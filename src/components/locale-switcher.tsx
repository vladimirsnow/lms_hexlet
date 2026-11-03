"use client";

import { apiFetch } from "@/lib/api-fetch";
import { useEffect, useState } from "react";
import { getMessages, localeOptions, type AppLocale } from "@/lib/i18n";

export function LocaleSwitcher({ locale }: { locale: AppLocale }) {
  const messages = getMessages(locale);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  async function changeLocale(nextLocale: AppLocale) {
    if (nextLocale === locale || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch("/api/v1/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      if (!response.ok) throw new Error(messages.saveLanguageError);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.saveLanguageError);
      setSaving(false);
    }
  }

  return (
    <div className="locale-switcher">
      <label className="sr-only" htmlFor="locale-switcher">
        {messages.language}
      </label>
      <select
        disabled={saving}
        id="locale-switcher"
        onChange={(event) => void changeLocale(event.target.value as AppLocale)}
        value={locale}
      >
        {localeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span aria-live="polite" className="sr-only">
        {saving ? messages.saving : error}
      </span>
    </div>
  );
}
