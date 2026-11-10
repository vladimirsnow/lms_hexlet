"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { normalizeLocale } from "@/lib/i18n";

const labels = {
  ru: {
    eyebrow: "УЧЕБНЫЙ ПРОЦЕСС / ПРЕПОДАВАТЕЛЬ",
    title: "Оценки за пары",
    description: "Поставьте оценку от 2 до 5 в ячейке занятия. Изменения сохраняются сразу.",
    journal: "ЖУРНАЛ",
    groupLessons: "Группа и занятия",
    group: "Группа",
    week: "Неделя",
    from: "С",
    to: "По",
    student: "Студент",
    allStudents: "Все студенты",
    chooseGroup: "Выберите группу",
    today: "Сегодня",
    loading: "Загружаем журнал…",
    noGroups: "У вас пока нет доступных групп.",
    noLessons: "На выбранные даты ваших пар нет. Выберите другую неделю или период.",
    noStudents: "Студенты не найдены.",
    saved: "Оценка сохранена.",
    loadError: "Не удалось загрузить журнал.",
    saveError: "Не удалось сохранить оценку.",
    grade: "Оценка",
    scroll: "Прокрутите таблицу вправо, чтобы увидеть остальные пары.",
  },
  kk: {
    eyebrow: "ОҚУ ҮДЕРІСІ / ОҚЫТУШЫ",
    title: "Сабақ бағалары",
    description: "Сабақ ұяшығында 2-ден 5-ке дейін баға қойыңыз. Өзгерістер бірден сақталады.",
    journal: "ЖУРНАЛ",
    groupLessons: "Топ пен сабақтар",
    group: "Топ",
    week: "Апта",
    from: "Бастап",
    to: "Дейін",
    student: "Студент",
    allStudents: "Барлық студенттер",
    chooseGroup: "Топты таңдаңыз",
    today: "Бүгін",
    loading: "Журнал жүктелуде…",
    noGroups: "Қолжетімді топтар әлі жоқ.",
    noLessons: "Таңдалған күндерде сабақтарыңыз жоқ. Басқа апта не кезең таңдаңыз.",
    noStudents: "Студенттер табылмады.",
    saved: "Баға сақталды.",
    loadError: "Журнал жүктелмеді.",
    saveError: "Бағаны сақтау мүмкін болмады.",
    grade: "Баға",
    scroll: "Басқа сабақтарды көру үшін кестені оңға жылжытыңыз.",
  },
  en: {
    eyebrow: "ACADEMIC WORK / TEACHER",
    title: "Class grades",
    description: "Set a grade from 2 to 5 in each class cell. Changes save immediately.",
    journal: "GRADEBOOK",
    groupLessons: "Group and classes",
    group: "Group",
    week: "Week",
    from: "From",
    to: "To",
    student: "Student",
    allStudents: "All students",
    chooseGroup: "Choose a group",
    today: "Today",
    loading: "Loading gradebook…",
    noGroups: "You have no available groups yet.",
    noLessons: "You have no classes on these dates. Choose another week or date range.",
    noStudents: "No students found.",
    saved: "Grade saved.",
    loadError: "Could not load the gradebook.",
    saveError: "Could not save the grade.",
    grade: "Grade",
    scroll: "Scroll the table right to see more classes.",
  },
} as const;

type Book = {
  groups: { id: string; name: string }[];
  groupId: string | null;
  students: { id: string; name: string }[];
  lessons: { key: string; date: string; time: string; title: string }[];
  grades: { lessonKey: string; date: string; studentId: string; value: number }[];
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

export function LessonGradebook({ locale }: { locale: string }) {
  const appLocale = normalizeLocale(locale);
  const copy = labels[appLocale];
  const dateLocale = appLocale === "kk" ? "kk-KZ" : appLocale === "en" ? "en-GB" : "ru-RU";
  const initial = useMemo(() => weekBounds(today()), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [week, setWeek] = useState(isoWeek(initial.from));
  const [groupId, setGroupId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [book, setBook] = useState<Book | null>(null);
  const [grades, setGrades] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
        setBook(data);
        setGroupId(data.groupId || "");
        setGrades(
          Object.fromEntries(
            data.grades.map((grade: Book["grades"][number]) => [
              cellId(grade.studentId, grade.lessonKey, grade.date),
              grade.value,
            ]),
          ),
        );
      } catch (cause) {
        if (signal.aborted) return;
        setError(cause instanceof Error ? cause.message : copy.loadError);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [from, to, groupId, copy.loadError],
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
    setSaving(id);
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
          value: value ? Number(value) : null,
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
      setNotice(copy.saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.saveError);
    } finally {
      setSaving("");
    }
  }

  const students = book?.students.filter((student) => !studentId || student.id === studentId) ?? [];
  const dateLabel = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString(dateLocale, {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    });
  const lessonCount = book?.lessons.length ?? 0;
  const lessonUnit =
    appLocale === "ru"
      ? ({ one: "пара", few: "пары", many: "пар", other: "пары" } as const)[
          new Intl.PluralRules("ru-RU").select(lessonCount) as "one" | "few" | "many" | "other"
        ]
      : appLocale === "kk"
        ? "сабақ"
        : lessonCount === 1
          ? "class"
          : "classes";

  return (
    <div className="app-page-wrap lesson-gradebook-page">
      <header className="app-page-header lesson-gradebook-header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <span className="lesson-gradebook-period">
          {dateLabel(from)} — {dateLabel(to)}
        </span>
      </header>
      <section className="admin-panel lesson-gradebook-panel" aria-label={copy.title}>
        <div className="admin-panel-heading">
          <div>
            <p className="eyebrow">{copy.journal}</p>
            <h2>{copy.groupLessons}</h2>
          </div>
          <span className="users-total">
            {lessonCount} {lessonUnit}
          </span>
        </div>
        <div className="lesson-gradebook-filters">
          <label>
            {copy.group}
            <select
              value={groupId}
              onChange={(event) => {
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
            <input
              type="week"
              value={week}
              onChange={(event) => {
                const bounds = weekFromInput(event.target.value);
                setWeek(event.target.value);
                if (bounds) {
                  setFrom(bounds.from);
                  setTo(bounds.to);
                }
              }}
            />
          </label>
          <label>
            {copy.from}
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => {
                setFrom(event.target.value);
                setWeek("");
              }}
            />
          </label>
          <label>
            {copy.to}
            <input
              type="date"
              value={to}
              min={from}
              onChange={(event) => {
                setTo(event.target.value);
                setWeek("");
              }}
            />
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
            className="button button-muted"
            type="button"
            onClick={() => {
              const bounds = weekBounds(today());
              setFrom(bounds.from);
              setTo(bounds.to);
              setWeek(isoWeek(bounds.from));
            }}
          >
            {copy.today}
          </button>
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
                        <strong>{dateLabel(lesson.date)}</strong>
                        <span>
                          {lesson.time} · {lesson.title}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.id}>
                      <th scope="row" className="lesson-gradebook-student">
                        {student.name}
                      </th>
                      {book.lessons.map((lesson) => {
                        const id = cellId(student.id, lesson.key, lesson.date);
                        return (
                          <td key={id}>
                            <select
                              aria-label={`${copy.grade}: ${student.name}, ${lesson.title}, ${dateLabel(lesson.date)} ${lesson.time}`}
                              value={grades[id] ?? ""}
                              disabled={saving === id}
                              onChange={(event) =>
                                void save(student.id, lesson, event.target.value)
                              }
                            >
                              <option value="">—</option>
                              <option value="2">2</option>
                              <option value="3">3</option>
                              <option value="4">4</option>
                              <option value="5">5</option>
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!students.length ? <p className="course-material-empty">{copy.noStudents}</p> : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
