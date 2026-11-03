import { apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { requireActor } from "@/server/auth/session";
import { getMyAttendance } from "@/server/services/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const report = await getMyAttendance(
      actor,
      url.searchParams.get("from"),
      url.searchParams.get("to"),
    );
    return Response.json(report, {
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
