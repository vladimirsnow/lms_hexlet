import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor, requireAdminRole } from "@/server/auth/session";
import {
  deactivateAcademicRecord,
  parseAcademicResource,
  updateAcademicRecord,
} from "@/server/services/academic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ resource: string; id: string }> };

async function getParams(context: RouteContext) {
  const params = await context.params;
  if (!z.uuid().safeParse(params.id).success) {
    throw new ApiError(404, "RECORD_NOT_FOUND", "Запись не найдена.");
  }
  return { resource: parseAcademicResource(params.resource), id: params.id };
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const { resource, id } = await getParams(context);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Тело запроса должно быть JSON.");
    }
    const item = await updateAcademicRecord(actor, resource, id, body, request);
    return Response.json(
      { item },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const { resource, id } = await getParams(context);
    const item = await deactivateAcademicRecord(actor, resource, id, request);
    return Response.json(
      { item },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
