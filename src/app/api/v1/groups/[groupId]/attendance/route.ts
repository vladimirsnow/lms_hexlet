import { ApiError, apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import {
  getGroupDailyAttendance,
  markGroupDailyAttendance,
  parseAttendanceGroupId,
} from "@/server/services/group-daily-attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ groupId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const { groupId: rawGroupId } = await context.params;
    const groupId = parseAttendanceGroupId(rawGroupId);
    const date = new URL(request.url).searchParams.get("date");
    if (!date) throw new ApiError(422, "DATE_REQUIRED", "Укажите дату посещаемости.");
    const result = await getGroupDailyAttendance(actor, groupId, date);
    return Response.json(result, {
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    const { groupId: rawGroupId } = await context.params;
    const groupId = parseAttendanceGroupId(rawGroupId);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Тело запроса должно быть JSON.");
    }
    const result = await markGroupDailyAttendance(actor, groupId, body, request);
    return Response.json(result, {
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
