import { afterEach, describe, expect, it, vi } from "vitest";

describe("presigned storage uploads", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadPresign(mode: "post" | "put") {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/lms");
    vi.stubEnv("S3_ENDPOINT", "example.storage.supabase.co/storage/v1/s3");
    vi.stubEnv("S3_ACCESS_KEY", "server-access-key");
    vi.stubEnv("S3_SECRET_KEY", "server-secret-key");
    vi.stubEnv("S3_BUCKET", "lms-private");
    vi.stubEnv("S3_USE_SSL", "true");
    vi.stubEnv("S3_REGION", "eu-west-2");
    vi.stubEnv("STORAGE_UPLOAD_MODE", mode);
    vi.stubEnv("AUTH_SECRET", "test-secret-with-more-than-thirty-two-characters");
    vi.resetModules();
    return import("./presign");
  }

  const input = {
    bucket: "lms-private",
    key: "course-id/file-id",
    contentType: "application/pdf",
    maxBytes: 1024,
    expiresSeconds: 300,
    now: new Date("2026-11-03T00:00:00.000Z"),
  };

  it("creates a signed PUT for Supabase and signs with its configured region", async () => {
    const { createPresignedUpload } = await loadPresign("put");
    const upload = await createPresignedUpload(input);
    const url = new URL(upload.url);

    expect(upload.method).toBe("PUT");
    expect(upload.fields).toEqual({});
    expect(upload.headers).toEqual({ "Content-Type": "application/pdf" });
    expect(url.hostname).toBe("example.storage.supabase.co");
    expect(url.pathname).toBe("/storage/v1/s3/lms-private/course-id/file-id");
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/eu-west-2/s3/aws4_request");
  });

  it("keeps the current signed POST behavior for local S3 storage", async () => {
    const { createPresignedUpload } = await loadPresign("post");
    const upload = await createPresignedUpload(input);
    const policy = JSON.parse(Buffer.from(upload.fields.Policy, "base64").toString("utf8"));

    expect(upload.method).toBe("POST");
    expect(upload.fields["X-Amz-Credential"]).toContain("/eu-west-2/s3/aws4_request");
    expect(policy.conditions).toContainEqual(["content-length-range", 1, 1024]);
  });
});
