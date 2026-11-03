import { getPrisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/http/api-error";

export type ActorRateLimitScope =
  "file-upload-presign" | "file-upload-complete" | "admin-password-reset" | "password-change";

export async function enforceActorRateLimit(
  actorId: string,
  scope: ActorRateLimitScope,
  maxRequests: number,
  windowMs: number,
) {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) {
    throw new Error("Rate limit maxRequests must be a positive integer.");
  }
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error("Rate limit windowMs must be a positive integer.");
  }

  const now = BigInt(Date.now());
  const windowStart = now - BigInt(windowMs);
  const key = `lms:${scope}:${actorId}`;
  const rows = await getPrisma().$queryRaw<Array<{ count: number; lastRequest: bigint }>>`
    INSERT INTO rate_limits (id, "key", count, last_request)
    VALUES (gen_random_uuid(), ${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE
    SET count = CASE
          WHEN rate_limits.last_request <= ${windowStart} THEN 1
          ELSE LEAST(rate_limits.count + 1, ${maxRequests + 1})
        END,
        last_request = EXCLUDED.last_request
    RETURNING count, last_request AS "lastRequest"
  `;
  const result = rows[0];

  if (!result || result.count > maxRequests) {
    const lastRequest = Number(result?.lastRequest ?? now);
    const retryAfterSeconds = Math.max(1, Math.ceil((lastRequest + windowMs - Date.now()) / 1000));
    throw new ApiError(429, "RATE_LIMITED", "Слишком много запросов. Повторите позже.", {
      retryAfterSeconds,
    });
  }
}
