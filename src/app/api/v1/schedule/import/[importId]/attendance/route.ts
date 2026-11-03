import { ApiError, apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import {
  getImportedScheduleAttendance,
  markImportedScheduleAttendance,
} from "@/server/services/schedule-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ importId: string }> };

function parseImportId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(404, "SCHEDULE_IMPORT_NOT_FOUND", "Импорт расписания не найден.");
  }
  return value;
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const { importId: rawImportId } = await context.params;
    const importId = parseImportId(rawImportId);
    const url = new URL(request.url);
    const item = await getImportedScheduleAttendance(actor, importId, {
      entryIndex: url.searchParams.get("entryIndex"),
      date: url.searchParams.get("date"),
    });
    return Response.json(item, {
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
    const { importId: rawImportId } = await context.params;
    const importId = parseImportId(rawImportId);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Тело запроса должно быть JSON.");
    }
    const result = await markImportedScheduleAttendance(actor, importId, body, request);
    return Response.json(result, {
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
