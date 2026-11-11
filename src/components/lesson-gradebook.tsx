"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { normalizeLocale } from "@/lib/i18n";

const labels = {
  ru: {
    title: "Оценки за пары",
    description: "Баллы за каждую пару по шкале от 0 до 100.",
    journal: "ЭЛЕКТРОННЫЙ ЖУРНАЛ",
    groupLessons: "Занятия группы",
    filters: "Параметры журнала",
    moreFilters: "Ещё фильтры",
    hideFilters: "Скрыть",
    scale: "100-балльная система",
    lessonMetric: "Занятий",
    daysMetric: "Дней с оценками",
    studentMetric: "Студентов",
    filledMetric: "Оценок выставлено",
    group: "Группа",
    week: "Неделя",
    period: "Период",
    view: "Просмотр",
    dayView: "День",
    weekView: "Неделя",
    periodView: "Период",
    allView: "За всё время",
    from: "С",
    to: "По",
    course: "Предмет",
    allCourses: "Все предметы",
    average: "Средний балл",
    showMore: "Показать ещё",
    rangeErrorDates: "Выберите период не длиннее 367 дней.",
    date: "Дата",
    student: "Студент",
    allStudents: "Все студенты",
    chooseGroup: "Выберите группу",
    chooseWeek: "Выберите неделю",
    today: "Сегодня",
    previousDay: "Предыдущий день",
    nextDay: "Следующий день",
    loading: "Загружаем журнал…",
    noGroups: "У вас пока нет доступных групп.",
    noLessons:
      "В выбранном периоде нет занятий по этому предмету. Измените дату, период или предмет.",
    nearestDay: "Показан ближайший день с занятиями из расписания.",
    noStudents: "Студенты не найдены.",
    saved: "Оценка сохранена.",
    savedInline: "Сохранено",
    savingInline: "Сохраняем…",
    errorInline: "Ошибка",
    loadError: "Не удалось загрузить журнал.",
    saveError: "Не удалось сохранить оценку.",
    rangeError: "Введите целое число от 0 до 100.",
    grade: "Балл",
    scroll: "Прокрутите таблицу вправо, чтобы увидеть остальные пары.",
  },
  kk: {
    title: "Сабақ бағалары",
    description: "Әр сабаққа 0-ден 100-ге дейін балл қойыңыз.",
    journal: "ЭЛЕКТРОНДЫ ЖУРНАЛ",
    groupLessons: "Топ сабақтары",
    filters: "Журнал параметрлері",
    moreFilters: "Басқа сүзгілер",
    hideFilters: "Жасыру",
    scale: "100 балдық жүйе",
    lessonMetric: "Сабақтар",
    daysMetric: "Бағаланған күндер",
    studentMetric: "Студенттер",
    filledMetric: "Қойылған бағалар",
    group: "Топ",
    week: "Апта",
    period: "Кезең",
    view: "Көрініс",
    dayView: "Күн",
    weekView: "Апта",
    periodView: "Кезең",
    allView: "Барлық уақыт",
    from: "Бастап",
    to: "Дейін",
    course: "Пән",
    allCourses: "Барлық пәндер",
    average: "Орташа ұпай",
    showMore: "Тағы көрсету",
    rangeErrorDates: "367 күннен аспайтын кезеңді таңдаңыз.",
    date: "Күні",
    student: "Студент",
    allStudents: "Барлық студенттер",
    chooseGroup: "Топты таңдаңыз",
    chooseWeek: "Аптаны таңдаңыз",
    today: "Бүгін",
    previousDay: "Алдыңғы күн",
    nextDay: "Келесі күн",
    loading: "Журнал жүктелуде…",
    noGroups: "Қолжетімді топтар әлі жоқ.",
    noLessons:
      "Таңдалған кезеңде бұл пән бойынша сабақ жоқ. Күнді, кезеңді немесе пәнді өзгертіңіз.",
    nearestDay: "Кестедегі ең жақын сабақ күні көрсетілді.",
    noStudents: "Студенттер табылмады.",
    saved: "Баға сақталды.",
    savedInline: "Сақталды",
    savingInline: "Сақталуда…",
    errorInline: "Қате",
    loadError: "Журнал жүктелмеді.",
    saveError: "Бағаны сақтау мүмкін болмады.",
    rangeError: "0-ден 100-ге дейінгі бүтін санды енгізіңіз.",
    grade: "Балл",
    scroll: "Басқа сабақтарды көру үшін кестені оңға жылжытыңыз.",
  },
  en: {
    title: "Class grades",
    description: "Score every class on a scale from 0 to 100.",
    journal: "CLASS GRADEBOOK",
    groupLessons: "Group classes",
    filters: "Gradebook filters",
    moreFilters: "More filters",
    hideFilters: "Hide filters",
    scale: "100-point scale",
    lessonMetric: "Classes",
    daysMetric: "Days with grades",
    studentMetric: "Students",
    filledMetric: "Scores entered",
    group: "Group",
    week: "Week",
    period: "Period",
    view: "View",
    dayView: "Day",
    weekView: "Week",
    periodView: "Period",
    allView: "All time",
    from: "From",
    to: "To",
    course: "Subject",
    allCourses: "All subjects",
    average: "Average score",
    showMore: "Show more",
    rangeErrorDates: "Choose a period of no more than 367 days.",
    date: "Date",
    student: "Student",
    allStudents: "All students",
    chooseGroup: "Choose a group",
    chooseWeek: "Choose a week",
    today: "Today",
    previousDay: "Previous day",
    nextDay: "Next day",
    loading: "Loading gradebook…",
    noGroups: "You have no available groups yet.",
    noLessons:
      "No classes for this subject in the selected period. Change the date, period, or subject.",
    nearestDay: "Showing the nearest class day in the schedule.",
    noStudents: "No students found.",
    saved: "Grade saved.",
    savedInline: "Saved",
    savingInline: "Saving…",
    errorInline: "Error",
    loadError: "Could not load the gradebook.",
    saveError: "Could not save the grade.",
    rangeError: "Enter a whole number from 0 to 100.",
    grade: "Score",
    scroll: "Scroll the table right to see more classes.",
  },
} as const;

type Book = {
  groups: { id: string; name: string }[];
  groupId: string | null;
  students: { id: string; name: string }[];
  lessons: { key: string; date: string; time: string; title: string }[];
  grades: { lessonKey: string; date: string; studentId: string; value: number }[];
  availableDates: string[];
  suggestedDate: string | null;
};

type History = {
  groups: { id: string; name: string }[];
  groupId: string | null;
  courses: { key: string; title: string }[];
  students: { id: string; name: string }[];
  total: { grades: number; days: number; students: number; average: number | null };
  hasMore: boolean;
  grades: {
    id: string;
    studentId: string;
    studentName: string;
    date: string;
    value: number;
    courseKey: string;
    courseTitle: string;
  }[];
};

function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Almaty" });
}

function weekBounds(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

function isoWeek(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((day.getTime() - first.getTime()) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function weekFromInput(value: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return null;
  const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4));
  const monday = new Date(
    jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000 + (Number(match[2]) - 1) * 604800000,
  );
  return weekBounds(monday.toISOString().slice(0, 10));
}

function cellId(studentId: string, lessonKey: string, date: string) {
  return `${studentId}:${lessonKey}:${date}`;
}

function formatDate(date: string, locale: string) {
  if (!date) return "—";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function formatWeekday(date: string, locale: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: "short",
    timeZone: "UTC",
  });
}

function formatFullDate(date: string, locale: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function LessonGradebook({ locale }: { locale: string }) {
  const appLocale = normalizeLocale(locale);
  const copy = labels[appLocale];
  const dateLocale = appLocale === "kk" ? "kk-KZ" : appLocale === "en" ? "en-GB" : "ru-RU";
  const initial = useMemo(() => weekBounds(today()), []);
  const weekOptions = useMemo(() => {
    const monday = Date.parse(`${initial.from}T00:00:00Z`);
    return Array.from({ length: 105 }, (_, index) => {
      const bounds = weekBounds(
        new Date(monday + (index - 52) * 604800000).toISOString().slice(0, 10),
      );
      return {
        value: isoWeek(bounds.from),
        label: `${formatDate(bounds.from, dateLocale)} — ${formatDate(bounds.to, dateLocale)}`,
      };
    });
  }, [initial.from, dateLocale]);
  const [date, setDate] = useState(today());
  const [view, setView] = useState<"day" | "week" | "period" | "all">("day");
  const [periodFrom, setPeriodFrom] = useState(shiftDate(today(), -30));
  const [periodTo, setPeriodTo] = useState(today());
  const [course, setCourse] = useState("");
  const [week, setWeek] = useState(isoWeek(initial.from));
  const [groupId, setGroupId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [book, setBook] = useState<Book | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyOffset, setHistoryOffset] = useState(0);
  const [grades, setGrades] = useState<Record<string, number>>({});
  const [draftGrades, setDraftGrades] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [cellStates, setCellStates] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const autoSelectDate = useRef(true);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const bounds =
          view === "day"
            ? { from: date, to: date }
            : view === "week"
              ? weekBounds(date)
              : { from: periodFrom, to: periodTo };
        const days =
          (Date.parse(`${bounds.to}T00:00:00Z`) - Date.parse(`${bounds.from}T00:00:00Z`)) /
          86400000;
        if (!Number.isFinite(days) || days < 0 || days > 366) {
          setError(copy.rangeErrorDates);
          setBook(null);
          setLoading(false);
          return;
        }
        const query = new URLSearchParams(bounds);
        if (groupId) query.set("groupId", groupId);
        const response = await apiFetch(`/api/v1/lesson-grades?${query}`, {
          cache: "no-store",
          signal,
        });
        const data = await response.json();
        if (signal.aborted) return;
        if (!response.ok) throw new Error(data?.error?.message || copy.loadError);
        if (
          view === "day" &&
          autoSelectDate.current &&
          !data.lessons.length &&
          data.suggestedDate &&
          data.suggestedDate !== date
        ) {
          autoSelectDate.current = false;
          setGroupId(data.groupId || "");
          setDate(data.suggestedDate);
          setWeek(isoWeek(data.suggestedDate));
          setNotice(copy.nearestDay);
          return;
        }
        autoSelectDate.current = false;
        setBook(data);
        setCourse((current) =>
          current &&
          !data.lessons.some((lesson: Book["lessons"][number]) => lesson.title === current)
            ? ""
            : current,
        );
        setGroupId(data.groupId || "");
        const nextGrades = Object.fromEntries(
          data.grades.map((grade: Book["grades"][number]) => [
            cellId(grade.studentId, grade.lessonKey, grade.date),
            grade.value,
          ]),
        );
        setGrades(nextGrades);
        setDraftGrades(
          Object.fromEntries(Object.entries(nextGrades).map(([id, value]) => [id, String(value)])),
        );
        setCellStates({});
      } catch (cause) {
        if (signal.aborted) return;
        setError(cause instanceof Error ? cause.message : copy.loadError);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [
      date,
      view,
      periodFrom,
      periodTo,
      groupId,
      copy.loadError,
      copy.nearestDay,
      copy.rangeErrorDates,
    ],
  );

  useEffect(() => {
    if (view === "all") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void load(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [load, view]);

  useEffect(() => {
    if (view !== "all") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const query = new URLSearchParams();
        if (groupId) query.set("groupId", groupId);
        if (course) query.set("courseKey", course);
        if (studentId) query.set("studentId", studentId);
        query.set("offset", String(historyOffset));
        const response = await apiFetch(`/api/v1/lesson-grades/history?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(data?.error?.message || copy.loadError);
        setHistory((current) =>
          historyOffset === 0
            ? (data as History)
            : {
                ...(data as History),
                grades: [...(current?.grades ?? []), ...(data as History).grades],
              },
        );
        setGroupId(data.groupId || "");
      } catch (cause) {
        if (!controller.signal.aborted)
          setHistoryError(cause instanceof Error ? cause.message : copy.loadError);
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [view, groupId, course, studentId, historyOffset, copy.loadError]);

  async function save(studentId: string, lesson: Book["lessons"][number], value: string) {
    if (!book?.groupId) return;
    const id = cellId(studentId, lesson.key, lesson.date);
    if (cellStates[id] === "saving") return;
    const trimmed = value.trim();
    if (trimmed && !/^(?:0|[1-9]\d?|100)$/.test(trimmed)) {
      setError(copy.rangeError);
      setNotice("");
      setCellStates((current) => ({ ...current, [id]: "error" }));
      return;
    }
    const nextValue = trimmed ? Number(trimmed) : null;
    if ((grades[id] ?? null) === nextValue) {
      setDraftGrades((current) => ({ ...current, [id]: trimmed }));
      setCellStates((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    setCellStates((current) => ({ ...current, [id]: "saving" }));
    setError("");
    setNotice("");
    try {
      const response = await apiFetch("/api/v1/lesson-grades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: book.groupId,
          studentId,
          lessonKey: lesson.key,
          date: lesson.date,
          value: nextValue,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || copy.saveError);
      setGrades((current) => {
        const next = { ...current };
        if (result.value === null) delete next[id];
        else next[id] = result.value;
        return next;
      });
      setDraftGrades((current) => ({
        ...current,
        [id]: result.value === null ? "" : String(result.value),
      }));
      setNotice(copy.saved);
      setCellStates((current) => ({ ...current, [id]: "saved" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.saveError);
      setCellStates((current) => ({ ...current, [id]: "error" }));
    }
  }

  const allStudents = view === "all" ? (history?.students ?? []) : (book?.students ?? []);
  const students = allStudents.filter((student) => !studentId || student.id === studentId);
  const courses = [...new Set(book?.lessons.map((lesson) => lesson.title) ?? [])].sort((a, b) =>
    a.localeCompare(b, dateLocale),
  );
  const selectedCourseTitle =
    view === "all" ? history?.courses.find((item) => item.key === course)?.title : course;
  const visibleLessons = book?.lessons.filter((lesson) => !course || lesson.title === course) ?? [];
  const visibleHistory = history?.grades ?? [];
  const dateLabel = (date: string) => formatDate(date, dateLocale);
  const lessonCount = view === "all" ? (history?.total.days ?? 0) : visibleLessons.length;
  const visibleScores =
    view === "all"
      ? []
      : students.flatMap((student) =>
          visibleLessons.flatMap((lesson) => {
            const score = grades[cellId(student.id, lesson.key, lesson.date)];
            return score === undefined ? [] : [score];
          }),
        );
  const average = (scores: number[]) =>
    scores.length
      ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toLocaleString(dateLocale, {
          maximumFractionDigits: 1,
        })
      : "—";
  const periodLabel =
    view === "all"
      ? copy.allView
      : view === "day"
        ? formatFullDate(date, dateLocale)
        : `${formatDate(view === "week" ? weekBounds(date).from : periodFrom, dateLocale)} — ${formatDate(view === "week" ? weekBounds(date).to : periodTo, dateLocale)}`;
  const filledCount =
    view === "all"
      ? (history?.total.grades ?? 0)
      : students.reduce(
          (total, student) =>
            total +
            (visibleLessons.reduce(
              (count, lesson) =>
                count + (grades[cellId(student.id, lesson.key, lesson.date)] !== undefined ? 1 : 0),
              0,
            ) ?? 0),
          0,
        );
  function moveDay(offset: number) {
    const nextDate = shiftDate(date, offset);
    autoSelectDate.current = false;
    setDate(nextDate);
    setView("day");
    setWeek(isoWeek(nextDate));
    setNotice("");
  }
  return (
    <div className="app-page-wrap lesson-gradebook-page">
      <header className="app-page-header lesson-gradebook-header">
        <div className="lesson-gradebook-header-copy">
          <p className="eyebrow">{copy.journal}</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <div className="lesson-gradebook-scale" aria-label={copy.scale}>
          <strong>0–100</strong>
          <span>{copy.scale}</span>
        </div>
      </header>
      <section className="lesson-gradebook-workspace" aria-label={copy.title}>
        <div className="lesson-gradebook-toolbar">
          <div className="lesson-gradebook-toolbar-heading">
            <div>
              <p className="eyebrow">{copy.filters}</p>
              <h2>{copy.groupLessons}</h2>
            </div>
            <span className="lesson-gradebook-period">{periodLabel}</span>
          </div>
          <div className={`lesson-gradebook-filters${showMoreFilters ? " is-expanded" : ""}`}>
            <label>
              {copy.group}
              <select
                value={groupId}
                onChange={(event) => {
                  autoSelectDate.current = false;
                  setGroupId(event.target.value);
                  setStudentId("");
                  setCourse("");
                  setHistoryOffset(0);
                }}
                disabled={
                  !(view === "all"
                    ? history?.groups.length || book?.groups.length
                    : book?.groups.length)
                }
              >
                <option value="" disabled>
                  {copy.chooseGroup}
                </option>
                {(view === "all" ? (history?.groups ?? book?.groups) : book?.groups)?.map(
                  (group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              {copy.week}
              <select
                value={week}
                onChange={(event) => {
                  autoSelectDate.current = false;
                  setView("week");
                  const bounds = weekFromInput(event.target.value);
                  setWeek(event.target.value);
                  if (bounds) {
                    setDate(
                      book?.availableDates.find(
                        (available) => available >= bounds.from && available <= bounds.to,
                      ) ?? bounds.from,
                    );
                  }
                }}
              >
                <option value="">{copy.chooseWeek}</option>
                {week && !weekOptions.some((option) => option.value === week) ? (
                  <option value={week}>
                    {dateLabel(weekBounds(date).from)} — {dateLabel(weekBounds(date).to)}
                  </option>
                ) : null}
                {weekOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-muted lesson-gradebook-more-filters"
              type="button"
              aria-expanded={showMoreFilters}
              onClick={() => setShowMoreFilters((current) => !current)}
            >
              {showMoreFilters ? copy.hideFilters : copy.moreFilters}
            </button>
            <label>
              {copy.date}
              <input
                type="date"
                lang={appLocale}
                value={date}
                onChange={(event) => {
                  if (!event.target.value) return;
                  autoSelectDate.current = false;
                  setView("day");
                  setDate(event.target.value);
                  setWeek(isoWeek(event.target.value));
                  setNotice("");
                }}
              />
              <small className="lesson-gradebook-date-caption">{dateLabel(date)}</small>
            </label>
            <label>
              {copy.student}
              <select
                value={studentId}
                onChange={(event) => {
                  setStudentId(event.target.value);
                  setHistoryOffset(0);
                }}
              >
                <option value="">{copy.allStudents}</option>
                {allStudents.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-muted lesson-gradebook-current-week"
              type="button"
              onClick={() => {
                autoSelectDate.current = false;
                const todayDate = today();
                setView("day");
                setDate(todayDate);
                setWeek(isoWeek(todayDate));
              }}
            >
              {copy.today}
            </button>
          </div>
          <div className="lesson-gradebook-extra-filters">
            <label>
              {copy.view}
              <select
                value={view}
                onChange={(event) => {
                  autoSelectDate.current = false;
                  setCourse("");
                  setStudentId("");
                  setHistoryOffset(0);
                  setView(event.target.value as "day" | "week" | "period" | "all");
                }}
              >
                <option value="day">{copy.dayView}</option>
                <option value="week">{copy.weekView}</option>
                <option value="period">{copy.periodView}</option>
                <option value="all">{copy.allView}</option>
              </select>
            </label>
            {view === "period" ? (
              <>
                <label>
                  {copy.from}
                  <input
                    type="date"
                    value={periodFrom}
                    onChange={(event) => setPeriodFrom(event.target.value)}
                  />
                </label>
                <label>
                  {copy.to}
                  <input
                    type="date"
                    value={periodTo}
                    onChange={(event) => setPeriodTo(event.target.value)}
                  />
                </label>
              </>
            ) : null}
            <label>
              {copy.course}
              <select
                value={course}
                onChange={(event) => {
                  setCourse(event.target.value);
                  setHistoryOffset(0);
                }}
              >
                <option value="">{copy.allCourses}</option>
                {(view === "all"
                  ? (history?.courses.map((item) => ({ key: item.key, title: item.title })) ?? [])
                  : courses.map((title) => ({ key: title, title }))
                ).map((item) => (
                  <option value={item.key} key={item.key}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="lesson-gradebook-summary" aria-live="polite">
          <div>
            <strong>{lessonCount}</strong>
            <span>{view === "all" ? copy.daysMetric : copy.lessonMetric}</span>
          </div>
          <div>
            <strong>{view === "all" ? (history?.total.students ?? 0) : students.length}</strong>
            <span>{copy.studentMetric}</span>
          </div>
          <div>
            <strong>{filledCount}</strong>
            <span>{copy.filledMetric}</span>
          </div>
          <div>
            <strong>
              {view === "all"
                ? history?.total.average === null || history?.total.average === undefined
                  ? "—"
                  : history.total.average.toLocaleString(dateLocale, { maximumFractionDigits: 1 })
                : average(visibleScores)}
            </strong>
            <span>{copy.average}</span>
          </div>
        </div>
        <div className="lesson-gradebook-panel">
          <div className="lesson-gradebook-table-heading">
            <div>
              <p className="eyebrow">{copy.journal}</p>
              <h2>
                {periodLabel}
                {selectedCourseTitle ? ` · ${selectedCourseTitle}` : ""}
              </h2>
            </div>
          </div>
          {view !== "all" && error ? (
            <p className="schedule-form-error" role="alert">
              {error}
            </p>
          ) : null}
          {view === "all" && historyError ? (
            <p className="schedule-form-error" role="alert">
              {historyError}
            </p>
          ) : null}
          {notice ? (
            <p className="schedule-form-success" role="status">
              {notice}
            </p>
          ) : null}
          {view === "all" ? (
            historyError ? null : historyLoading || !history ? (
              <p className="course-material-empty" role="status">
                {copy.loading}
              </p>
            ) : !visibleHistory.length ? (
              <p className="course-material-empty">{copy.noLessons}</p>
            ) : (
              <>
                <div className="gradebook-table-wrap">
                  <table className="gradebook-table lesson-grade-history-table">
                    <thead>
                      <tr>
                        <th scope="col">{copy.date}</th>
                        <th scope="col">{copy.student}</th>
                        <th scope="col">{copy.course}</th>
                        <th scope="col">{copy.grade}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleHistory.map((grade) => (
                        <tr key={grade.id}>
                          <td>{formatFullDate(grade.date, dateLocale)}</td>
                          <td>{grade.studentName}</td>
                          <td>{grade.courseTitle}</td>
                          <td>{grade.value} / 100</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {history?.hasMore ? (
                  <button
                    className="button button-muted lesson-grade-history-more"
                    type="button"
                    disabled={historyLoading}
                    onClick={() => setHistoryOffset((offset) => offset + 100)}
                  >
                    {copy.showMore}
                  </button>
                ) : null}
              </>
            )
          ) : loading ? (
            <p className="course-material-empty" role="status">
              {copy.loading}
            </p>
          ) : !book?.groups.length ? (
            <p className="course-material-empty">{copy.noGroups}</p>
          ) : !visibleLessons.length ? (
            <p className="course-material-empty">{copy.noLessons}</p>
          ) : (
            <>
              <p className="lesson-gradebook-scroll-hint">{copy.scroll}</p>
              <div className="lesson-gradebook-scroll">
                <table className="lesson-gradebook-table">
                  <thead>
                    <tr>
                      <th scope="col" className="lesson-gradebook-student">
                        {copy.student}
                      </th>
                      {visibleLessons.map((lesson) => (
                        <th scope="col" key={`${lesson.key}:${lesson.date}`}>
                          <span className="lesson-gradebook-weekday">
                            {formatWeekday(lesson.date, dateLocale)}
                          </span>
                          <strong>{dateLabel(lesson.date)}</strong>
                          <span className="lesson-gradebook-lesson-time">{lesson.time}</span>
                          <span className="lesson-gradebook-lesson-title">{lesson.title}</span>
                        </th>
                      ))}
                      <th scope="col" className="lesson-gradebook-average">
                        {copy.average}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student, index) => (
                      <tr key={student.id}>
                        <th scope="row" className="lesson-gradebook-student">
                          <span className="lesson-gradebook-student-index">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="lesson-gradebook-student-name">{student.name}</span>
                        </th>
                        {visibleLessons.map((lesson) => {
                          const id = cellId(student.id, lesson.key, lesson.date);
                          return (
                            <td key={id}>
                              <div
                                className={`lesson-gradebook-score${grades[id] !== undefined ? " is-filled" : ""}${cellStates[id] === "error" ? " is-error" : ""}`}
                              >
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  maxLength={3}
                                  aria-label={`${copy.grade}: ${student.name}, ${lesson.title}, ${dateLabel(lesson.date)} ${lesson.time}`}
                                  aria-invalid={cellStates[id] === "error"}
                                  placeholder="—"
                                  value={draftGrades[id] ?? ""}
                                  disabled={cellStates[id] === "saving"}
                                  onChange={(event) => {
                                    setDraftGrades((current) => ({
                                      ...current,
                                      [id]: event.target.value,
                                    }));
                                    if (cellStates[id]) {
                                      setCellStates((current) => {
                                        const next = { ...current };
                                        delete next[id];
                                        return next;
                                      });
                                    }
                                  }}
                                  onBlur={(event) =>
                                    void save(student.id, lesson, event.currentTarget.value)
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") event.currentTarget.blur();
                                    if (event.key === "Escape") {
                                      const previous =
                                        grades[id] === undefined ? "" : String(grades[id]);
                                      event.currentTarget.value = previous;
                                      setDraftGrades((current) => ({ ...current, [id]: previous }));
                                      event.currentTarget.blur();
                                    }
                                  }}
                                />
                                <span aria-hidden="true">/ 100</span>
                              </div>
                              {cellStates[id] === "saving" ? (
                                <small className="lesson-gradebook-cell-state" role="status">
                                  {copy.savingInline}
                                </small>
                              ) : cellStates[id] === "saved" ? (
                                <small className="lesson-gradebook-cell-state" role="status">
                                  ✓ {copy.savedInline}
                                </small>
                              ) : cellStates[id] === "error" ? (
                                <small
                                  className="lesson-gradebook-cell-state is-error"
                                  role="alert"
                                >
                                  {copy.errorInline}
                                </small>
                              ) : null}
                            </td>
                          );
                        })}
                        <td className="lesson-gradebook-average">
                          {average(
                            visibleLessons.flatMap((lesson) => {
                              const score = grades[cellId(student.id, lesson.key, lesson.date)];
                              return score === undefined ? [] : [score];
                            }),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!students.length ? (
                  <p className="course-material-empty">{copy.noStudents}</p>
                ) : null}
              </div>
            </>
          )}
          {view !== "all" && book?.groups.length ? (
            <nav className="lesson-gradebook-day-nav" aria-label={copy.date}>
              <button
                className="button button-muted"
                type="button"
                aria-label={copy.previousDay}
                title={copy.previousDay}
                onClick={() => moveDay(-1)}
              >
                <ChevronLeft aria-hidden="true" size={20} />
              </button>
              <span aria-live="polite">{formatFullDate(date, dateLocale)}</span>
              <button
                className="button button-muted"
                type="button"
                aria-label={copy.nextDay}
                title={copy.nextDay}
                onClick={() => moveDay(1)}
              >
                <ChevronRight aria-hidden="true" size={20} />
              </button>
            </nav>
          ) : null}
        </div>
      </section>
    </div>
  );
}
