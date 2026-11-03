import { apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import {
  createCourseSection,
  listCourseSections,
  parseCourseContentId,
} from "@/server/services/course-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ courseId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const { courseId: value } = await context.params;
    const sections = await listCourseSections(actor, parseCourseContentId(value));
    const safeSections = JSON.parse(
      JSON.stringify(sections, (_key, item) => (typeof item === "bigint" ? item.toString() : item)),
    );
    return Response.json(
      { sections: safeSections },
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
    const { courseId: value } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new Error("INVALID_JSON");
    }
    const section = await createCourseSection(actor, parseCourseContentId(value), body, request);
    return Response.json(
      { section },
      { status: 201, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_JSON") {
      return Response.json(
        { error: { code: "INVALID_JSON", message: "Тело запроса должно быть JSON." } },
        { status: 400, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
      );
    }
    return apiErrorResponse(error, requestId);
  }
}
