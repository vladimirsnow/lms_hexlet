import { apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { requireActor } from "@/server/auth/session";
import { getLessonGradeHistory } from "@/server/services/lesson-grades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const query = new URL(request.url).searchParams;
    const result = await getLessonGradeHistory(actor, {
      groupId: query.get("groupId") || undefined,
      courseKey: query.get("courseKey") || undefined,
      studentId: query.get("studentId") || undefined,
      offset: Number(query.get("offset") || 0),
    });
    return Response.json(result, {
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
