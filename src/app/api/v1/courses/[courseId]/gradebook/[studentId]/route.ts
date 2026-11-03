import { ApiError, apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import { parseAssignmentId, setFinalGrade } from "@/server/services/assignments";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ courseId: string; studentId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    const { courseId: courseValue, studentId: studentValue } = await context.params;
    const courseId = parseAssignmentId(courseValue);
    const studentId = z.uuid().parse(studentValue);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Тело запроса должно быть JSON.");
    }
    const grade = await setFinalGrade(actor, courseId, studentId, body, request);
    return Response.json(
      { grade },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
