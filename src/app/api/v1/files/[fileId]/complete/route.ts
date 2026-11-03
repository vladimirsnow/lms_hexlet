import { apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { enforceActorRateLimit } from "@/server/auth/rate-limit";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import { completeFileUpload } from "@/server/services/files";
import { parseCourseContentId } from "@/server/services/course-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ fileId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    await enforceActorRateLimit(actor.id, "file-upload-complete", 60, 60_000);
    const { fileId: value } = await context.params;
    const result = await completeFileUpload(actor, parseCourseContentId(value), request);
    return Response.json(
      { file: result },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
