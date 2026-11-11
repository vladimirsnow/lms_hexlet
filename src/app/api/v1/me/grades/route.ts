import { apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { requireActor } from "@/server/auth/session";
import { getMyGrades } from "@/server/services/assignments";
import { getMyLessonGrades } from "@/server/services/lesson-grades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const [grades, lessonGrades] = await Promise.all([
      getMyGrades(actor),
      getMyLessonGrades(actor),
    ]);
    return Response.json(
      { grades, lessonGrades },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
