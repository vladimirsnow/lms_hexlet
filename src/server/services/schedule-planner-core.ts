import { z } from "zod";
import type { ImportedLesson } from "@/server/services/schedule-xlsx";

const date = z.iso.date();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const plannerSchema = z.object({
  termId: z.uuid(),
  rooms: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  slots: z
    .array(z.object({ startTime: time, endTime: time, hours: z.number().int().min(1).max(2) }))
    .min(1)
    .max(8),
  vacations: z
    .array(z.object({ startsOn: date, endsOn: date }))
    .max(30)
    .default([]),
  extraDaysOff: z.array(date).max(100).default([]),
  allocations: z
    .array(
      z.object({
        groupId: z.uuid(),
        courseId: z.uuid(),
        teacherName: z.string().trim().min(1).max(160),
        hours: z.number().int().min(1).max(1000),
        rooms: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
      }),
    )
    .min(1)
    .max(500),
});

export type PlannerConfig = z.infer<typeof plannerSchema>;
export type PlannerCourse = { id: string; title: string };
export type PlannerGroup = { id: string; name: string };
export type ManualBooking = {
  groupId: string;
  teacherName: string;
  room: string | null;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  weekPattern: "EVERY" | "ODD" | "EVEN";
  startsOn: string;
  endsOn: string;
};

function minutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function iso(value: Date) {
  return value.toISOString().slice(0, 10);
}
function utc(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
function monday(value: Date) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 6) % 7));
  return result;
}
function roomKey(value: string) {
  return value.toLocaleLowerCase("ru");
}
function isVirtualRoom(value: string) {
  return roomKey(value) === "онлайн";
}

/** Fixed holidays and transfers: https://www.gov.kz/article/16887?lang=ru (2026 calendar). */
export function kazakhstanDaysOff(year: number): Set<string> {
  const fixed = [
    "01-01",
    "01-02",
    "03-15",
    "03-21",
    "03-22",
    "03-23",
    "05-01",
    "05-07",
    "05-09",
    "07-06",
    "10-25",
    "12-16",
  ];
  const result = new Set<string>();
  const holidays = fixed.map((part) => utc(`${year}-${part}`));
  for (const holiday of holidays) result.add(iso(holiday));
  // Each national/state holiday falling on a weekend adds the next free weekday.
  for (const holiday of holidays) {
    const weekday = holiday.getUTCDay();
    if (weekday !== 0 && weekday !== 6) continue;
    const shifted = new Date(holiday);
    do {
      shifted.setUTCDate(shifted.getUTCDate() + 1);
    } while (shifted.getUTCDay() === 0 || shifted.getUTCDay() === 6 || result.has(iso(shifted)));
    result.add(iso(shifted));
  }
  result.add(`${year}-01-07`); // Orthodox Christmas has no transfer.
  if (year === 2026) result.add("2026-05-27");
  // DUMK's 2027 date is preliminary. It falls on Sunday and has no transfer.
  if (year === 2027) result.add("2027-05-16");
  return result;
}

export function validatePlannerConfig(config: PlannerConfig) {
  if (
    new Set(config.rooms.map((room) => room.toLocaleLowerCase("ru"))).size !== config.rooms.length
  )
    throw new Error("Названия кабинетов не должны повторяться.");
  const slots = config.slots.map((slot) => ({
    start: minutes(slot.startTime),
    end: minutes(slot.endTime),
  }));
  if (slots.some((slot) => slot.end <= slot.start || slot.end - slot.start > 180))
    throw new Error("Проверьте время начала и конца занятий.");
  for (let i = 0; i < slots.length; i++)
    for (let j = i + 1; j < slots.length; j++)
      if (slots[i].start < slots[j].end && slots[j].start < slots[i].end)
        throw new Error("Временные интервалы занятий пересекаются.");
  if (config.vacations.some((range) => range.startsOn > range.endsOn))
    throw new Error("Конец каникул должен быть не раньше начала.");
  const names = new Set(config.rooms);
  if (config.allocations.some((item) => item.rooms.some((room) => !names.has(room))))
    throw new Error("Для курса выбран кабинет вне списка кабинетов.");
  const allocationKeys = config.allocations.map(
    (item) => `${item.groupId}:${item.courseId}:${item.teacherName.toLocaleLowerCase("ru")}`,
  );
  if (new Set(allocationKeys).size !== allocationKeys.length)
    throw new Error("Одинаковая нагрузка для группы, курса и преподавателя указана дважды.");
}

export function generateSchedule(input: {
  config: PlannerConfig;
  term: { startsOn: string; endsOn: string };
  groups: PlannerGroup[];
  courses: PlannerCourse[];
  manualBookings?: ManualBooking[];
}) {
  const { config, term, manualBookings = [] } = input;
  validatePlannerConfig(config);
  const groupMap = new Map(input.groups.map((group) => [group.id, group]));
  const courseMap = new Map(input.courses.map((course) => [course.id, course]));
  for (const allocation of config.allocations) {
    const course = courseMap.get(allocation.courseId);
    if (!groupMap.has(allocation.groupId) || !course)
      throw new Error("В нагрузке есть несуществующая группа или курс.");
  }
  const dayOff = new Set(config.extraDaysOff);
  for (
    let year = Number(term.startsOn.slice(0, 4));
    year <= Number(term.endsOn.slice(0, 4));
    year++
  )
    for (const day of kazakhstanDaysOff(year)) dayOff.add(day);
  const dates: string[] = [];
  for (
    let current = utc(term.startsOn);
    iso(current) <= term.endsOn;
    current.setUTCDate(current.getUTCDate() + 1)
  ) {
    const value = iso(current);
    const weekday = current.getUTCDay();
    if (
      weekday === 0 ||
      weekday === 6 ||
      dayOff.has(value) ||
      config.vacations.some((range) => value >= range.startsOn && value <= range.endsOn)
    )
      continue;
    dates.push(value);
  }
  const capacity = dates.length * config.slots.reduce((sum, slot) => sum + slot.hours, 0);
  const groupHours = new Map<string, number>();
  for (const allocation of config.allocations)
    groupHours.set(
      allocation.groupId,
      (groupHours.get(allocation.groupId) ?? 0) + allocation.hours,
    );
  for (const [groupId, hours] of groupHours)
    if (hours > capacity)
      throw new Error(
        `Для группы ${groupMap.get(groupId)?.name} требуется ${hours} часов, но доступно только ${capacity} академических часов.`,
      );

  const remaining = config.allocations.map((item) => ({ ...item, remaining: item.hours }));
  const scheduledByGroup = new Map<string, number>();
  const lessons: ImportedLesson[] = [];
  const firstMonday = monday(utc(term.startsOn));
  const slotIndexes = config.slots
    .map((_, i) => i)
    .sort((a, b) => minutes(config.slots[a].startTime) - minutes(config.slots[b].startTime));
  for (const [dayIndex, day] of dates.entries()) {
    const weekday = ((utc(day).getUTCDay() + 6) % 7) + 1;
    const week = Math.floor((monday(utc(day)).getTime() - firstMonday.getTime()) / 604800000) + 1;
    for (const slotIndex of slotIndexes) {
      const slot = config.slots[slotIndex];
      const start = minutes(slot.startTime),
        end = minutes(slot.endTime);
      const activeManual = manualBookings.filter((booking) => {
        if (
          day < booking.startsOn ||
          day > booking.endsOn ||
          booking.dayOfWeek !== weekday ||
          start >= booking.endMinute ||
          end <= booking.startMinute
        )
          return false;
        if (booking.weekPattern === "EVERY") return true;
        const manualWeek =
          Math.floor(
            (monday(utc(day)).getTime() - monday(utc(booking.startsOn)).getTime()) / 604800000,
          ) + 1;
        return booking.weekPattern === "ODD" ? manualWeek % 2 === 1 : manualWeek % 2 === 0;
      });
      const busyGroups = new Set(activeManual.map((item) => item.groupId));
      const busyTeachers = new Set(
        activeManual.map((item) => item.teacherName.toLocaleLowerCase("ru")),
      );
      const busyRooms = new Set(
        activeManual
          .map((item) => (item.room ? roomKey(item.room) : null))
          .filter((room): room is string => Boolean(room) && room !== "онлайн"),
      );
      const groups = [...groupHours.keys()].sort((a, b) => {
        const options = (id: string) =>
          remaining.filter((item) => item.groupId === id && item.remaining > 0).length;
        return (
          options(a) - options(b) ||
          (groupHours.get(b) ?? 0) - (groupHours.get(a) ?? 0) ||
          a.localeCompare(b)
        );
      });
      for (const groupId of groups) {
        if (busyGroups.has(groupId)) continue;
        const total = groupHours.get(groupId) ?? 0;
        const scheduled = scheduledByGroup.get(groupId) ?? 0;
        const dailyTarget = Math.ceil((total * (dayIndex + 1)) / dates.length);
        const futureCapacity =
          (dates.length - dayIndex - 1) * config.slots.reduce((sum, item) => sum + item.hours, 0);
        if (scheduled >= dailyTarget && total - scheduled <= futureCapacity) continue;
        const choices = remaining
          .filter(
            (item) =>
              item.groupId === groupId &&
              item.remaining >= slot.hours &&
              !busyTeachers.has(item.teacherName.toLocaleLowerCase("ru")),
          )
          .flatMap((item) =>
            item.rooms
              .filter((room) => isVirtualRoom(room) || !busyRooms.has(roomKey(room)))
              .map((room) => ({ item, room })),
          );
        choices.sort(
          (a, b) =>
            b.item.remaining - a.item.remaining ||
            a.item.rooms.length - b.item.rooms.length ||
            a.item.courseId.localeCompare(b.item.courseId),
        );
        const chosen = choices[0];
        if (!chosen) continue;
        const course = courseMap.get(chosen.item.courseId)!;
        const group = groupMap.get(groupId)!;
        lessons.push({
          groupId,
          groupName: group.name,
          date: day,
          week,
          pair: slotIndex + 1,
          startTime: slot.startTime,
          endTime: slot.endTime,
          subject: course.title,
          teacher: chosen.item.teacherName,
          room: chosen.room,
          sourceText: course.title,
        });
        chosen.item.remaining -= slot.hours;
        scheduledByGroup.set(groupId, scheduled + slot.hours);
        busyGroups.add(groupId);
        busyTeachers.add(chosen.item.teacherName.toLocaleLowerCase("ru"));
        if (!isVirtualRoom(chosen.room)) busyRooms.add(roomKey(chosen.room));
      }
    }
  }
  const unplaced = remaining.filter((item) => item.remaining > 0);
  if (unplaced.length)
    throw new Error(
      `Не удалось разместить ${unplaced.reduce((sum, item) => sum + item.remaining, 0)} часов. Добавьте интервалы/кабинеты, сократите каникулы или измените назначения преподавателей.`,
    );
  return {
    lessons,
    daysOff: [...dayOff].filter((day) => day >= term.startsOn && day <= term.endsOn).sort(),
    teachingDays: dates.length,
  };
}
