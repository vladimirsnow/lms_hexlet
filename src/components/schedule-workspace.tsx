"use client";

import { apiFetch } from "@/lib/api-fetch";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { getMessages, normalizeLocale, type AppLocale } from "@/lib/i18n";
import type { ImportedScheduleView } from "@/server/services/schedule-import";
import type { ImportedLesson } from "@/server/services/schedule-xlsx";

type ScheduleEntry = {
  id: string;
  room: string | null;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  startTime: string;
  endTime: string;
  weekPattern: "EVERY" | "ODD" | "EVEN";
  term: { id: string; name: string; startsOn: string; endsOn: string };
  group: { id: string; name: string };
  course: { id: string; title: string; slug: string };
  teacher: { id: string; name: string };
  canMarkAttendance: boolean;
};

type ScheduleOptions = {
  terms: { id: string; name: string; startsOn: string; endsOn: string }[];
  groups: { id: string; name: string; academicYearId: string }[];
  courses: {
    id: string;
    title: string;
    termId: string;
    academicYearId: string;
    teachers: { id: string; name: string }[];
  }[];
  teachers: { id: string; name: string }[];
};

type DailyAttendanceRecord = {
  studentId: string;
  name: string;
  email: string;
  present: boolean;
};
type AttendanceReport = {
  from: string;
  to: string;
  total: number;
  items: {
    studentId: string;
    studentName: string;
    group: string;
    course: string;
    total: number;
    PRESENT: number;
    ABSENT: number;
    LATE: number;
    EXCUSED: number;
  }[];
  records: {
    id: string;
    date: string;
    status: string;
    note: string | null;
    student: { id: string; name: string };
    group: string;
    course: string;
    teacher: string;
    startTime: string;
    endTime: string;
    room: string | null;
  }[];
};

type ScheduleMessages = ReturnType<typeof getMessages>["schedule"];

async function readResponse(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || fallback);
  return data;
}

function toLocalIsoDate(date = new Date()) {
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Almaty" });
}

function ScheduleForm({
  options,
  initial,
  onDone,
  t,
}: {
  options: ScheduleOptions;
  initial?: ScheduleEntry;
  onDone: () => void;
  t: ScheduleMessages;
}) {
  const router = useRouter();
  const [termId, setTermId] = useState(initial?.term.id ?? options.terms[0]?.id ?? "");
  const [groupId, setGroupId] = useState(initial?.group.id ?? "");
  const [courseId, setCourseId] = useState(
    initial?.course.id ??
      options.courses.find((course) => course.termId === (initial?.term.id ?? options.terms[0]?.id))
        ?.id ??
      "",
  );
  const initialCourse = options.courses.find(
    (course) => course.id === (initial?.course.id ?? courseId),
  );
  const [teacherId, setTeacherId] = useState(
    initial?.teacher.id ?? initialCourse?.teachers[0]?.id ?? "",
  );
  const [dayOfWeek, setDayOfWeek] = useState(String(initial?.dayOfWeek ?? 1));
  const [startTime, setStartTime] = useState(initial?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "09:45");
  const [room, setRoom] = useState(initial?.room ?? "");
  const [weekPattern, setWeekPattern] = useState<ScheduleEntry["weekPattern"]>(
    initial?.weekPattern ?? "EVERY",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedCourse = options.courses.find((course) => course.id === courseId);
  const terms = options.terms;
  const groups = options.groups.filter(
    (group) => !selectedCourse || group.academicYearId === selectedCourse.academicYearId,
  );
  const courses = options.courses.filter((course) => !termId || course.termId === termId);
  const teachers = selectedCourse?.teachers ?? options.teachers;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(
        initial ? `/api/v1/schedule/${initial.id}` : "/api/v1/schedule",
        {
          method: initial ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            termId,
            groupId,
            courseId,
            teacherId,
            dayOfWeek: Number(dayOfWeek),
            startTime,
            endTime,
            room: room || null,
            weekPattern,
          }),
        },
      );
      await readResponse(response, t.form.saveError);
      router.refresh();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.form.saveError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="schedule-form" onSubmit={save}>
      <label>
        {t.form.term}
        <select
          required
          value={termId}
          onChange={(event) => {
            setTermId(event.target.value);
            const next = options.courses.find((course) => course.termId === event.target.value);
            setCourseId(next?.id ?? "");
            setTeacherId(next?.teachers[0]?.id ?? "");
          }}
        >
          <option value="">{t.form.chooseTerm}</option>
          {terms.map((term) => (
            <option key={term.id} value={term.id}>
              {term.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.form.group}
        <select required value={groupId} onChange={(event) => setGroupId(event.target.value)}>
          <option value="">{t.form.chooseGroup}</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.form.course}
        <select
          required
          value={courseId}
          onChange={(event) => {
            setCourseId(event.target.value);
            setTeacherId(
              options.courses.find((course) => course.id === event.target.value)?.teachers[0]?.id ??
                "",
            );
          }}
        >
          <option value="">{t.form.chooseCourse}</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.form.teacher}
        <select required value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
          <option value="">{t.form.chooseTeacher}</option>
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {teacher.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.form.day}
        <select required value={dayOfWeek} onChange={(event) => setDayOfWeek(event.target.value)}>
          {t.weekdays.map((day, index) => (
            <option key={day} value={index + 1}>
              {day}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.form.start}
        <input
          required
          type="time"
          value={startTime}
          onChange={(event) => setStartTime(event.target.value)}
        />
      </label>
      <label>
        {t.form.end}
        <input
          required
          type="time"
          value={endTime}
          onChange={(event) => setEndTime(event.target.value)}
        />
      </label>
      <label>
        {t.form.room}
        <input
          maxLength={100}
          value={room}
          onChange={(event) => setRoom(event.target.value)}
          placeholder={t.form.roomExample}
        />
      </label>
      <label>
        {t.form.repeat}
        <select
          value={weekPattern}
          onChange={(event) => setWeekPattern(event.target.value as ScheduleEntry["weekPattern"])}
        >
          {Object.entries(t.patterns).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p className="schedule-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="schedule-form-actions">
        <button className="button button-primary" disabled={busy}>
          {busy ? t.form.saving : initial ? t.form.saveChanges : t.form.addLesson}
        </button>
        {initial ? (
          <button className="button button-muted" type="button" onClick={onDone}>
            {t.form.cancel}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function GroupDailyAttendanceEditor({
  group,
  date,
  onClose,
  t,
}: {
  group: { id: string; name: string };
  date: string;
  onClose: () => void;
  t: ScheduleMessages;
}) {
  const [records, setRecords] = useState<DailyAttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      setMessage("");
      try {
        const response = await apiFetch(
          `/api/v1/groups/${group.id}/attendance?date=${encodeURIComponent(date)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await readResponse(response, t.attendance.loadError);
        setRecords(data.records as DailyAttendanceRecord[]);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setRecords([]);
          setError(cause instanceof Error ? cause.message : t.attendance.loadError);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [date, group.id, t.attendance.loadError]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch(`/api/v1/groups/${group.id}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          records: records.map(({ studentId, present }) => ({ studentId, present })),
        }),
      });
      const result = await readResponse(response, t.attendance.saveError);
      setMessage(t.attendance.savedMarks(result.updated));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.attendance.saveError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="schedule-entry-extra imported-attendance-editor">
      <div className="attendance-editor-heading">
        <div>
          <p className="eyebrow">{t.attendance.heading}</p>
          <h3>
            {group.name} · {new Date(`${date}T00:00:00`).toLocaleDateString()}
          </h3>
        </div>
        <button className="button button-muted" type="button" onClick={onClose}>
          {t.attendance.close}
        </button>
      </div>
      {loading ? <p>{t.attendance.loading}</p> : null}
      {error ? (
        <p className="schedule-form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="schedule-import-notice" role="status">
          {message}
        </p>
      ) : null}
      {!loading && records.length ? (
        <form onSubmit={save}>
          <div className="attendance-roster">
            {records.map((record) => (
              <label className="attendance-student daily-attendance-student" key={record.studentId}>
                <span>
                  <strong>{record.name}</strong>
                  <small>{record.email}</small>
                </span>
                <span className="attendance-checkbox-state">
                  <input
                    aria-label={`${record.name}: ${record.present ? t.attendance.present : t.attendance.absent}`}
                    checked={record.present}
                    disabled={busy}
                    onChange={(event) =>
                      setRecords((current) =>
                        current.map((item) =>
                          item.studentId === record.studentId
                            ? { ...item, present: event.target.checked }
                            : item,
                        ),
                      )
                    }
                    type="checkbox"
                  />
                  <span>{record.present ? t.attendance.present : t.attendance.absent}</span>
                </span>
              </label>
            ))}
          </div>
          <button className="button button-primary" disabled={busy} type="submit">
            {busy ? t.attendance.saving : t.attendance.save}
          </button>
        </form>
      ) : null}
      {!loading && !error && records.length === 0 ? (
        <p className="course-material-empty">{t.attendance.empty}</p>
      ) : null}
    </section>
  );
}

function ScheduleCard({
  entry,
  admin,
  options,
  t,
  dateLocale,
}: {
  entry: ScheduleEntry;
  admin: boolean;
  options?: ScheduleOptions;
  t: ScheduleMessages;
  dateLocale: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  async function archive() {
    if (!window.confirm(t.card.archiveConfirm)) return;
    try {
      const response = await apiFetch(`/api/v1/schedule/${entry.id}`, { method: "DELETE" });
      await readResponse(response, t.attendance.saveError);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.card.archiveError);
    }
  }
  return (
    <article className="schedule-entry-card">
      <div className="schedule-entry-time">
        <strong>{entry.startTime}</strong>
        <span>{entry.endTime}</span>
      </div>
      <div className="schedule-entry-main">
        <p className="eyebrow">
          {entry.group.name} · {t.patterns[entry.weekPattern]}
        </p>
        <h3>{entry.course.title}</h3>
        <p>
          {entry.teacher.name}
          {entry.room ? " · " + t.card.roomPrefix + " " + entry.room : ""}
        </p>
        <small>
          {entry.term.name} ·{" "}
          {new Date(entry.term.startsOn + "T00:00:00").toLocaleDateString(dateLocale)} —{" "}
          {new Date(entry.term.endsOn + "T00:00:00").toLocaleDateString(dateLocale)}
        </small>
        <Link href={`/courses/${entry.course.slug}`}>{t.card.openCourse}</Link>
      </div>
      {admin ? (
        <div className="schedule-entry-actions">
          <button
            className="button button-muted"
            type="button"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? t.card.hideForm : t.card.edit}
          </button>
          <button className="button button-muted" type="button" onClick={archive}>
            {t.card.archive}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="schedule-form-error" role="alert">
          {error}
        </p>
      ) : null}
      {admin && editing && options ? (
        <div className="schedule-entry-extra">
          <ScheduleForm options={options} initial={entry} onDone={() => setEditing(false)} t={t} />
        </div>
      ) : null}
    </article>
  );
}

function AttendanceReportPanel({
  initial,
  student,
  t,
  dateLocale,
}: {
  initial: AttendanceReport;
  student: boolean;
  t: ScheduleMessages;
  dateLocale: string;
}) {
  const [report, setReport] = useState(initial);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const displayDate = (value: string) =>
    value
      ? new Date(`${value}T00:00:00Z`).toLocaleDateString(dateLocale, {
          day: "2-digit",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })
      : "—";
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])",
        ),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);
  async function refresh(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const path = student ? "/api/v1/me/attendance" : "/api/v1/attendance/report";
      const response = await apiFetch(
        `${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: "no-store" },
      );
      setReport(await readResponse(response, t.report.loadError));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.report.loadError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-panel schedule-report-panel">
      <div className="admin-panel-heading">
        <div>
          <p className="eyebrow">{t.report.eyebrow}</p>
          <h2>{student ? t.report.myAttendance : t.report.studentAttendance}</h2>
        </div>
        <span className="users-total">
          {report.total} {t.report.totalMarks}
        </span>
      </div>
      <button
        ref={triggerRef}
        className="button button-primary"
        type="button"
        onClick={() => setOpen(true)}
      >
        {t.report.preview}
      </button>
      {open ? (
        <div
          className="report-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            className="report-modal"
            role="dialog"
            aria-modal="true"
            aria-label={student ? t.report.myAttendance : t.report.studentAttendance}
          >
            <div className="report-modal-heading">
              <div>
                <p className="eyebrow">{t.report.eyebrow}</p>
                <h2>{student ? t.report.myAttendance : t.report.studentAttendance}</h2>
              </div>
              <button
                className="button button-muted"
                type="button"
                autoFocus
                onClick={() => setOpen(false)}
                aria-label={t.report.close}
              >
                {t.report.close} ✕
              </button>
            </div>
            <form className="attendance-date-row" onSubmit={refresh}>
              <label>
                {t.report.from}
                <input
                  required
                  type="date"
                  lang={dateLocale.slice(0, 2)}
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
                <small className="report-date-caption">{displayDate(from)}</small>
              </label>
              <label>
                {t.report.to}
                <input
                  required
                  type="date"
                  lang={dateLocale.slice(0, 2)}
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
                <small className="report-date-caption">{displayDate(to)}</small>
              </label>
              <button className="button button-primary" disabled={busy}>
                {busy ? t.report.loading : t.report.refresh}
              </button>
            </form>
            {!student ? (
              <div className="attendance-report-export-actions">
                {(["csv", "xlsx"] as const).map((format) =>
                  report.records.length ? (
                    <a
                      key={format}
                      className="button button-muted attendance-report-export"
                      href={`/api/v1/attendance/report?format=${format}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`}
                    >
                      {format === "csv" ? t.report.downloadCsv : t.report.downloadXlsx}
                    </a>
                  ) : (
                    <button
                      key={format}
                      className="button button-muted attendance-report-export"
                      type="button"
                      disabled
                    >
                      {format === "csv" ? t.report.downloadCsv : t.report.downloadXlsx}
                    </button>
                  ),
                )}
              </div>
            ) : null}
            {error ? (
              <p className="schedule-form-error" role="alert">
                {error}
              </p>
            ) : null}
            {report.items.length ? (
              <div className="schedule-report-scroll">
                <table className="attendance-report-table">
                  <thead>
                    <tr>
                      <th>{t.report.student}</th>
                      <th>{t.report.group}</th>
                      <th>{t.report.course}</th>
                      <th>{t.report.total}</th>
                      <th>{t.report.present}</th>
                      <th>{t.report.absent}</th>
                      <th>{t.report.late}</th>
                      <th>{t.report.excused}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.items.map((item) => (
                      <tr key={`${item.studentId}:${item.course}`}>
                        <td>{item.studentName}</td>
                        <td>{item.group}</td>
                        <td>{item.course}</td>
                        <td>{item.total}</td>
                        <td>{item.PRESENT}</td>
                        <td>{item.ABSENT}</td>
                        <td>{item.LATE}</td>
                        <td>{item.EXCUSED}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="course-material-empty">{t.report.empty}</p>
            )}
            {report.records.length ? (
              <details className="attendance-detail-list">
                <summary>{t.report.showRecords}</summary>
                <ul>
                  {report.records.slice(0, 100).map((record) => (
                    <li key={record.id}>
                      <span>
                        {new Date(record.date + "T00:00:00").toLocaleDateString(dateLocale)} ·{" "}
                        {record.startTime} · {record.course} · {record.group}
                      </span>
                      <strong>
                        {record.student.name}:{" "}
                        {t.attendanceLabels[record.status as keyof typeof t.attendanceLabels] ??
                          record.status}
                      </strong>
                      {record.note ? <small>{record.note}</small> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function ScheduleWorkspace({
  entries,
  report,
  importedSchedule,
  role,
  locale,
}: {
  entries: ScheduleEntry[];
  report: AttendanceReport | null;
  importedSchedule: ImportedScheduleView | null;
  role: "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT";
  locale: AppLocale | string;
}) {
  const appLocale = normalizeLocale(locale);
  const t = getMessages(appLocale).schedule;
  const dateLocale = appLocale === "kk" ? "kk-KZ" : appLocale === "en" ? "en-GB" : "ru-RU";
  const weekdays = t.weekdays;
  const admin = role === "SUPER_ADMIN" || role === "ADMIN";
  const teacher = role === "TEACHER";
  const student = role === "STUDENT";
  const byDay = useMemo(
    () =>
      weekdays.map((name, index) => ({
        name,
        day: index + 1,
        entries: entries.filter((entry) => entry.dayOfWeek === index + 1),
      })),
    [entries, weekdays],
  );

  return (
    <div className="app-page-wrap schedule-page">
      <header className="app-page-header">
        <div>
          <p className="eyebrow">{t.page.eyebrow}</p>
          <h1>
            {student ? t.page.studentTitle : teacher ? t.page.teacherTitle : t.page.collegeTitle}
          </h1>
          <p>
            {student
              ? t.page.studentDescription
              : teacher
                ? t.page.teacherDescription
                : t.page.adminDescription}
          </p>
        </div>
        <a className="button button-muted" href="/api/v1/me/schedule.ics">
          {t.page.downloadCalendar}
        </a>
      </header>
      {admin || (importedSchedule && importedSchedule.entries.length > 0) ? (
        <ImportedSchedulePanel
          key={importedSchedule?.id ?? "empty"}
          initial={importedSchedule}
          canImport={admin}
          student={student}
          t={t}
        />
      ) : null}
      {entries.some((entry) => entry.canMarkAttendance) && !importedSchedule?.entries.length ? (
        <GroupAttendancePanel entries={entries.filter((entry) => entry.canMarkAttendance)} t={t} />
      ) : null}
      {!admin && entries.length ? (
        <section className="schedule-week" aria-label={t.page.weekLabel}>
          {byDay.map(({ name, day, entries: dayEntries }) => (
            <div className="schedule-day" key={day}>
              <div className="schedule-day-heading">
                <h2>{name}</h2>
                <span>{dayEntries.length}</span>
              </div>
              {dayEntries.map((entry) => (
                <ScheduleCard
                  key={entry.id}
                  entry={entry}
                  admin={false}
                  t={t}
                  dateLocale={dateLocale}
                />
              ))}
            </div>
          ))}
        </section>
      ) : !admin && !importedSchedule?.entries.length ? (
        <p className="admin-empty-state">{t.page.empty}</p>
      ) : null}
      {report ? (
        <AttendanceReportPanel initial={report} student={student} t={t} dateLocale={dateLocale} />
      ) : null}
    </div>
  );
}

function ImportedSchedulePanel({
  initial,
  canImport,
  student,
  t,
}: {
  initial: ImportedScheduleView | null;
  canImport: boolean;
  student: boolean;
  t: ScheduleMessages;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState<ImportedLesson | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const weeks = initial?.summary.weeks ?? [];
  const [week, setWeek] = useState(
    String(
      initial?.entries.find((entry) => entry.date === toLocalIsoDate())?.week ?? weeks[0] ?? "",
    ),
  );
  const [date, setDate] = useState(toLocalIsoDate);
  const [group, setGroup] = useState("");
  const [attendanceGroupId, setAttendanceGroupId] = useState<string | null>(null);
  const [tableZoom, setTableZoom] = useState(1);
  const [tableExpanded, setTableExpanded] = useState(false);
  useEffect(() => {
    if (!tableExpanded) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTableExpanded(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [tableExpanded]);
  const visibleWeek = Number(week);
  const dates = [
    ...new Set([
      toLocalIsoDate(),
      ...(initial?.entries ?? [])
        .filter((entry) => entry.week === visibleWeek)
        .map((entry) => entry.date),
    ]),
  ].sort();
  const selectedDate = dates.includes(date) ? date : (dates[0] ?? "");
  const groups = [
    ...new Set(
      (initial?.entries ?? [])
        .filter((entry) => entry.week === visibleWeek)
        .map((entry) => entry.groupName),
    ),
  ].sort((a, b) => a.localeCompare(b, "ru"));
  const rows = (initial?.entries ?? [])
    .map((entry, entryIndex) => ({ entry, entryIndex }))
    .filter(
      ({ entry }) =>
        entry.week === visibleWeek &&
        entry.date === selectedDate &&
        (!group || entry.groupName === group),
    )
    .sort(
      (a, b) =>
        a.entry.pair - b.entry.pair || a.entry.groupName.localeCompare(b.entry.groupName, "ru"),
    );
  const attendanceGroups = [
    ...new Map(
      rows
        .filter(({ entry }) => entry.canMarkAttendance && entry.groupId)
        .map(({ entry }) => [
          entry.groupId as string,
          { id: entry.groupId as string, name: entry.groupName },
        ]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const selectedAttendanceGroup = attendanceGroups.find((item) => item.id === attendanceGroupId);

  async function importFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      initial &&
      !window.confirm(
        "Заменить текущее расписание? Новая таблица заменит текущие данные и изменения строк. Продолжить?",
      )
    ) {
      return;
    }
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch("/api/v1/schedule/import", {
        method: "POST",
        body: new FormData(form),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error?.message ?? "Не удалось импортировать расписание.");
      form.reset();
      setNotice(`Импортировано занятий: ${result.item.summary.rows}.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось импортировать расписание.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEditedLesson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!initial || editingIndex === null || !editingDraft) return;
    setEditBusy(true);
    setEditError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schedule/import/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryIndex: editingIndex,
          groupId: editingDraft.groupId,
          pair: editingDraft.pair,
          startTime: editingDraft.startTime,
          endTime: editingDraft.endTime,
          subject: editingDraft.subject,
          teacher: editingDraft.teacher,
          room: editingDraft.room,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.message ?? "Не удалось сохранить занятие.");
      setNotice("Изменение расписания сохранено.");
      setEditingIndex(null);
      setEditingDraft(null);
      router.refresh();
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : "Не удалось сохранить занятие.");
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <section
      className={`admin-panel schedule-import-panel${student ? " student-schedule-table" : ""}`}
    >
      {!student ? (
        <div className="admin-panel-heading">
          <div>
            <p className="eyebrow">Расписание из Excel</p>
            <h2>{initial ? initial.fileName : "Импорт расписания колледжа"}</h2>
          </div>
          {initial ? (
            <span className="users-total">
              {initial.summary.rows} занятий · {initial.summary.mappedGroups} сопоставленных групп
            </span>
          ) : null}
        </div>
      ) : null}
      {canImport ? (
        <form className="schedule-import-form" onSubmit={importFile}>
          <label>
            Выберите файл расписания (.xlsx)
            <input
              name="file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
            />
          </label>
          <button className="button button-primary" disabled={busy} type="submit">
            <Upload aria-hidden="true" size={16} /> {busy ? "Импортирую…" : "Загрузить расписание"}
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="schedule-import-notice" role="status">
          {notice}
        </p>
      ) : null}
      {canImport && initial ? (
        <p className="schedule-import-edit-note">
          Исправляйте пару прямо в таблице. При новой загрузке появится подтверждение, а все
          предыдущие изменения заменятся содержимым файла.
        </p>
      ) : null}
      {initial ? (
        <>
          {initial.summary.unmappedGroups.length ? (
            <details className="schedule-import-unmapped">
              <summary>Не сопоставлены группы: {initial.summary.unmappedGroups.length}</summary>
              <p>
                Эти занятия сохранены и видны администратору. Добавьте группы с такими названиями в
                учебную структуру, затем импортируйте файл ещё раз.
              </p>
              <ul>
                {initial.summary.unmappedGroups.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {initial.summary.skippedAdditionalCells ? (
            <p className="schedule-import-note">
              Пропущено ячеек «Доп.» без времени пары: {initial.summary.skippedAdditionalCells}.
            </p>
          ) : null}
          <div className="schedule-import-toolbar">
            <label>
              Неделя
              <select
                value={week}
                onChange={(event) => {
                  setWeek(event.target.value);
                  setDate("");
                }}
              >
                {weeks.map((item) => (
                  <option key={item} value={item}>
                    Неделя {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Дата
              <select value={selectedDate} onChange={(event) => setDate(event.target.value)}>
                {dates.map((item) => (
                  <option key={item} value={item}>
                    {new Date(`${item}T00:00:00`).toLocaleDateString("ru-RU", {
                      weekday: "long",
                      day: "2-digit",
                      month: "long",
                    })}
                  </option>
                ))}
              </select>
            </label>
            {!student ? (
              <label>
                Группа
                <select value={group} onChange={(event) => setGroup(event.target.value)}>
                  <option value="">Все группы</option>
                  {groups.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {attendanceGroups.length ? (
            <section className="schedule-attendance-panel imported-attendance-panel">
              <div className="admin-panel-heading">
                <div>
                  <p className="eyebrow">{t.attendance.heading}</p>
                  <h2>{t.report.studentAttendance}</h2>
                </div>
                <span className="users-total">{attendanceGroups.length}</span>
              </div>
              <div className="schedule-attendance-list">
                {attendanceGroups.map((item) => (
                  <article className="schedule-attendance-item" key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {new Date(`${selectedDate}T00:00:00`).toLocaleDateString("ru-RU")}
                      </span>
                    </div>
                    <button
                      className="button button-muted"
                      type="button"
                      aria-expanded={attendanceGroupId === item.id}
                      onClick={() =>
                        setAttendanceGroupId((current) => (current === item.id ? null : item.id))
                      }
                    >
                      {attendanceGroupId === item.id
                        ? t.card.hideAttendance
                        : t.card.markAttendance}
                    </button>
                  </article>
                ))}
              </div>
              {selectedAttendanceGroup ? (
                <GroupDailyAttendanceEditor
                  group={selectedAttendanceGroup}
                  date={selectedDate}
                  t={t}
                  onClose={() => setAttendanceGroupId(null)}
                />
              ) : null}
            </section>
          ) : null}
          {rows.length ? (
            <div
              className={`schedule-import-view${tableExpanded ? " is-expanded" : ""}`}
              role={tableExpanded ? "dialog" : undefined}
              aria-modal={tableExpanded ? true : undefined}
              aria-label="Расписание занятий"
            >
              <div className="schedule-import-view-toolbar">
                <span>{rows.length} занятий</span>
                <div>
                  <button
                    className="button button-muted"
                    type="button"
                    aria-label="Уменьшить масштаб таблицы"
                    disabled={tableZoom <= 0.8}
                    onClick={() => setTableZoom((value) => Math.max(0.8, value - 0.1))}
                  >
                    −
                  </button>
                  <span>{Math.round(tableZoom * 100)}%</span>
                  <button
                    className="button button-muted"
                    type="button"
                    aria-label="Увеличить масштаб таблицы"
                    disabled={tableZoom >= 1.5}
                    onClick={() => setTableZoom((value) => Math.min(1.5, value + 0.1))}
                  >
                    +
                  </button>
                  <button
                    className="button button-muted"
                    type="button"
                    onClick={() => setTableExpanded((value) => !value)}
                  >
                    {tableExpanded ? "Свернуть" : "На весь экран"}
                  </button>
                </div>
              </div>
              <div
                className="schedule-import-table-scroll"
                style={{ fontSize: `${12 * tableZoom}px` }}
              >
                <table className="schedule-import-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Пара</th>
                      <th>Время</th>
                      <th>Группа</th>
                      <th>Предмет</th>
                      <th>Преподаватель</th>
                      <th>Аудитория</th>
                      {canImport ? <th>Действия</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ entry, entryIndex }) => (
                      <Fragment
                        key={`${entry.groupName}:${entry.date}:${entry.pair}:${entryIndex}`}
                      >
                        <tr>
                          <td>
                            {new Date(`${entry.date}T00:00:00`).toLocaleDateString("ru-RU", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })}
                          </td>
                          <td>{entry.pair}</td>
                          <td>
                            {entry.startTime}–{entry.endTime}
                          </td>
                          <td>{entry.groupName}</td>
                          <td>{entry.subject}</td>
                          <td>{entry.teacher ?? "—"}</td>
                          <td>{entry.room ?? "—"}</td>
                          {canImport ? (
                            <td>
                              <button
                                className="mini-action"
                                type="button"
                                onClick={() => {
                                  setEditingIndex(entryIndex);
                                  setEditingDraft({ ...entry });
                                  setEditError("");
                                }}
                              >
                                Изменить
                              </button>
                            </td>
                          ) : null}
                        </tr>
                        {canImport && editingIndex === entryIndex && editingDraft ? (
                          <tr className="schedule-import-edit-row">
                            <td colSpan={8}>
                              <form
                                className="schedule-import-edit-grid"
                                onSubmit={saveEditedLesson}
                              >
                                <label>
                                  Группа
                                  <select
                                    required
                                    value={editingDraft.groupId ?? ""}
                                    onChange={(event) =>
                                      setEditingDraft({
                                        ...editingDraft,
                                        groupId: event.target.value,
                                      })
                                    }
                                  >
                                    {(initial.groups ?? []).map((item) => (
                                      <option key={item.id} value={item.id}>
                                        {item.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Предмет
                                  <input
                                    required
                                    maxLength={200}
                                    value={editingDraft.subject}
                                    onChange={(event) =>
                                      setEditingDraft({
                                        ...editingDraft,
                                        subject: event.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  Преподаватель
                                  <input
                                    maxLength={160}
                                    value={editingDraft.teacher ?? ""}
                                    onChange={(event) =>
                                      setEditingDraft({
                                        ...editingDraft,
                                        teacher: event.target.value || null,
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  Аудитория
                                  <input
                                    maxLength={100}
                                    value={editingDraft.room ?? ""}
                                    onChange={(event) =>
                                      setEditingDraft({
                                        ...editingDraft,
                                        room: event.target.value || null,
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  Номер пары
                                  <input
                                    type="number"
                                    min={1}
                                    max={8}
                                    required
                                    value={editingDraft.pair}
                                    onChange={(event) =>
                                      setEditingDraft({
                                        ...editingDraft,
                                        pair: Number(event.target.value),
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  Начало
                                  <input
                                    type="time"
                                    required
                                    value={editingDraft.startTime}
                                    onChange={(event) =>
                                      setEditingDraft({
                                        ...editingDraft,
                                        startTime: event.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  Окончание
                                  <input
                                    type="time"
                                    required
                                    value={editingDraft.endTime}
                                    onChange={(event) =>
                                      setEditingDraft({
                                        ...editingDraft,
                                        endTime: event.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <div className="schedule-import-edit-actions">
                                  <button className="button button-primary" disabled={editBusy}>
                                    {editBusy ? "Сохраняю…" : "Сохранить строку"}
                                  </button>
                                  <button
                                    className="button button-muted"
                                    type="button"
                                    disabled={editBusy}
                                    onClick={() => {
                                      setEditingIndex(null);
                                      setEditingDraft(null);
                                      setEditError("");
                                    }}
                                  >
                                    Отмена
                                  </button>
                                </div>
                                {editError ? (
                                  <p className="schedule-form-error" role="alert">
                                    {editError}
                                  </p>
                                ) : null}
                              </form>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="course-material-empty">{t.page.noClasses}</p>
          )}
        </>
      ) : canImport ? (
        <p className="course-material-empty">
          Загрузите книгу Excel с листами «Неделя 1», «Неделя 2» и так далее.
        </p>
      ) : null}
    </section>
  );
}

function GroupAttendancePanel({ entries, t }: { entries: ScheduleEntry[]; t: ScheduleMessages }) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [date, setDate] = useState(toLocalIsoDate);
  const groups = [...new Map(entries.map((entry) => [entry.group.id, entry.group])).values()].sort(
    (a, b) => a.name.localeCompare(b.name, "ru"),
  );
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);

  return (
    <section className="admin-panel schedule-attendance-panel" id="attendance">
      <div className="admin-panel-heading">
        <div>
          <p className="eyebrow">{t.attendance.heading}</p>
          <h2>{t.report.studentAttendance}</h2>
        </div>
        <span className="users-total">{groups.length}</span>
      </div>
      <div className="schedule-attendance-date">
        <label>
          {t.attendance.date}
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>
      <div className="schedule-attendance-list">
        {groups.map((group) => (
          <article className="schedule-attendance-item" key={group.id}>
            <div>
              <strong>{group.name}</strong>
            </div>
            <button
              className="button button-muted"
              type="button"
              aria-expanded={selectedGroupId === group.id}
              onClick={() =>
                setSelectedGroupId((current) => (current === group.id ? null : group.id))
              }
            >
              {selectedGroupId === group.id ? t.card.hideAttendance : t.card.markAttendance}
            </button>
          </article>
        ))}
      </div>
      {selectedGroup ? (
        <GroupDailyAttendanceEditor
          group={selectedGroup}
          date={date}
          onClose={() => setSelectedGroupId(null)}
          t={t}
        />
      ) : null}
    </section>
  );
}
