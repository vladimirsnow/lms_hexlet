import { Prisma } from "../../../generated/prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { getServerEnv } from "@/lib/env";
import { ApiError } from "@/lib/http/api-error";
import { hasRichTextContent, sanitizeRichText } from "@/lib/security/sanitize-html";
import type { Actor } from "@/server/auth/session";

const dateTime = z.iso.datetime({ offset: true }).nullable().optional();
const availabilityFields = {
  availableFrom: dateTime,
  availableUntil: dateTime,
};

const sectionCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(1000).nullable().optional(),
    position: z.coerce.number().int().min(0).max(10000).optional(),
    isPublished: z.boolean().default(false),
    ...availabilityFields,
  })
  .refine(
    (value) =>
      !value.availableFrom ||
      !value.availableUntil ||
      Date.parse(value.availableUntil) >= Date.parse(value.availableFrom),
    { path: ["availableUntil"], message: "Дата окончания должна быть позже даты начала." },
  );

const sectionUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().trim().max(1000).nullable().optional(),
    position: z.coerce.number().int().min(0).max(10000).optional(),
    isPublished: z.boolean().optional(),
    ...availabilityFields,
  })
  .refine(
    (value) =>
      !value.availableFrom ||
      !value.availableUntil ||
      Date.parse(value.availableUntil) >= Date.parse(value.availableFrom),
    { path: ["availableUntil"], message: "Дата окончания должна быть позже даты начала." },
  );

const lessonFields = {
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().max(50000).nullable().optional(),
  externalUrl: z.string().trim().url().max(2000).nullable().optional(),
  position: z.coerce.number().int().min(0).max(10000).optional(),
  isPublished: z.boolean().default(false),
  ...availabilityFields,
};

const lessonCreateSchema = z
  .object({ type: z.enum(["TEXT", "FILE", "LINK", "VIDEO"]), ...lessonFields })
  .refine(
    (value) => (value.type === "LINK" || value.type === "VIDEO") === Boolean(value.externalUrl),
    {
      path: ["externalUrl"],
      message: "Для ссылки или видео укажите адрес; для других типов он не нужен.",
    },
  )
  .refine((value) => value.type !== "TEXT" || Boolean(value.content?.trim()), {
    path: ["content"],
    message: "Для текстового материала добавьте текст.",
  })
  .refine(
    (value) =>
      !value.availableFrom ||
      !value.availableUntil ||
      Date.parse(value.availableUntil) >= Date.parse(value.availableFrom),
    { path: ["availableUntil"], message: "Дата окончания должна быть позже даты начала." },
  );

const lessonUpdateSchema = z
  .object({
    title: lessonFields.title.optional(),
    content: lessonFields.content,
    externalUrl: lessonFields.externalUrl,
    position: lessonFields.position,
    isPublished: z.boolean().optional(),
    ...availabilityFields,
  })
  .refine(
    (value) =>
      !value.availableFrom ||
      !value.availableUntil ||
      Date.parse(value.availableUntil) >= Date.parse(value.availableFrom),
    { path: ["availableUntil"], message: "Дата окончания должна быть позже даты начала." },
  );

function parseBody<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Проверьте поля формы.",
      parsed.error.flatten().fieldErrors,
    );
  }
  return parsed.data;
}

function parseOptionalDate(value: string | null | undefined): Date | null | undefined {
  return value === undefined ? undefined : value === null ? null : new Date(value);
}

function availabilityWhere(now: Date) {
  return {
    AND: [
      { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
      { OR: [{ availableUntil: null }, { availableUntil: { gte: now } }] },
    ],
  };
}

export async function assertCourseReadable(actor: Actor, courseId: string) {
  const access: Prisma.CourseWhereInput =
    actor.role === "STUDENT"
      ? { status: "PUBLISHED", enrollments: { some: { studentId: actor.id, status: "ACTIVE" } } }
      : actor.role === "TEACHER"
        ? {
            status: { not: "ARCHIVED" },
            OR: [
              { teacherAssignments: { some: { teacherId: actor.id } } },
              { enrollments: { some: { status: "ACTIVE", group: { curatorId: actor.id } } } },
            ],
          }
        : {};
  const course = await getPrisma().course.findFirst({
    where: { id: courseId, deletedAt: null, ...access },
    select: { id: true, status: true },
  });
  if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "Курс не найден.");
  return course;
}

export async function assertCourseManageable(actor: Actor, courseId: string) {
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "ADMIN" && actor.role !== "TEACHER") {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Редактировать материалы курса могут администратор и назначенный преподаватель.",
    );
  }
  const where: Prisma.CourseWhereInput = {
    id: courseId,
    deletedAt: null,
    ...(actor.role === "TEACHER"
      ? {
          status: { not: "ARCHIVED" as const },
          teacherAssignments: { some: { teacherId: actor.id } },
        }
      : {}),
  };
  const course = await getPrisma().course.findFirst({ where, select: { id: true } });
  if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "Курс не найден.");
  return course;
}

async function audit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  before: Prisma.InputJsonValue | undefined,
  after: Prisma.InputJsonValue | undefined,
  request: Request,
) {
  await tx.auditLog.create({
    data: {
      actorId: actor.id,
      action,
      entityType,
      entityId,
      beforeJson: before === undefined ? Prisma.JsonNull : before,
      afterJson: after === undefined ? Prisma.JsonNull : after,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    },
  });
}

export async function listCourseSections(actor: Actor, courseId: string) {
  await assertCourseReadable(actor, courseId);
  const now = new Date();
  const student = actor.role === "STUDENT";
  const env = getServerEnv();
  const sections = await getPrisma().courseSection.findMany({
    where: {
      courseId,
      deletedAt: null,
      ...(student ? { isPublished: true, ...availabilityWhere(now) } : {}),
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      lessons: {
        where: {
          deletedAt: null,
          ...(student ? { isPublished: true, ...availabilityWhere(now) } : {}),
        },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        include: {
          attachments: {
            where: {
              file: {
                deletedAt: null,
                uploadStatus: "READY",
                ...(student && env.FILE_SCAN_REQUIRED ? { virusScanStatus: "CLEAN" as const } : {}),
              },
            },
            orderBy: { position: "asc" },
            select: {
              file: {
                select: { id: true, originalName: true, mimeType: true, sizeBytes: true },
              },
            },
          },
          ...(student
            ? { progress: { where: { studentId: actor.id }, select: { completedAt: true } } }
            : {}),
        },
      },
    },
  });
  return sections.map((section) => ({
    ...section,
    lessons: section.lessons.map((lesson) => ({
      ...lesson,
      content:
        typeof lesson.content === "string" ? sanitizeRichText(lesson.content) : lesson.content,
    })),
  }));
}

export async function listSectionLessons(actor: Actor, sectionId: string) {
  const now = new Date();
  const section = await getPrisma().courseSection.findFirst({
    where: {
      id: sectionId,
      deletedAt: null,
      ...(actor.role === "STUDENT" ? { isPublished: true, ...availabilityWhere(now) } : {}),
    },
    select: { id: true, courseId: true },
  });
  if (!section) throw new ApiError(404, "SECTION_NOT_FOUND", "Раздел курса не найден.");
  await assertCourseReadable(actor, section.courseId);
  const student = actor.role === "STUDENT";
  const env = getServerEnv();
  return getPrisma().lesson.findMany({
    where: {
      sectionId,
      deletedAt: null,
      ...(student ? { isPublished: true, ...availabilityWhere(now) } : {}),
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      attachments: {
        where: {
          file: {
            deletedAt: null,
            uploadStatus: "READY",
            ...(student && env.FILE_SCAN_REQUIRED ? { virusScanStatus: "CLEAN" as const } : {}),
          },
        },
        orderBy: { position: "asc" },
        select: {
          file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
        },
      },
      ...(student
        ? { progress: { where: { studentId: actor.id }, select: { completedAt: true } } }
        : {}),
    },
  });
}

export async function createCourseSection(
  actor: Actor,
  courseId: string,
  input: unknown,
  request: Request,
) {
  await assertCourseManageable(actor, courseId);
  const value = parseBody(sectionCreateSchema, input);
  return getPrisma().$transaction(async (tx) => {
    const max =
      value.position === undefined
        ? await tx.courseSection.aggregate({
            where: { courseId, deletedAt: null },
            _max: { position: true },
          })
        : null;
    const section = await tx.courseSection.create({
      data: {
        courseId,
        title: value.title,
        summary: value.summary ?? null,
        position: value.position ?? (max?._max.position ?? -1) + 1,
        isPublished: value.isPublished,
        availableFrom: parseOptionalDate(value.availableFrom),
        availableUntil: parseOptionalDate(value.availableUntil),
        createdById: actor.id,
      },
    });
    await audit(
      tx,
      actor,
      "course.section.created",
      "CourseSection",
      section.id,
      undefined,
      { courseId, title: section.title },
      request,
    );
    return section;
  });
}

export async function updateCourseSection(
  actor: Actor,
  sectionId: string,
  input: unknown,
  request: Request,
) {
  const existing = await getPrisma().courseSection.findFirst({
    where: { id: sectionId, deletedAt: null },
    select: {
      id: true,
      courseId: true,
      title: true,
      summary: true,
      position: true,
      isPublished: true,
      availableFrom: true,
      availableUntil: true,
    },
  });
  if (!existing) throw new ApiError(404, "SECTION_NOT_FOUND", "Раздел курса не найден.");
  await assertCourseManageable(actor, existing.courseId);
  const value = parseBody(sectionUpdateSchema, input);
  if (Object.keys(value).length === 0)
    throw new ApiError(422, "EMPTY_UPDATE", "Укажите поля для изменения.");
  return getPrisma().$transaction(async (tx) => {
    const updated = await tx.courseSection.update({
      where: { id: sectionId },
      data: {
        ...value,
        availableFrom: parseOptionalDate(value.availableFrom),
        availableUntil: parseOptionalDate(value.availableUntil),
        updatedById: actor.id,
      },
    });
    await audit(
      tx,
      actor,
      "course.section.updated",
      "CourseSection",
      sectionId,
      { title: existing.title, isPublished: existing.isPublished },
      { title: updated.title, isPublished: updated.isPublished },
      request,
    );
    return updated;
  });
}

export async function archiveCourseSection(actor: Actor, sectionId: string, request: Request) {
  const existing = await getPrisma().courseSection.findFirst({
    where: { id: sectionId, deletedAt: null },
    select: { id: true, courseId: true, title: true },
  });
  if (!existing) throw new ApiError(404, "SECTION_NOT_FOUND", "Раздел курса не найден.");
  await assertCourseManageable(actor, existing.courseId);
  const now = new Date();
  await getPrisma().$transaction(async (tx) => {
    await tx.courseSection.update({
      where: { id: sectionId },
      data: { deletedAt: now, isPublished: false, updatedById: actor.id },
    });
    await tx.lesson.updateMany({
      where: { sectionId, deletedAt: null },
      data: { deletedAt: now, isPublished: false, updatedById: actor.id },
    });
    await audit(
      tx,
      actor,
      "course.section.archived",
      "CourseSection",
      sectionId,
      { title: existing.title },
      undefined,
      request,
    );
  });
}

async function assertAllowedExternalUrl(type: "LINK" | "VIDEO", value: string | null | undefined) {
  if (!value) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(422, "INVALID_EXTERNAL_URL", "Укажите корректную внешнюю ссылку.");
  }
  if (url.protocol !== "https:")
    throw new ApiError(422, "INVALID_EXTERNAL_URL", "Внешние материалы должны использовать HTTPS.");
  const hosts = new Set(
    getServerEnv()
      .COURSE_LINK_ALLOWED_HOSTS.split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  const hostname = url.hostname.toLowerCase();
  const allowed = [...hosts].some((host) => hostname === host || hostname.endsWith(`.${host}`));
  if (!allowed)
    throw new ApiError(
      422,
      "EXTERNAL_HOST_NOT_ALLOWED",
      `Домен ${type === "VIDEO" ? "видео" : "ссылки"} не разрешён настройками платформы.`,
    );
}

export async function createLesson(
  actor: Actor,
  sectionId: string,
  input: unknown,
  request: Request,
) {
  const section = await getPrisma().courseSection.findFirst({
    where: { id: sectionId, deletedAt: null },
    select: { id: true, courseId: true },
  });
  if (!section) throw new ApiError(404, "SECTION_NOT_FOUND", "Раздел курса не найден.");
  await assertCourseManageable(actor, section.courseId);
  const value = parseBody(lessonCreateSchema, input);
  const content = value.content ? sanitizeRichText(value.content) : null;
  if (value.type === "TEXT" && (!content || !hasRichTextContent(content))) {
    throw new ApiError(422, "VALIDATION_ERROR", "Для текстового материала добавьте текст.");
  }
  if (value.type === "LINK" || value.type === "VIDEO")
    await assertAllowedExternalUrl(value.type, value.externalUrl);
  return getPrisma().$transaction(async (tx) => {
    const max =
      value.position === undefined
        ? await tx.lesson.aggregate({
            where: { sectionId, deletedAt: null },
            _max: { position: true },
          })
        : null;
    const lesson = await tx.lesson.create({
      data: {
        sectionId,
        type: value.type,
        title: value.title,
        content: content ? content : Prisma.JsonNull,
        externalUrl: value.externalUrl ?? null,
        position: value.position ?? (max?._max.position ?? -1) + 1,
        isPublished: value.isPublished,
        availableFrom: parseOptionalDate(value.availableFrom),
        availableUntil: parseOptionalDate(value.availableUntil),
        createdById: actor.id,
      },
    });
    await audit(
      tx,
      actor,
      "course.lesson.created",
      "Lesson",
      lesson.id,
      undefined,
      { sectionId, type: lesson.type, title: lesson.title },
      request,
    );
    return lesson;
  });
}

export async function updateLesson(
  actor: Actor,
  lessonId: string,
  input: unknown,
  request: Request,
) {
  const existing = await getPrisma().lesson.findFirst({
    where: { id: lessonId, deletedAt: null },
    select: {
      id: true,
      section: { select: { courseId: true } },
      type: true,
      title: true,
      content: true,
      externalUrl: true,
      isPublished: true,
    },
  });
  if (!existing) throw new ApiError(404, "LESSON_NOT_FOUND", "Материал курса не найден.");
  await assertCourseManageable(actor, existing.section.courseId);
  const value = parseBody(lessonUpdateSchema, input);
  if (Object.keys(value).length === 0)
    throw new ApiError(422, "EMPTY_UPDATE", "Укажите поля для изменения.");
  const content = value.content == null ? value.content : sanitizeRichText(value.content);
  if (
    existing.type === "TEXT" &&
    value.content !== undefined &&
    (!content || !hasRichTextContent(content))
  ) {
    throw new ApiError(422, "VALIDATION_ERROR", "Для текстового материала добавьте текст.");
  }
  const externalUrl = value.externalUrl === undefined ? existing.externalUrl : value.externalUrl;
  if (existing.type === "LINK" || existing.type === "VIDEO") {
    if (!externalUrl)
      throw new ApiError(
        422,
        "INVALID_EXTERNAL_URL",
        "Для этого материала необходим внешний адрес.",
      );
    await assertAllowedExternalUrl(existing.type, externalUrl);
  } else if (value.externalUrl) {
    throw new ApiError(
      422,
      "INVALID_EXTERNAL_URL",
      "У этого типа материала не должно быть внешней ссылки.",
    );
  }
  const updated = await getPrisma().$transaction(async (tx) => {
    const lesson = await tx.lesson.update({
      where: { id: lessonId },
      data: {
        ...value,
        content:
          value.content === undefined ? undefined : content === null ? Prisma.JsonNull : content,
        externalUrl: value.externalUrl,
        availableFrom: parseOptionalDate(value.availableFrom),
        availableUntil: parseOptionalDate(value.availableUntil),
        updatedById: actor.id,
      },
    });
    await audit(
      tx,
      actor,
      "course.lesson.updated",
      "Lesson",
      lessonId,
      { title: existing.title, isPublished: existing.isPublished },
      { title: lesson.title, isPublished: lesson.isPublished },
      request,
    );
    return lesson;
  });
  return updated;
}

export async function archiveLesson(actor: Actor, lessonId: string, request: Request) {
  const existing = await getPrisma().lesson.findFirst({
    where: { id: lessonId, deletedAt: null },
    select: { id: true, title: true, section: { select: { courseId: true } } },
  });
  if (!existing) throw new ApiError(404, "LESSON_NOT_FOUND", "Материал курса не найден.");
  await assertCourseManageable(actor, existing.section.courseId);
  await getPrisma().$transaction(async (tx) => {
    await tx.lesson.update({
      where: { id: lessonId },
      data: { deletedAt: new Date(), isPublished: false, updatedById: actor.id },
    });
    await audit(
      tx,
      actor,
      "course.lesson.archived",
      "Lesson",
      lessonId,
      { title: existing.title },
      undefined,
      request,
    );
  });
}

export async function markLessonProgress(actor: Actor, lessonId: string, complete: boolean) {
  if (actor.role !== "STUDENT")
    throw new ApiError(403, "FORBIDDEN", "Отмечать прогресс может только студент.");
  const lesson = await getPrisma().lesson.findFirst({
    where: {
      id: lessonId,
      deletedAt: null,
      isPublished: true,
      section: {
        deletedAt: null,
        isPublished: true,
        ...availabilityWhere(new Date()),
        course: {
          status: "PUBLISHED",
          deletedAt: null,
          enrollments: { some: { studentId: actor.id, status: "ACTIVE" } },
        },
      },
      ...availabilityWhere(new Date()),
    },
    select: { id: true },
  });
  if (!lesson) throw new ApiError(404, "LESSON_NOT_FOUND", "Материал курса не найден.");
  const now = new Date();
  return getPrisma().lessonProgress.upsert({
    where: { lessonId_studentId: { lessonId, studentId: actor.id } },
    create: { lessonId, studentId: actor.id, viewedAt: now, completedAt: complete ? now : null },
    update: { viewedAt: now, completedAt: complete ? now : null },
    select: { lessonId: true, viewedAt: true, completedAt: true },
  });
}

export function parseCourseContentId(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new ApiError(404, "CONTENT_NOT_FOUND", "Материал курса не найден.");
  return parsed.data;
}

export function parseProgressBody(input: unknown): boolean {
  const parsed = z.object({ complete: z.boolean() }).safeParse(input);
  if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Укажите состояние материала.");
  return parsed.data.complete;
}
