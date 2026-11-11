import { Prisma } from "../../../generated/prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import type { Actor } from "@/server/auth/session";

export interface SearchResult {
  id: string;
  kind: "course" | "assignment" | "lesson";
  title: string;
  description: string;
  href: string;
}

function visibleCourseWhere(actor: Actor): Prisma.CourseWhereInput {
  if (actor.role === "STUDENT") {
    return {
      status: "PUBLISHED",
      enrollments: { some: { studentId: actor.id, status: "ACTIVE" } },
    };
  }

  if (actor.role === "TEACHER") {
    return {
      status: { not: "ARCHIVED" },
      OR: [
        { teacherAssignments: { some: { teacherId: actor.id } } },
        {
          enrollments: {
            some: { status: "ACTIVE", group: { curatorId: actor.id } },
          },
        },
      ],
    };
  }

  return {};
}

export async function searchLearningContent(actor: Actor, query: string): Promise<SearchResult[]> {
  const prisma = getPrisma();
  const term = query.trim();
  if (!term) return [];

  const now = new Date();
  const courseAccess = visibleCourseWhere(actor);
  // Course access may contain an OR clause (for example a teacher's own and curated
  // courses). Keep it in AND so the text match cannot replace that access rule.
  const courseTextMatch: Prisma.CourseWhereInput = {
    OR: [
      { title: { contains: term, mode: "insensitive" } },
      { slug: { contains: term, mode: "insensitive" } },
      { subject: { nameRu: { contains: term, mode: "insensitive" } } },
      { subject: { nameKk: { contains: term, mode: "insensitive" } } },
      { subject: { nameEn: { contains: term, mode: "insensitive" } } },
      { subject: { code: { contains: term, mode: "insensitive" } } },
    ],
  };
  const results = await Promise.allSettled([
    prisma.course.findMany({
      where: {
        deletedAt: null,
        AND: [courseAccess, courseTextMatch],
      },
      select: { id: true, title: true, slug: true, subject: { select: { nameRu: true } } },
      orderBy: { title: "asc" },
      take: 5,
    }),
    prisma.assignment.findMany({
      where: {
        deletedAt: null,
        ...(actor.role === "STUDENT" ? { status: "PUBLISHED" } : {}),
        course: { deletedAt: null, ...courseAccess },
        OR: [
          { title: { contains: term, mode: "insensitive" } },
          { description: { contains: term, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, dueAt: true, course: { select: { title: true } } },
      orderBy: [{ dueAt: "asc" }, { title: "asc" }],
      take: 5,
    }),
    prisma.lesson.findMany({
      where: {
        deletedAt: null,
        ...(actor.role === "STUDENT" ? { isPublished: true } : {}),
        AND: [
          ...(actor.role === "STUDENT"
            ? [
                { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
                { OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] },
              ]
            : []),
          {
            OR: [
              { title: { contains: term, mode: "insensitive" } },
              { externalUrl: { contains: term, mode: "insensitive" } },
            ],
          },
        ],
        section: {
          deletedAt: null,
          ...(actor.role === "STUDENT"
            ? {
                isPublished: true,
                AND: [
                  { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
                  { OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] },
                ],
              }
            : {}),
          course: { deletedAt: null, ...courseAccess },
        },
      },
      select: {
        id: true,
        title: true,
        type: true,
        section: { select: { title: true, course: { select: { slug: true, title: true } } } },
      },
      orderBy: [{ section: { position: "asc" } }, { position: "asc" }],
      take: 5,
    }),
  ]);
  if (results.every((result) => result.status === "rejected")) {
    throw results[0].status === "rejected" ? results[0].reason : new Error("Search unavailable");
  }
  const courses = results[0].status === "fulfilled" ? results[0].value : [];
  const assignments = results[1].status === "fulfilled" ? results[1].value : [];
  const lessons = results[2].status === "fulfilled" ? results[2].value : [];

  return [
    ...courses.map((course) => ({
      id: course.id,
      kind: "course" as const,
      title: course.title,
      description: course.subject.nameRu,
      href: `/courses/${course.slug}`,
    })),
    ...assignments.map((assignment) => ({
      id: assignment.id,
      kind: "assignment" as const,
      title: assignment.title,
      description: `Задание · ${assignment.course.title}${assignment.dueAt ? ` · срок ${assignment.dueAt.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" })}` : ""}`,
      href: `/assignments/${assignment.id}`,
    })),
    ...lessons.map((lesson) => ({
      id: lesson.id,
      kind: "lesson" as const,
      title: lesson.title,
      description: `${lesson.section.course.title} · ${lesson.section.title}`,
      href: `/courses/${lesson.section.course.slug}`,
    })),
  ];
}
