import { getServerEnv } from "@/lib/env";
import { apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { createSessionCsrfToken, getSessionTokenFromCookieHeader } from "@/server/auth/csrf";
import { requireActor } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await requireActor(request.headers, { allowFirstLogin: true });

    const sessionToken = getSessionTokenFromCookieHeader(request.headers.get("cookie"));
    if (!sessionToken) {
      return Response.json(
        { error: { code: "UNAUTHENTICATED", message: "Войдите в систему." } },
        {
          status: 401,
          headers: { "Cache-Control": "private, no-store", "X-Request-ID": requestId },
        },
      );
    }

    const token = createSessionCsrfToken(sessionToken, getServerEnv().AUTH_SECRET);
    return Response.json(
      { token },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Request-ID": requestId,
          Vary: "Cookie",
        },
      },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
