import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: mocks.getPrisma }));

import { getLessonGradeHistory, getMyLessonGrades } from "./lesson-grades";

describe("student lesson grade history", () => {
  beforeEach(() => mocks.getPrisma.mockReset());

  it("keeps an older imported class grade after a new schedule replaces it", async () => {
    const groupId = "11111111-1111-4111-8111-111111111111";
    const subject = "Математика";
    const hash = createHash("sha256")
      .update(subject.toLocaleLowerCase("ru"))
      .digest("hex")
      .slice(0, 12);
    const lessonKey = `import:${groupId}:1:09:00:${hash}`;
    mocks.getPrisma.mockReturnValue({
      lessonGrade: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "grade-id",
            lessonKey,
            sessionDate: new Date("2026-11-04T00:00:00Z"),
            groupId,
            value: 82,
            group: { name: "Группа 1" },
          },
        ]),
      },
      scheduleEntry: { findMany: vi.fn().mockResolvedValue([]) },
      course: { findMany: vi.fn().mockResolvedValue([]) },
      scheduleImport: {
        findMany: vi.fn().mockResolvedValue([
          { createdAt: new Date("2026-11-10T00:00:00Z"), entries: [] },
          {
            createdAt: new Date("2026-11-01T00:00:00Z"),
            entries: [{ groupId, date: "2026-11-04", pair: 1, startTime: "09:00", subject }],
          },
        ]),
      },
    });

    const grades = await getMyLessonGrades({ id: "student-id", role: "STUDENT" } as never);
    expect(grades).toEqual([
      {
        id: "grade-id",
        date: "2026-11-04",
        value: 82,
        courseTitle: subject,
        courseKey: "subject:математика",
        courseSlug: null,
      },
    ]);
  });

  it("returns grades from earlier years under their exact course", async () => {
    const groupId = "11111111-1111-4111-8111-111111111111";
    const courseId = "22222222-2222-4222-8222-222222222222";
    const teacherId = "33333333-3333-4333-8333-333333333333";
    const entryId = "44444444-4444-4444-8444-444444444444";
    mocks.getPrisma.mockReturnValue({
      scheduleImport: { findMany: vi.fn().mockResolvedValue([]) },
      scheduleEntry: {
        findMany: vi
          .fn()
          .mockImplementation(({ select }) =>
            Promise.resolve(
              select.groupId
                ? [{ groupId }]
                : select.teacherId
                  ? [{ id: entryId, teacherId, course: { id: courseId, title: "Математика" } }]
                  : [],
            ),
          ),
      },
      studyGroup: {
        findMany: vi.fn().mockResolvedValue([{ id: groupId, name: "Группа 1" }]),
        findUnique: vi.fn().mockResolvedValue({ curatorId: null }),
      },
      groupMember: { findMany: vi.fn().mockResolvedValue([]) },
      lessonGrade: {
        findMany: vi.fn().mockImplementation(({ where }) =>
          Promise.resolve(
            where.sessionDate
              ? []
              : [
                  {
                    id: "grade-id",
                    lessonKey: `manual:${entryId}`,
                    sessionDate: new Date("2021-03-15T00:00:00Z"),
                    value: 91,
                    studentId: "student-id",
                    student: { name: "Студент" },
                    setById: teacherId,
                  },
                ],
          ),
        ),
      },
      course: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const history = await getLessonGradeHistory({ id: teacherId, role: "TEACHER" } as never, {
      groupId,
    });
    expect(history.courses).toEqual([{ key: courseId, title: "Математика" }]);
    expect(history.grades).toEqual([
      {
        id: "grade-id",
        studentId: "student-id",
        studentName: "Студент",
        date: "2021-03-15",
        value: 91,
        courseKey: courseId,
        courseTitle: "Математика",
      },
    ]);
    const otherCourse = await getLessonGradeHistory({ id: teacherId, role: "TEACHER" } as never, {
      groupId,
      courseKey: "another-course",
    });
    expect(otherCourse.total.grades).toBe(0);
    expect(otherCourse.grades).toEqual([]);
  });
});
