"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    lessonMetric: "Пар в периоде",
    studentMetric: "Студентов",
    filledMetric: "Оценок выставлено",
    group: "Группа",
    week: "Неделя",
    from: "С",
    to: "По",
    student: "Студент",
    allStudents: "Все студенты",
    chooseGroup: "Выберите группу",
    chooseWeek: "Выберите неделю",
    today: "Эта неделя",
    loading: "Загружаем журнал…",
    noGroups: "У вас пока нет доступных групп.",
    noLessons:
      "На выбранные даты в расписании группы нет занятий. Выберите другую неделю или период.",
    nearestPeriod: "Показана ближайшая неделя из расписания.",
    noStudents: "Студенты не найдены.",
    saved: "Оценка сохранена.",
    savedInline: "Сохранено",
    savingInline: "Сохраняем…",
    errorInline: "Ошибка",
    loadError: "Не удалось загрузить журнал.",
    saveError: "Не удалось сохранить оценку.",
    rangeError: "Введите целое число от 0 до 100.",
    grade: "Балл",
    gradeHint: "Введите 0–100. Балл сохранится при переходе из ячейки.",
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
    lessonMetric: "Кезеңдегі сабақтар",
    studentMetric: "Студенттер",
    filledMetric: "Қойылған бағалар",
    group: "Топ",
    week: "Апта",
    from: "Бастап",
    to: "Дейін",
    student: "Студент",
    allStudents: "Барлық студенттер",
    chooseGroup: "Топты таңдаңыз",
    chooseWeek: "Аптаны таңдаңыз",
    today: "Осы апта",
    loading: "Журнал жүктелуде…",
    noGroups: "Қолжетімді топтар әлі жоқ.",
    noLessons: "Таңдалған күндерде топ кестесінде сабақ жоқ. Басқа апта не кезең таңдаңыз.",
    nearestPeriod: "Кестедегі ең жақын апта көрсетілді.",
    noStudents: "Студенттер табылмады.",
    saved: "Баға сақталды.",
    savedInline: "Сақталды",
    savingInline: "Сақталуда…",
    errorInline: "Қате",
    loadError: "Журнал жүктелмеді.",
    saveError: "Бағаны сақтау мүмкін болмады.",
    rangeError: "0-ден 100-ге дейінгі бүтін санды енгізіңіз.",
    grade: "Балл",
    gradeHint: "0–100 енгізіңіз. Ұяшықтан шыққанда балл сақталады.",
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
    lessonMetric: "Classes in range",
    studentMetric: "Students",
    filledMetric: "Scores entered",
    group: "Group",
    week: "Week",
    from: "From",
    to: "To",
    student: "Student",
    allStudents: "All students",
    chooseGroup: "Choose a group",
    chooseWeek: "Choose a week",
    today: "This week",
    loading: "Loading gradebook…",
    noGroups: "You have no available groups yet.",
    noLessons: "The group has no classes on these dates. Choose another week or date range.",
    nearestPeriod: "Showing the nearest week in the schedule.",
    noStudents: "No students found.",
    saved: "Grade saved.",
    savedInline: "Saved",
    savingInline: "Saving…",
    errorInline: "Error",
    loadError: "Could not load the gradebook.",
    saveError: "Could not save the grade.",
    rangeError: "Enter a whole number from 0 to 100.",
    grade: "Score",
    gradeHint: "Enter 0–100. The score saves when you leave the cell.",
    scroll: "Scroll the table right to see more classes.",
  },
} as const;

type Book = {
  groups: { id: string; name: string }[];
  groupId: string | null;
  students: { id: string; name: string }[];
  lessons: { key: string; date: string; time: string; title: string }[];
  grades: { lessonKey: string; date: string; studentId: string; value: number }[];
  suggestedPeriod: { from: string; to: string } | null;
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
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [week, setWeek] = useState(isoWeek(initial.from));
  const [groupId, setGroupId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [book, setBook] = useState<Book | null>(null);
  const [grades, setGrades] = useState<Record<string, number>>({});
  const [draftGrades, setDraftGrades] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [cellStates, setCellStates] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const autoSelectPeriod = useRef(true);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({ from, to });
        if (groupId) query.set("groupId", groupId);
        const response = await apiFetch(`/api/v1/lesson-grades?${query}`, {
          cache: "no-store",
          signal,
        });
        const data = await response.json();
        if (signal.aborted) return;
        if (!response.ok) throw new Error(data?.error?.message || copy.loadError);
        if (
          autoSelectPeriod.current &&
          !data.lessons.length &&
          data.suggestedPeriod &&
          (data.suggestedPeriod.from !== from || data.suggestedPeriod.to !== to)
        ) {
          autoSelectPeriod.current = false;
          setGroupId(data.groupId || "");
          setFrom(data.suggestedPeriod.from);
          setTo(data.suggestedPeriod.to);
          setWeek(isoWeek(data.suggestedPeriod.from));
          setNotice(copy.nearestPeriod);
          return;
        }
        autoSelectPeriod.current = false;
        setBook(data);
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
    [from, to, groupId, copy.loadError, copy.nearestPeriod],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void load(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [load]);

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

  const students = book?.students.filter((student) => !studentId || student.id === studentId) ?? [];
  const dateLabel = (date: string) => formatDate(date, dateLocale);
  const lessonCount = book?.lessons.length ?? 0;
  const filledCount = students.reduce(
    (total, student) =>
      total +
      (book?.lessons.reduce(
        (count, lesson) =>
          count + (grades[cellId(student.id, lesson.key, lesson.date)] !== undefined ? 1 : 0),
        0,
      ) ?? 0),
    0,
  );
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
            <span className="lesson-gradebook-period">
              {dateLabel(from)} — {dateLabel(to)}
            </span>
          </div>
          <div className={`lesson-gradebook-filters${showMoreFilters ? " is-expanded" : ""}`}>
            <label>
              {copy.group}
              <select
                value={groupId}
                onChange={(event) => {
                  autoSelectPeriod.current = true;
                  setGroupId(event.target.value);
                  setStudentId("");
                }}
                disabled={!book?.groups.length}
              >
                <option value="" disabled>
                  {copy.chooseGroup}
                </option>
                {book?.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.week}
              <select
                value={week}
                onChange={(event) => {
                  autoSelectPeriod.current = false;
                  const bounds = weekFromInput(event.target.value);
                  setWeek(event.target.value);
                  if (bounds) {
                    setFrom(bounds.from);
                    setTo(bounds.to);
                  }
                }}
              >
                <option value="">{copy.chooseWeek}</option>
                {week && !weekOptions.some((option) => option.value === week) ? (
                  <option value={week}>
                    {dateLabel(from)} — {dateLabel(to)}
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
              {copy.from}
              <input
                type="date"
                lang={appLocale}
                value={from}
                max={to}
                onChange={(event) => {
                  autoSelectPeriod.current = false;
                  setFrom(event.target.value);
                  setWeek("");
                }}
              />
              <small className="lesson-gradebook-date-caption">{dateLabel(from)}</small>
            </label>
            <label>
              {copy.to}
              <input
                type="date"
                lang={appLocale}
                value={to}
                min={from}
                onChange={(event) => {
                  autoSelectPeriod.current = false;
                  setTo(event.target.value);
                  setWeek("");
                }}
              />
              <small className="lesson-gradebook-date-caption">{dateLabel(to)}</small>
            </label>
            <label>
              {copy.student}
              <select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
                <option value="">{copy.allStudents}</option>
                {book?.students.map((student) => (
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
                autoSelectPeriod.current = false;
                const bounds = weekBounds(today());
                setFrom(bounds.from);
                setTo(bounds.to);
                setWeek(isoWeek(bounds.from));
              }}
            >
              {copy.today}
            </button>
          </div>
        </div>
        <div className="lesson-gradebook-summary" aria-live="polite">
          <div>
            <strong>{lessonCount}</strong>
            <span>{copy.lessonMetric}</span>
          </div>
          <div>
            <strong>{students.length}</strong>
            <span>{copy.studentMetric}</span>
          </div>
          <div>
            <strong>{filledCount}</strong>
            <span>{copy.filledMetric}</span>
          </div>
        </div>
        <div className="lesson-gradebook-panel">
          <div className="lesson-gradebook-table-heading">
            <div>
              <p className="eyebrow">{copy.journal}</p>
              <h2>
                {book?.groups.find((group) => group.id === groupId)?.name ?? copy.groupLessons}
              </h2>
            </div>
            <p id="lesson-gradebook-grade-hint">{copy.gradeHint}</p>
          </div>
          {error ? (
            <p className="schedule-form-error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="schedule-form-success" role="status">
              {notice}
            </p>
          ) : null}
          {loading ? (
            <p className="course-material-empty" role="status">
              {copy.loading}
            </p>
          ) : !book?.groups.length ? (
            <p className="course-material-empty">{copy.noGroups}</p>
          ) : !book.lessons.length ? (
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
                      {book.lessons.map((lesson) => (
                        <th scope="col" key={`${lesson.key}:${lesson.date}`}>
                          <span className="lesson-gradebook-weekday">
                            {formatWeekday(lesson.date, dateLocale)}
                          </span>
                          <strong>{dateLabel(lesson.date)}</strong>
                          <span className="lesson-gradebook-lesson-time">{lesson.time}</span>
                          <span className="lesson-gradebook-lesson-title">{lesson.title}</span>
                        </th>
                      ))}
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
                        {book.lessons.map((lesson) => {
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
                                  aria-describedby="lesson-gradebook-grade-hint"
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
        </div>
      </section>
    </div>
  );
}
