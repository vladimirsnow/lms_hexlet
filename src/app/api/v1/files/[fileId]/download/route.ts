import { apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { requireActor } from "@/server/auth/session";
import { downloadCourseFile } from "@/server/services/files";
import { parseCourseContentId } from "@/server/services/course-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ fileId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const { fileId: value } = await context.params;
    const response = await downloadCourseFile(actor, parseCourseContentId(value));
    const headers = new Headers(response.headers);
    headers.set("X-Request-ID", requestId);
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
