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
