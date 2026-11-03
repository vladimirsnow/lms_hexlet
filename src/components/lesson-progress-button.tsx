"use client";

import { apiFetch } from "@/lib/api-fetch";
import { useState } from "react";
import { getMessages, normalizeLocale, type AppLocale } from "@/lib/i18n";

export function LessonProgressButton({
  lessonId,
  complete: initial,
  locale = "ru",
}: {
  lessonId: string;
  complete: boolean;
  locale?: AppLocale | string;
}) {
  const t = getMessages(normalizeLocale(locale)).course;
  const [complete, setComplete] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/lessons/${lessonId}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete: !complete }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message || t.progressError);
      }
      setComplete((value) => !value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.progressError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lesson-progress-control">
      <button
        className={
          complete ? "lesson-complete-button lesson-complete-button-done" : "lesson-complete-button"
        }
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={complete}
      >
        {busy ? t.progressSaving : complete ? t.progressDone : t.progressMark}
      </button>
      {error ? (
        <span className="form-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
