import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { generateSchedule } from "../src/server/services/schedule-planner-core";
import {
  cleanScheduleSubjectName,
  type ImportedLesson,
} from "../src/server/services/schedule-xlsx";

dotenv.config({ path: process.env.SCHEDULE_VERIFY_ENV ?? ".env" });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
try {
  const [term, groups, imported] = await Promise.all([
    prisma.term.findFirst({
      where: { isActive: true },
      select: { id: true, startsOn: true, endsOn: true },
    }),
    prisma.studyGroup.findMany({ select: { id: true, name: true, specialtyId: true } }),
    prisma.scheduleImport.findFirst({ orderBy: { createdAt: "desc" }, select: { entries: true } }),
  ]);
  if (!term || !imported)
    throw new Error("Нет активного семестра или импортированного расписания.");
  const entries = imported.entries as unknown as ImportedLesson[];
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const rooms = [
    ...new Set(entries.map((entry) => entry.room).filter((room): room is string => Boolean(room))),
  ];
  const slots = [
    ...new Map(
      entries.map((entry) => [
        entry.pair,
        { startTime: entry.startTime, endTime: entry.endTime, hours: 1 },
      ]),
    ).values(),
  ];
  const allocations = new Map<
    string,
    { groupId: string; courseId: string; teacherName: string; hours: number; rooms: string[] }
  >();
  const courses = new Map<string, { id: string; title: string }>();
  let incomplete = 0;
  for (const entry of entries) {
    const group = entry.groupId ? groupsById.get(entry.groupId) : null;
    if (!group || !entry.teacher || !entry.room) {
      incomplete++;
      continue;
    }
    const title = cleanScheduleSubjectName(entry.subject);
    const courseId = `${group.specialtyId}:${title}`;
    courses.set(courseId, { id: courseId, title });
    const key = `${group.id}:${courseId}:${entry.teacher}`;
    const current = allocations.get(key);
    if (current) current.hours++;
    else
      allocations.set(key, {
        groupId: group.id,
        courseId,
        teacherName: entry.teacher,
        hours: 1,
        rooms: [entry.room],
      });
  }
  const result = generateSchedule({
    config: {
      termId: term.id,
      rooms,
      slots,
      vacations: [],
      extraDaysOff: [],
      allocations: [...allocations.values()],
    },
    term: {
      startsOn: term.startsOn.toISOString().slice(0, 10),
      endsOn: term.endsOn.toISOString().slice(0, 10),
    },
    groups,
    courses: [...courses.values()],
  });
  console.log(
    JSON.stringify({
      sourceLessons: entries.length,
      incomplete,
      allocations: allocations.size,
      generatedLessons: result.lessons.length,
      first: result.lessons[0]?.date,
      last: result.lessons.at(-1)?.date,
      teachingDays: result.teachingDays,
    }),
  );
} finally {
  await prisma.$disconnect();
}
