import { createHash } from "node:crypto";
import { Prisma } from "../../../generated/prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/http/api-error";
import type { Actor } from "@/server/auth/session";
import { cleanScheduleSubjectName, type ImportedLesson } from "@/server/services/schedule-xlsx";
import {
  generateSchedule,
  plannerSchema,
  validatePlannerConfig,
} from "@/server/services/schedule-planner-core";

function admin(actor: Actor) {
  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN")
    throw new ApiError(403, "FORBIDDEN", "Настройка расписания доступна только администратору.");
}
function date(value: Date) {
  return value.toISOString().slice(0, 10);
}
function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
function lessonHours(startTime: string, endTime: string) {
  const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
  const end = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3));
  return end - start > 60 ? 2 : 1;
}
function key(termId: string) {
  return `schedule.planner.${termId}`;
}

export async function getPlannerData(actor: Actor, termId?: string) {
  admin(actor);
  const prisma = getPrisma();
  const [terms, groups, courses, teachers, latest, stored] = await Promise.all([
    prisma.term.findMany({
      orderBy: [{ isActive: "desc" }, { startsOn: "desc" }],
      include: { academicYear: { select: { name: true } } },
    }),
    prisma.studyGroup.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, academicYearId: true, specialtyId: true },
    }),
    prisma.course.findMany({
      where: {
        deletedAt: null,
        status: { not: "ARCHIVED" },
        slug: { not: { startsWith: "demo-" } },
      },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        termId: true,
        academicYearId: true,
        specialtyId: true,
        specialty: { select: { code: true } },
        teacherAssignments: {
          select: { teacher: { select: { id: true, name: true, status: true } } },
        },
      },
    }),
    prisma.user.findMany({
      where: { role: "TEACHER", status: "ACTIVE", deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.scheduleImport.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true, fileName: true, entries: true },
    }),
    termId
      ? prisma.systemSetting.findUnique({
          where: { key: key(termId) },
          select: { valueJson: true },
        })
      : Promise.resolve(null),
  ]);
  const imported = (latest?.entries ?? []) as ImportedLesson[];
  const selectedTerm = terms.find((item) => item.id === termId);
  const termLessons = selectedTerm
    ? imported.filter(
        (item) =>
          item.date >= date(selectedTerm.startsOn) && item.date <= date(selectedTerm.endsOn),
      )
    : [];
  const importedGroupIds = new Set(imported.map((item) => item.groupId).filter(Boolean));
  const subjects = [
    ...new Set(imported.map((item) => cleanScheduleSubjectName(item.subject)).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "ru"));
  const rooms = [
    ...new Set(
      imported.map((item) => item.room?.trim()).filter((room): room is string => Boolean(room)),
    ),
  ].sort((a, b) => a.localeCompare(b, "ru"));
  const timesByPair = new Map<
    number,
    Map<string, { startTime: string; endTime: string; count: number }>
  >();
  for (const item of imported) {
    const choices = timesByPair.get(item.pair) ?? new Map();
    const timeKey = `${item.startTime}-${item.endTime}`;
    const choice = choices.get(timeKey) ?? {
      startTime: item.startTime,
      endTime: item.endTime,
      count: 0,
    };
    choice.count++;
    choices.set(timeKey, choice);
    timesByPair.set(item.pair, choices);
  }
  const slots = [...timesByPair]
    .sort(([a], [b]) => a - b)
    .map(([, choices]) => [...choices.values()].sort((a, b) => b.count - a.count)[0])
    .map(({ startTime, endTime }) => ({
      startTime,
      endTime,
      hours: lessonHours(startTime, endTime),
    }));
  const courseBySubject = new Map(
    courses.map((course) => [
      `${course.termId}:${course.specialtyId}:${normalize(course.title)}`,
      course,
    ]),
  );
  const suggested = new Map<
    string,
    { groupId: string; courseId: string; teacherName: string; hours: number }
  >();
  if (termId)
    for (const item of termLessons) {
      const group = item.groupId ? groups.find((candidate) => candidate.id === item.groupId) : null;
      const course = group
        ? courseBySubject.get(
            `${termId}:${group.specialtyId}:${normalize(cleanScheduleSubjectName(item.subject))}`,
          )
        : null;
      if (!group || !course) continue;
      const teacherName = item.teacher ?? "";
      const identifier = `${group.id}:${course.id}:${normalize(teacherName)}`;
      const existing = suggested.get(identifier);
      if (existing) existing.hours += lessonHours(item.startTime, item.endTime);
      else
        suggested.set(identifier, {
          groupId: group.id,
          courseId: course.id,
          teacherName,
          hours: lessonHours(item.startTime, item.endTime),
        });
    }
  return {
    terms: terms.map((item) => ({
      id: item.id,
      name: `${item.academicYear.name} · ${item.name}`,
      startsOn: date(item.startsOn),
      endsOn: date(item.endsOn),
      academicYearId: item.academicYearId,
    })),
    groups,
    courses: courses.map((item) => ({
      id: item.id,
      title: item.title,
      termId: item.termId,
      academicYearId: item.academicYearId,
      specialtyId: item.specialtyId,
      specialtyCode: item.specialty.code,
      teachers: item.teacherAssignments
        .filter((assignment) => assignment.teacher.status === "ACTIVE")
        .map((assignment) => ({ id: assignment.teacher.id, name: assignment.teacher.name })),
    })),
    teachers,
    imported: latest
      ? {
          fileName: latest.fileName,
          groups: groups
            .filter((item) => importedGroupIds.has(item.id))
            .map((item) => ({ id: item.id, name: item.name })),
          subjects,
          rooms,
          slots,
          teacherNames: [
            ...new Set(
              imported.map((item) => item.teacher).filter((name): name is string => Boolean(name)),
            ),
          ].sort((a, b) => a.localeCompare(b, "ru")),
          lessons: imported.length,
          suggestedAllocations: [...suggested.values()],
        }
      : null,
    config: plannerSchema.safeParse(stored?.valueJson).data ?? null,
  };
}

async function validated(actor: Actor, body: unknown) {
  admin(actor);
  const parsed = plannerSchema.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Проверьте настройки генератора.",
      parsed.error.flatten().fieldErrors,
    );
  const config = parsed.data;
  try {
    validatePlannerConfig(config);
  } catch (error) {
    throw new ApiError(
      422,
      "INVALID_PLAN",
      error instanceof Error ? error.message : "Проверьте настройки.",
    );
  }
  const prisma = getPrisma();
  const term = await prisma.term.findUnique({
    where: { id: config.termId },
    select: { id: true, academicYearId: true, startsOn: true, endsOn: true },
  });
  if (!term) throw new ApiError(404, "TERM_NOT_FOUND", "Семестр не найден.");
  const [groups, courses, manual] = await Promise.all([
    prisma.studyGroup.findMany({
      where: { academicYearId: term.academicYearId, isActive: true },
      select: { id: true, name: true },
    }),
    prisma.course.findMany({
      where: {
        termId: term.id,
        deletedAt: null,
        status: { not: "ARCHIVED" },
        slug: { not: { startsWith: "demo-" } },
      },
      select: {
        id: true,
        title: true,
        teacherAssignments: {
          select: { teacher: { select: { id: true, name: true, status: true } } },
        },
      },
    }),
    prisma.scheduleEntry.findMany({
      where: {
        deletedAt: null,
        term: { startsOn: { lte: term.endsOn }, endsOn: { gte: term.startsOn } },
      },
      select: {
        groupId: true,
        teacher: { select: { name: true } },
        room: true,
        dayOfWeek: true,
        startMinute: true,
        endMinute: true,
        weekPattern: true,
        term: { select: { startsOn: true, endsOn: true } },
      },
    }),
  ]);
  const courseRows = courses.map((course) => ({
    id: course.id,
    title: course.title,
  }));
  let result: ReturnType<typeof generateSchedule>;
  try {
    result = generateSchedule({
      config,
      term: { startsOn: date(term.startsOn), endsOn: date(term.endsOn) },
      groups,
      courses: courseRows,
      manualBookings: manual.map((item) => ({
        groupId: item.groupId,
        teacherName: item.teacher.name,
        room: item.room,
        dayOfWeek: item.dayOfWeek,
        startMinute: item.startMinute,
        endMinute: item.endMinute,
        weekPattern: item.weekPattern,
        startsOn: date(item.term.startsOn),
        endsOn: date(item.term.endsOn),
      })),
    });
  } catch (error) {
    throw new ApiError(
      422,
      "GENERATION_FAILED",
      error instanceof Error ? error.message : "Не удалось составить расписание.",
    );
  }
  if (result.lessons.length > 10000)
    throw new ApiError(
      422,
      "PLAN_TOO_LARGE",
      "В расписании больше 10 000 занятий. Уменьшите период или нагрузку.",
    );
  return {
    config,
    result,
    termRange: { startsOn: date(term.startsOn), endsOn: date(term.endsOn) },
  };
}

export async function previewPlanner(actor: Actor, body: unknown) {
  const { result } = await validated(actor, body);
  return {
    count: result.lessons.length,
    teachingDays: result.teachingDays,
    daysOff: result.daysOff,
    sample: result.lessons.slice(0, 30),
  };
}

export async function savePlanner(actor: Actor, body: unknown, request: Request) {
  const { config } = await validated(actor, body);
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: { key: key(config.termId) },
      create: { key: key(config.termId), valueJson: config as Prisma.InputJsonValue },
      update: { valueJson: config as Prisma.InputJsonValue },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "schedule.plan.saved",
        entityType: "Term",
        entityId: config.termId,
        afterJson: { allocations: config.allocations.length, rooms: config.rooms.length },
        userAgent: request.headers.get("user-agent")?.slice(0, 1000) ?? null,
      },
    });
  });
  return { saved: true };
}

export async function publishPlanner(actor: Actor, body: unknown, request: Request) {
  const { config, result, termRange } = await validated(actor, body);
  const prisma = getPrisma();
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(71624001)::text`;
      const latest = await tx.scheduleImport.findFirst({
        orderBy: { createdAt: "desc" },
        select: { id: true, entries: true },
      });
      const retained = ((latest?.entries ?? []) as ImportedLesson[]).filter(
        (lesson) => lesson.date < termRange.startsOn || lesson.date > termRange.endsOn,
      );
      const lessons = [...retained, ...result.lessons].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.pair - b.pair ||
          a.groupName.localeCompare(b.groupName, "ru"),
      );
      if (lessons.length > 10000)
        throw new ApiError(
          422,
          "PLAN_TOO_LARGE",
          "Совокупное расписание превышает 10 000 занятий.",
        );
      const monday = (value: string) => {
        const day = new Date(`${value}T00:00:00.000Z`);
        day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
        return date(day);
      };
      const weekNumbers = new Map(
        [...new Set(lessons.map((lesson) => monday(lesson.date)))].map((value, index) => [
          value,
          index + 1,
        ]),
      );
      for (const lesson of lessons) lesson.week = weekNumbers.get(monday(lesson.date))!;
      const weeks = [...weekNumbers.values()];
      const groupIds = new Set(lessons.map((lesson) => lesson.groupId));
      const record = await tx.scheduleImport.create({
        data: {
          fileName: `Сгенерировано · ${config.termId}`,
          entries: lessons as unknown as Prisma.InputJsonValue,
          summary: {
            rows: lessons.length,
            weeks,
            mappedGroups: groupIds.size,
            unmappedGroups: [],
            skippedAdditionalCells: 0,
          },
          importedById: actor.id,
        },
        select: { id: true },
      });
      await tx.systemSetting.upsert({
        where: { key: key(config.termId) },
        create: { key: key(config.termId), valueJson: config as Prisma.InputJsonValue },
        update: { valueJson: config as Prisma.InputJsonValue },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "schedule.generated",
          entityType: "ScheduleImport",
          entityId: record.id,
          beforeJson: latest ? { importId: latest.id } : Prisma.JsonNull,
          afterJson: {
            termId: config.termId,
            lessons: result.lessons.length,
            teachingDays: result.teachingDays,
          },
          userAgent: request.headers.get("user-agent")?.slice(0, 1000) ?? null,
        },
      });
      return { id: record.id, count: result.lessons.length };
    },
    { timeout: 30000 },
  );
}

export async function syncImportedCourses(actor: Actor, termId: string, request: Request) {
  admin(actor);
  const prisma = getPrisma();
  const term = await prisma.term.findUnique({
    where: { id: termId },
    select: { id: true, academicYearId: true, startsOn: true, endsOn: true },
  });
  if (!term) throw new ApiError(404, "TERM_NOT_FOUND", "Семестр не найден.");
  const latest = await prisma.scheduleImport.findFirst({
    orderBy: { createdAt: "desc" },
    select: { entries: true, fileName: true },
  });
  if (!latest)
    throw new ApiError(422, "NO_IMPORT", "Сначала загрузите существующее расписание XLSX.");
  const lessons = (latest.entries as unknown as ImportedLesson[]).filter(
    (item) => item.date >= date(term.startsOn) && item.date <= date(term.endsOn),
  );
  if (!lessons.length)
    throw new ApiError(422, "EMPTY_IMPORT", "В импортированном расписании нет занятий.");
  const groups = await prisma.studyGroup.findMany({
    where: {
      id: { in: lessons.map((item) => item.groupId).filter((id): id is string => Boolean(id)) },
    },
    select: { id: true, name: true, academicYearId: true, specialtyId: true },
  });
  const byGroup = new Map(groups.map((group) => [group.id, group]));
  const unknown = [
    ...new Set(
      lessons
        .filter((item) => !item.groupId || !byGroup.has(item.groupId))
        .map((item) => item.groupName),
    ),
  ];
  if (unknown.length)
    throw new ApiError(422, "UNMAPPED_GROUPS", `Сначала добавьте группы: ${unknown.join(", ")}.`);
  const wrongYear = groups.filter((group) => group.academicYearId !== term.academicYearId);
  if (wrongYear.length)
    throw new ApiError(
      422,
      "GROUP_YEAR_MISMATCH",
      `Группы относятся к другому учебному году: ${wrongYear.map((group) => group.name).join(", ")}.`,
    );
  const teachers = await prisma.user.findMany({
    where: { role: "TEACHER", status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true },
  });
  const teachersByName = new Map(teachers.map((teacher) => [normalize(teacher.name), teacher.id]));
  const unique = new Map<
    string,
    { subject: string; specialtyId: string; teachers: Set<string>; groupIds: Set<string> }
  >();
  const unmatched = new Set<string>();
  for (const lesson of lessons) {
    const group = byGroup.get(lesson.groupId!);
    if (!group) continue;
    const subject = cleanScheduleSubjectName(lesson.subject);
    if (!subject) continue;
    const identifier = `${group.specialtyId}:${normalize(subject)}`;
    if (!unique.has(identifier))
      unique.set(identifier, {
        subject,
        specialtyId: group.specialtyId,
        teachers: new Set(),
        groupIds: new Set(),
      });
    unique.get(identifier)!.groupIds.add(group.id);
    if (lesson.teacher) {
      const teacherId = teachersByName.get(normalize(lesson.teacher));
      if (teacherId) unique.get(identifier)!.teachers.add(teacherId);
      else unmatched.add(lesson.teacher);
    }
  }
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(71624001)::text`;
      let subjectsCreated = 0,
        coursesCreated = 0,
        assignmentsCreated = 0,
        enrollmentsCreated = 0;
      for (const item of unique.values()) {
        const code = `SCH-${hash(normalize(item.subject))}`.toUpperCase();
        let subject = await tx.subject.findFirst({
          where: { OR: [{ code }, { nameRu: { equals: item.subject, mode: "insensitive" } }] },
          select: { id: true },
        });
        if (!subject) {
          subject = await tx.subject.create({
            data: { code, nameRu: item.subject },
            select: { id: true },
          });
          subjectsCreated++;
        }
        const slug = `schedule-${hash(`${termId}:${item.specialtyId}:${normalize(item.subject)}`)}`;
        const category = /^ООД(?:\s|$)/u.test(item.subject)
          ? "OOD"
          : /^ООМ(?:\s|$)/u.test(item.subject)
            ? "OOM"
            : "PM";
        let course = await tx.course.findFirst({
          where: { termId, specialtyId: item.specialtyId, subjectId: subject.id, deletedAt: null },
          select: { id: true, slug: true, category: true },
        });
        if (!course) {
          course = await tx.course.create({
            data: {
              subjectId: subject.id,
              termId,
              academicYearId: term.academicYearId,
              specialtyId: item.specialtyId,
              title: item.subject,
              slug,
              category,
              status: "PUBLISHED",
              createdById: actor.id,
            },
            select: { id: true, slug: true, category: true },
          });
          coursesCreated++;
        } else if (course.slug.startsWith("schedule-") && course.category !== category) {
          await tx.course.update({
            where: { id: course.id },
            data: { category, updatedById: actor.id },
          });
        }
        for (const teacherId of item.teachers) {
          const existing = await tx.courseTeacher.findUnique({
            where: { courseId_teacherId: { courseId: course.id, teacherId } },
            select: { id: true },
          });
          if (!existing) {
            await tx.courseTeacher.create({
              data: { courseId: course.id, teacherId, assignedById: actor.id },
            });
            assignmentsCreated++;
          }
        }
        const members = await tx.groupMember.findMany({
          where: { groupId: { in: [...item.groupIds] }, leftAt: null },
          select: { groupId: true, studentId: true },
        });
        if (members.length) {
          const existing = await tx.enrollment.findMany({
            where: {
              courseId: course.id,
              studentId: { in: members.map((member) => member.studentId) },
            },
            select: { studentId: true },
          });
          const enrolled = new Set(existing.map((row) => row.studentId));
          const newMembers = members.filter((member) => !enrolled.has(member.studentId));
          if (newMembers.length) {
            const added = await tx.enrollment.createMany({
              data: newMembers.map((member) => ({
                courseId: course.id,
                studentId: member.studentId,
                groupId: member.groupId,
              })),
              skipDuplicates: true,
            });
            enrollmentsCreated += added.count;
          }
        }
      }
      // Archive only unmistakable demo courses. Retain their records and history.
      const archivedDemo = await tx.course.updateMany({
        where: { slug: { startsWith: "demo-" }, status: { not: "ARCHIVED" } },
        data: { status: "ARCHIVED", updatedById: actor.id },
      });
      const academicYear = await tx.academicYear.findUnique({
        where: { id: term.academicYearId },
        select: { name: true },
      });
      if (
        academicYear?.name.endsWith(" (демо)") &&
        groups.some((group) => !group.name.startsWith("ДЕМО"))
      ) {
        await tx.academicYear.update({
          where: { id: term.academicYearId },
          data: { name: academicYear.name.replace(/ \(демо\)$/u, "") },
        });
      }
      await tx.specialty.updateMany({
        where: { code: { startsWith: "DEMO-" }, groups: { none: {} } },
        data: { isActive: false },
      });
      await tx.subject.updateMany({
        where: { code: { startsWith: "DEMO-" }, courses: { every: { status: "ARCHIVED" } } },
        data: { isActive: false },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "schedule.courses.synced",
          entityType: "Term",
          entityId: termId,
          afterJson: {
            subjectsCreated,
            coursesCreated,
            assignmentsCreated,
            enrollmentsCreated,
            archivedDemo: archivedDemo.count,
            source: latest.fileName,
          },
          userAgent: request.headers.get("user-agent")?.slice(0, 1000) ?? null,
        },
      });
      return {
        subjectsCreated,
        coursesCreated,
        assignmentsCreated,
        enrollmentsCreated,
        archivedDemo: archivedDemo.count,
        unmatchedTeachers: [...unmatched],
      };
    },
    { timeout: 120000 },
  );
  return result;
}
