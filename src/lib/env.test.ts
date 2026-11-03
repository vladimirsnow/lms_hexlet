import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const requiredValues: Record<string, string | undefined> = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://user:password@localhost:5432/lms",
  MINIO_ENDPOINT: "localhost:9000",
  MINIO_ACCESS_KEY: "local-access",
  MINIO_SECRET_KEY: "local-secret",
  MINIO_BUCKET: "lms-private",
  AUTH_SECRET: "development-secret-with-at-least-32-characters",
};

describe("server environment", () => {
  it("applies development defaults and parses boolean settings", () => {
    const env = parseServerEnv({ ...requiredValues, MINIO_USE_SSL: "true" });

    expect(env.NODE_ENV).toBe("development");
    expect(env.MINIO_USE_SSL).toBe(true);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("uses Vercel's deployment hostname when APP_URL is not set", () => {
    const env = parseServerEnv({
      ...requiredValues,
      APP_URL: undefined,
      VERCEL_ENV: "preview",
      VERCEL_URL: "kzhexly-preview.vercel.app",
    });

    expect(env.APP_URL).toBe("https://kzhexly-preview.vercel.app");
  });

  it("uses Vercel's stable project domain for production", () => {
    const env = parseServerEnv({
      ...requiredValues,
      APP_URL: undefined,
      VERCEL_ENV: "production",
      VERCEL_URL: "deployment-123.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "kzhexly-college.vercel.app",
    });

    expect(env.APP_URL).toBe("https://kzhexly-college.vercel.app");
  });

  it("rejects missing required secrets and service settings", () => {
    expect(() => parseServerEnv({})).toThrow();
  });

  it("rejects an unsupported database protocol or invalid bucket name", () => {
    expect(() =>
      parseServerEnv({ ...requiredValues, DATABASE_URL: "https://example.test/database" }),
    ).toThrow();
    expect(() => parseServerEnv({ ...requiredValues, MINIO_BUCKET: "not/a/bucket" })).toThrow();
  });

  it("accepts generic S3 settings for a managed object-storage service", () => {
    const env = parseServerEnv({
      ...requiredValues,
      MINIO_ENDPOINT: undefined,
      MINIO_ACCESS_KEY: undefined,
      MINIO_SECRET_KEY: undefined,
      MINIO_BUCKET: undefined,
      S3_ENDPOINT: "example.storage.supabase.co/storage/v1/s3",
      S3_ACCESS_KEY: "server-access-key",
      S3_SECRET_KEY: "server-secret-key",
      S3_BUCKET: "lms-private",
      S3_USE_SSL: "true",
      S3_REGION: "eu-west-2",
      STORAGE_UPLOAD_MODE: "put",
      DATABASE_POOL_MAX: "1",
    });

    expect(env.MINIO_ENDPOINT).toBe("example.storage.supabase.co/storage/v1/s3");
    expect(env.MINIO_ACCESS_KEY).toBe("server-access-key");
    expect(env.MINIO_BUCKET).toBe("lms-private");
    expect(env.MINIO_USE_SSL).toBe(true);
    expect(env.S3_REGION).toBe("eu-west-2");
    expect(env.STORAGE_UPLOAD_MODE).toBe("put");
    expect(env.DATABASE_POOL_MAX).toBe(1);
  });
});
