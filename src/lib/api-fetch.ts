"use client";

let cachedCsrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;

export function invalidateCsrfToken(): void {
  cachedCsrfToken = null;
  csrfRequest = null;
}

export async function refreshCsrfToken(): Promise<string> {
  invalidateCsrfToken();
  const response = await fetch("/api/v1/security/csrf", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const result = (await response.json().catch(() => null)) as {
    token?: unknown;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(
      result?.error?.message ??
        (response.status === 401
          ? "Сеанс завершён. Войдите в систему снова."
          : "Не удалось обновить защитный токен."),
    );
  }
  if (typeof result?.token !== "string") {
    throw new Error("Сервер не вернул защитный токен. Обновите страницу и попробуйте ещё раз.");
  }

  cachedCsrfToken = result.token;
  return result.token;
}

async function getCsrfToken(): Promise<string> {
  if (cachedCsrfToken) return cachedCsrfToken;
  csrfRequest ??= refreshCsrfToken();
  try {
    return await csrfRequest;
  } finally {
    csrfRequest = null;
  }
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const url = new URL(
    input instanceof Request ? input.url : input.toString(),
    window.location.href,
  );
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (
    !isMutation ||
    url.origin !== window.location.origin ||
    !url.pathname.startsWith("/api/v1/")
  ) {
    return fetch(input, init);
  }

  const token = await getCsrfToken();
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  headers.set("X-CSRF-Token", token);
  return fetch(input, { ...init, headers });
}
