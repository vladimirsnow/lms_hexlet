import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { requireActor, requireAdminRole } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  action: z.string().trim().max(80).optional(),
});

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Проверьте параметры журнала аудита.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const { page, perPage, action } = parsed.data;
    const prisma = getPrisma();
    const where = action ? { action } : {};
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return Response.json(
      { items, page, perPage, total },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
