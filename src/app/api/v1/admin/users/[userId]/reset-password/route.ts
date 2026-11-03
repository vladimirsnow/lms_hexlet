import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { enforceActorRateLimit } from "@/server/auth/rate-limit";
import { assertSameOrigin, requireActor, requireAdminRole } from "@/server/auth/session";
import { resetUserPassword } from "@/server/services/users";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    await enforceActorRateLimit(actor.id, "admin-password-reset", 12, 60_000);
    const { userId } = await context.params;
    if (!z.uuid().safeParse(userId).success) {
      throw new ApiError(404, "USER_NOT_FOUND", "Пользователь не найден.");
    }

    const result = await resetUserPassword(actor, userId, request);
    return Response.json(result, {
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
