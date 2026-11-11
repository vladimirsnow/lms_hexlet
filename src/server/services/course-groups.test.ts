import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import { findImportedCourseIdsForGroupQuery, resolveCourseGroupNames } from "./course-groups";

describe("course group labels", () => {
  beforeEach(() => mocks.getPrisma.mockReset());

  it("finds a course group in the imported timetable when there are no enrollments", async () => {
    mocks.getPrisma.mockReturnValue({
      scheduleImport: {
        findFirst: vi.fn().mockResolvedValue({
          entries: [{ groupId: "group-id", date: "2026-11-11", subject: "Математика" }],
        }),
      },
      studyGroup: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "group-id", name: "ПМ1 РПО", specialtyId: "specialty-id" }]),
      },
    });
    const groups = await resolveCourseGroupNames([
      {
        id: "course-id",
        title: "Математика",
        specialtyId: "specialty-id",
        term: { startsOn: new Date("2026-09-01"), endsOn: new Date("2027-01-31") },
        enrollments: [],
        scheduleEntries: [],
      },
    ]);
    expect(groups.get("course-id")).toEqual(["ПМ1 РПО"]);
  });

  it("finds courses by an imported group name in the matching term", async () => {
    mocks.getPrisma.mockReturnValue({
      studyGroup: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "group-id", name: "ПМ1 РПО", specialtyId: "specialty-id" }]),
      },
      scheduleImport: {
        findFirst: vi.fn().mockResolvedValue({
          entries: [{ groupId: "group-id", date: "2026-11-11", subject: "Математика" }],
        }),
      },
      course: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "matching-course",
            title: "Математика",
            specialtyId: "specialty-id",
            term: { startsOn: new Date("2026-09-01"), endsOn: new Date("2027-01-31") },
          },
          {
            id: "other-term",
            title: "Математика",
            specialtyId: "specialty-id",
            term: { startsOn: new Date("2027-02-01"), endsOn: new Date("2027-06-30") },
          },
        ]),
      },
    });
    expect(await findImportedCourseIdsForGroupQuery("ПМ1 РПО")).toEqual(["matching-course"]);
  });

  it("does not show imported groups outside a student's memberships", async () => {
    mocks.getPrisma.mockReturnValue({
      scheduleImport: {
        findFirst: vi.fn().mockResolvedValue({
          entries: [{ groupId: "other-group", date: "2026-11-11", subject: "Математика" }],
        }),
      },
      studyGroup: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "other-group", name: "ПМ1 РПО", specialtyId: "specialty-id" }]),
      },
      groupMember: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const groups = await resolveCourseGroupNames(
      [
        {
          id: "course-id",
          title: "Математика",
          specialtyId: "specialty-id",
          term: { startsOn: new Date("2026-09-01"), endsOn: new Date("2027-01-31") },
          enrollments: [],
          scheduleEntries: [],
        },
      ],
      "student-id",
    );
    expect(groups.get("course-id")).toEqual([]);
  });
});
