import { describe, expect, it } from "vitest";
import {
  generateSchedule,
  kazakhstanDaysOff,
  type PlannerConfig,
} from "@/server/services/schedule-planner-core";

const ids = {
  term: "00000000-0000-4000-8000-000000000001",
  firstGroup: "00000000-0000-4000-8000-000000000002",
  secondGroup: "00000000-0000-4000-8000-000000000003",
  course: "00000000-0000-4000-8000-000000000004",
};

function fixture(): Parameters<typeof generateSchedule>[0] {
  const config: PlannerConfig = {
    termId: ids.term,
    rooms: ["101"],
    slots: [{ startTime: "09:00", endTime: "09:45", hours: 1 }],
    vacations: [],
    extraDaysOff: [],
    allocations: [
      {
        groupId: ids.firstGroup,
        courseId: ids.course,
        teacherName: "Учитель",
        hours: 2,
        rooms: ["101"],
      },
      {
        groupId: ids.secondGroup,
        courseId: ids.course,
        teacherName: "Учитель",
        hours: 2,
        rooms: ["101"],
      },
    ],
  };
  return {
    config,
    term: { startsOn: "2026-12-14", endsOn: "2026-12-18" },
    groups: [
      { id: ids.firstGroup, name: "РПО-1" },
      { id: ids.secondGroup, name: "ВД-1" },
    ],
    courses: [{ id: ids.course, title: "Математика" }],
  };
}

describe("schedule planner", () => {
  it("skips Kazakhstan holidays and never double-books a room or teacher", () => {
    const generated = generateSchedule(fixture());
    expect(generated.lessons).toHaveLength(4);
    expect(generated.lessons.map((lesson) => lesson.date)).toEqual([
      "2026-12-14",
      "2026-12-15",
      "2026-12-17",
      "2026-12-18",
    ]);
    expect(generated.lessons.filter((lesson) => lesson.groupId === ids.firstGroup)).toHaveLength(2);
    expect(generated.lessons.filter((lesson) => lesson.groupId === ids.secondGroup)).toHaveLength(
      2,
    );
    expect(
      new Set(
        generated.lessons.map((lesson) => `${lesson.date}:${lesson.startTime}:${lesson.room}`),
      ).size,
    ).toBe(4);
    expect(kazakhstanDaysOff(2026)).toContain("2026-03-24");
    expect(kazakhstanDaysOff(2026)).toContain("2026-05-27");
  });

  it("rejects a plan that cannot fit after vacation and existing bookings", () => {
    const withVacation = fixture();
    withVacation.config.vacations = [{ startsOn: "2026-12-15", endsOn: "2026-12-15" }];
    expect(() => generateSchedule(withVacation)).toThrow(/Не удалось разместить/);
    const withManual = fixture();
    withManual.manualBookings = [
      {
        groupId: "other",
        teacherName: "Другой",
        room: "101",
        dayOfWeek: 1,
        startMinute: 540,
        endMinute: 585,
        weekPattern: "EVERY",
        startsOn: "2026-12-14",
        endsOn: "2026-12-18",
      },
    ];
    expect(() => generateSchedule(withManual)).toThrow(/Не удалось разместить/);
  });
});
