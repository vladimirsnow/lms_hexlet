import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/storage/s3";
import { getPrisma } from "@/lib/db/prisma";
import { getServerEnv } from "@/lib/env";
import { getRequestId } from "@/lib/http/request-id";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  const [database, storage] = await Promise.all([
    (async () => {
      try {
        await getPrisma().$queryRawUnsafe("SELECT 1");
        return "healthy" as const;
      } catch {
        return "unavailable" as const;
      }
    })(),
    (async () => {
      try {
        await getS3Client().send(new HeadBucketCommand({ Bucket: getServerEnv().MINIO_BUCKET }));
        return "healthy" as const;
      } catch {
        return "unavailable" as const;
      }
    })(),
  ]);

  const healthy = database === "healthy" && storage === "healthy";
  if (!healthy) {
    logger.error({ requestId, database, storage }, "Health check failed");
  }

  return Response.json(
    {
      status: healthy ? "ok" : "unavailable",
      checks: { database, storage },
      requestId,
    },
    {
      status: healthy ? 200 : 503,
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    },
  );
}
