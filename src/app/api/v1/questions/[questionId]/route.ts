import { apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import { deleteTestQuestion, parseQuestionId } from "@/server/services/quizzes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ questionId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    const { questionId } = await context.params;
    const result = await deleteTestQuestion(actor, parseQuestionId(questionId), request);
    return Response.json(result, {
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
