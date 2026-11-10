import { z } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import {
  getPlannerData,
  previewPlanner,
  publishPlanner,
  savePlanner,
  syncImportedCourses,
} from "@/server/services/schedule-planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const termId = new URL(request.url).searchParams.get("termId") ?? undefined;
    if (termId && !z.uuid().safeParse(termId).success)
      throw new ApiError(422, "INVALID_TERM", "Неверный идентификатор семестра.");
    return Response.json(await getPlannerData(actor, termId), {
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Тело запроса должно быть JSON.");
    }
    const parsed = z
      .object({
        action: z.enum(["sync", "preview", "save", "publish"]),
        termId: z.uuid().optional(),
        config: z.unknown().optional(),
      })
      .safeParse(body);
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Проверьте запрос.");
    let result: unknown;
    if (parsed.data.action === "sync") {
      if (!parsed.data.termId) throw new ApiError(422, "TERM_REQUIRED", "Выберите семестр.");
      result = await syncImportedCourses(actor, parsed.data.termId, request);
    } else {
      if (!parsed.data.config)
        throw new ApiError(422, "PLAN_REQUIRED", "Укажите настройки расписания.");
      result =
        parsed.data.action === "preview"
          ? await previewPlanner(actor, parsed.data.config)
          : parsed.data.action === "save"
            ? await savePlanner(actor, parsed.data.config, request)
            : await publishPlanner(actor, parsed.data.config, request);
    }
    return Response.json(
      { result },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
