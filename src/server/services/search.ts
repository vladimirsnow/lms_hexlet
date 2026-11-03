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
      teacherAssignments: { some: { teacherId: actor.id } },
    };
  }

  return {};
}

export async function searchLearningContent(actor: Actor, query: string): Promise<SearchResult[]> {
  const prisma = getPrisma();
  const term = query.trim();
  if (term.length < 2) return [];

  const now = new Date();
  const courseAccess = visibleCourseWhere(actor);
  const [courses, assignments, lessons] = await Promise.all([
    prisma.course.findMany({
      where: {
        deletedAt: null,
        ...courseAccess,
        OR: [
          { title: { contains: term, mode: "insensitive" } },
          { slug: { contains: term, mode: "insensitive" } },
          { subject: { nameRu: { contains: term, mode: "insensitive" } } },
        ],
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
