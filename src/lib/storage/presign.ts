import { createHmac } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerEnv } from "@/lib/env";
import { getS3Client } from "@/lib/storage/s3";

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function signingKey(secret: string, date: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

export function createPresignedPost(input: {
  bucket: string;
  key: string;
  contentType: string;
  maxBytes: number;
  expiresSeconds?: number;
  now?: Date;
}): { url: string; fields: Record<string, string>; expiresAt: Date } {
  const env = getServerEnv();
  const endpoint = new URL(`${env.MINIO_USE_SSL ? "https" : "http"}://${env.MINIO_ENDPOINT}`);
  const now = input.now ?? new Date();
  const dateTime = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = dateTime.slice(0, 8);
  const expiresSeconds = input.expiresSeconds ?? 300;
  const scope = `${date}/${env.S3_REGION}/s3/aws4_request`;
  const credential = `${env.MINIO_ACCESS_KEY}/${scope}`;
  const expiration = new Date(now.getTime() + expiresSeconds * 1000).toISOString();
  const policy = {
    expiration,
    conditions: [
      { bucket: input.bucket },
      { key: input.key },
      { "Content-Type": input.contentType },
      { "x-amz-algorithm": "AWS4-HMAC-SHA256" },
      { "x-amz-credential": credential },
      { "x-amz-date": dateTime },
      ["content-length-range", 1, input.maxBytes],
    ],
  };
  const encodedPolicy = Buffer.from(JSON.stringify(policy), "utf8").toString("base64");
  const signature = createHmac("sha256", signingKey(env.MINIO_SECRET_KEY, date, env.S3_REGION))
    .update(encodedPolicy, "utf8")
    .digest("hex");
  const endpointPath = endpoint.pathname.replace(/\/$/, "");
  const url = `${endpoint.origin}${endpointPath}/${encodeURIComponent(input.bucket)}`;

  return {
    url,
    fields: {
      key: input.key,
      "Content-Type": input.contentType,
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": credential,
      "X-Amz-Date": dateTime,
      Policy: encodedPolicy,
      "X-Amz-Signature": signature,
    },
    expiresAt: new Date(now.getTime() + expiresSeconds * 1000),
  };
}

export async function createPresignedUpload(input: {
  bucket: string;
  key: string;
  contentType: string;
  maxBytes: number;
  expiresSeconds?: number;
  now?: Date;
}): Promise<{
  url: string;
  method: "POST" | "PUT";
  fields: Record<string, string>;
  headers: Record<string, string>;
  expiresAt: Date;
}> {
  const env = getServerEnv();
  if (env.STORAGE_UPLOAD_MODE === "put") {
    const expiresSeconds = input.expiresSeconds ?? 300;
    const url = await getSignedUrl(
      getS3Client(),
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ContentType: input.contentType,
      }),
      { expiresIn: expiresSeconds },
    );
    return {
      url,
      method: "PUT",
      fields: {},
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date((input.now ?? new Date()).getTime() + expiresSeconds * 1000),
    };
  }

  const post = createPresignedPost(input);
  return { ...post, method: "POST", headers: {} };
}
