import { apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import { parseAssignmentId, submitDraft } from "@/server/services/assignments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ submissionId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    const { submissionId } = await context.params;
    const submission = await submitDraft(actor, parseAssignmentId(submissionId), request);
    return Response.json(
      { submission },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
