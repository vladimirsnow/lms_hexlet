import { createHash, randomUUID } from "node:crypto";
import { posix as posixPath } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Prisma } from "../../../generated/prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { getServerEnv } from "@/lib/env";
import { ApiError } from "@/lib/http/api-error";
import { getS3Client } from "@/lib/storage/s3";
import { createPresignedUpload } from "@/lib/storage/presign";
import { assertCourseManageable } from "@/server/services/course-content";
import type { Actor } from "@/server/auth/session";

const allowedMimeTypes: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "text/plain": ["txt", "md"],
  "text/csv": ["csv"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "application/zip": ["zip"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
};

const uploadSchema = z
  .object({
    lessonId: z.uuid().optional(),
    submissionId: z.uuid().optional(),
    originalName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().toLowerCase().max(160),
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .refine((value) => Boolean(value.lessonId) !== Boolean(value.submissionId), {
    message: "Укажите ровно один родительский объект для файла.",
  });

type FileUploadScope = { lessonId?: string; submissionId?: string; courseId: string };

function safeFileName(value: string): string {
  const filename = posixPath
    .basename(value.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!filename || filename.length > 255)
    throw new ApiError(422, "INVALID_FILE_NAME", "Имя файла пустое или слишком длинное.");
  return filename;
}

function validateFileDescriptor(originalName: string, mimeType: string, sizeBytes: number) {
  const name = safeFileName(originalName);
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  const extensions = allowedMimeTypes[mimeType];
  if (!extensions || !extensions.includes(extension)) {
    throw new ApiError(
      415,
      "UNSUPPORTED_FILE_TYPE",
      "Разрешены PDF, DOCX, PPTX, XLSX, ZIP, TXT, CSV, PNG, JPEG и WebP.",
    );
  }
  const env = getServerEnv();
  const maxBytes = env.UPLOAD_MAX_MB * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    throw new ApiError(
      413,
      "FILE_TOO_LARGE",
      `Размер файла превышает лимит ${env.UPLOAD_MAX_MB} МБ.`,
    );
  }
  return { name, maxBytes };
}

function sniffFile(prefix: Buffer, mimeType: string): boolean {
  if (mimeType === "application/pdf") return prefix.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/png")
    return prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg")
    return prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  if (mimeType === "image/webp")
    return (
      prefix.subarray(0, 4).toString("ascii") === "RIFF" &&
      prefix.subarray(8, 12).toString("ascii") === "WEBP"
    );
  if (
    mimeType === "application/zip" ||
    mimeType.startsWith("application/vnd.openxmlformats-officedocument.")
  ) {
    return (
      prefix.length >= 4 &&
      prefix[0] === 0x50 &&
      prefix[1] === 0x4b &&
      [0x03, 0x05, 0x07].includes(prefix[2]) &&
      [0x04, 0x06, 0x08].includes(prefix[3])
    );
  }
  if (mimeType === "text/plain" || mimeType === "text/csv") {
    if (prefix.includes(0)) return false;
    for (const byte of prefix) {
      if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return false;
    }
    const sample = prefix.length > 4 ? prefix.subarray(0, prefix.length - 4) : prefix;
    return !new TextDecoder("utf-8", { fatal: false }).decode(sample).includes("\uFFFD");
  }
  return false;
}

async function auditFile(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: string,
  fileId: string,
  detail: Prisma.InputJsonValue,
  request: Request,
) {
  await tx.auditLog.create({
    data: {
      actorId: actor.id,
      action,
      entityType: "StoredFile",
      entityId: fileId,
      beforeJson: Prisma.JsonNull,
      afterJson: detail,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    },
  });
}

async function getManageableFileLesson(actor: Actor, lessonId: string): Promise<FileUploadScope> {
  const lesson = await getPrisma().lesson.findFirst({
    where: {
      id: lessonId,
      deletedAt: null,
      type: "FILE",
      section: { deletedAt: null, course: { deletedAt: null } },
    },
    select: { id: true, section: { select: { courseId: true } } },
  });
  if (!lesson) throw new ApiError(404, "LESSON_NOT_FOUND", "Файловый материал курса не найден.");
  await assertCourseManageable(actor, lesson.section.courseId);
  return { lessonId: lesson.id, courseId: lesson.section.courseId };
}

async function getSubmissionFileScope(
  actor: Actor,
  submissionId: string,
): Promise<FileUploadScope> {
  if (actor.role !== "STUDENT")
    throw new ApiError(403, "FORBIDDEN", "Прикреплять работу может только студент.");
  const submission = await getPrisma().submission.findFirst({
    where: {
      id: submissionId,
      studentId: actor.id,
      status: "DRAFT",
      assignment: {
        status: "PUBLISHED",
        deletedAt: null,
        course: {
          status: "PUBLISHED",
          deletedAt: null,
          enrollments: { some: { studentId: actor.id, status: "ACTIVE" } },
        },
      },
    },
    select: { id: true, assignment: { select: { courseId: true, type: true } } },
  });
  if (!submission) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "Черновик работы не найден.");
  if (submission.assignment.type === "TEXT")
    throw new ApiError(422, "FILE_NOT_ALLOWED", "Для этого задания загрузка файлов отключена.");
  return { submissionId: submission.id, courseId: submission.assignment.courseId };
}

export async function createFileUpload(actor: Actor, input: unknown, request: Request) {
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Проверьте имя, тип и размер файла.",
      parsed.error.flatten().fieldErrors,
    );
  const { name } = validateFileDescriptor(
    parsed.data.originalName,
    parsed.data.mimeType,
    parsed.data.sizeBytes,
  );
  const scope = parsed.data.lessonId
    ? await getManageableFileLesson(actor, parsed.data.lessonId)
    : await getSubmissionFileScope(actor, parsed.data.submissionId!);
  const env = getServerEnv();
  const fileId = randomUUID();
  const storageKey = `${scope.courseId}/${randomUUID()}`;
  const upload = await createPresignedUpload({
    bucket: env.MINIO_BUCKET,
    key: storageKey,
    contentType: parsed.data.mimeType,
    maxBytes: parsed.data.sizeBytes,
    expiresSeconds: 300,
  });
  const courseLimit = BigInt(Math.floor(env.COURSE_QUOTA_GB * 1024 * 1024 * 1024));
  const userLimit = BigInt(Math.floor(env.USER_QUOTA_GB * 1024 * 1024 * 1024));

  await getPrisma().$transaction(async (tx) => {
    const lockKeys = [`course:${scope.courseId}`, `user:${actor.id}`].sort();
    for (const lockKey of lockKeys) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`;
    }
    const [courseUsage, userUsage] = await Promise.all([
      tx.storedFile.aggregate({
        where: {
          deletedAt: null,
          uploadStatus: { in: ["PENDING", "READY"] },
          OR: [
            {
              lessonAttachments: {
                some: {
                  lesson: {
                    deletedAt: null,
                    section: { courseId: scope.courseId, deletedAt: null },
                  },
                },
              },
            },
            {
              submissionFiles: {
                some: { submission: { assignment: { courseId: scope.courseId } } },
              },
            },
          ],
        },
        _sum: { sizeBytes: true },
      }),
      tx.storedFile.aggregate({
        where: {
          uploadedById: actor.id,
          deletedAt: null,
          uploadStatus: { in: ["PENDING", "READY"] },
        },
        _sum: { sizeBytes: true },
      }),
    ]);
    const requested = BigInt(parsed.data.sizeBytes);
    if ((courseUsage._sum.sizeBytes ?? BigInt(0)) + requested > courseLimit) {
      throw new ApiError(413, "COURSE_QUOTA_EXCEEDED", "Для курса исчерпана квота файлов.");
    }
    if ((userUsage._sum.sizeBytes ?? BigInt(0)) + requested > userLimit) {
      throw new ApiError(
        413,
        "USER_QUOTA_EXCEEDED",
        "Для вашей учётной записи исчерпана квота файлов.",
      );
    }
    await tx.storedFile.create({
      data: {
        id: fileId,
        storageKey,
        bucket: env.MINIO_BUCKET,
        originalName: name,
        mimeType: parsed.data.mimeType,
        sizeBytes: requested,
        uploadedById: actor.id,
        visibility: "COURSE",
        uploadStatus: "PENDING",
        virusScanStatus: "NOT_SCANNED",
        lessonAttachments: scope.lessonId ? { create: { lessonId: scope.lessonId } } : undefined,
        submissionFiles: scope.submissionId
          ? { create: { submissionId: scope.submissionId } }
          : undefined,
      },
    });
    await auditFile(
      tx,
      actor,
      "file.upload.presigned",
      fileId,
      {
        lessonId: scope.lessonId,
        submissionId: scope.submissionId,
        sizeBytes: parsed.data.sizeBytes,
        mimeType: parsed.data.mimeType,
      },
      request,
    );
  });

  return {
    fileId,
    url: upload.url,
    method: upload.method,
    fields: upload.fields,
    headers: upload.headers,
    expiresAt: upload.expiresAt.toISOString(),
  };
}

async function rejectUpload(
  fileId: string,
  bucket: string,
  storageKey: string,
  reason: string,
  actor: Actor,
  request: Request,
) {
  await getS3Client()
    .send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }))
    .catch(() => undefined);
  await getPrisma().$transaction(async (tx) => {
    await tx.storedFile.update({ where: { id: fileId }, data: { uploadStatus: "REJECTED" } });
    await auditFile(tx, actor, "file.upload.rejected", fileId, { reason }, request);
  });
}

export async function completeFileUpload(actor: Actor, fileId: string, request: Request) {
  const file = await getPrisma().storedFile.findFirst({
    where: { id: fileId, deletedAt: null },
    include: {
      lessonAttachments: {
        include: { lesson: { include: { section: { select: { courseId: true } } } } },
      },
      submissionFiles: {
        include: { submission: { include: { assignment: { select: { courseId: true } } } } },
      },
    },
  });
  if (
    !file ||
    file.uploadedById !== actor.id ||
    file.lessonAttachments.length + file.submissionFiles.length !== 1
  ) {
    throw new ApiError(404, "FILE_NOT_FOUND", "Файл не найден.");
  }
  if (file.lessonAttachments.length) {
    const lesson = file.lessonAttachments[0]!.lesson;
    await assertCourseManageable(actor, lesson.section.courseId);
  } else {
    const submission = file.submissionFiles[0]!.submission;
    if (
      actor.role !== "STUDENT" ||
      submission.studentId !== actor.id ||
      submission.status !== "DRAFT"
    ) {
      throw new ApiError(404, "FILE_NOT_FOUND", "Файл не найден.");
    }
  }
  if (file.uploadStatus === "READY")
    return { id: file.id, status: file.uploadStatus, checksumSha256: file.checksumSha256 };
  if (file.uploadStatus !== "PENDING")
    throw new ApiError(409, "UPLOAD_NOT_PENDING", "Загрузка уже закрыта.");

  const storage = getS3Client();
  const head = await storage
    .send(new HeadObjectCommand({ Bucket: file.bucket, Key: file.storageKey }))
    .catch(() => undefined);
  if (!head) throw new ApiError(409, "UPLOAD_NOT_FOUND", "Файл ещё не загружен в хранилище.");
  if (head.ContentLength !== Number(file.sizeBytes) || head.ContentType !== file.mimeType) {
    await rejectUpload(
      file.id,
      file.bucket,
      file.storageKey,
      "SIZE_OR_TYPE_MISMATCH",
      actor,
      request,
    );
    throw new ApiError(
      422,
      "FILE_METADATA_MISMATCH",
      "Загруженный файл не совпадает с указанным размером или типом.",
    );
  }

  const object = await storage.send(
    new GetObjectCommand({ Bucket: file.bucket, Key: file.storageKey }),
  );
  if (!object.Body)
    throw new ApiError(502, "STORAGE_READ_FAILED", "Не удалось проверить загруженный файл.");
  const hash = createHash("sha256");
  let byteCount = 0;
  let prefix = Buffer.alloc(0);
  for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteCount += bytes.length;
    hash.update(bytes);
    if (prefix.length < 8192)
      prefix = Buffer.concat([prefix, bytes.subarray(0, 8192 - prefix.length)]);
  }
  if (byteCount !== Number(file.sizeBytes) || !sniffFile(prefix, file.mimeType)) {
    await rejectUpload(
      file.id,
      file.bucket,
      file.storageKey,
      "FILE_SIGNATURE_MISMATCH",
      actor,
      request,
    );
    throw new ApiError(
      415,
      "FILE_SIGNATURE_MISMATCH",
      "Содержимое файла не соответствует его типу.",
    );
  }

  const checksumSha256 = hash.digest("hex");
  const virusScanStatus = getServerEnv().FILE_SCAN_REQUIRED ? "PENDING" : "NOT_SCANNED";
  await getPrisma().$transaction(async (tx) => {
    const completed = await tx.storedFile.updateMany({
      where: { id: file.id, uploadStatus: "PENDING", deletedAt: null },
      data: { uploadStatus: "READY", checksumSha256, virusScanStatus },
    });
    if (!completed.count) {
      throw new ApiError(
        409,
        "UPLOAD_EXPIRED",
        "Срок незавершённой загрузки истёк. Загрузите файл ещё раз.",
      );
    }
    await auditFile(
      tx,
      actor,
      "file.upload.completed",
      file.id,
      { sizeBytes: byteCount, checksumSha256, virusScanStatus },
      request,
    );
  });
  return { id: file.id, status: "READY", checksumSha256, virusScanStatus };
}

function encodeDispositionName(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export async function downloadCourseFile(actor: Actor, fileId: string) {
  const now = new Date();
  const student = actor.role === "STUDENT";
  const teacher = actor.role === "TEACHER";
  const file = await getPrisma().storedFile.findFirst({
    where: {
      id: fileId,
      deletedAt: null,
      uploadStatus: "READY",
      OR: [
        {
          lessonAttachments: {
            some: {
              lesson: {
                deletedAt: null,
                ...(student ? { isPublished: true, ...dateAvailableWhere(now) } : {}),
                section: {
                  deletedAt: null,
                  ...(student ? { isPublished: true, ...dateAvailableWhere(now) } : {}),
                  course: {
                    deletedAt: null,
                    ...(student
                      ? {
                          status: "PUBLISHED",
                          enrollments: { some: { studentId: actor.id, status: "ACTIVE" } },
                        }
                      : teacher
                        ? {
                            status: { not: "ARCHIVED" },
                            teacherAssignments: { some: { teacherId: actor.id } },
                          }
                        : {}),
                  },
                },
              },
            },
          },
        },
        {
          submissionFiles: {
            some: {
              submission: {
                ...(student ? { studentId: actor.id } : {}),
                assignment: {
                  deletedAt: null,
                  course: {
                    deletedAt: null,
                    ...(student
                      ? {
                          status: "PUBLISHED",
                          enrollments: { some: { studentId: actor.id, status: "ACTIVE" } },
                        }
                      : teacher
                        ? {
                            status: { not: "ARCHIVED" },
                            teacherAssignments: { some: { teacherId: actor.id } },
                          }
                        : {}),
                  },
                },
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      storageKey: true,
      bucket: true,
      originalName: true,
      mimeType: true,
      virusScanStatus: true,
    },
  });
  if (!file) throw new ApiError(404, "FILE_NOT_FOUND", "Файл не найден.");
  const env = getServerEnv();
  if (
    file.virusScanStatus === "INFECTED" ||
    (env.FILE_SCAN_REQUIRED && file.virusScanStatus !== "CLEAN")
  ) {
    throw new ApiError(
      423,
      "FILE_QUARANTINED",
      "Файл временно недоступен до завершения проверки безопасности.",
    );
  }
  const object = await getS3Client().send(
    new GetObjectCommand({ Bucket: file.bucket, Key: file.storageKey }),
  );
  if (!object.Body) throw new ApiError(404, "FILE_NOT_FOUND", "Файл не найден в хранилище.");
  const body = object.Body.transformToWebStream();
  const fallbackName = file.originalName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeDispositionName(file.originalName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function dateAvailableWhere(now: Date) {
  return {
    AND: [
      { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
      { OR: [{ availableUntil: null }, { availableUntil: { gte: now } }] },
    ],
  };
}
