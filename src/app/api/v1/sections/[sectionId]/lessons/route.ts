import { ApiError, apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import {
  createLesson,
  listSectionLessons,
  parseCourseContentId,
} from "@/server/services/course-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sectionId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const { sectionId: value } = await context.params;
    const lessons = await listSectionLessons(actor, parseCourseContentId(value));
    const safeLessons = JSON.parse(
      JSON.stringify(lessons, (_key, item) => (typeof item === "bigint" ? item.toString() : item)),
    );
    return Response.json(
      { lessons: safeLessons },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    const { sectionId: value } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Тело запроса должно быть JSON.");
    }
    const lesson = await createLesson(actor, parseCourseContentId(value), body, request);
    return Response.json(
      { lesson },
      { status: 201, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
