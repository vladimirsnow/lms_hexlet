import { apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import { markNotificationRead } from "@/server/services/announcements";
import { z } from "zod";
import { ApiError } from "@/lib/http/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ notificationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    const { notificationId } = await context.params;
    const parsed = z.uuid().safeParse(notificationId);
    if (!parsed.success)
      throw new ApiError(404, "NOTIFICATION_NOT_FOUND", "Уведомление не найдено.");
    const result = await markNotificationRead(actor, parsed.data);
    return Response.json(result, {
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
