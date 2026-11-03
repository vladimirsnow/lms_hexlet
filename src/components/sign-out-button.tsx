"use client";

import { apiFetch } from "@/lib/api-fetch";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getMessages, type AppLocale } from "@/lib/i18n";

export function SignOutButton({ locale }: { locale: AppLocale }) {
  const messages = getMessages(locale);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function signOut() {
    setPending(true);
    setError(false);
    try {
      const response = await apiFetch("/api/v1/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      const result = (await response.json()) as { success?: boolean };
      if (!response.ok || result.success !== true) throw new Error("Sign-out failed.");
      router.replace("/login");
      router.refresh();
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return (
    <button
      aria-label={error ? messages.signOutError : messages.signOut}
      className="app-sign-out"
      disabled={pending}
      onClick={signOut}
      title={error ? messages.signOutError : messages.signOut}
      type="button"
    >
      <LogOut aria-hidden="true" size={17} />
    </button>
  );
}
