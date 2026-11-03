import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.string().url().default("http://127.0.0.1:3000"),
    SEO_INDEXING_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://")),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    MINIO_ENDPOINT: z.string().min(1),
    MINIO_ACCESS_KEY: z.string().min(1),
    MINIO_SECRET_KEY: z.string().min(1),
    MINIO_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    MINIO_USE_SSL: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    S3_REGION: z.string().trim().min(1).default("us-east-1"),
    STORAGE_UPLOAD_MODE: z.enum(["post", "put"]).default("post"),
    AUTH_SECRET: z.string().min(32),
    UPLOAD_MAX_MB: z.coerce.number().int().positive().max(1024).default(100),
    COURSE_QUOTA_GB: z.coerce.number().positive().max(1024).default(5),
    USER_QUOTA_GB: z.coerce.number().positive().max(1024).default(1),
    FILE_SCAN_REQUIRED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    COURSE_LINK_ALLOWED_HOSTS: z
      .string()
      .default("youtube.com,www.youtube.com,youtu.be,vimeo.com,player.vimeo.com"),
    SMTP_HOST: z.string().trim().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().trim().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().trim().optional(),
    SMTP_REQUIRE_TLS: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  })
  .superRefine((value, context) => {
    const hasHost = Boolean(value.SMTP_HOST);
    const hasFrom = Boolean(value.SMTP_FROM);
    const hasUser = Boolean(value.SMTP_USER);
    const hasPassword = Boolean(value.SMTP_PASSWORD);

    if (hasHost !== hasFrom) {
      context.addIssue({
        code: "custom",
        message: "SMTP_HOST and SMTP_FROM must be configured together.",
        path: [hasHost ? "SMTP_FROM" : "SMTP_HOST"],
      });
    }
    if (hasUser !== hasPassword) {
      context.addIssue({
        code: "custom",
        message: "SMTP_USER and SMTP_PASSWORD must be configured together.",
        path: [hasUser ? "SMTP_PASSWORD" : "SMTP_USER"],
      });
    }
    if ((hasUser || hasPassword) && !hasHost) {
      context.addIssue({
        code: "custom",
        message: "SMTP credentials require SMTP_HOST and SMTP_FROM.",
        path: ["SMTP_HOST"],
      });
    }
  });

export type ServerEnv = z.infer<typeof envSchema>;
let parsedEnv: ServerEnv | undefined;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const appUrl = source.APP_URL ?? (source.VERCEL_URL ? `https://${source.VERCEL_URL}` : undefined);
  return envSchema.parse({
    ...source,
    APP_URL: appUrl,
    MINIO_ENDPOINT: source.S3_ENDPOINT ?? source.MINIO_ENDPOINT,
    MINIO_ACCESS_KEY: source.S3_ACCESS_KEY ?? source.MINIO_ACCESS_KEY,
    MINIO_SECRET_KEY: source.S3_SECRET_KEY ?? source.MINIO_SECRET_KEY,
    MINIO_BUCKET: source.S3_BUCKET ?? source.MINIO_BUCKET,
    MINIO_USE_SSL: source.S3_USE_SSL ?? source.MINIO_USE_SSL,
  });
}

export function getServerEnv(): ServerEnv {
  parsedEnv ??= parseServerEnv(process.env);
  return parsedEnv;
}
