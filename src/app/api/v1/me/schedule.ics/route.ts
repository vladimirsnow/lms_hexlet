import { getRequestId } from "@/lib/http/request-id";
import { apiErrorResponse } from "@/lib/http/api-error";
import { requireActor } from "@/server/auth/session";
import { exportScheduleIcs } from "@/server/services/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const calendar = await exportScheduleIcs(actor);
    return new Response(calendar, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": "attachment; filename=college-schedule.ics",
        "Cache-Control": "no-store",
        "X-Request-ID": requestId,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
