"use client";

import { apiFetch } from "@/lib/api-fetch";
import { useState, type FormEvent } from "react";
import { getMessages, normalizeLocale, type AppLocale } from "@/lib/i18n";

type Gradebook = {
  assignments: Array<{ id: string; title: string; maxScore: number; weight: number }>;
  rows: Array<{
    student: { id: string; name: string; email: string };
    assignments: Array<{
      assignmentId: string;
      score: number | null;
      maxScore: number;
      weight: number;
    }>;
    calculatedPercent: number | null;
    gradeLabel: string | null;
    finalOverride: {
      score: number | null;
      gradeLabel: string | null;
      comment: string | null;
    } | null;
  }>;
  settings: {
    scale: "SCORE_100" | "SCORE_5" | "PASS_FAIL";
    passingScore: number | null;
    rounding: number;
  };
};

function messageFrom(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    return (payload as { error?: { message?: string } }).error?.message || fallback;
  }
  return fallback;
}

async function patchJson(path: string, body: unknown, fallback: string) {
  const response = await apiFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(messageFrom(payload, fallback));
  return payload;
}

function FinalGradeForm({
  courseId,
  row,
  t,
}: {
  courseId: string;
  row: Gradebook["rows"][number];
  t: ReturnType<typeof getMessages>["gradebook"];
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await patchJson(
        `/api/v1/courses/${courseId}/gradebook/${row.student.id}`,
        {
          score: values.get("score") === "" ? null : values.get("score"),
          gradeLabel: values.get("gradeLabel") || null,
          comment: values.get("comment") || null,
        },
        t.saveError,
      );
      setMessage(t.saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.saveError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="final-grade-form" onSubmit={save}>
      <label>
        {t.finalScore}
        <input
          name="score"
          type="number"
          min="0"
          max="999999.99"
          step="0.01"
          defaultValue={row.finalOverride?.score ?? ""}
        />
      </label>
      <label>
        {t.label}
        <input
          name="gradeLabel"
          maxLength={40}
          defaultValue={row.finalOverride?.gradeLabel ?? ""}
        />
      </label>
      <label>
        {t.comment}
        <textarea name="comment" maxLength={5000} defaultValue={row.finalOverride?.comment ?? ""} />
      </label>
      <button className="button button-secondary" type="submit" disabled={busy}>
        {busy ? t.saving : t.save}
      </button>
      {message ? (
        <small className="form-success" role="status">
          {message}
        </small>
      ) : null}
      {error ? (
        <small className="form-error" role="alert">
          {error}
        </small>
      ) : null}
    </form>
  );
}

export function GradebookTable({
  courseId,
  gradebook,
  locale,
}: {
  courseId: string;
  gradebook: Gradebook;
  locale: AppLocale | string;
}) {
  const t = getMessages(normalizeLocale(locale)).gradebook;
  const [busy, setBusy] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setSettingsError("");
    try {
      await patchJson(
        `/api/v1/courses/${courseId}/gradebook/settings`,
        {
          scale: values.get("scale"),
          passingScore: values.get("passingScore") === "" ? null : values.get("passingScore"),
          rounding: values.get("rounding"),
        },
        t.settingsError,
      );
      window.location.reload();
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : t.settingsError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gradebook-content">
      <div className="course-materials-heading">
        <div>
          <p className="eyebrow">{t.eyebrow}</p>
          <h2>{t.title}</h2>
        </div>
        <div className="gradebook-export-actions">
          <a className="admin-inline-link" href={`/api/v1/courses/${courseId}/gradebook/export`}>
            {t.downloadCsv}
          </a>
          <a
            className="admin-inline-link"
            href={`/api/v1/courses/${courseId}/gradebook/export?format=xlsx`}
          >
            {t.downloadXlsx}
          </a>
        </div>
      </div>
      <form className="gradebook-settings-form admin-panel" onSubmit={saveSettings}>
        <label>
          {t.scale}
          <select name="scale" defaultValue={gradebook.settings.scale}>
            <option value="SCORE_100">{t.scale100}</option>
            <option value="SCORE_5">{t.scale5}</option>
            <option value="PASS_FAIL">{t.passFail}</option>
          </select>
        </label>
        <label>
          {t.passingScore}
          <input
            name="passingScore"
            type="number"
            min="0"
            max="100"
            step="0.01"
            defaultValue={gradebook.settings.passingScore ?? 50}
          />
        </label>
        <label>
          {t.rounding}
          <input
            name="rounding"
            type="number"
            min="0"
            max="4"
            defaultValue={gradebook.settings.rounding}
          />
        </label>
        <button className="button button-secondary" type="submit" disabled={busy}>
          {busy ? t.saving : t.saveScale}
        </button>
        {settingsError ? (
          <span className="form-error" role="alert">
            {settingsError}
          </span>
        ) : null}
      </form>
      <div className="gradebook-table-wrap">
        <table className="gradebook-table">
          <thead>
            <tr>
              <th>{t.student}</th>
              {gradebook.assignments.map((assignment) => (
                <th key={assignment.id}>
                  {assignment.title}
                  <small>
                    {t.maximum} {assignment.maxScore} · {t.weight} {assignment.weight}
                  </small>
                </th>
              ))}
              <th>{t.calculated}</th>
              <th>{t.teacherFinal}</th>
            </tr>
          </thead>
          <tbody>
            {gradebook.rows.map((row) => (
              <tr key={row.student.id}>
                <td>
                  <strong>{row.student.name}</strong>
                  <small>{row.student.email}</small>
                </td>
                {row.assignments.map((cell) => (
                  <td key={cell.assignmentId}>
                    {cell.score === null ? "—" : `${cell.score}/${cell.maxScore}`}
                  </td>
                ))}
                <td>
                  {row.calculatedPercent === null ? "—" : `${row.calculatedPercent}%`}
                  <small>{row.gradeLabel ?? ""}</small>
                </td>
                <td>
                  <FinalGradeForm courseId={courseId} row={row} t={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!gradebook.rows.length ? <p className="course-material-empty">{t.noStudents}</p> : null}
      </div>
    </div>
  );
}
