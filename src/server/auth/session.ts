import { auth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { ApiError } from "@/lib/http/api-error";
import { getSessionTokenFromCookieHeader, verifySessionCsrfToken } from "@/server/auth/csrf";
import { isUserRole, type UserRole } from "@/server/policies/users";

export type AppLocale = "ru" | "kk" | "en";

export interface Actor {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  locale?: AppLocale;
  status: "ACTIVE" | "BLOCKED" | "ARCHIVED";
  mustChangePassword: boolean;
}

export async function requireActor(
  headers: Headers,
  options: { allowFirstLogin?: boolean } = {},
): Promise<Actor> {
  const session = await auth.api.getSession({ headers });
  if (!session) throw new ApiError(401, "UNAUTHENTICATED", "Войдите в систему.");

  const role = session.user.role;
  if (!isUserRole(role) || session.user.status !== "ACTIVE") {
    throw new ApiError(401, "UNAUTHENTICATED", "Войдите в систему.");
  }
  if (session.user.mustChangePassword && !options.allowFirstLogin) {
    throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "Сначала задайте новый пароль.");
  }

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role,
    locale: session.user.locale as AppLocale,
    status: session.user.status,
    mustChangePassword: session.user.mustChangePassword,
  };
}

export function requireAdminRole(role: UserRole): void {
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    throw new ApiError(403, "FORBIDDEN", "Этот раздел доступен администраторам.");
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const env = getServerEnv();
  const expected = new URL(env.APP_URL);
  const allowedOrigins = new Set([expected.origin]);
  if (env.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(expected.hostname)) {
    for (const hostname of ["localhost", "127.0.0.1"]) {
      allowedOrigins.add(
        `${expected.protocol}//${hostname}${expected.port ? `:${expected.port}` : ""}`,
      );
    }
  }
  if (!origin || !allowedOrigins.has(origin)) {
    throw new ApiError(403, "INVALID_ORIGIN", "Запрос отклонён.");
  }
  const cookieHeader = request.headers.get("cookie");
  if (
    getSessionTokenFromCookieHeader(cookieHeader) &&
    !verifySessionCsrfToken(cookieHeader, request.headers.get("x-csrf-token"), env.AUTH_SECRET)
  ) {
    throw new ApiError(403, "CSRF_TOKEN_INVALID", "Запрос отклонён.");
  }
}
