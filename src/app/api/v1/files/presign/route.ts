import { ApiError, apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { enforceActorRateLimit } from "@/server/auth/rate-limit";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import { createFileUpload } from "@/server/services/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    await enforceActorRateLimit(actor.id, "file-upload-presign", 30, 60_000);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Тело запроса должно быть JSON.");
    }
    const upload = await createFileUpload(actor, body, request);
    return Response.json(
      { upload },
      { status: 201, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
