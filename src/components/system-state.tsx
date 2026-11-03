"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { getMessages, normalizeLocale, type AppLocale } from "@/lib/i18n";

type SystemStateProps = {
  kind: "error" | "loading" | "not-found";
  onRetry?: () => void;
};

function subscribeToDocumentLanguage(onChange: () => void) {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  return () => observer.disconnect();
}

function getDocumentLanguage() {
  const routeLocale = new URLSearchParams(window.location.search).get("locale");
  return normalizeLocale(routeLocale ?? document.documentElement.lang);
}

function getServerLanguage(): AppLocale {
  return "ru";
}

export function SystemState({ kind, onRetry }: SystemStateProps) {
  const locale = useSyncExternalStore(
    subscribeToDocumentLanguage,
    getDocumentLanguage,
    getServerLanguage,
  );

  const messages = getMessages(locale);
  const t = messages.auth.systemError;

  if (kind === "loading") {
    return (
      <main aria-busy="true" aria-live="polite" className="system-state">
        <span aria-hidden="true" className="system-state-mark">
          k
        </span>
        <p>{t.loading}</p>
      </main>
    );
  }

  if (kind === "not-found") {
    return (
      <main className="system-state">
        <span className="system-state-code">404</span>
        <h1>{t.notFoundTitle}</h1>
        <p>{t.notFoundDescription}</p>
        <Link className="button button-primary" href={`/?locale=${locale}`}>
          {messages.home}
        </Link>
      </main>
    );
  }

  return (
    <main className="system-state" role="alert">
      <span className="system-state-code">!</span>
      <h1>{t.title}</h1>
      <p>{t.description}</p>
      <button className="button button-primary" onClick={onRetry} type="button">
        {t.retry}
      </button>
    </main>
  );
}
