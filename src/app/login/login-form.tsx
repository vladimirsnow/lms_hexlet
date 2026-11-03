"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import type { AppLocale, getMessages } from "@/lib/i18n";

type LoginCopy = ReturnType<typeof getMessages>["auth"]["login"];

export function LoginForm({ locale, copy }: { locale: AppLocale; copy: LoginCopy }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setPending(true);

    try {
      const isEmail = identifier.includes("@");
      const response = await fetch(`/api/v1/auth/sign-in/${isEmail ? "email" : "username"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [isEmail ? "email" : "username"]: identifier.trim(),
          password,
          callbackURL: "/dashboard",
        }),
      });
      const result = (await response.json()) as {
        user?: { mustChangePassword?: boolean };
        error?: unknown;
      };

      if (!response.ok || result.error || !result.user) {
        setError(copy.loginError);
        return;
      }

      window.location.assign(
        result.user.mustChangePassword ? `/change-password?locale=${locale}` : "/dashboard",
      );
    } catch {
      setError(copy.serviceUnavailable);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" method="post" onSubmit={submit}>
      <label className="auth-label" htmlFor="login-identifier">
        {copy.identifier}
      </label>
      <input
        autoComplete="username"
        className="auth-input"
        id="login-identifier"
        name="identifier"
        onChange={(event) => setIdentifier(event.target.value)}
        placeholder={copy.identifierPlaceholder}
        required
        value={identifier}
      />

      <div className="auth-password-heading">
        <label className="auth-label" htmlFor="login-password">
          {copy.password}
        </label>
        <span>{copy.passwordMinimum}</span>
      </div>
      <div className="auth-password-field">
        <input
          autoComplete="current-password"
          className="auth-input"
          id="login-password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type={showPassword ? "text" : "password"}
          value={password}
        />
        <button
          aria-label={showPassword ? copy.hidePassword : copy.showPassword}
          className="auth-password-toggle"
          onClick={() => setShowPassword((value) => !value)}
          type="button"
        >
          {showPassword ? (
            <EyeOff aria-hidden="true" size={17} />
          ) : (
            <Eye aria-hidden="true" size={17} />
          )}
        </button>
      </div>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="auth-submit" disabled={pending} type="submit">
        {pending ? copy.submitting : copy.submit}
        {!pending ? <ArrowRight aria-hidden="true" size={17} /> : null}
      </button>

      <p className="auth-security-note">
        <LockKeyhole aria-hidden="true" size={15} />
        {copy.securityNote}
      </p>
    </form>
  );
}
