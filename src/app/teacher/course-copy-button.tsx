"use client";

import { apiFetch } from "@/lib/api-fetch";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CourseCopyButton({
  courseId,
  copyLabel,
  copyError,
  copySuccess,
}: {
  courseId: string;
  copyLabel: string;
  copyError: string;
  copySuccess: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function copyCourse() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await apiFetch(`/api/v1/courses/${courseId}/copy`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? copyError);
      setMessage(copySuccess.replace("{title}", result.item.title));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copyError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="course-card-copy-action">
      <button
        className="button button-secondary"
        disabled={busy}
        onClick={() => void copyCourse()}
        type="button"
      >
        {copyLabel}
      </button>
      {message ? (
        <span className="course-copy-feedback" role="status">
          {message}
        </span>
      ) : null}
      {error ? (
        <span className="course-copy-feedback course-copy-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
