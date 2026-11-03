import "dotenv/config";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

const endpoint = process.env.MINIO_ENDPOINT;
const accessKeyId = process.env.MINIO_ACCESS_KEY;
const secretAccessKey = process.env.MINIO_SECRET_KEY;
const bucket = process.env.MINIO_BUCKET;
const appUrl = process.env.APP_URL;
const storageProvider = process.env.LOCAL_OBJECT_STORAGE_PROVIDER ?? "minio-community";

if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !appUrl) {
  throw new Error("Set the S3-compatible storage and APP_URL settings in .env.");
}
if (!new Set(["minio-community", "rustfs"]).has(storageProvider)) {
  throw new Error("LOCAL_OBJECT_STORAGE_PROVIDER must be minio-community or rustfs.");
}

function createClient(credentials) {
  return new S3Client({
    endpoint: `http://${endpoint}`,
    region: "us-east-1",
    forcePathStyle: true,
    credentials,
  });
}

const client = createClient({ accessKeyId, secretAccessKey });
const rootAccessKey = process.env.MINIO_ROOT_USER;
const rootSecretKey = process.env.MINIO_ROOT_PASSWORD;
if (storageProvider === "minio-community" && (!rootAccessKey || !rootSecretKey)) {
  throw new Error("MinIO Community provisioning requires MINIO_ROOT_USER and MINIO_ROOT_PASSWORD.");
}
const adminClient =
  storageProvider === "minio-community"
    ? createClient({ accessKeyId: rootAccessKey, secretAccessKey: rootSecretKey })
    : client;
const allowedOrigins = (process.env.MINIO_API_CORS_ALLOW_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
if (
  storageProvider === "minio-community" &&
  !allowedOrigins.includes("*") &&
  !allowedOrigins.includes(new URL(appUrl).origin)
) {
  throw new Error(
    "MINIO_API_CORS_ALLOW_ORIGIN must include the APP_URL origin for browser uploads.",
  );
}

let bucketExists = true;
try {
  await adminClient.send(new HeadBucketCommand({ Bucket: bucket }));
} catch (error) {
  const statusCode = error?.$metadata?.httpStatusCode;
  if (statusCode !== 404 && error?.name !== "NotFound" && error?.name !== "NoSuchBucket") {
    throw error;
  }
  bucketExists = false;
}

if (!bucketExists) await adminClient.send(new CreateBucketCommand({ Bucket: bucket }));

if (storageProvider === "rustfs") {
  await adminClient.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [new URL(appUrl).origin],
            AllowedMethods: ["GET", "HEAD", "POST", "PUT"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 300,
          },
        ],
      },
    }),
  );
} else {
  console.info(
    "MinIO Community CORS is configured globally on the server; bucket-level CORS is not available.",
  );
}

const key = `healthcheck/${randomUUID()}.txt`;
const expectedBody = "kzhexly local object storage check";
try {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: expectedBody,
      ContentType: "text/plain",
    }),
  );
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const actualBody = await object.Body?.transformToString();
  if (actualBody !== expectedBody) throw new Error("S3-compatible object read-back did not match.");
  const corsMode =
    storageProvider === "minio-community"
      ? "global CORS is configured"
      : "bucket CORS is configured";
  console.info(`Bucket ${bucket} is private, ${corsMode}, and app-user object PUT/GET succeeded.`);
} finally {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
}
