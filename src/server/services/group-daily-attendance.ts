import { Prisma } from "../../../generated/prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/http/api-error";
import type { Actor } from "@/server/auth/session";

const groupIdSchema = z.uuid();
const dateSchema = z.iso.date();
const saveSchema = z.object({
  date: dateSchema,
  records: z
    .array(z.object({ studentId: z.uuid(), present: z.boolean() }))
    .min(1)
    .max(500),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Проверьте дату и отметки посещаемости.",
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

export function parseAttendanceGroupId(value: string) {
  const result = groupIdSchema.safeParse(value);
  if (!result.success) throw new ApiError(404, "GROUP_NOT_FOUND", "Группа не найдена.");
  return result.data;
}

async function getAttendanceGroup(
  actor: Actor,
  groupId: string,
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma> = getPrisma(),
) {
  const group = await client.studyGroup.findFirst({
    where: { id: groupId, isActive: true },
    select: {
      id: true,
      name: true,
      curatorId: true,
      memberships: {
        where: { studentId: actor.id, leftAt: null, isGroupLeader: true },
        select: { id: true },
      },
    },
  });
  if (!group) throw new ApiError(404, "GROUP_NOT_FOUND", "Активная группа не найдена.");
  const allowed =
    (actor.role === "TEACHER" && group.curatorId === actor.id) ||
    (actor.role === "STUDENT" && group.memberships.length > 0);
  if (!allowed) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Посещаемость группы может отмечать только её куратор или староста.",
    );
  }
  return group;
}

async function getRoster(
  groupId: string,
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma> = getPrisma(),
) {
  return client.groupMember.findMany({
    where: {
      groupId,
      leftAt: null,
      student: { status: "ACTIVE", deletedAt: null },
    },
    orderBy: [
      { student: { lastName: "asc" } },
      { student: { firstName: "asc" } },
      { student: { middleName: "asc" } },
    ],
    select: { studentId: true, student: { select: { name: true, email: true } } },
  });
}

export async function getGroupDailyAttendance(actor: Actor, groupId: string, dateText: string) {
  const date = parse(dateSchema, dateText);
  const group = await getAttendanceGroup(actor, groupId);
  const sessionDate = new Date(`${date}T00:00:00.000Z`);
  const [roster, attendance] = await Promise.all([
    getRoster(group.id),
    getPrisma().groupDailyAttendance.findMany({
      where: { groupId: group.id, sessionDate },
      select: { studentId: true, status: true },
    }),
  ]);
  const existing = new Map(attendance.map((record) => [record.studentId, record.status]));
  return {
    group: { id: group.id, name: group.name },
    date,
    records: roster.map(({ studentId, student }) => ({
      studentId,
      name: student.name,
      email: student.email,
      present: existing.get(studentId) === "PRESENT",
    })),
  };
}

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function markGroupDailyAttendance(
  actor: Actor,
  groupId: string,
  body: unknown,
  request: Request,
) {
  const value = parse(saveSchema, body);
  const sessionDate = new Date(`${value.date}T00:00:00.000Z`);
  const ids = value.records.map((record) => record.studentId);
  if (new Set(ids).size !== ids.length) {
    throw new ApiError(422, "DUPLICATE_STUDENT", "В списке есть повторяющиеся студенты.");
  }

  return getPrisma().$transaction(async (tx) => {
    const group = await getAttendanceGroup(actor, groupId, tx);
    const roster = await getRoster(group.id, tx);
    const rosterIds = new Set(roster.map((student) => student.studentId));
    if (ids.length !== rosterIds.size || ids.some((id) => !rosterIds.has(id))) {
      throw new ApiError(
        422,
        "ROSTER_MISMATCH",
        "Передайте отметку для каждого активного студента этой группы.",
      );
    }

    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${group.id}:${value.date}`}))::text`;
    const before = await tx.groupDailyAttendance.findMany({
      where: { groupId: group.id, sessionDate },
      select: { studentId: true, status: true },
    });
    for (const record of value.records) {
      const status = record.present ? "PRESENT" : "ABSENT";
      await tx.groupDailyAttendance.upsert({
        where: {
          groupId_sessionDate_studentId: {
            groupId: group.id,
            sessionDate,
            studentId: record.studentId,
          },
        },
        create: {
          groupId: group.id,
          sessionDate,
          studentId: record.studentId,
          status,
          markedById: actor.id,
        },
        update: { status, markedById: actor.id, markedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "attendance.group_daily_bulk_marked",
        entityType: "StudyGroup",
        entityId: group.id,
        beforeJson: auditJson({ date: value.date, records: before }),
        afterJson: auditJson({
          date: value.date,
          records: value.records.map((record) => ({
            studentId: record.studentId,
            status: record.present ? "PRESENT" : "ABSENT",
          })),
        }),
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: request.headers.get("user-agent")?.slice(0, 1000) ?? null,
      },
    });
    return { groupId: group.id, date: value.date, updated: value.records.length };
  });
}
