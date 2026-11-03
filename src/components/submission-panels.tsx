"use client";

import { apiFetch } from "@/lib/api-fetch";
import { useState, type FormEvent } from "react";
import { FileUpload } from "@/components/course-content-manager";
import { getMessages, normalizeLocale, type AppLocale } from "@/lib/i18n";

type SubmissionFile = {
  file: { id: string; originalName: string; uploadStatus?: string; virusScanStatus?: string };
};
type StudentSubmission = {
  id: string;
  attemptNo: number;
  textContent: string | null;
  status: string;
  submittedAt: string | null;
  isLate: boolean;
  score: string | null;
  feedback: string | null;
  files: SubmissionFile[];
};
type AssignmentDetails = {
  id: string;
  title: string;
  type: "FILE" | "TEXT" | "FILE_OR_TEXT";
  maxScore: string;
  maxAttempts: number;
  allowResubmission: boolean;
  submissions?: StudentSubmission[];
};
type StaffSubmission = StudentSubmission & { student: { id: string; name: string; email: string } };
type SubmissionMessages = ReturnType<typeof getMessages>["submission"];

function errorMessage(payload: unknown, fallback: string) {
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
  if (!response.ok) throw new Error(errorMessage(payload, fallback));
  return payload;
}

function StudentAttempt({
  submission,
  t,
  dateLocale,
}: {
  submission: StudentSubmission;
  t: SubmissionMessages;
  dateLocale: string;
}) {
  return (
    <article className="submission-record">
      <div className="submission-record-heading">
        <div>
          <h3>
            {t.attempt} {submission.attemptNo}
          </h3>
          <p>
            {t.status[submission.status as keyof typeof t.status] ?? submission.status}
            {submission.isLate ? " · " + t.late : ""}
          </p>
        </div>
        {submission.score !== null ? (
          <strong>
            {submission.score} {t.points}
          </strong>
        ) : null}
      </div>
      {submission.textContent ? (
        <div className="submission-answer">{submission.textContent}</div>
      ) : null}
      {submission.files.map(({ file }) => (
        <a className="course-file-link" href={`/api/v1/files/${file.id}/download`} key={file.id}>
          <span>
            <strong>{file.originalName}</strong>
            <small>{file.uploadStatus === "PENDING" ? t.pendingUpload : t.file}</small>
          </span>
          <span aria-hidden="true">↓</span>
        </a>
      ))}
      {submission.feedback ? (
        <p className="submission-answer">
          <strong>{t.teacherFeedback}: </strong>
          {submission.feedback}
        </p>
      ) : null}
      {submission.submittedAt ? (
        <small>
          {t.sent}: {new Date(submission.submittedAt).toLocaleString(dateLocale)}
        </small>
      ) : null}
    </article>
  );
}

export function StudentSubmissionPanel({
  assignment,
  locale = "ru",
}: {
  assignment: AssignmentDetails;
  locale?: AppLocale | string;
}) {
  const appLocale = normalizeLocale(locale);
  const t = getMessages(appLocale).submission;
  const dateLocale = appLocale === "kk" ? "kk-KZ" : appLocale === "en" ? "en-GB" : "ru-RU";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempts = assignment.submissions ?? [];
  const latest = attempts[0];
  const draft = latest?.status === "DRAFT" ? latest : undefined;
  const mayCreate =
    !latest ||
    (["GRADED", "RETURNED", "RESUBMISSION_REQUIRED"].includes(latest.status) &&
      assignment.allowResubmission &&
      latest.attemptNo < assignment.maxAttempts);

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const content = String(new FormData(form).get("textContent") ?? "");
    setBusy(true);
    setError("");
    try {
      if (draft)
        await mutate(
          `/api/v1/submissions/${draft.id}`,
          "PATCH",
          { textContent: content || null },
          t.operationError,
        );
      else
        await mutate(
          `/api/v1/assignments/${assignment.id}/submissions`,
          "POST",
          {
            textContent: content || null,
          },
          t.operationError,
        );
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.draftError);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await mutate(`/api/v1/submissions/${draft.id}/submit`, "POST", {}, t.operationError);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.submitError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel">
      <div className="course-materials-heading">
        <div>
          <p className="eyebrow">{t.myWork}</p>
          <h2>{t.attempts}</h2>
        </div>
        <span>
          {t.limit}: {assignment.maxAttempts}
        </span>
      </div>
      {attempts.length ? (
        <div className="submission-attempt-list">
          {attempts.map((submission) => (
            <StudentAttempt
              key={submission.id}
              submission={submission}
              t={t}
              dateLocale={dateLocale}
            />
          ))}
        </div>
      ) : (
        <p className="course-material-empty">{t.notStarted}</p>
      )}
      {draft ? (
        <>
          <form className="submission-draft-form" onSubmit={saveDraft}>
            {assignment.type !== "FILE" ? (
              <label>
                {t.answer}
                <textarea
                  name="textContent"
                  defaultValue={draft.textContent ?? ""}
                  maxLength={50000}
                  placeholder={t.answerPlaceholder}
                />
              </label>
            ) : null}
            <button className="button button-secondary" disabled={busy} type="submit">
              {busy ? t.saving : t.saveDraft}
            </button>
          </form>
          {assignment.type !== "TEXT" ? (
            <FileUpload submissionId={draft.id} locale={appLocale} />
          ) : null}
          <div className="submission-draft-actions">
            <button
              className="button button-primary"
              disabled={busy}
              type="button"
              onClick={submit}
            >
              {busy ? t.sending : t.submit}
            </button>
            <small>{t.lockedAfterSubmit}</small>
          </div>
        </>
      ) : mayCreate ? (
        <form className="submission-draft-form" onSubmit={saveDraft}>
          {assignment.type !== "FILE" ? (
            <label>
              {t.answer}
              <textarea name="textContent" maxLength={50000} placeholder={t.answerPlaceholder} />
            </label>
          ) : null}
          <button className="button button-primary" disabled={busy} type="submit">
            {busy ? t.creating : attempts.length ? t.resubmit : t.start}
          </button>
        </form>
      ) : (
        <p className="course-material-empty">{t.unavailable}</p>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function SubmissionReview({
  submission,
  maxScore,
  allowReturn,
  t,
}: {
  submission: StaffSubmission;
  maxScore: string;
  allowReturn: boolean;
  t: SubmissionMessages;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function grade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await mutate(
        `/api/v1/submissions/${submission.id}/grade`,
        "POST",
        {
          score: data.get("score"),
          feedback: data.get("feedback") || null,
        },
        t.operationError,
      );
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.saveGradeError);
    } finally {
      setBusy(false);
    }
  }

  async function returnForRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const feedback = new FormData(event.currentTarget).get("returnFeedback");
    setBusy(true);
    setError("");
    try {
      await mutate(
        `/api/v1/submissions/${submission.id}/return`,
        "POST",
        { feedback },
        t.operationError,
      );
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.returnError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="submission-record">
      <div className="submission-record-heading">
        <div>
          <h3>{submission.student.name}</h3>
          <p>
            {submission.student.email} · {t.attempt} {submission.attemptNo} ·{" "}
            {t.status[submission.status as keyof typeof t.status] ?? submission.status}
            {submission.isLate ? " · " + t.late : ""}
          </p>
        </div>
        {submission.score !== null ? (
          <strong>
            {submission.score}/{maxScore}
          </strong>
        ) : null}
      </div>
      {submission.textContent ? (
        <div className="submission-answer">{submission.textContent}</div>
      ) : null}
      {submission.files.map(({ file }) => (
        <a className="course-file-link" href={`/api/v1/files/${file.id}/download`} key={file.id}>
          <span>
            <strong>{file.originalName}</strong>
            <small>{file.uploadStatus === "READY" ? t.file : t.pendingUpload}</small>
          </span>
          <span aria-hidden="true">↓</span>
        </a>
      ))}
      {submission.feedback ? <p className="submission-answer">{submission.feedback}</p> : null}
      {submission.status === "SUBMITTED" || submission.status === "GRADED" ? (
        <>
          <form className="submission-grade-form" onSubmit={grade}>
            <label>
              {t.pointsLabel}
              <input
                name="score"
                type="number"
                min="0"
                max={maxScore}
                step="0.01"
                defaultValue={submission.score ?? ""}
                required
              />
            </label>
            <label>
              {t.comment}
              <textarea
                name="feedback"
                defaultValue={submission.feedback ?? ""}
                maxLength={10000}
              />
            </label>
            <button className="button button-primary" type="submit" disabled={busy}>
              {busy ? t.gradeSaving : t.grade}
            </button>
          </form>
          {allowReturn ? (
            <form className="submission-review-actions" onSubmit={returnForRevision}>
              <label>
                {t.returnPrompt}
                <input name="returnFeedback" required maxLength={10000} />
              </label>
              <button className="button button-secondary" type="submit" disabled={busy}>
                {t.return}
              </button>
            </form>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

export function SubmissionReviewPanel({
  submissions,
  missingStudents,
  maxScore,
  allowResubmission,
  maxAttempts,
  locale = "ru",
}: {
  submissions: StaffSubmission[];
  missingStudents: Array<{ id: string; name: string; email: string }>;
  maxScore: string;
  allowResubmission: boolean;
  maxAttempts: number;
  locale?: AppLocale | string;
}) {
  const t = getMessages(normalizeLocale(locale)).submission;
  return (
    <section className="admin-panel">
      <div className="course-materials-heading">
        <div>
          <p className="eyebrow">{t.review}</p>
          <h2>{t.received}</h2>
        </div>
        <span>
          {submissions.length} {t.attempts}
        </span>
      </div>
      {submissions.length ? (
        submissions.map((submission) => (
          <SubmissionReview
            key={submission.id}
            submission={submission}
            maxScore={maxScore}
            allowReturn={allowResubmission && submission.attemptNo < maxAttempts}
            t={t}
          />
        ))
      ) : (
        <p className="course-material-empty">{t.noSubmissions}</p>
      )}
      <div className="missing-students">
        <strong>{t.notSubmitted}</strong>
        {missingStudents.length ? (
          missingStudents.map((student) => (
            <div key={student.id}>
              {student.name} · {student.email}
            </div>
          ))
        ) : (
          <p>{t.everyoneSubmitted}</p>
        )}
      </div>
    </section>
  );
}
