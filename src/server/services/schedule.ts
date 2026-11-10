import { Prisma } from "../../../generated/prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/http/api-error";
import type { Actor } from "@/server/auth/session";
import {
  getGroupDailyAttendance,
  markGroupDailyAttendance,
} from "@/server/services/group-daily-attendance";
import { getImportedSchedule } from "@/server/services/schedule-import";

const idSchema = z.uuid();
const dateSchema = z.iso.date();
const timeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Укажите время в формате ЧЧ:ММ.");
const roomSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().trim().max(100).nullable(),
);
const scheduleFields = {
  termId: z.uuid(),
  groupId: z.uuid(),
  courseId: z.uuid(),
  teacherId: z.uuid(),
  room: roomSchema.optional(),
  dayOfWeek: z.coerce.number().int().min(1).max(7),
  startTime: timeSchema,
  endTime: timeSchema,
  weekPattern: z.enum(["EVERY", "ODD", "EVEN"]).default("EVERY"),
};
const createSchema = z.object(scheduleFields);
const updateSchema = z.object({
  termId: z.uuid().optional(),
  groupId: z.uuid().optional(),
  courseId: z.uuid().optional(),
  teacherId: z.uuid().optional(),
  room: roomSchema.optional(),
  dayOfWeek: z.coerce.number().int().min(1).max(7).optional(),
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
  weekPattern: z.enum(["EVERY", "ODD", "EVEN"]).optional(),
});
const attendanceSchema = z.object({
  date: dateSchema,
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

type ScheduleInput = {
  termId: string;
  groupId: string;
  courseId: string;
  teacherId: string;
  room: string | null;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  weekPattern: "EVERY" | "ODD" | "EVEN";
};

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Проверьте поля формы.",
      result.error.flatten().fieldErrors,
    );
  return result.data;
}

export function parseScheduleId(value: string): string {
  const result = idSchema.safeParse(value);
  if (!result.success) throw new ApiError(404, "SCHEDULE_NOT_FOUND", "Занятие не найдено.");
  return result.data;
}

function toMinute(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function toTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function audit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  request: Request,
) {
  await tx.auditLog.create({
    data: {
      actorId: actor.id,
      action,
      entityType,
      entityId,
      beforeJson: before === undefined ? Prisma.JsonNull : auditJson(before),
      afterJson: after === undefined ? Prisma.JsonNull : auditJson(after),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    },
  });
}

function requireScheduleAdmin(actor: Actor) {
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "ADMIN") {
    throw new ApiError(403, "FORBIDDEN", "Расписание могут менять только администраторы.");
  }
}

async function validateScheduleInput(value: ScheduleInput) {
  if (value.endMinute <= value.startMinute) {
    throw new ApiError(
      422,
      "INVALID_TIME_RANGE",
      "Время окончания должно быть позже времени начала.",
    );
  }
  const prisma = getPrisma();
  const [term, group, course, teacher] = await Promise.all([
    prisma.term.findUnique({
      where: { id: value.termId },
      select: { id: true, academicYearId: true, startsOn: true, endsOn: true },
    }),
    prisma.studyGroup.findUnique({
      where: { id: value.groupId },
      select: { id: true, academicYearId: true, isActive: true },
    }),
    prisma.course.findFirst({
      where: { id: value.courseId, deletedAt: null, status: { not: "ARCHIVED" } },
      select: {
        id: true,
        termId: true,
        academicYearId: true,
        teacherAssignments: { where: { teacherId: value.teacherId }, select: { id: true } },
      },
    }),
    prisma.user.findFirst({
      where: { id: value.teacherId, role: "TEACHER", status: "ACTIVE", deletedAt: null },
      select: { id: true },
    }),
  ]);
  if (!term || !group?.isActive || !course || !teacher || !course.teacherAssignments.length) {
    throw new ApiError(
      422,
      "INVALID_SCHEDULE_RELATION",
      "Выберите активный семестр, группу, курс и назначенного на курс преподавателя.",
    );
  }
  if (
    course.termId !== term.id ||
    course.academicYearId !== term.academicYearId ||
    group.academicYearId !== term.academicYearId
  ) {
    throw new ApiError(
      422,
      "ACADEMIC_PERIOD_MISMATCH",
      "Группа, курс и семестр должны относиться к одному учебному году и периоду.",
    );
  }
}

function isoWeekday(value: Date): number {
  return ((value.getUTCDay() + 6) % 7) + 1;
}

function matchesPattern(date: Date, termStart: Date, pattern: "EVERY" | "ODD" | "EVEN"): boolean {
  if (pattern === "EVERY") return true;
  const start = new Date(
    Date.UTC(termStart.getUTCFullYear(), termStart.getUTCMonth(), termStart.getUTCDate()),
  );
  const mondayOffset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  const week = Math.floor((date.getTime() - start.getTime()) / (7 * 86400000)) + 1;
  return pattern === "ODD" ? week % 2 === 1 : week % 2 === 0;
}

function shareOccurrence(
  first: {
    dayOfWeek: number;
    weekPattern: "EVERY" | "ODD" | "EVEN";
    term: { startsOn: Date; endsOn: Date };
  },
  second: {
    dayOfWeek: number;
    weekPattern: "EVERY" | "ODD" | "EVEN";
    term: { startsOn: Date; endsOn: Date };
  },
): boolean {
  if (first.dayOfWeek !== second.dayOfWeek) return false;
  const from = Math.max(first.term.startsOn.getTime(), second.term.startsOn.getTime());
  const until = Math.min(first.term.endsOn.getTime(), second.term.endsOn.getTime());
  for (let timestamp = from; timestamp <= until; timestamp += 86400000) {
    const date = new Date(timestamp);
    if (
      isoWeekday(date) === first.dayOfWeek &&
      matchesPattern(date, first.term.startsOn, first.weekPattern) &&
      matchesPattern(date, second.term.startsOn, second.weekPattern)
    )
      return true;
  }
  return false;
}

async function assertNoConflict(
  value: ScheduleInput,
  excludeId?: string,
  tx?: Prisma.TransactionClient,
) {
  const prisma = tx ?? getPrisma();
  const term = await prisma.term.findUnique({
    where: { id: value.termId },
    select: { startsOn: true, endsOn: true },
  });
  if (!term) throw new ApiError(404, "TERM_NOT_FOUND", "Семестр не найден.");
  const resourceConflicts: Prisma.ScheduleEntryWhereInput[] = [
    { groupId: value.groupId },
    { teacherId: value.teacherId },
  ];
  if (value.room) resourceConflicts.push({ room: { equals: value.room, mode: "insensitive" } });
  const candidates = await prisma.scheduleEntry.findMany({
    where: {
      dayOfWeek: value.dayOfWeek,
      startMinute: { lt: value.endMinute },
      endMinute: { gt: value.startMinute },
      deletedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: resourceConflicts,
    },
    include: {
      term: { select: { startsOn: true, endsOn: true } },
      group: { select: { name: true } },
      course: { select: { title: true } },
      teacher: { select: { name: true } },
    },
  });
  const conflict = candidates.find((entry) =>
    shareOccurrence({ dayOfWeek: value.dayOfWeek, weekPattern: value.weekPattern, term }, entry),
  );
  if (conflict) {
    const resource =
      conflict.groupId === value.groupId
        ? "группы"
        : conflict.teacherId === value.teacherId
          ? "преподавателя"
          : "аудитории";
    throw new ApiError(
      409,
      "SCHEDULE_CONFLICT",
      `В это время уже занята ${resource}: ${conflict.course.title}, ${toTime(conflict.startMinute)}–${toTime(conflict.endMinute)}.`,
    );
  }
}

function toScheduleInput(parsed: z.infer<typeof createSchema>): ScheduleInput {
  const { startTime, endTime, ...fields } = parsed;
  const input: ScheduleInput = {
    ...fields,
    room: parsed.room?.trim() || null,
    startMinute: toMinute(startTime),
    endMinute: toMinute(endTime),
  };
  if (input.endMinute <= input.startMinute)
    throw new ApiError(
      422,
      "INVALID_TIME_RANGE",
      "Время окончания должно быть позже времени начала.",
    );
  return input;
}

export async function getScheduleOptions(actor: Actor) {
  requireScheduleAdmin(actor);
  const prisma = getPrisma();
  const [terms, groups, courses, teachers] = await Promise.all([
    prisma.term.findMany({
      orderBy: [{ isActive: "desc" }, { startsOn: "desc" }],
      include: { academicYear: { select: { id: true, name: true } } },
    }),
    prisma.studyGroup.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: { academicYear: { select: { id: true, name: true } } },
    }),
    prisma.course.findMany({
      where: { deletedAt: null, status: { not: "ARCHIVED" } },
      orderBy: { title: "asc" },
      include: {
        teacherAssignments: {
          include: { teacher: { select: { id: true, name: true, status: true } } },
        },
      },
    }),
    prisma.user.findMany({
      where: { role: "TEACHER", status: "ACTIVE", deletedAt: null },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, name: true },
    }),
  ]);
  return {
    terms: terms.map((term) => ({
      id: term.id,
      name: `${term.academicYear.name} · ${term.name}`,
      startsOn: dateOnly(term.startsOn),
      endsOn: dateOnly(term.endsOn),
    })),
    groups: groups.map((group) => ({
      id: group.id,
      name: `${group.name} · ${group.academicYear.name}`,
      academicYearId: group.academicYearId,
    })),
    courses: courses.map((course) => ({
      id: course.id,
      title: course.title,
      termId: course.termId,
      academicYearId: course.academicYearId,
      teachers: course.teacherAssignments
        .filter((assignment) => assignment.teacher.status === "ACTIVE")
        .map((assignment) => assignment.teacher),
    })),
    teachers,
  };
}

export async function listScheduleEntries(actor: Actor) {
  const prisma = getPrisma();
  let groupIds: string[] = [];
  const where: Prisma.ScheduleEntryWhereInput = { deletedAt: null };
  if (actor.role === "STUDENT") {
    const memberships = await prisma.groupMember.findMany({
      where: { studentId: actor.id, leftAt: null },
      select: { groupId: true },
    });
    groupIds = memberships.map((membership) => membership.groupId);
    if (!groupIds.length) return [];
    where.groupId = { in: groupIds };
    where.course = {
      enrollments: { some: { studentId: actor.id, status: "ACTIVE", groupId: { in: groupIds } } },
    };
  } else if (actor.role === "TEACHER") {
    where.OR = [{ teacherId: actor.id }, { group: { curatorId: actor.id } }];
  }
  const entries = await prisma.scheduleEntry.findMany({
    where,
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }, { group: { name: "asc" } }],
    take: 500,
    include: {
      term: {
        select: {
          id: true,
          name: true,
          startsOn: true,
          endsOn: true,
          academicYear: { select: { name: true } },
        },
      },
      group: {
        select: {
          id: true,
          name: true,
          curatorId: true,
          memberships: {
            where: { studentId: actor.id, leftAt: null, isGroupLeader: true },
            select: { id: true },
          },
        },
      },
      course: { select: { id: true, title: true, slug: true } },
      teacher: { select: { id: true, name: true } },
      _count: { select: { attendance: true } },
    },
  });
  return entries.map((entry) => ({
    ...entry,
    canMarkAttendance:
      (actor.role === "TEACHER" && entry.group.curatorId === actor.id) ||
      (actor.role === "STUDENT" && entry.group.memberships.length > 0),
    group: { id: entry.group.id, name: entry.group.name },
    term: {
      ...entry.term,
      startsOn: dateOnly(entry.term.startsOn),
      endsOn: dateOnly(entry.term.endsOn),
    },
    startTime: toTime(entry.startMinute),
    endTime: toTime(entry.endMinute),
  }));
}

export async function createScheduleEntry(actor: Actor, body: unknown, request: Request) {
  requireScheduleAdmin(actor);
  const value = toScheduleInput(parse(createSchema, body));
  await validateScheduleInput(value);
  return getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(71624001)::text`;
    await assertNoConflict(value, undefined, tx);
    const entry = await tx.scheduleEntry.create({
      data: { ...value, createdById: actor.id },
      include: { term: true, group: true, course: true, teacher: true },
    });
    await audit(
      tx,
      actor,
      "schedule.created",
      "ScheduleEntry",
      entry.id,
      undefined,
      {
        termId: entry.termId,
        groupId: entry.groupId,
        courseId: entry.courseId,
        teacherId: entry.teacherId,
        room: entry.room,
        dayOfWeek: entry.dayOfWeek,
        startTime: toTime(entry.startMinute),
        endTime: toTime(entry.endMinute),
        weekPattern: entry.weekPattern,
      },
      request,
    );
    return entry;
  });
}

export async function updateScheduleEntry(
  actor: Actor,
  scheduleId: string,
  body: unknown,
  request: Request,
) {
  requireScheduleAdmin(actor);
  const existing = await getPrisma().scheduleEntry.findFirst({
    where: { id: scheduleId, deletedAt: null },
    include: { term: true },
  });
  if (!existing) throw new ApiError(404, "SCHEDULE_NOT_FOUND", "Занятие не найдено.");
  const patch = parse(updateSchema, body);
  if (!Object.keys(patch).length)
    throw new ApiError(422, "EMPTY_UPDATE", "Укажите поля для изменения.");
  const value: ScheduleInput = {
    termId: patch.termId ?? existing.termId,
    groupId: patch.groupId ?? existing.groupId,
    courseId: patch.courseId ?? existing.courseId,
    teacherId: patch.teacherId ?? existing.teacherId,
    room: patch.room === undefined ? existing.room : patch.room?.trim() || null,
    dayOfWeek: patch.dayOfWeek ?? existing.dayOfWeek,
    startMinute: patch.startTime === undefined ? existing.startMinute : toMinute(patch.startTime),
    endMinute: patch.endTime === undefined ? existing.endMinute : toMinute(patch.endTime),
    weekPattern: patch.weekPattern ?? existing.weekPattern,
  };
  if (value.endMinute <= value.startMinute)
    throw new ApiError(
      422,
      "INVALID_TIME_RANGE",
      "Время окончания должно быть позже времени начала.",
    );
  await validateScheduleInput(value);
  return getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(71624001)::text`;
    await assertNoConflict(value, scheduleId, tx);
    const updated = await tx.scheduleEntry.update({
      where: { id: scheduleId },
      data: { ...value, updatedById: actor.id },
    });
    await audit(
      tx,
      actor,
      "schedule.updated",
      "ScheduleEntry",
      scheduleId,
      {
        dayOfWeek: existing.dayOfWeek,
        startMinute: existing.startMinute,
        endMinute: existing.endMinute,
        room: existing.room,
        weekPattern: existing.weekPattern,
      },
      {
        dayOfWeek: updated.dayOfWeek,
        startMinute: updated.startMinute,
        endMinute: updated.endMinute,
        room: updated.room,
        weekPattern: updated.weekPattern,
      },
      request,
    );
    return updated;
  });
}

export async function archiveScheduleEntry(actor: Actor, scheduleId: string, request: Request) {
  requireScheduleAdmin(actor);
  const existing = await getPrisma().scheduleEntry.findFirst({
    where: { id: scheduleId, deletedAt: null },
    select: {
      id: true,
      groupId: true,
      courseId: true,
      teacherId: true,
      dayOfWeek: true,
      startMinute: true,
      endMinute: true,
    },
  });
  if (!existing) throw new ApiError(404, "SCHEDULE_NOT_FOUND", "Занятие не найдено.");
  return getPrisma().$transaction(async (tx) => {
    const archived = await tx.scheduleEntry.update({
      where: { id: scheduleId },
      data: { deletedAt: new Date(), updatedById: actor.id },
    });
    await audit(
      tx,
      actor,
      "schedule.archived",
      "ScheduleEntry",
      scheduleId,
      existing,
      { deletedAt: archived.deletedAt?.toISOString() },
      request,
    );
    return { id: scheduleId, archived: true };
  });
}

export async function getAttendanceSession(actor: Actor, scheduleId: string, dateText: string) {
  const entry = await getPrisma().scheduleEntry.findFirst({
    where: { id: scheduleId, deletedAt: null },
    select: {
      id: true,
      groupId: true,
      course: { select: { title: true } },
      group: { select: { name: true } },
    },
  });
  if (!entry) throw new ApiError(404, "SCHEDULE_NOT_FOUND", "Занятие не найдено.");
  const session = await getGroupDailyAttendance(actor, entry.groupId, dateText);
  return {
    schedule: { id: entry.id, course: entry.course.title, group: entry.group.name, date: dateText },
    records: session.records.map((record) => ({
      ...record,
      status: record.present ? "PRESENT" : "ABSENT",
      note: null,
    })),
  };
}

export async function markAttendance(
  actor: Actor,
  scheduleId: string,
  body: unknown,
  request: Request,
) {
  const value = parse(attendanceSchema, body);
  const entry = await getPrisma().scheduleEntry.findFirst({
    where: { id: scheduleId, deletedAt: null },
    select: { groupId: true },
  });
  if (!entry) throw new ApiError(404, "SCHEDULE_NOT_FOUND", "Занятие не найдено.");
  return markGroupDailyAttendance(
    actor,
    entry.groupId,
    {
      date: value.date,
      records: value.records.map(({ studentId, status }) => ({
        studentId,
        present: status === "PRESENT",
      })),
    },
    request,
  );
}

function parseRange(from?: string | null, to?: string | null) {
  const today = new Date();
  const toDefault = dateOnly(today);
  const fromDefaultDate = new Date(today.getTime() - 29 * 86400000);
  const fromDefault = dateOnly(fromDefaultDate);
  const fromValue = from ?? fromDefault;
  const toValue = to ?? toDefault;
  if (
    !dateSchema.safeParse(fromValue).success ||
    !dateSchema.safeParse(toValue).success ||
    fromValue > toValue
  ) {
    throw new ApiError(422, "INVALID_DATE_RANGE", "Укажите корректный диапазон дат.");
  }
  return {
    from: new Date(`${fromValue}T00:00:00.000Z`),
    to: new Date(`${toValue}T23:59:59.999Z`),
    fromText: fromValue,
    toText: toValue,
  };
}

async function readAttendance(
  actor: Actor,
  from?: string | null,
  to?: string | null,
  studentOnly = false,
) {
  const range = parseRange(from, to);
  if (!studentOnly && actor.role !== "TEACHER") {
    throw new ApiError(403, "FORBIDDEN", "Отчёт по посещаемости доступен преподавателям.");
  }
  const prisma = getPrisma();
  const records = await prisma.attendance.findMany({
    where: {
      studentId: studentOnly ? actor.id : undefined,
      sessionDate: { gte: range.from, lte: range.to },
      ...(actor.role === "TEACHER" && !studentOnly
        ? { scheduleEntry: { OR: [{ teacherId: actor.id }, { group: { curatorId: actor.id } }] } }
        : {}),
    },
    orderBy: [{ sessionDate: "desc" }, { scheduleEntry: { startMinute: "asc" } }],
    take: 10000,
    include: {
      student: { select: { id: true, name: true } },
      scheduleEntry: {
        select: {
          id: true,
          dayOfWeek: true,
          startMinute: true,
          endMinute: true,
          room: true,
          group: { select: { id: true, name: true } },
          course: { select: { id: true, title: true } },
          teacher: { select: { id: true, name: true } },
        },
      },
    },
  });
  const dailyRecords = await prisma.groupDailyAttendance.findMany({
    where: {
      studentId: studentOnly ? actor.id : undefined,
      sessionDate: { gte: range.from, lte: range.to },
      ...(actor.role === "TEACHER" && !studentOnly ? { group: { curatorId: actor.id } } : {}),
    },
    orderBy: { sessionDate: "desc" },
    take: 10000,
    include: {
      student: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
      markedBy: { select: { name: true } },
    },
  });
  const dailyRecordKeys = new Set(
    dailyRecords.map(
      (record) => `${record.studentId}:${dateOnly(record.sessionDate)}:${record.groupId}`,
    ),
  );
  const classRecords = records.filter(
    (record) =>
      !dailyRecordKeys.has(
        `${record.studentId}:${dateOnly(record.sessionDate)}:${record.scheduleEntry.group.id}`,
      ),
  );
  const aggregates = new Map<
    string,
    {
      studentId: string;
      studentName: string;
      group: string;
      course: string;
      total: number;
      PRESENT: number;
      ABSENT: number;
      LATE: number;
      EXCUSED: number;
    }
  >();
  for (const record of classRecords) {
    const key = `${record.studentId}:${record.scheduleEntry.course.id}`;
    const item = aggregates.get(key) ?? {
      studentId: record.studentId,
      studentName: record.student.name,
      group: record.scheduleEntry.group.name,
      course: record.scheduleEntry.course.title,
      total: 0,
      PRESENT: 0,
      ABSENT: 0,
      LATE: 0,
      EXCUSED: 0,
    };
    item.total += 1;
    item[record.status] += 1;
    aggregates.set(key, item);
  }
  for (const record of dailyRecords) {
    const key = `${record.studentId}:group-daily`;
    const item = aggregates.get(key) ?? {
      studentId: record.studentId,
      studentName: record.student.name,
      group: record.group.name,
      course: "Посещаемость за день",
      total: 0,
      PRESENT: 0,
      ABSENT: 0,
      LATE: 0,
      EXCUSED: 0,
    };
    item.total += 1;
    item[record.status] += 1;
    aggregates.set(key, item);
  }
  return {
    from: range.fromText,
    to: range.toText,
    items: [...aggregates.values()].sort(
      (a, b) =>
        a.group.localeCompare(b.group, "ru") || a.studentName.localeCompare(b.studentName, "ru"),
    ),
    records: [
      ...classRecords.map((record) => ({
        id: record.id,
        date: dateOnly(record.sessionDate),
        status: record.status,
        note: record.note,
        student: record.student,
        group: record.scheduleEntry.group.name,
        course: record.scheduleEntry.course.title,
        teacher: record.scheduleEntry.teacher.name,
        startTime: toTime(record.scheduleEntry.startMinute),
        endTime: toTime(record.scheduleEntry.endMinute),
        room: record.scheduleEntry.room,
      })),
      ...dailyRecords.map((record) => ({
        id: record.id,
        date: dateOnly(record.sessionDate),
        status: record.status,
        note: null,
        student: record.student,
        group: record.group.name,
        course: "Посещаемость за день",
        teacher: record.markedBy.name,
        startTime: "За день",
        endTime: "",
        room: null,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date)),
    total: classRecords.length + dailyRecords.length,
  };
}

export async function getAttendanceReport(actor: Actor, from?: string | null, to?: string | null) {
  return readAttendance(actor, from, to);
}

export async function getMyAttendance(actor: Actor, from?: string | null, to?: string | null) {
  if (actor.role !== "STUDENT")
    throw new ApiError(403, "FORBIDDEN", "Личный отчёт доступен студенту.");
  return readAttendance(actor, from, to, true);
}

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function icsDate(date: Date, minute: number): string {
  const base = dateOnly(date).replaceAll("-", "");
  return `${base}T${String(Math.floor(minute / 60)).padStart(2, "0")}${String(minute % 60).padStart(2, "0")}00`;
}

export async function exportScheduleIcs(actor: Actor): Promise<string> {
  const importedSchedule = await getImportedSchedule(actor);
  const entries = await getPrisma().scheduleEntry.findMany({
    where:
      actor.role === "STUDENT"
        ? {
            id: { in: (await listScheduleEntries(actor)).map((entry) => entry.id) },
            deletedAt: null,
          }
        : actor.role === "TEACHER"
          ? { OR: [{ teacherId: actor.id }, { group: { curatorId: actor.id } }], deletedAt: null }
          : { deletedAt: null },
    include: {
      term: { select: { startsOn: true, endsOn: true } },
      group: { select: { name: true } },
      course: { select: { title: true } },
      teacher: { select: { name: true } },
    },
  });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KZHEXLY//College LMS//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Almaty",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0500",
    "TZOFFSETTO:+0500",
    "TZNAME:+05",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
  for (const entry of entries) {
    const current = new Date(
      Date.UTC(
        entry.term.startsOn.getUTCFullYear(),
        entry.term.startsOn.getUTCMonth(),
        entry.term.startsOn.getUTCDate(),
      ),
    );
    const until = new Date(
      Date.UTC(
        entry.term.endsOn.getUTCFullYear(),
        entry.term.endsOn.getUTCMonth(),
        entry.term.endsOn.getUTCDate(),
      ),
    );
    const description = `${entry.group.name} · ${entry.teacher.name}`;
    while (current <= until) {
      if (
        isoWeekday(current) === entry.dayOfWeek &&
        matchesPattern(current, entry.term.startsOn, entry.weekPattern)
      ) {
        lines.push(
          "BEGIN:VEVENT",
          `UID:${entry.id}-${dateOnly(current)}@kzhexly.local`,
          `DTSTAMP:${stamp}`,
          `DTSTART;TZID=Asia/Almaty:${icsDate(current, entry.startMinute)}`,
          `DTEND;TZID=Asia/Almaty:${icsDate(current, entry.endMinute)}`,
          `SUMMARY:${escapeIcs(entry.course.title)}`,
          `DESCRIPTION:${escapeIcs(description)}`,
          ...(entry.room ? [`LOCATION:${escapeIcs(entry.room)}`] : []),
          "END:VEVENT",
        );
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }
  for (const [index, entry] of (importedSchedule?.entries ?? []).entries()) {
    const description = [entry.groupName, entry.teacher].filter(Boolean).join(" · ");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${importedSchedule!.id}-${index}@kzhexly.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Almaty:${icsDate(new Date(`${entry.date}T00:00:00.000Z`), toMinute(entry.startTime))}`,
      `DTEND;TZID=Asia/Almaty:${icsDate(new Date(`${entry.date}T00:00:00.000Z`), toMinute(entry.endTime))}`,
      `SUMMARY:${escapeIcs(entry.subject)}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      ...(entry.room ? [`LOCATION:${escapeIcs(entry.room)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
