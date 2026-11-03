import { Prisma } from "../../../generated/prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/http/api-error";
import type { Actor } from "@/server/auth/session";
import {
  getGroupDailyAttendance,
  markGroupDailyAttendance,
} from "@/server/services/group-daily-attendance";
import {
  cleanScheduleSubjectName,
  parseScheduleWorkbook,
  type ImportedLesson,
  type ScheduleWorkbookResult,
} from "@/server/services/schedule-xlsx";

export type ImportedScheduleView = {
  id: string;
  fileName: string;
  importedAt: string;
  summary: ScheduleWorkbookResult["summary"];
  entries: ImportedScheduleEntry[];
  groups?: Array<{ id: string; name: string }>;
};

const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const nullableText = (max: number) =>
  z.preprocess((value) => (value === "" ? null : value), z.string().trim().max(max).nullable());
const updateLessonSchema = z.object({
  entryIndex: z.coerce.number().int().min(0).max(9999),
  groupId: z.uuid(),
  pair: z.coerce.number().int().min(1).max(8),
  startTime: timeSchema,
  endTime: timeSchema,
  subject: z.string().trim().min(1).max(200),
  teacher: nullableText(160),
  room: nullableText(100),
});
const attendanceQuerySchema = z.object({
  entryIndex: z.coerce.number().int().min(0).max(9999),
  date: z.iso.date(),
});
const importedAttendanceSchema = z.object({
  entryIndex: z.number().int().min(0).max(9999),
  date: z.iso.date(),
  records: z
    .array(
      z.object({
        studentId: z.uuid(),
        status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]),
        note: z.string().trim().max(1000).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});

type ImportedScheduleEntry = ImportedLesson & { canMarkAttendance?: boolean };

function requireScheduleAdmin(actor: Actor) {
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "ADMIN") {
    throw new ApiError(403, "FORBIDDEN", "Импортировать расписание могут только администраторы.");
  }
}

export async function importScheduleWorkbook(
  actor: Actor,
  fileName: string,
  bytes: Buffer,
  request: Request,
) {
  requireScheduleAdmin(actor);
  const prisma = getPrisma();
  const groups = await prisma.studyGroup.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  const parsed = parseScheduleWorkbook(bytes, fileName, groups);
  if (parsed.summary.unmappedGroups.length) {
    throw new ApiError(
      422,
      "UNMAPPED_SCHEDULE_GROUPS",
      `Нельзя заменить расписание: сначала добавьте или сопоставьте группы ${parsed.summary.unmappedGroups.join(", ")}.`,
    );
  }
  const safeName = fileName.replace(/[\x00-\x1f]/g, "").slice(0, 255) || "schedule.xlsx";
  return prisma.$transaction(async (tx) => {
    const record = await tx.scheduleImport.create({
      data: {
        fileName: safeName,
        entries: parsed.entries as unknown as Prisma.InputJsonValue,
        summary: parsed.summary as unknown as Prisma.InputJsonValue,
        importedById: actor.id,
      },
      select: { id: true, fileName: true, summary: true, createdAt: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "schedule.imported",
        entityType: "ScheduleImport",
        entityId: record.id,
        afterJson: { fileName: record.fileName, ...parsed.summary },
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: request.headers.get("user-agent")?.slice(0, 1000) ?? null,
      },
    });
    return record;
  });
}

export async function getImportedSchedule(actor: Actor): Promise<ImportedScheduleView | null> {
  const prisma = getPrisma();
  const latest = await prisma.scheduleImport.findFirst({ orderBy: { createdAt: "desc" } });
  if (!latest) return null;
  const rawEntries = latest.entries as unknown as ImportedLesson[];
  const groups =
    actor.role === "SUPER_ADMIN" || actor.role === "ADMIN"
      ? await prisma.studyGroup.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : undefined;
  let allowedGroupIds: Set<string> | null = null;
  let leaderGroupIds = new Set<string>();
  let curatorGroupIds = new Set<string>();
  if (actor.role === "STUDENT") {
    const memberships = await prisma.groupMember.findMany({
      where: { studentId: actor.id, leftAt: null },
      select: { groupId: true, isGroupLeader: true },
    });
    allowedGroupIds = new Set(memberships.map((item) => item.groupId));
    leaderGroupIds = new Set(
      memberships.filter((item) => item.isGroupLeader).map((item) => item.groupId),
    );
  } else if (actor.role === "TEACHER") {
    const groups = await prisma.studyGroup.findMany({
      where: {
        isActive: true,
        OR: [
          { curatorId: actor.id },
          {
            enrollments: {
              some: {
                status: "ACTIVE",
                course: { teacherAssignments: { some: { teacherId: actor.id } } },
              },
            },
          },
        ],
      },
      select: { id: true, curatorId: true },
    });
    allowedGroupIds = new Set(groups.map((group) => group.id));
    curatorGroupIds = new Set(
      groups.filter((group) => group.curatorId === actor.id).map((group) => group.id),
    );
  }
  const entries = allowedGroupIds
    ? rawEntries.filter((entry) => entry.groupId !== null && allowedGroupIds?.has(entry.groupId))
    : rawEntries;
  return {
    id: latest.id,
    fileName: latest.fileName,
    importedAt: latest.createdAt.toISOString(),
    summary: latest.summary as unknown as ScheduleWorkbookResult["summary"],
    entries: entries.map((entry) => ({
      ...entry,
      canMarkAttendance:
        (actor.role === "STUDENT" && Boolean(entry.groupId && leaderGroupIds.has(entry.groupId))) ||
        (actor.role === "TEACHER" && Boolean(entry.groupId && curatorGroupIds.has(entry.groupId))),
    })),
    ...(groups ? { groups } : {}),
  };
}

async function getImportedAttendanceContext(
  actor: Actor,
  importId: string,
  entryIndex: number,
  date: string,
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma> = getPrisma(),
) {
  const imported = await client.scheduleImport.findUnique({ where: { id: importId } });
  if (!imported)
    throw new ApiError(404, "SCHEDULE_IMPORT_NOT_FOUND", "Импорт расписания не найден.");
  const latest = await client.scheduleImport.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (latest?.id !== imported.id) {
    throw new ApiError(
      409,
      "SCHEDULE_IMPORT_CHANGED",
      "Расписание уже заменено. Обновите страницу.",
    );
  }
  const entries = imported.entries as unknown as ImportedLesson[];
  const entry = entries[entryIndex];
  if (!entry || entry.date !== date || !entry.groupId) {
    throw new ApiError(404, "SCHEDULE_ENTRY_NOT_FOUND", "Занятие на эту дату не найдено.");
  }
  const group = await client.studyGroup.findFirst({
    where: { id: entry.groupId, isActive: true },
    select: { id: true, name: true, curatorId: true },
  });
  if (!group) throw new ApiError(404, "GROUP_NOT_FOUND", "Группа занятия не найдена.");

  let allowed = false;
  if (actor.role === "STUDENT") {
    const membership = await client.groupMember.findFirst({
      where: {
        groupId: group.id,
        studentId: actor.id,
        leftAt: null,
        isGroupLeader: true,
      },
      select: { id: true },
    });
    allowed = Boolean(membership);
  } else if (actor.role === "TEACHER") {
    allowed = group.curatorId === actor.id;
  }
  if (!allowed) {
    throw new ApiError(
      403,
      "IMPORTED_ATTENDANCE_FORBIDDEN",
      "Посещаемость группы может отмечать только её куратор или староста.",
    );
  }
  return {
    imported,
    entry,
    group,
    sessionDate: new Date(`${date}T00:00:00.000Z`),
  };
}

export async function getImportedScheduleAttendance(
  actor: Actor,
  importId: string,
  query: unknown,
) {
  const parsed = attendanceQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Проверьте дату занятия.",
      parsed.error.flatten().fieldErrors,
    );
  }
  const context = await getImportedAttendanceContext(
    actor,
    importId,
    parsed.data.entryIndex,
    parsed.data.date,
  );
  const attendance = await getGroupDailyAttendance(actor, context.group.id, parsed.data.date);
  return {
    importId,
    entryIndex: parsed.data.entryIndex,
    date: parsed.data.date,
    group: context.group,
    subject: context.entry.subject,
    startTime: context.entry.startTime,
    endTime: context.entry.endTime,
    students: attendance.records.map((record) => ({
      studentId: record.studentId,
      name: record.name,
      status: record.present ? "PRESENT" : "ABSENT",
      note: "",
    })),
  };
}

export async function markImportedScheduleAttendance(
  actor: Actor,
  importId: string,
  body: unknown,
  request: Request,
) {
  const parsed = importedAttendanceSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Проверьте отметки посещаемости.",
      parsed.error.flatten().fieldErrors,
    );
  }
  const context = await getImportedAttendanceContext(
    actor,
    importId,
    parsed.data.entryIndex,
    parsed.data.date,
  );
  return markGroupDailyAttendance(
    actor,
    context.group.id,
    {
      date: parsed.data.date,
      records: parsed.data.records.map(({ studentId, status }) => ({
        studentId,
        present: status === "PRESENT",
      })),
    },
    request,
  );
}

export async function updateImportedScheduleLesson(
  actor: Actor,
  importId: string,
  body: unknown,
  request: Request,
) {
  requireScheduleAdmin(actor);
  const parsed = updateLessonSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Проверьте поля занятия.",
      parsed.error.flatten().fieldErrors,
    );
  }
  if (parsed.data.endTime <= parsed.data.startTime) {
    throw new ApiError(422, "INVALID_TIME_RANGE", "Время окончания должно быть позже начала.");
  }

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(71624003)::text`;
    const latest = await tx.scheduleImport.findFirst({ orderBy: { createdAt: "desc" } });
    if (!latest || latest.id !== importId) {
      throw new ApiError(
        409,
        "SCHEDULE_IMPORT_CHANGED",
        "Расписание уже заменено другой загрузкой. Обновите страницу и повторите изменение.",
      );
    }
    const group = await tx.studyGroup.findFirst({
      where: { id: parsed.data.groupId, isActive: true },
      select: { id: true, name: true },
    });
    if (!group) throw new ApiError(422, "INVALID_GROUP", "Выберите активную группу.");
    const subject = cleanScheduleSubjectName(parsed.data.subject);
    if (!subject) {
      throw new ApiError(
        422,
        "INVALID_SUBJECT",
        "Укажите название предмета без кода группы или класса.",
      );
    }
    const entries = latest.entries as unknown as ImportedLesson[];
    const previous = entries[parsed.data.entryIndex];
    if (!previous) throw new ApiError(404, "SCHEDULE_ENTRY_NOT_FOUND", "Занятие не найдено.");
    const entry: ImportedLesson = {
      ...previous,
      groupId: group.id,
      groupName: group.name,
      pair: parsed.data.pair,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      subject,
      teacher: parsed.data.teacher,
      room: parsed.data.room,
      sourceText: [subject, parsed.data.teacher, parsed.data.room].filter(Boolean).join(" · "),
    };
    entries[parsed.data.entryIndex] = entry;
    await tx.scheduleImport.update({
      where: { id: latest.id },
      data: { entries: entries as unknown as Prisma.InputJsonValue },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "schedule.imported_lesson_updated",
        entityType: "ScheduleImport",
        entityId: latest.id,
        beforeJson: {
          entryIndex: parsed.data.entryIndex,
          groupName: previous.groupName,
          pair: previous.pair,
          startTime: previous.startTime,
          endTime: previous.endTime,
          subject: previous.subject,
          teacher: previous.teacher,
          room: previous.room,
        },
        afterJson: {
          entryIndex: parsed.data.entryIndex,
          groupName: entry.groupName,
          pair: entry.pair,
          startTime: entry.startTime,
          endTime: entry.endTime,
          subject: entry.subject,
          teacher: entry.teacher,
          room: entry.room,
        },
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: request.headers.get("user-agent")?.slice(0, 1000) ?? null,
      },
    });
    return { entry };
  });
}
