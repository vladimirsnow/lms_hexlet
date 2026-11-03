import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({ getPrisma: mocks.getPrisma }));

import { getGroupDailyAttendance, markGroupDailyAttendance } from "./group-daily-attendance";

const ids = {
  group: "11111111-1111-4111-8111-111111111111",
  curator: "22222222-2222-4222-8222-222222222222",
  leader: "33333333-3333-4333-8333-333333333333",
  firstStudent: "44444444-4444-4444-8444-444444444444",
  secondStudent: "55555555-5555-4555-8555-555555555555",
};

const roster = [
  {
    studentId: ids.firstStudent,
    student: { name: "Анна Абрамова", email: "anna@example.test" },
  },
  {
    studentId: ids.secondStudent,
    student: { name: "Борис Борисов", email: "boris@example.test" },
  },
];

function createPrismaMock({
  allowed = true,
  leaderMember = false,
}: { allowed?: boolean; leaderMember?: boolean } = {}) {
  const studyGroup = {
    findFirst: vi.fn().mockResolvedValue({
      id: ids.group,
      name: "12 ТИС/24",
      curatorId: allowed ? ids.curator : "66666666-6666-4666-8666-666666666666",
      memberships: leaderMember ? [{ id: "leader-membership" }] : [],
    }),
  };
  const groupMember = { findMany: vi.fn().mockResolvedValue(roster) };
  const groupDailyAttendance = {
    findMany: vi.fn().mockResolvedValue([{ studentId: ids.firstStudent, status: "PRESENT" }]),
    upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
  };
  const auditLog = { create: vi.fn().mockResolvedValue({ id: "audit-id" }) };
  const transaction = {
    studyGroup,
    groupMember,
    groupDailyAttendance,
    auditLog,
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const prisma = {
    studyGroup,
    groupMember,
    groupDailyAttendance,
    $transaction: vi.fn((callback) => callback(transaction)),
  };
  mocks.getPrisma.mockReturnValue(prisma);
  return { prisma, transaction };
}

describe("group daily attendance", () => {
  beforeEach(() => mocks.getPrisma.mockReset());

  it("returns an alphabetized roster and treats an unchecked student as absent", async () => {
    const { prisma } = createPrismaMock();
    const result = await getGroupDailyAttendance(
      { id: ids.curator, role: "TEACHER" } as never,
      ids.group,
      "2026-11-02",
    );

    expect(result.records).toEqual([
      {
        studentId: ids.firstStudent,
        name: "Анна Абрамова",
        email: "anna@example.test",
        present: true,
      },
      {
        studentId: ids.secondStudent,
        name: "Борис Борисов",
        email: "boris@example.test",
        present: false,
      },
    ]);
    expect(prisma.groupMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { student: { lastName: "asc" } },
          { student: { firstName: "asc" } },
          { student: { middleName: "asc" } },
        ],
      }),
    );
  });

  it("saves one present/absent mark per student, group, and date", async () => {
    const { transaction } = createPrismaMock();
    const request = new Request("http://localhost/api/v1/groups/attendance", {
      method: "POST",
      headers: { "user-agent": "vitest" },
    });
    const result = await markGroupDailyAttendance(
      { id: ids.curator, role: "TEACHER" } as never,
      ids.group,
      {
        date: "2026-11-02",
        records: [
          { studentId: ids.firstStudent, present: true },
          { studentId: ids.secondStudent, present: false },
        ],
      },
      request,
    );

    expect(result).toEqual({ groupId: ids.group, date: "2026-11-02", updated: 2 });
    expect(transaction.groupDailyAttendance.upsert).toHaveBeenCalledTimes(2);
    expect(transaction.groupDailyAttendance.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ create: expect.objectContaining({ status: "PRESENT" }) }),
    );
    expect(transaction.groupDailyAttendance.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ create: expect.objectContaining({ status: "ABSENT" }) }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("does not grant attendance to an ordinary teacher", async () => {
    createPrismaMock({ allowed: false });

    await expect(
      getGroupDailyAttendance(
        { id: "77777777-7777-4777-8777-777777777777", role: "TEACHER" } as never,
        ids.group,
        "2026-11-02",
      ),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("allows a class representative to open the same group roster", async () => {
    createPrismaMock({ leaderMember: true });
    const result = await getGroupDailyAttendance(
      { id: ids.leader, role: "STUDENT" } as never,
      ids.group,
      "2026-11-02",
    );

    expect(result.group).toEqual({ id: ids.group, name: "12 ТИС/24" });
    expect(result.records).toHaveLength(2);
  });
});
