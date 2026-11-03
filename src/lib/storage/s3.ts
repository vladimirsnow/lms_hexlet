import { S3Client } from "@aws-sdk/client-s3";
import { getServerEnv } from "@/lib/env";

let client: S3Client | undefined;

export function getS3Client(): S3Client {
  if (client) return client;

  const env = getServerEnv();
  const protocol = env.MINIO_USE_SSL ? "https" : "http";
  const endpoint = new URL(protocol + "://" + env.MINIO_ENDPOINT);
  client = new S3Client({
    endpoint: endpoint.toString(),
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.MINIO_ACCESS_KEY,
      secretAccessKey: env.MINIO_SECRET_KEY,
    },
  });

  return client;
}
