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
  value: z.number().int().min(0).max(100).nullable(),
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

async function getImportedLessons(prisma: ReturnType<typeof getPrisma>) {
  const imports = await prisma.scheduleImport.findMany({
    orderBy: { createdAt: "desc" },
    select: { entries: true, createdAt: true },
  });
  const lessons = new Map<string, ImportedLesson>();
  for (const [index, imported] of imports.entries()) {
    const replacedOn =
      index === 0
        ? null
        : imports[index - 1].createdAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Almaty" });
    for (const entry of imported.entries as unknown as ImportedLesson[]) {
      if (!entry.groupId) continue;
      if (replacedOn && entry.date >= replacedOn) continue;
      const slot = `${entry.groupId}:${entry.date}:${entry.pair}:${entry.startTime}`;
      if (!lessons.has(slot)) lessons.set(slot, entry);
    }
  }
  return [...lessons.values()];
}

export async function getLessonGradebook(actor: Actor, input: unknown) {
  requireTeacher(actor);
  const parsed = filtersSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(422, "INVALID_FILTER", "Проверьте даты и группу.");
  const { from, to } = parsed.data;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  if (days < 0 || days > 366) {
    throw new ApiError(422, "INVALID_PERIOD", "Выберите период не длиннее 367 дней.");
  }
  const prisma = getPrisma();
  const [imported, manualGroups] = await Promise.all([
    getImportedLessons(prisma),
    prisma.scheduleEntry.findMany({
      where: {
        deletedAt: null,
        OR: [{ teacherId: actor.id }, { group: { curatorId: actor.id } }],
      },
      select: { groupId: true },
      distinct: ["groupId"],
    }),
  ]);
  const scheduledGroupIds = [
    ...new Set([
      ...imported.flatMap((entry) => (entry.groupId ? [entry.groupId] : [])),
      ...manualGroups.map((entry) => entry.groupId),
    ]),
  ];
  const groups = await prisma.studyGroup.findMany({
    where: {
      isActive: true,
      id: { in: scheduledGroupIds },
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
  });
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
    return {
      groups,
      groupId: null,
      students: [],
      lessons: [],
      grades: [],
      availableDates: [],
      suggestedDate: null,
    };

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
  ]
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  const nearestDate = !lessons.length
    ? [...availableDates].sort((a, b) => {
        const distance = (date: string) =>
          date < from
            ? Date.parse(from) - Date.parse(date)
            : date > to
              ? Date.parse(date) - Date.parse(to)
              : 0;
        return distance(a) - distance(b) || a.localeCompare(b);
      })[0]
    : undefined;
  return {
    groups,
    groupId,
    students: members.map(({ student }) => student),
    lessons,
    availableDates,
    suggestedDate: nearestDate ?? null,
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
  if (!parsed.success) throw new ApiError(422, "INVALID_GRADE", "Укажите целый балл от 0 до 100.");
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

export async function getMyLessonGrades(actor: Actor) {
  if (actor.role !== "STUDENT")
    throw new ApiError(403, "FORBIDDEN", "Оценки за занятия доступны студенту.");
  const prisma = getPrisma();
  const grades = await prisma.lessonGrade.findMany({
    where: { studentId: actor.id },
    orderBy: [{ sessionDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      lessonKey: true,
      sessionDate: true,
      groupId: true,
      value: true,
      group: { select: { name: true } },
    },
  });
  if (!grades.length) return [];
  const manualIds = grades
    .filter((grade) => grade.lessonKey.startsWith("manual:"))
    .map((grade) => grade.lessonKey.slice(7));
  const [manualEntries, importedLessons, enrolledCourses] = await Promise.all([
    prisma.scheduleEntry.findMany({
      where: { id: { in: manualIds } },
      select: { id: true, course: { select: { id: true, title: true, slug: true } } },
    }),
    getImportedLessons(prisma),
    prisma.course.findMany({
      where: { enrollments: { some: { studentId: actor.id } } },
      select: {
        id: true,
        title: true,
        slug: true,
        subject: { select: { nameRu: true, nameKk: true, nameEn: true } },
      },
    }),
  ]);
  const manualCourses = new Map(manualEntries.map((entry) => [`manual:${entry.id}`, entry.course]));
  const subjectCourses = new Map<string, { id: string; title: string; slug: string } | null>();
  for (const course of enrolledCourses) {
    for (const name of [
      course.title,
      course.subject.nameRu,
      course.subject.nameKk,
      course.subject.nameEn,
    ]) {
      if (!name) continue;
      const key = name.trim().toLocaleLowerCase("ru");
      if (!subjectCourses.has(key)) subjectCourses.set(key, course);
      else if (subjectCourses.get(key)?.id !== course.id) subjectCourses.set(key, null);
    }
  }
  const importedSubjects = new Map<string, string>();
  for (const entry of importedLessons) {
    if (!entry.groupId) continue;
    const subjectHash = createHash("sha256")
      .update(entry.subject.trim().toLocaleLowerCase("ru"))
      .digest("hex")
      .slice(0, 12);
    const key = `import:${entry.groupId}:${entry.pair}:${entry.startTime}:${subjectHash}:${entry.date}`;
    importedSubjects.set(key, entry.subject);
  }
  return grades.map((grade) => {
    const date = grade.sessionDate.toISOString().slice(0, 10);
    const manual = manualCourses.get(grade.lessonKey);
    const importedSubject = importedSubjects.get(`${grade.lessonKey}:${date}`);
    const matched = importedSubject
      ? subjectCourses.get(importedSubject.trim().toLocaleLowerCase("ru"))
      : null;
    const courseTitle = manual?.title ?? matched?.title ?? importedSubject ?? grade.group.name;
    return {
      id: grade.id,
      date,
      value: grade.value,
      courseTitle,
      courseKey:
        manual?.id ?? matched?.id ?? `subject:${courseTitle.trim().toLocaleLowerCase("ru")}`,
      courseSlug: manual?.slug ?? matched?.slug ?? null,
    };
  });
}

export async function getLessonGradeHistory(actor: Actor, input: unknown) {
  requireTeacher(actor);
  const parsed = z
    .object({
      groupId: z.uuid().optional(),
      courseKey: z.string().max(250).optional(),
      studentId: z.uuid().optional(),
      offset: z.number().int().min(0).max(1000000).default(0),
    })
    .safeParse(input);
  if (!parsed.success) throw new ApiError(422, "INVALID_FILTER", "Проверьте группу.");
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Almaty" });
  const access = await getLessonGradebook(actor, {
    groupId: parsed.data.groupId,
    from: today,
    to: today,
  });
  if (!access.groupId)
    return {
      groups: access.groups,
      groupId: null,
      courses: [],
      students: [],
      summaries: [],
      total: { grades: 0, days: 0, students: 0, average: null },
      hasMore: false,
    };

  const prisma = getPrisma();
  const groupId = access.groupId;
  const group = await prisma.studyGroup.findUnique({
    where: { id: groupId },
    select: { curatorId: true, name: true },
  });
  const grades = await prisma.lessonGrade.findMany({
    where: { groupId },
    orderBy: [{ sessionDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      lessonKey: true,
      sessionDate: true,
      value: true,
      setById: true,
      studentId: true,
      student: { select: { name: true } },
    },
  });
  const manualIds = grades
    .filter((grade) => grade.lessonKey.startsWith("manual:"))
    .map((grade) => grade.lessonKey.slice(7));
  const [manualEntries, importedLessons, groupCourses, members] = await Promise.all([
    prisma.scheduleEntry.findMany({
      where: { id: { in: manualIds }, groupId },
      select: { id: true, teacherId: true, course: { select: { id: true, title: true } } },
    }),
    getImportedLessons(prisma),
    prisma.course.findMany({
      where: {
        deletedAt: null,
        OR: [{ scheduleEntries: { some: { groupId } } }, { enrollments: { some: { groupId } } }],
      },
      select: { id: true, title: true, subject: { select: { nameRu: true } } },
    }),
    prisma.groupMember.findMany({
      where: { groupId, leftAt: null, student: { status: "ACTIVE", deletedAt: null } },
      select: { student: { select: { id: true, name: true } } },
    }),
  ]);
  const manualCourses = new Map(manualEntries.map((entry) => [`manual:${entry.id}`, entry.course]));
  const subjectCourses = new Map<string, { id: string; title: string } | null>();
  for (const course of groupCourses) {
    for (const name of [course.title, course.subject.nameRu]) {
      const key = name.trim().toLocaleLowerCase("ru");
      if (!subjectCourses.has(key)) subjectCourses.set(key, course);
      else if (subjectCourses.get(key)?.id !== course.id) subjectCourses.set(key, null);
    }
  }
  const importedSubjects = new Map<string, string>();
  for (const entry of importedLessons) {
    if (entry.groupId !== groupId) continue;
    const subjectHash = createHash("sha256")
      .update(entry.subject.trim().toLocaleLowerCase("ru"))
      .digest("hex")
      .slice(0, 12);
    importedSubjects.set(
      `import:${groupId}:${entry.pair}:${entry.startTime}:${subjectHash}:${entry.date}`,
      entry.subject,
    );
  }
  const manualTeachers = new Map(
    manualEntries.map((entry) => [`manual:${entry.id}`, entry.teacherId]),
  );
  const rows = grades
    .filter(
      (grade) =>
        group?.curatorId === actor.id ||
        manualTeachers.get(grade.lessonKey) === actor.id ||
        grade.setById === actor.id,
    )
    .map((grade) => {
      const date = grade.sessionDate.toISOString().slice(0, 10);
      const importedSubject = importedSubjects.get(`${grade.lessonKey}:${date}`);
      const manual = manualCourses.get(grade.lessonKey);
      const matched = importedSubject
        ? subjectCourses.get(importedSubject.trim().toLocaleLowerCase("ru"))
        : null;
      const courseTitle = manual?.title ?? matched?.title ?? importedSubject ?? "Занятие";
      return {
        id: grade.id,
        studentId: grade.studentId,
        studentName: grade.student.name,
        date,
        value: grade.value,
        courseKey:
          manual?.id ?? matched?.id ?? `subject:${courseTitle.trim().toLocaleLowerCase("ru")}`,
        courseTitle,
      };
    });
  const courses = [
    ...new Map(
      rows.map((row) => [row.courseKey, { key: row.courseKey, title: row.courseTitle }]),
    ).values(),
  ].sort((a, b) => a.title.localeCompare(b.title, "ru"));
  const students = [
    ...new Map([
      ...members.map(({ student }) => [student.id, student] as const),
      ...rows.map((row) => [row.studentId, { id: row.studentId, name: row.studentName }] as const),
    ]).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const selected = rows.filter(
    (row) =>
      (!parsed.data.courseKey || row.courseKey === parsed.data.courseKey) &&
      (!parsed.data.studentId || row.studentId === parsed.data.studentId),
  );
  const total = {
    grades: selected.length,
    days: new Set(selected.map((row) => row.date)).size,
    students: students.filter(
      (student) => !parsed.data.studentId || student.id === parsed.data.studentId,
    ).length,
    average: selected.length
      ? selected.reduce((sum, row) => sum + row.value, 0) / selected.length
      : null,
  };
  const summaryMap = new Map<
    string,
    {
      studentId: string;
      studentName: string;
      groupName: string;
      courseKey: string;
      courseTitle: string;
      scoreTotal: number;
      count: number;
    }
  >();
  for (const row of selected) {
    const key = `${row.studentId}:${row.courseKey}`;
    const summary = summaryMap.get(key) ?? {
      studentId: row.studentId,
      studentName: row.studentName,
      groupName: group?.name ?? "—",
      courseKey: row.courseKey,
      courseTitle: row.courseTitle,
      scoreTotal: 0,
      count: 0,
    };
    summary.scoreTotal += row.value;
    summary.count += 1;
    summaryMap.set(key, summary);
  }
  const selectedCourse = courses.find((course) => course.key === parsed.data.courseKey);
  for (const student of students) {
    if (parsed.data.studentId && student.id !== parsed.data.studentId) continue;
    if (parsed.data.courseKey && !selectedCourse) continue;
    const key = `${student.id}:${selectedCourse?.key ?? ""}`;
    if (
      selectedCourse
        ? summaryMap.has(key)
        : [...summaryMap.values()].some((row) => row.studentId === student.id)
    )
      continue;
    summaryMap.set(key, {
      studentId: student.id,
      studentName: student.name,
      groupName: group?.name ?? "—",
      courseKey: selectedCourse?.key ?? "",
      courseTitle: selectedCourse?.title ?? "—",
      scoreTotal: 0,
      count: 0,
    });
  }
  const summaries = [...summaryMap.values()]
    .sort(
      (a, b) =>
        a.studentName.localeCompare(b.studentName, "ru") ||
        a.courseTitle.localeCompare(b.courseTitle, "ru"),
    )
    .map(({ scoreTotal, count, ...summary }) => ({
      ...summary,
      average: count ? scoreTotal / count : null,
      count,
    }));
  const page = summaries.slice(parsed.data.offset, parsed.data.offset + 100);
  return {
    groups: access.groups,
    groupId,
    courses,
    students,
    summaries: page,
    total,
    hasMore: parsed.data.offset + page.length < summaries.length,
  };
}
