"use client";

import { apiFetch } from "@/lib/api-fetch";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { AppLocale } from "@/lib/i18n";
import { getMessages } from "@/lib/i18n";

type QuizRecord = {
  id: string;
  title: string;
  description: string | null;
  timeLimitMinutes: number | null;
  attemptsAllowed: number;
  passingPercent: string;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  _count: { questions: number };
  attempts: {
    id: string;
    attemptNo: number;
    status: string;
    score: string | null;
    maxScore: string;
    isTimedOut: boolean;
    student?: { name: string };
  }[];
};

async function request(path: string, method: string, body: unknown, fallback: string) {
  const response = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || fallback);
  return payload;
}

export function QuizManager({
  courseId,
  tests,
  canManage,
  locale,
}: {
  courseId: string;
  tests: QuizRecord[];
  canManage: boolean;
  locale: AppLocale;
}) {
  const t = getMessages(locale).quiz;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await request(
        `/api/v1/courses/${courseId}/tests`,
        "POST",
        {
          title: data.get("title"),
          description: data.get("description") || null,
          timeLimitMinutes: data.get("timeLimitMinutes") || null,
          attemptsAllowed: data.get("attemptsAllowed") || 1,
          passingPercent: data.get("passingPercent") || 50,
          shuffleQuestions: data.get("shuffleQuestions") === "on",
        },
        t.operationError,
      );
      router.push(`/tests/${result.test.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.createError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel quiz-manager">
      <div className="admin-panel-heading">
        <div>
          <p className="eyebrow">{t.managerEyebrow}</p>
          <h2>{t.managerTitle}</h2>
        </div>
        <span className="users-total">{tests.length}</span>
      </div>
      {canManage ? (
        <form className="quiz-create-form" onSubmit={create}>
          <label>
            {t.title}
            <input required name="title" maxLength={200} placeholder={t.titlePlaceholder} />
          </label>
          <label>
            {t.description}
            <textarea name="description" rows={2} maxLength={10000} />
          </label>
          <label>
            {t.timeLimit}
            <input
              name="timeLimitMinutes"
              type="number"
              min="1"
              max="600"
              placeholder={t.noLimit}
            />
          </label>
          <label>
            {t.attemptsAllowed}
            <input
              name="attemptsAllowed"
              type="number"
              min="1"
              max="20"
              defaultValue="1"
              required
            />
          </label>
          <label>
            {t.passingPercent}
            <input
              name="passingPercent"
              type="number"
              min="0"
              max="100"
              defaultValue="50"
              required
            />
          </label>
          <label className="quiz-checkbox">
            <input name="shuffleQuestions" type="checkbox" defaultChecked /> {t.shuffleQuestions}
          </label>
          <button className="button button-primary" disabled={busy}>
            {busy ? t.creating : t.create}
          </button>
          {error ? (
            <p className="schedule-form-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
      {tests.length ? (
        <div className="quiz-list">
          {tests.map((test) => {
            const latest = test.attempts[0];
            return (
              <article className="quiz-card" key={test.id}>
                <div>
                  <span className={`course-status course-status-${test.status.toLowerCase()}`}>
                    {test.status === "PUBLISHED"
                      ? t.published
                      : test.status === "CLOSED"
                        ? t.closed
                        : t.draft}
                  </span>
                  <h3>
                    <Link href={`/tests/${test.id}`}>{test.title}</Link>
                  </h3>
                  <p>
                    {test._count.questions} {t.questionsCount} ·{" "}
                    {test.timeLimitMinutes
                      ? `${test.timeLimitMinutes} ${t.minutesShort}`
                      : t.noTimer}{" "}
                    · {test.attemptsAllowed} {t.attempts}
                  </p>
                  {!canManage && latest ? (
                    <small>
                      {t.attempt} {latest.attemptNo}:{" "}
                      {latest.status === "GRADED"
                        ? `${latest.score ?? "0"}/${latest.maxScore} ${t.result}`
                        : latest.status === "IN_PROGRESS"
                          ? t.inProgress
                          : latest.status === "NEEDS_REVIEW"
                            ? t.needsReview
                            : (t.attemptStatuses[latest.status as keyof typeof t.attemptStatuses] ??
                              latest.status)}
                    </small>
                  ) : null}
                  {canManage ? (
                    <small>
                      {test.attempts.length} {t.attempts} · {t.passingScore} {test.passingPercent}%
                    </small>
                  ) : null}
                </div>
                <Link className="button button-secondary" href={`/tests/${test.id}`}>
                  {canManage ? t.manage : latest?.status === "IN_PROGRESS" ? t.continue : t.open}
                </Link>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="course-material-empty">{t.emptyTests}</p>
      )}
    </section>
  );
}
