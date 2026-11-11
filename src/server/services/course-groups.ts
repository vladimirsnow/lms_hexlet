import { unstable_cache } from "next/cache";
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

const getGroupNames = unstable_cache(
  async () =>
    (await getPrisma().studyGroup.findMany({ select: { name: true } })).map((group) => group.name),
  ["study-group-names-v1"],
  { revalidate: 30 },
);

const getImportedGroupSubjects = unstable_cache(
  async () => {
    const prisma = getPrisma();
    const latest = await prisma.scheduleImport.findFirst({
      orderBy: { createdAt: "desc" },
      select: { entries: true },
    });
    const imported = (latest?.entries ?? []) as unknown as ImportedLesson[];
    const groupIds = [
      ...new Set(imported.flatMap((entry) => (entry.groupId ? [entry.groupId] : []))),
    ];
    if (!groupIds.length) return [];

    const groups = await prisma.studyGroup.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, name: true, specialtyId: true },
    });
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const subjects = new Map<
      string,
      {
        groupId: string;
        groupName: string;
        specialtyId: string;
        subject: string;
        dates: Set<string>;
      }
    >();
    for (const entry of imported) {
      const group = entry.groupId ? groupById.get(entry.groupId) : null;
      if (!group) continue;
      const subject = cleanScheduleSubjectName(entry.subject);
      if (!subject) continue;
      const key = `${group.id}:${normalize(subject)}`;
      const match = subjects.get(key) ?? {
        groupId: group.id,
        groupName: group.name,
        specialtyId: group.specialtyId,
        subject,
        dates: new Set<string>(),
      };
      match.dates.add(entry.date);
      subjects.set(key, match);
    }
    return [...subjects.values()].map((match) => ({ ...match, dates: [...match.dates] }));
  },
  ["imported-group-subjects-v1"],
  { revalidate: 30 },
);

export async function isExactStudyGroupName(query: string): Promise<boolean> {
  const normalizedQuery = normalize(query);
  return (await getGroupNames()).some((name) => normalize(name) === normalizedQuery);
}

export async function findImportedCourseIdsForGroupQuery(query: string): Promise<string[]> {
  const prisma = getPrisma();
  const normalizedQuery = normalize(query);
  if (!(await getGroupNames()).some((name) => normalize(name).includes(normalizedQuery))) return [];
  const imported = await getImportedGroupSubjects();
  const matches = new Map<string, { specialtyId: string; subject: string; dates: Set<string> }>();
  for (const entry of imported) {
    if (!normalize(entry.groupName).includes(normalizedQuery)) continue;
    const key = `${entry.specialtyId}:${normalize(entry.subject)}`;
    const match = matches.get(key) ?? {
      specialtyId: entry.specialtyId,
      subject: entry.subject,
      dates: new Set<string>(),
    };
    entry.dates.forEach((date) => match.dates.add(date));
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

  const imported = await getImportedGroupSubjects().catch(() => []);
  const allowedGroupIds = studentId
    ? new Set(
        (
          await getPrisma().groupMember.findMany({
            where: { studentId, leftAt: null },
            select: { groupId: true },
          })
        ).map((membership) => membership.groupId),
      )
    : null;
  const missingBySubject = new Map<string, CourseGroupSource[]>();
  for (const course of missing) {
    const key = `${course.specialtyId}:${normalize(course.title)}`;
    missingBySubject.set(key, [...(missingBySubject.get(key) ?? []), course]);
  }
  for (const entry of imported) {
    if (allowedGroupIds && !allowedGroupIds.has(entry.groupId)) continue;
    const key = `${entry.specialtyId}:${normalize(entry.subject)}`;
    for (const course of missingBySubject.get(key) ?? []) {
      const start = course.term.startsOn.toISOString().slice(0, 10);
      const end = course.term.endsOn.toISOString().slice(0, 10);
      if (entry.dates.some((date) => date >= start && date <= end)) {
        names.get(course.id)?.add(entry.groupName);
      }
    }
  }
  return new Map(
    [...names].map(([id, values]) => [id, [...values].sort((a, b) => a.localeCompare(b, "ru"))]),
  );
}
