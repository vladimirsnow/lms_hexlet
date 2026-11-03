import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import { copyCourse } from "@/server/services/course-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ courseId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    const { courseId } = await context.params;
    if (!z.uuid().safeParse(courseId).success) {
      throw new ApiError(404, "COURSE_NOT_FOUND", "Курс не найден.");
    }
    const result = await copyCourse(actor, courseId, request);
    return Response.json(result, {
      status: 201,
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
