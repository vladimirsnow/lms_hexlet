"use client";

import { apiFetch } from "@/lib/api-fetch";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { getMessages, normalizeLocale, type AppLocale } from "@/lib/i18n";

type AssignmentRecord = {
  id: string;
  title: string;
  type: "FILE" | "TEXT" | "FILE_OR_TEXT";
  maxScore: string;
  weight: string;
  dueAt: string | null;
  allowLate: boolean;
  maxAttempts: number;
  allowResubmission: boolean;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  submissions?: Array<{ id: string; attemptNo: number; status: string; score: string | null }>;
  _count?: { submissions: number };
};

function responseMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    return (payload as { error?: { message?: string } }).error?.message || fallback;
  }
  return fallback;
}

async function mutate(path: string, method: string, body: unknown, fallback: string) {
  const response = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseMessage(payload, fallback));
  return payload;
}

export function AssignmentManager({
  courseId,
  courseSlug,
  assignments,
  canManage,
  locale,
}: {
  courseId: string;
  courseSlug: string;
  assignments: AssignmentRecord[];
  canManage: boolean;
  locale: AppLocale | string;
}) {
  const appLocale = normalizeLocale(locale);
  const t = getMessages(appLocale).assignments;
  const dateLocale = appLocale === "kk" ? "kk-KZ" : appLocale === "en" ? "en-GB" : "ru-RU";
  const typeLabels: Record<AssignmentRecord["type"], string> = {
    FILE: t.typeFile,
    TEXT: t.typeText,
    FILE_OR_TEXT: t.typeEither,
  };
  const attemptStatuses: Record<string, string> = {
    DRAFT: t.statusDraft,
    SUBMITTED: t.statusSubmitted,
    GRADED: t.statusGraded,
    RETURNED: t.statusReturned,
    RESUBMISSION_REQUIRED: t.statusResubmission,
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const dueValue = String(data.get("dueAt") || "");
    setBusy(true);
    setError("");
    try {
      await mutate(
        `/api/v1/courses/${courseId}/assignments`,
        "POST",
        {
          title: data.get("title"),
          description: data.get("description") || null,
          instructions: data.get("instructions") || null,
          type: data.get("type"),
          maxScore: data.get("maxScore"),
          weight: data.get("weight"),
          dueAt: dueValue ? new Date(dueValue).toISOString() : null,
          allowLate: data.get("allowLate") === "on",
          latePenaltyPercent: data.get("latePenaltyPercent") || 0,
          maxAttempts: data.get("maxAttempts") || 1,
          allowResubmission: data.get("allowResubmission") === "on",
        },
        t.operationError,
      );
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.createError);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(assignment: AssignmentRecord) {
    const status = assignment.status === "PUBLISHED" ? "CLOSED" : "PUBLISHED";
    setBusy(true);
    setError("");
    try {
      await mutate(`/api/v1/assignments/${assignment.id}`, "PATCH", { status }, t.operationError);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.statusError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="course-content-manager admin-panel assignment-manager">
      <div className="course-materials-heading">
        <div>
          <p className="eyebrow">{t.eyebrow}</p>
          <h2>{t.title}</h2>
        </div>
        {canManage ? (
          <Link className="admin-inline-link" href={`/courses/${courseSlug}/gradebook`}>
            {t.gradebook}
          </Link>
        ) : null}
      </div>
      {assignments.length ? (
        <div className="assignment-list">
          {assignments.map((assignment) => {
            const latest = assignment.submissions?.[0];
            return (
              <article className="assignment-card" key={assignment.id}>
                <div>
                  <span
                    className={`course-status course-status-${assignment.status.toLowerCase()}`}
                  >
                    {assignment.status === "PUBLISHED"
                      ? t.published
                      : assignment.status === "CLOSED"
                        ? t.closed
                        : t.draft}
                  </span>
                  <h3>
                    <Link href={`/assignments/${assignment.id}`}>{assignment.title}</Link>
                  </h3>
                  <p>
                    {typeLabels[assignment.type]} · {t.maximum} {assignment.maxScore} · {t.weight}{" "}
                    {assignment.weight}
                  </p>
                  <small>
                    {assignment.dueAt
                      ? t.due + ": " + new Date(assignment.dueAt).toLocaleString(dateLocale)
                      : t.noDue}
                    {assignment.allowLate ? " · " + t.lateAllowed : ""}
                  </small>
                  {canManage ? (
                    <small>
                      {assignment._count?.submissions ?? 0} {t.attempts}
                    </small>
                  ) : latest ? (
                    <small>
                      {t.latestAttempt}: {attemptStatuses[latest.status] ?? latest.status}
                      {latest.score ? " · " + latest.score + " " + t.points : ""}
                    </small>
                  ) : (
                    <small>{t.workNotStarted}</small>
                  )}
                </div>
                {canManage ? (
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => changeStatus(assignment)}
                  >
                    {assignment.status === "PUBLISHED" ? t.close : t.publish}
                  </button>
                ) : (
                  <Link className="button button-secondary" href={`/assignments/${assignment.id}`}>
                    {latest?.status === "DRAFT" ? t.continue : t.open}
                  </Link>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="course-material-empty">{t.empty}</p>
      )}
      {canManage ? (
        <form className="assignment-create-form" onSubmit={create}>
          <h3>{t.newAssignment}</h3>
          <label>
            {t.name}
            <input name="title" required maxLength={200} placeholder={t.exampleName} />
          </label>
          <label>
            {t.responseType}
            <select name="type" defaultValue="FILE_OR_TEXT">
              <option value="FILE_OR_TEXT">{t.typeEither}</option>
              <option value="FILE">{t.typeFile}</option>
              <option value="TEXT">{t.typeText}</option>
            </select>
          </label>
          <label>
            {t.description}
            <textarea name="description" maxLength={10000} />
          </label>
          <label>
            {t.instructions}
            <textarea name="instructions" maxLength={30000} />
          </label>
          <label>
            {t.maxScore}
            <input
              name="maxScore"
              type="number"
              min="0.01"
              step="0.01"
              defaultValue="100"
              required
            />
          </label>
          <label>
            {t.weight}
            <input
              name="weight"
              type="number"
              min="0"
              max="999.99"
              step="0.01"
              defaultValue="1"
              required
            />
          </label>
          <label>
            {t.dueAt}
            <input name="dueAt" type="datetime-local" />
          </label>
          <label>
            {t.attemptLimit}
            <input name="maxAttempts" type="number" min="1" max="20" defaultValue="1" />
          </label>
          <label>
            {t.latePenalty}
            <input
              name="latePenaltyPercent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              defaultValue="0"
            />
          </label>
          <label className="assignment-checkbox">
            <input name="allowLate" type="checkbox" /> {t.allowLate}
          </label>
          <label className="assignment-checkbox">
            <input name="allowResubmission" type="checkbox" /> {t.resubmission}
          </label>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? t.saving : t.create}
          </button>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
      {!canManage && error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
