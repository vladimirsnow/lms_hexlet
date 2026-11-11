import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: mocks.getPrisma }));

import { searchLearningContent } from "./search";

describe("learning content search", () => {
  beforeEach(() => mocks.getPrisma.mockReset());

  it("searches curated courses while keeping the title match inside the access filter", async () => {
    const course = { findMany: vi.fn().mockResolvedValue([]) };
    const assignment = { findMany: vi.fn().mockResolvedValue([]) };
    const lesson = { findMany: vi.fn().mockResolvedValue([]) };
    mocks.getPrisma.mockReturnValue({ course, assignment, lesson });

    await searchLearningContent({ id: "teacher-id", role: "TEACHER" } as never, "математика");

    const where = course.findMany.mock.calls[0][0].where;
    expect(where.AND[0].OR).toEqual([
      { teacherAssignments: { some: { teacherId: "teacher-id" } } },
      { enrollments: { some: { status: "ACTIVE", group: { curatorId: "teacher-id" } } } },
    ]);
    expect(where.AND[1].OR).toContainEqual({
      title: { contains: "математика", mode: "insensitive" },
    });
    expect(where.AND[1].OR).toContainEqual({
      enrollments: {
        some: {
          status: "ACTIVE",
          group: { name: { contains: "математика", mode: "insensitive" } },
        },
      },
    });
    expect(assignment.findMany.mock.calls[0][0].where.course.OR).toEqual(where.AND[0].OR);
    expect(lesson.findMany.mock.calls[0][0].where.section.course.OR).toEqual(where.AND[0].OR);
  });

  it("returns matching courses when material search fails", async () => {
    mocks.getPrisma.mockReturnValue({
      course: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "course-id",
            title: "Математика",
            slug: "math",
            subject: { nameRu: "Математика" },
            enrollments: [{ group: { name: "ПМ1 РПО" } }],
            scheduleEntries: [{ group: { name: "ПМ1 РПО" } }],
          },
        ]),
      },
      assignment: { findMany: vi.fn().mockResolvedValue([]) },
      lesson: { findMany: vi.fn().mockRejectedValue(new Error("material index unavailable")) },
    });

    const items = await searchLearningContent({ id: "teacher-id", role: "TEACHER" } as never, "М");
    expect(items).toEqual([
      {
        id: "course-id",
        kind: "course",
        title: "Математика",
        description: "Математика",
        groups: ["ПМ1 РПО"],
        href: "/courses/math",
      },
    ]);
  });
});
