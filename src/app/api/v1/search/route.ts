import { z } from "zod";
import { apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { requireActor } from "@/server/auth/session";
import { searchLearningContent } from "@/server/services/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.string().trim().min(2).max(80);

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const parsed = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
    if (!parsed.success) {
      return Response.json(
        { items: [], requestId },
        { status: 200, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
      );
    }

    const items = await searchLearningContent(actor, parsed.data);
    return Response.json(items, {
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
