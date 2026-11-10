import { createHash } from "node:crypto";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/http/api-error";
import type { Actor } from "@/server/auth/session";
import type { ImportedLesson } from "@/server/services/schedule-xlsx";

const filtersSchema = z.object({
  groupId: z.uuid().optional(),
  from: z.iso.date(),
  to: z.iso.date(),
});
const updateSchema = z.object({
  groupId: z.uuid(),
  studentId: z.uuid(),
  lessonKey: z.string().max(100),
  date: z.iso.date(),
  value: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.null()]),
});

function requireTeacher(actor: Actor) {
  if (actor.role !== "TEACHER")
    throw new ApiError(403, "FORBIDDEN", "Журнал доступен преподавателям.");
}

function dateInRange(date: string, from: string, to: string) {
  return date >= from && date <= to;
}

function lessonTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export async function getLessonGradebook(actor: Actor, input: unknown) {
  requireTeacher(actor);
  const parsed = filtersSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(422, "INVALID_FILTER", "Проверьте даты и группу.");
  const { from, to } = parsed.data;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  if (days < 0 || days > 62) {
    throw new ApiError(422, "INVALID_PERIOD", "Выберите период не длиннее 63 дней.");
  }
  const prisma = getPrisma();
  const [groups, latestImport] = await Promise.all([
    prisma.studyGroup.findMany({
      where: {
        isActive: true,
        OR: [
          { curatorId: actor.id },
          { scheduleEntries: { some: { teacherId: actor.id } } },
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
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.scheduleImport.findFirst({
      orderBy: { createdAt: "desc" },
      select: { entries: true },
    }),
  ]);
  const imported = (latestImport?.entries ?? []) as unknown as ImportedLesson[];
  const groupId =
    parsed.data.groupId ??
    groups.find((group) =>
      imported.some((entry) => entry.groupId === group.id && dateInRange(entry.date, from, to)),
    )?.id ??
    groups.find((group) => imported.some((entry) => entry.groupId === group.id))?.id ??
    groups[0]?.id ??
    null;
  if (groupId && !groups.some((group) => group.id === groupId)) {
    throw new ApiError(403, "FORBIDDEN", "Эта группа вам недоступна.");
  }
  if (!groupId)
    return { groups, groupId: null, students: [], lessons: [], grades: [], suggestedPeriod: null };

  const [members, entries, grades] = await Promise.all([
    prisma.groupMember.findMany({
      where: { groupId, leftAt: null, student: { status: "ACTIVE", deletedAt: null } },
      select: { student: { select: { id: true, name: true } } },
      orderBy: { student: { name: "asc" } },
    }),
    prisma.scheduleEntry.findMany({
      where: {
        groupId,
        OR: [{ teacherId: actor.id }, { group: { curatorId: actor.id } }],
        AND: [{ OR: [{ deletedAt: null }, { deletedAt: { gte: new Date(`${from}T00:00:00Z`) } }] }],
        term: {
          startsOn: { lte: new Date(`${to}T00:00:00Z`) },
          endsOn: { gte: new Date(`${from}T00:00:00Z`) },
        },
      },
      select: {
        id: true,
        dayOfWeek: true,
        startMinute: true,
        endMinute: true,
        weekPattern: true,
        deletedAt: true,
        term: { select: { startsOn: true, endsOn: true } },
        course: { select: { title: true } },
      },
    }),
    prisma.lessonGrade.findMany({
      where: {
        groupId,
        sessionDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      },
      select: { lessonKey: true, sessionDate: true, studentId: true, value: true },
    }),
  ]);

  const lessons: Array<{ key: string; date: string; time: string; title: string }> = [];
  for (let offset = 0; offset <= days; offset += 1) {
    const day = new Date(Date.parse(from) + offset * 86400000);
    const date = day.toISOString().slice(0, 10);
    const weekday = day.getUTCDay() || 7;
    for (const entry of entries) {
      if (
        weekday !== entry.dayOfWeek ||
        date < entry.term.startsOn.toISOString().slice(0, 10) ||
        date > entry.term.endsOn.toISOString().slice(0, 10)
      )
        continue;
      if (
        entry.deletedAt &&
        date > entry.deletedAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Almaty" })
      )
        continue;
      const termStart = new Date(entry.term.startsOn);
      termStart.setUTCDate(termStart.getUTCDate() - ((termStart.getUTCDay() + 6) % 7));
      const week = Math.floor((day.getTime() - termStart.getTime()) / 604800000) + 1;
      if (entry.weekPattern === "ODD" && week % 2 !== 1) continue;
      if (entry.weekPattern === "EVEN" && week % 2 !== 0) continue;
      lessons.push({
        key: `manual:${entry.id}`,
        date,
        time: lessonTime(entry.startMinute),
        title: entry.course.title,
      });
    }
  }
  const seenImportedLessons = new Set<string>();
  const manualSlots = new Map(lessons.map((lesson) => [`${lesson.date}:${lesson.time}`, lesson]));
  for (const entry of imported) {
    if (entry.groupId !== groupId || !dateInRange(entry.date, from, to)) continue;
    const subject = entry.subject.trim().toLocaleLowerCase("ru");
    const manualLesson = manualSlots.get(`${entry.date}:${entry.startTime}`);
    if (manualLesson) {
      manualLesson.title = entry.subject;
      continue;
    }
    const subjectHash = createHash("sha256").update(subject).digest("hex").slice(0, 12);
    const key = `import:${groupId}:${entry.pair}:${entry.startTime}:${subjectHash}`;
    const occurrence = `${key}:${entry.date}`;
    if (seenImportedLessons.has(occurrence)) continue;
    seenImportedLessons.add(occurrence);
    lessons.push({ key, date: entry.date, time: entry.startTime, title: entry.subject });
  }
  lessons.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.time.localeCompare(b.time) ||
      a.title.localeCompare(b.title, "ru"),
  );
  const visibleKeys = new Set(lessons.map((lesson) => `${lesson.key}:${lesson.date}`));
  const studentIds = new Set(members.map(({ student }) => student.id));
  const availableDates = [
    ...new Set(imported.filter((entry) => entry.groupId === groupId).map((entry) => entry.date)),
  ].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const nearestDate = !lessons.length
    ? availableDates.sort((a, b) => {
        const distance = (date: string) =>
          date < from
            ? Date.parse(from) - Date.parse(date)
            : date > to
              ? Date.parse(date) - Date.parse(to)
              : 0;
        return distance(a) - distance(b) || a.localeCompare(b);
      })[0]
    : undefined;
  const suggestedPeriod = nearestDate
    ? (() => {
        const day = new Date(`${nearestDate}T00:00:00Z`);
        const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86400000);
        return {
          from: monday.toISOString().slice(0, 10),
          to: new Date(monday.getTime() + 6 * 86400000).toISOString().slice(0, 10),
        };
      })()
    : null;
  return {
    groups,
    groupId,
    students: members.map(({ student }) => student),
    lessons,
    suggestedPeriod,
    grades: grades
      .filter(
        (grade) =>
          studentIds.has(grade.studentId) &&
          visibleKeys.has(`${grade.lessonKey}:${grade.sessionDate.toISOString().slice(0, 10)}`),
      )
      .map((grade) => ({
        ...grade,
        date: grade.sessionDate.toISOString().slice(0, 10),
        sessionDate: undefined,
      })),
  };
}

export async function setLessonGrade(actor: Actor, input: unknown) {
  requireTeacher(actor);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(422, "INVALID_GRADE", "Выберите оценку от 2 до 5.");
  const { groupId, studentId, lessonKey, date, value } = parsed.data;
  const book = await getLessonGradebook(actor, { groupId, from: date, to: date });
  if (
    !book.students.some((student) => student.id === studentId) ||
    !book.lessons.some((lesson) => lesson.key === lessonKey && lesson.date === date)
  ) {
    throw new ApiError(403, "FORBIDDEN", "Студент или занятие вам недоступны.");
  }
  const prisma = getPrisma();
  const where = {
    lessonKey_sessionDate_studentId: {
      lessonKey,
      sessionDate: new Date(`${date}T00:00:00Z`),
      studentId,
    },
  };
  if (value === null) {
    await prisma.lessonGrade.deleteMany({
      where: {
        lessonKey,
        sessionDate: where.lessonKey_sessionDate_studentId.sessionDate,
        studentId,
        groupId,
      },
    });
    return { value: null };
  }
  const grade = await prisma.lessonGrade.upsert({
    where,
    create: {
      lessonKey,
      sessionDate: where.lessonKey_sessionDate_studentId.sessionDate,
      groupId,
      studentId,
      value,
      setById: actor.id,
    },
    update: { value, setById: actor.id },
    select: { value: true },
  });
  return grade;
}
