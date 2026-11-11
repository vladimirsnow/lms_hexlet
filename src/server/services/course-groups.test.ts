import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: mocks.getPrisma }));

import { resolveCourseGroupNames } from "./course-groups";

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
});
