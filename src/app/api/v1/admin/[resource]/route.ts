import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor, requireAdminRole } from "@/server/auth/session";
import {
  createAcademicRecord,
  listAcademicRecords,
  parseAcademicResource,
} from "@/server/services/academic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ resource: string }> };

const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  academicYearId: z.uuid().optional(),
  specialtyId: z.uuid().optional(),
  category: z.enum(["OOD", "OOM", "PM", "SPECIALTY", "COHORT"]).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
});

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const { resource: resourceParam } = await context.params;
    const resource = parseAcademicResource(resourceParam);
    const parsed = listSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Проверьте параметры поиска.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const result = await listAcademicRecords(resource, parsed.data);
    return Response.json(
      { ...result, page: parsed.data.page, perPage: parsed.data.perPage },
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
    requireAdminRole(actor.role);
    const { resource: resourceParam } = await context.params;
    const resource = parseAcademicResource(resourceParam);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Тело запроса должно быть JSON.");
    }
    const item = await createAcademicRecord(actor, resource, body, request);
    return Response.json(
      { item },
      { status: 201, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
