import { z } from "zod";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { getPrisma } from "@/lib/db/prisma";
import { ApiError, apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { enforceActorRateLimit } from "@/server/auth/rate-limit";
import { assertSameOrigin, requireActor } from "@/server/auth/session";

export const runtime = "nodejs";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(12).max(128),
    confirmPassword: z.string().min(12).max(128),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Пароли не совпадают.",
  });

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers, { allowFirstLogin: true });
    await enforceActorRateLimit(actor.id, "password-change", 5, 60_000);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Тело запроса должно быть JSON.");
    }

    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Проверьте новый пароль.",
        parsed.error.flatten().fieldErrors,
      );
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      throw new ApiError(422, "PASSWORD_UNCHANGED", "Новый пароль должен отличаться от текущего.");
    }

    const prisma = getPrisma();
    const account = await prisma.account.findFirst({
      where: { userId: actor.id, providerId: "credential", accountId: actor.id },
      select: { id: true, password: true },
    });
    if (
      !account?.password ||
      !(await verifyPassword(account.password, parsed.data.currentPassword))
    ) {
      throw new ApiError(400, "CURRENT_PASSWORD_INVALID", "Текущий пароль указан неверно.");
    }

    const password = await hashPassword(parsed.data.newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id: account.id }, data: { password } });
      await tx.user.update({
        where: { id: actor.id },
        data: { mustChangePassword: false, passwordChangedAt: new Date() },
      });
      await tx.session.deleteMany({ where: { userId: actor.id } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "user.password_changed",
          entityType: "user",
          entityId: actor.id,
          beforeJson: { mustChangePassword: actor.mustChangePassword },
          afterJson: { mustChangePassword: false, sessionsRevoked: true },
          userAgent: request.headers.get("user-agent")?.slice(0, 1000) || undefined,
        },
      });
    });

    return Response.json(
      { changed: true, sessionsRevoked: true },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
