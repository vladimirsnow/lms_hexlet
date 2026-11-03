"use client";

import { apiFetch } from "@/lib/api-fetch";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AppLocale } from "@/lib/i18n";
import { getMessages } from "@/lib/i18n";

type QuizCopy = ReturnType<typeof getMessages>["quiz"];

type QuizQuestion = {
  id: string;
  type: "SINGLE" | "MULTIPLE" | "SHORT_ANSWER" | "ESSAY";
  prompt: string;
  points: string;
  position: number;
  acceptedAnswers?: unknown;
  options: { id: string; text: string; position: number; isCorrect?: boolean }[];
};
type QuizAttempt = {
  id: string;
  attemptNo: number;
  status: "IN_PROGRESS" | "NEEDS_REVIEW" | "GRADED" | "TIMED_OUT";
  score: string | null;
  maxScore: string;
  isTimedOut: boolean;
  startedAt: string;
  expiresAt: string | null;
  submittedAt: string | null;
  questions: QuizQuestion[];
  answers: {
    questionId: string;
    answer: unknown;
    pointsAwarded: string | null;
    feedback?: string | null;
  }[];
  student?: { id: string; name: string };
  test?: {
    id: string;
    title: string;
    passingPercent: string;
    course: { id: string; title: string; slug: string };
  };
};
type QuizTest = {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  timeLimitMinutes: number | null;
  attemptsAllowed: number;
  shuffleQuestions: boolean;
  passingPercent: string;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  course: { id: string; slug: string; title: string };
  questions?: QuizQuestion[];
  _count?: { questions: number };
  attempts: {
    id: string;
    attemptNo: number;
    status: QuizAttempt["status"];
    score: string | null;
    maxScore: string;
    isTimedOut: boolean;
    submittedAt: string | null;
    startedAt?: string;
    student?: { id: string; name: string };
  }[];
};

async function api(path: string, method: string, body: unknown, fallback: string) {
  const response = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || fallback);
  return data;
}

function AnswerControl({
  question,
  value,
  disabled,
  onChange,
  t,
}: {
  question: QuizQuestion;
  value: string | string[];
  disabled: boolean;
  onChange: (value: string | string[]) => void;
  t: QuizCopy;
}) {
  if (question.type === "SINGLE")
    return (
      <div className="quiz-answer-options">
        {question.options.map((option) => (
          <label key={option.id}>
            <input
              type="radio"
              name={question.id}
              value={option.id}
              checked={value === option.id}
              disabled={disabled}
              onChange={() => onChange(option.id)}
            />
            <span>{option.text}</span>
          </label>
        ))}
      </div>
    );
  if (question.type === "MULTIPLE") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="quiz-answer-options">
        {question.options.map((option) => (
          <label key={option.id}>
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option.id]
                    : selected.filter((id) => id !== option.id),
                )
              }
            />
            <span>{option.text}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <textarea
      className="quiz-answer-text"
      rows={question.type === "ESSAY" ? 5 : 2}
      maxLength={20000}
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      placeholder={question.type === "ESSAY" ? t.essayAnswer : t.answer}
    />
  );
}

function StudentAttempt({
  test,
  latest,
  t,
  locale,
}: {
  test: QuizTest;
  latest?: QuizTest["attempts"][number];
  t: QuizCopy;
  locale: AppLocale;
}) {
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [now, setNow] = useState(0);
  const router = useRouter();
  const answerPayload = useMemo(
    () => Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer })),
    [answers],
  );

  useEffect(() => {
    if (!attempt || attempt.status !== "IN_PROGRESS") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [attempt]);

  useEffect(() => {
    if (!attempt || attempt.status !== "IN_PROGRESS") return;
    const timer = window.setTimeout(async () => {
      try {
        await api(`/api/v1/attempts/${attempt.id}`, "PATCH", answerPayload, t.operationError);
        setSavedAt(
          new Date().toLocaleTimeString(
            locale === "kk" ? "kk-KZ" : locale === "en" ? "en-GB" : "ru-RU",
            {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            },
          ),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t.saveAnswersError);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [answerPayload, attempt, locale, t]);

  async function openAttempt() {
    setBusy(true);
    setError("");
    try {
      const data = await api(
        `/api/v1/tests/${test.id}/attempts`,
        "POST",
        undefined,
        t.operationError,
      );
      const value = data.attempt as QuizAttempt;
      setAttempt(value);
      setAnswers(
        Object.fromEntries(
          value.answers.flatMap((answer) =>
            typeof answer.answer === "string" || Array.isArray(answer.answer)
              ? [[answer.questionId, answer.answer as string | string[]]]
              : [],
          ),
        ),
      );
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.openAttemptError);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!attempt) return;
    setBusy(true);
    setError("");
    try {
      const data = await api(
        `/api/v1/attempts/${attempt.id}/submit`,
        "POST",
        answerPayload,
        t.operationError,
      );
      setAttempt(data.attempt as QuizAttempt);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.submitError);
    } finally {
      setBusy(false);
    }
  }

  if (!attempt || attempt.status !== "IN_PROGRESS") {
    const current = attempt ?? latest;
    const available =
      current?.status === "IN_PROGRESS" ||
      (test.status === "PUBLISHED" && (current?.attemptNo ?? 0) < test.attemptsAllowed);
    const scorePercent =
      current?.score !== null && current?.score !== undefined && Number(current.maxScore) > 0
        ? (Number(current.score) / Number(current.maxScore)) * 100
        : null;
    return (
      <section className="quiz-student-panel">
        {current?.status === "GRADED" || current?.status === "TIMED_OUT" ? (
          <div className="quiz-result">
            <strong>
              {current.score ?? "0"} / {current.maxScore} {t.points}
            </strong>
            <span>
              {scorePercent !== null && scorePercent >= Number(test.passingPercent)
                ? t.passing
                : t.belowPassing}
            </span>
            {current.isTimedOut ? <small>{t.timedOutResult}</small> : null}
          </div>
        ) : null}
        {current?.status === "NEEDS_REVIEW" ? (
          <p className="course-material-empty">{t.essayPending}</p>
        ) : null}
        <p>
          {current?.status === "IN_PROGRESS"
            ? `${t.continueAttempt} ${current.attemptNo} / ${test.attemptsAllowed}.`
            : `${t.attemptsAvailable}: ${test.attemptsAllowed - (current?.attemptNo ?? 0)} / ${test.attemptsAllowed}.`}
          {test.timeLimitMinutes
            ? ` ${t.timeForTest} — ${test.timeLimitMinutes} ${t.minutes}.`
            : ` ${t.noTimerSentence}`}
        </p>
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !available}
          onClick={openAttempt}
        >
          {busy
            ? t.opening
            : current?.status === "IN_PROGRESS"
              ? t.continueAction
              : available
                ? t.start
                : t.attemptsEnded}
        </button>
        {error ? (
          <p className="schedule-form-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  const secondsLeft = attempt.expiresAt
    ? Math.max(0, Math.ceil((new Date(attempt.expiresAt).getTime() - now) / 1000))
    : null;
  const timeUp = secondsLeft === 0;
  const formattedTime =
    secondsLeft === null
      ? t.noTimerLabel
      : `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;
  return (
    <section className="quiz-attempt-panel">
      <div className="quiz-timer">
        <span>
          {t.attempt} {attempt.attemptNo}
        </span>
        <strong aria-live="polite">{timeUp ? t.timeUp : formattedTime}</strong>
      </div>
      <p className="quiz-save-state" aria-live="polite">
        {savedAt ? `${t.savedDraft} ${savedAt}` : t.autosaving}
      </p>
      {attempt.questions.map((question, index) => (
        <article className="quiz-question-card" key={question.id}>
          <p className="eyebrow">
            {t.question} {index + 1} · {t.questionTypes[question.type]} · {question.points}{" "}
            {t.pointsShort}
          </p>
          <h2>{question.prompt}</h2>
          <AnswerControl
            question={question}
            value={answers[question.id] ?? (question.type === "MULTIPLE" ? [] : "")}
            disabled={timeUp || busy}
            t={t}
            onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
          />
        </article>
      ))}
      {error ? (
        <p className="schedule-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button button-primary" type="button" disabled={busy} onClick={submit}>
        {busy ? t.sending : timeUp ? t.submitTimedOut : t.finishSubmit}
      </button>
    </section>
  );
}

function QuestionBuilder({
  testId,
  onAdded,
  t,
}: {
  testId: string;
  onAdded: () => void;
  t: QuizCopy;
}) {
  const [type, setType] = useState<QuizQuestion["type"]>("SINGLE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const rawOptions = data
      .getAll("option")
      .map((value, index) => ({ text: String(value).trim(), index }))
      .filter((value) => value.text);
    const correctValues = data.getAll("correct").map(String);
    const options = rawOptions.map(({ text, index }) => ({
      text,
      isCorrect: correctValues.includes(String(index)),
    }));
    const acceptedAnswers = String(data.get("acceptedAnswers") || "")
      .split(/\r?\n/)
      .map((answer) => answer.trim())
      .filter(Boolean);
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/v1/tests/${testId}/questions`,
        "POST",
        {
          type,
          prompt: data.get("prompt"),
          points: data.get("points") || 1,
          options: type === "SINGLE" || type === "MULTIPLE" ? options : [],
          acceptedAnswers,
          caseSensitive: data.get("caseSensitive") === "on",
        },
        t.operationError,
      );
      form.reset();
      onAdded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.addQuestionError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="quiz-question-create" onSubmit={submit}>
      <h3>{t.addQuestion}</h3>
      <label>
        {t.questionType}
        <select
          value={type}
          onChange={(event) => setType(event.target.value as QuizQuestion["type"])}
        >
          {Object.entries(t.questionTypes).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.prompt}
        <textarea required name="prompt" rows={3} maxLength={10000} />
      </label>
      <label>
        {t.points}
        <input
          name="points"
          type="number"
          min="0.01"
          max="9999.99"
          step="0.01"
          defaultValue="1"
          required
        />
      </label>
      {type === "SINGLE" || type === "MULTIPLE" ? (
        <fieldset className="quiz-option-builder">
          <legend>{t.optionLegend}</legend>
          {[0, 1, 2, 3].map((index) => (
            <label key={index}>
              <span>
                {t.option} {index + 1}
              </span>
              <input name="option" maxLength={1000} />
              <input
                aria-label={`${t.correctOption} ${index + 1}`}
                name="correct"
                type={type === "SINGLE" ? "radio" : "checkbox"}
                value={index}
              />
            </label>
          ))}
        </fieldset>
      ) : null}
      {type === "SHORT_ANSWER" ? (
        <>
          <label>
            {t.acceptedAnswers}
            <textarea name="acceptedAnswers" rows={3} placeholder={t.onePerLine} />
          </label>
          <label className="quiz-checkbox">
            <input name="caseSensitive" type="checkbox" /> {t.caseSensitive}
          </label>
        </>
      ) : null}
      {error ? (
        <p className="schedule-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button button-primary" disabled={busy}>
        {busy ? t.adding : t.addQuestion}
      </button>
    </form>
  );
}

function EssayReview({ attemptId, t }: { attemptId: string; t: QuizCopy }) {
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [points, setPoints] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    if (!open) {
      setBusy(true);
      setError("");
      try {
        const data = await api(`/api/v1/attempts/${attemptId}`, "GET", undefined, t.operationError);
        const value = data.attempt as QuizAttempt;
        setAttempt(value);
        const answers = new Map(value.answers.map((answer) => [answer.questionId, answer]));
        setPoints(
          Object.fromEntries(
            value.questions
              .filter((question) => question.type === "ESSAY")
              .map((question) => [question.id, answers.get(question.id)?.pointsAwarded ?? "0"]),
          ),
        );
        setFeedback(
          Object.fromEntries(
            value.questions
              .filter((question) => question.type === "ESSAY")
              .map((question) => [question.id, answers.get(question.id)?.feedback ?? ""]),
          ),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t.reviewError);
      } finally {
        setBusy(false);
      }
    }
    setOpen((value) => !value);
  }
  async function grade() {
    if (!attempt) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const scores = attempt.questions
        .filter((question) => question.type === "ESSAY")
        .map((question) => ({
          questionId: question.id,
          points: Number(points[question.id] || 0),
          feedback: feedback[question.id] || null,
        }));
      await api(`/api/v1/attempts/${attemptId}/grade`, "POST", { scores }, t.operationError);
      setMessage(t.reviewSaved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.reviewSaveError);
    } finally {
      setBusy(false);
    }
  }
  const answerByQuestion = new Map(
    attempt?.answers.map((answer) => [answer.questionId, answer]) ?? [],
  );
  return (
    <div className="quiz-attempt-review">
      <button className="button button-muted" type="button" disabled={busy} onClick={load}>
        {busy ? t.loading : open ? t.hideAnswers : t.review}
      </button>
      {error ? (
        <p className="schedule-form-error" role="alert">
          {error}
        </p>
      ) : null}
      {open && attempt ? (
        <div className="quiz-review-answers">
          {attempt.questions.map((question) => {
            const answer = answerByQuestion.get(question.id);
            const value = answer?.answer;
            const display = Array.isArray(value)
              ? value.map(String).join(", ")
              : typeof value === "string"
                ? value
                : t.noAnswer;
            return (
              <article key={question.id}>
                <p className="eyebrow">
                  {t.questionTypes[question.type]} · {t.maximum} {question.points}
                </p>
                <h4>{question.prompt}</h4>
                <p className="quiz-review-answer">{display}</p>
                {question.type === "ESSAY" ? (
                  <div className="quiz-essay-grade">
                    <label>
                      {t.points}
                      <input
                        type="number"
                        min="0"
                        max={question.points}
                        step="0.01"
                        value={points[question.id] ?? "0"}
                        onChange={(event) =>
                          setPoints((current) => ({
                            ...current,
                            [question.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      {t.comment}
                      <textarea
                        rows={2}
                        maxLength={5000}
                        value={feedback[question.id] ?? ""}
                        onChange={(event) =>
                          setFeedback((current) => ({
                            ...current,
                            [question.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <small>
                    {t.automatic}: {answer?.pointsAwarded ?? "0"} / {question.points}
                  </small>
                )}
              </article>
            );
          })}
          <button
            className="button button-primary"
            type="button"
            disabled={busy || attempt.status === "GRADED"}
            onClick={grade}
          >
            {busy ? t.saving : t.saveEssayGrade}
          </button>
          {message ? (
            <p className="schedule-form-success" role="status">
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function QuizWorkspace({
  test,
  role,
  locale,
}: {
  test: QuizTest;
  role: "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT";
  locale: AppLocale;
}) {
  const t = getMessages(locale).quiz;
  const router = useRouter();
  const student = role === "STUDENT";
  const canManage = !student;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const questions = test.questions ?? [];

  async function setStatus(status: QuizTest["status"]) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/tests/${test.id}`, "PATCH", { status }, t.operationError);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.changeStatusError);
    } finally {
      setBusy(false);
    }
  }
  async function removeQuestion(questionId: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/questions/${questionId}`, "DELETE", undefined, t.operationError);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.deleteQuestionError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-page-wrap course-detail quiz-detail">
      <p className="eyebrow">
        {t.detailEyebrow} ·{" "}
        {test.status === "PUBLISHED"
          ? t.published.toLocaleUpperCase(
              locale === "kk" ? "kk-KZ" : locale === "en" ? "en-GB" : "ru-RU",
            )
          : test.status === "CLOSED"
            ? t.closed.toLocaleUpperCase(
                locale === "kk" ? "kk-KZ" : locale === "en" ? "en-GB" : "ru-RU",
              )
            : t.draft.toLocaleUpperCase(
                locale === "kk" ? "kk-KZ" : locale === "en" ? "en-GB" : "ru-RU",
              )}
      </p>
      <section className="quiz-detail-heading">
        <h1>{test.title}</h1>
        <p>{test.description || t.descriptionFallback}</p>
        <div className="course-detail-meta">
          <span>
            {t.course}: <Link href={`/courses/${test.course.slug}`}>{test.course.title}</Link>
          </span>
          <span>
            {test.timeLimitMinutes ? `${test.timeLimitMinutes} ${t.minutes}` : t.timeUnlimited}
          </span>
          <span>
            {test.attemptsAllowed} {t.attempts}
          </span>
          <span>
            {t.passingScore} {test.passingPercent}%
          </span>
        </div>
      </section>
      {canManage ? (
        <>
          <section className="admin-panel quiz-management-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{t.builder}</p>
                <h2>
                  {t.questions} · {questions.length}
                </h2>
              </div>
              <button
                className="button button-primary"
                type="button"
                disabled={busy}
                onClick={() => setStatus(test.status === "PUBLISHED" ? "CLOSED" : "PUBLISHED")}
              >
                {busy ? t.saving : test.status === "PUBLISHED" ? t.close : t.publish}
              </button>
            </div>
            {questions.map((question, index) => (
              <article className="quiz-question-summary" key={question.id}>
                <div>
                  <p className="eyebrow">
                    {t.question} {index + 1} · {t.questionTypes[question.type]} · {question.points}{" "}
                    {t.pointsShort}
                  </p>
                  <h3>{question.prompt}</h3>
                  {question.options.map((option) => (
                    <p
                      className={option.isCorrect ? "quiz-option-correct" : "quiz-option-summary"}
                      key={option.id}
                    >
                      {option.isCorrect ? "✓ " : ""}
                      {option.text}
                    </p>
                  ))}
                </div>
                {test.status === "DRAFT" ? (
                  <button
                    className="button button-muted"
                    type="button"
                    disabled={busy}
                    onClick={() => removeQuestion(question.id)}
                  >
                    {t.remove}
                  </button>
                ) : null}
              </article>
            ))}
            {error ? (
              <p className="schedule-form-error" role="alert">
                {error}
              </p>
            ) : null}
            {test.status === "DRAFT" ? (
              <QuestionBuilder testId={test.id} onAdded={() => router.refresh()} t={t} />
            ) : (
              <p className="course-material-empty">{t.lockedQuestions}</p>
            )}
          </section>
          <section className="admin-panel quiz-attempts-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{t.results}</p>
                <h2>
                  {t.studentAttempts} · {test.attempts.length}
                </h2>
              </div>
            </div>
            {test.attempts.length ? (
              test.attempts.map((attempt) => (
                <article className="quiz-student-attempt" key={attempt.id}>
                  <div>
                    <strong>{attempt.student?.name ?? t.student}</strong>
                    <span>
                      {t.attempt} {attempt.attemptNo} · {t.attemptStatuses[attempt.status]}
                    </span>
                    <small>
                      {attempt.score ?? "—"} / {attempt.maxScore}
                      {attempt.isTimedOut ? ` · ${t.timeExpired}` : ""}
                    </small>
                  </div>
                  {attempt.status !== "IN_PROGRESS" &&
                  questions.some((question) => question.type === "ESSAY") ? (
                    <EssayReview attemptId={attempt.id} t={t} />
                  ) : null}
                </article>
              ))
            ) : (
              <p className="course-material-empty">{t.noAttempts}</p>
            )}
          </section>
        </>
      ) : (
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <p className="eyebrow">{t.testing}</p>
              <h2>{t.attemptAndResult}</h2>
            </div>
          </div>
          <StudentAttempt test={test} latest={test.attempts[0]} t={t} locale={locale} />
        </section>
      )}
      <Link className="admin-inline-link" href={`/courses/${test.course.slug}`}>
        {t.returnToCourse}
      </Link>
    </div>
  );
}
