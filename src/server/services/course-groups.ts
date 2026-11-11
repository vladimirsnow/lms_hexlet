import { getPrisma } from "@/lib/db/prisma";
import { cleanScheduleSubjectName, type ImportedLesson } from "@/server/services/schedule-xlsx";

export type CourseGroupSource = {
  id: string;
  title: string;
  specialtyId: string;
  term: { startsOn: Date; endsOn: Date };
  enrollments: { group: { name: string } | null }[];
  scheduleEntries: { group: { name: string } }[];
};

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

export async function findImportedCourseIdsForGroupQuery(query: string): Promise<string[]> {
  const prisma = getPrisma();
  const groups = await prisma.studyGroup.findMany({
    where: { name: { contains: query, mode: "insensitive" } },
    select: { id: true, specialtyId: true },
  });
  if (!groups.length) return [];

  const latest = await prisma.scheduleImport.findFirst({
    orderBy: { createdAt: "desc" },
    select: { entries: true },
  });
  const imported = (latest?.entries ?? []) as unknown as ImportedLesson[];
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const matches = new Map<string, { specialtyId: string; subject: string; dates: Set<string> }>();
  for (const entry of imported) {
    const group = entry.groupId ? groupById.get(entry.groupId) : null;
    if (!group) continue;
    const subject = cleanScheduleSubjectName(entry.subject);
    if (!subject) continue;
    const key = `${group.specialtyId}:${normalize(subject)}`;
    const match = matches.get(key) ?? {
      specialtyId: group.specialtyId,
      subject,
      dates: new Set<string>(),
    };
    match.dates.add(entry.date);
    matches.set(key, match);
  }
  if (!matches.size) return [];

  const courses = await prisma.course.findMany({
    where: {
      deletedAt: null,
      OR: [...matches.values()].map(({ specialtyId, subject }) => ({
        specialtyId,
        title: { equals: subject, mode: "insensitive" as const },
      })),
    },
    select: {
      id: true,
      title: true,
      specialtyId: true,
      term: { select: { startsOn: true, endsOn: true } },
    },
  });
  return courses
    .filter((course) => {
      const match = matches.get(`${course.specialtyId}:${normalize(course.title)}`);
      if (!match) return false;
      const start = course.term.startsOn.toISOString().slice(0, 10);
      const end = course.term.endsOn.toISOString().slice(0, 10);
      return [...match.dates].some((date) => date >= start && date <= end);
    })
    .map((course) => course.id);
}

export async function resolveCourseGroupNames(
  courses: CourseGroupSource[],
  studentId?: string,
): Promise<Map<string, string[]>> {
  const names = new Map(
    courses.map((course) => [
      course.id,
      new Set([
        ...course.enrollments.flatMap((enrollment) =>
          enrollment.group ? [enrollment.group.name] : [],
        ),
        ...course.scheduleEntries.map((entry) => entry.group.name),
      ]),
    ]),
  );
  const missing = courses.filter((course) => !names.get(course.id)?.size);
  if (!missing.length) {
    return new Map(
      [...names].map(([id, values]) => [id, [...values].sort((a, b) => a.localeCompare(b, "ru"))]),
    );
  }

  const prisma = getPrisma();
  const latest = await prisma.scheduleImport
    .findFirst({
      orderBy: { createdAt: "desc" },
      select: { entries: true },
    })
    .catch(() => null);
  const imported = (latest?.entries ?? []) as unknown as ImportedLesson[];
  const groupIds = [
    ...new Set(imported.flatMap((entry) => (entry.groupId ? [entry.groupId] : []))),
  ];
  if (groupIds.length) {
    const groups = await prisma.studyGroup
      .findMany({
        where: {
          id: { in: groupIds },
          ...(studentId ? { memberships: { some: { studentId, leftAt: null } } } : {}),
        },
        select: { id: true, name: true, specialtyId: true },
      })
      .catch(() => []);
    const groupById = new Map(groups.map((group) => [group.id, group]));
    for (const entry of imported) {
      if (!entry.groupId) continue;
      const group = groupById.get(entry.groupId);
      if (!group) continue;
      const subject = normalize(cleanScheduleSubjectName(entry.subject));
      for (const course of missing) {
        if (
          course.specialtyId === group.specialtyId &&
          normalize(course.title) === subject &&
          entry.date >= course.term.startsOn.toISOString().slice(0, 10) &&
          entry.date <= course.term.endsOn.toISOString().slice(0, 10)
        ) {
          names.get(course.id)?.add(group.name);
        }
      }
    }
  }
  return new Map(
    [...names].map(([id, values]) => [id, [...values].sort((a, b) => a.localeCompare(b, "ru"))]),
  );
}
