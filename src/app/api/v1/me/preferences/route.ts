import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getPrisma } from "@/lib/db/prisma";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const preferencesSchema = z.object({ locale: z.enum(["ru", "kk", "en"]) });

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    const input = preferencesSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) {
      throw new ApiError(422, "VALIDATION_ERROR", "Выберите поддерживаемый язык интерфейса.");
    }

    await getPrisma().$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: actor.id, deletedAt: null, status: "ACTIVE" },
        select: { locale: true },
      });
      if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Учётная запись не найдена.");
      if (user.locale === input.data.locale) return;

      await tx.user.update({ where: { id: actor.id }, data: { locale: input.data.locale } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "user.locale.updated",
          entityType: "User",
          entityId: actor.id,
          beforeJson: { locale: user.locale },
          afterJson: { locale: input.data.locale },
          ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
          userAgent: request.headers.get("user-agent"),
        },
      });
    });

    return Response.json(
      { locale: input.data.locale },
      {
        headers: {
          "X-Request-ID": requestId,
          "Cache-Control": "no-store",
          "Set-Cookie": `lms_locale=${input.data.locale}; Path=/; Max-Age=31536000; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        },
      },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
