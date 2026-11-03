"use client";

import { apiFetch } from "@/lib/api-fetch";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound } from "lucide-react";
import { getMessages, type AppLocale } from "@/lib/i18n";

export function ChangePasswordForm({ locale }: { locale: AppLocale }) {
  const copy = getMessages(locale).auth.changePassword;
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (newPassword !== confirmPassword) {
      setError(copy.mismatch);
      return;
    }
    setPending(true);
    try {
      const response = await apiFetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const result = (await response.json()) as {
        error?: { code?: string; message?: string };
        changed?: boolean;
      };
      if (!response.ok || !result.changed) {
        const errorMessage =
          result.error?.code === "CURRENT_PASSWORD_INVALID"
            ? copy.currentPasswordInvalid
            : result.error?.code === "PASSWORD_UNCHANGED"
              ? copy.unchanged
              : result.error?.code === "VALIDATION_ERROR"
                ? copy.validationError
                : copy.requestError;
        setError(errorMessage);
        return;
      }
      router.replace(`/login?passwordChanged=1&locale=${locale}`);
      router.refresh();
    } catch {
      setError(copy.connectionError);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="auth-label" htmlFor="current-password">
        {copy.currentPassword}
      </label>
      <input
        autoComplete="current-password"
        className="auth-input auth-spaced-input"
        id="current-password"
        onChange={(event) => setCurrentPassword(event.target.value)}
        required
        type="password"
        value={currentPassword}
      />

      <label className="auth-label" htmlFor="new-password">
        {copy.newPassword}
      </label>
      <input
        autoComplete="new-password"
        className="auth-input auth-spaced-input"
        id="new-password"
        minLength={12}
        onChange={(event) => setNewPassword(event.target.value)}
        required
        type="password"
        value={newPassword}
      />

      <label className="auth-label" htmlFor="confirm-password">
        {copy.confirmPassword}
      </label>
      <input
        autoComplete="new-password"
        className="auth-input"
        id="confirm-password"
        minLength={12}
        onChange={(event) => setConfirmPassword(event.target.value)}
        required
        type="password"
        value={confirmPassword}
      />
      <p className="auth-hint">{copy.hint}</p>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="auth-submit" disabled={pending} type="submit">
        {pending ? copy.submitting : copy.submit}
        {!pending ? <ArrowRight aria-hidden="true" size={17} /> : null}
      </button>
    </form>
  );
}

export function PasswordChangeCard({ locale }: { locale: AppLocale }) {
  const copy = getMessages(locale).auth.changePassword;

  return (
    <section aria-labelledby="change-password-title" className="auth-card">
      <div className="auth-card-heading">
        <div className="auth-card-icon">
          <KeyRound aria-hidden="true" color="#6c3f8f" size={20} />
        </div>
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2 id="change-password-title">{copy.title}</h2>
        <p>{copy.description}</p>
      </div>
      <ChangePasswordForm locale={locale} />
      <div className="auth-card-footer">{copy.storedSecurely}</div>
    </section>
  );
}
