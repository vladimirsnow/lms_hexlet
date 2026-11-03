import { ApiError, apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import {
  archiveScheduleEntry,
  parseScheduleId,
  updateScheduleEntry,
} from "@/server/services/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ entryId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    const { entryId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Тело запроса должно быть JSON.");
    }
    const entry = await updateScheduleEntry(actor, parseScheduleId(entryId), body, request);
    return Response.json(
      { entry },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    const { entryId } = await context.params;
    const result = await archiveScheduleEntry(actor, parseScheduleId(entryId), request);
    return Response.json(result, {
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
