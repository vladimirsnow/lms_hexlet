import { Prisma } from "../../../generated/prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/http/api-error";
import { getServerEnv } from "@/lib/env";
import type { Actor } from "@/server/auth/session";

function copyTitle(title: string, language: string) {
  const suffix = language === "kk" ? "көшірме" : language === "en" ? "copy" : "копия";
  const marker = ` — ${suffix}`;
  return `${title.slice(0, 200 - marker.length)}${marker}`;
}

function slugWithSuffix(sourceSlug: string, suffix: string) {
  const prefix = sourceSlug.slice(0, 220 - suffix.length).replace(/-+$/, "");
  return `${prefix}${suffix}`;
}

export async function copyCourse(actor: Actor, sourceCourseId: string, request: Request) {
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "ADMIN" && actor.role !== "TEACHER") {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Копировать курс может администратор или назначенный преподаватель.",
    );
  }

  const prisma = getPrisma();
  const requireCleanFiles = getServerEnv().FILE_SCAN_REQUIRED;
  try {
    return await prisma.$transaction(
      async (tx) => {
        const source = await tx.course.findFirst({
          where: {
            id: sourceCourseId,
            deletedAt: null,
            ...(actor.role === "TEACHER"
              ? {
                  status: { not: "ARCHIVED" as const },
                  teacherAssignments: { some: { teacherId: actor.id } },
                }
              : {}),
          },
          include: {
            teacherAssignments: {
              where: {
                teacher: { role: "TEACHER", status: "ACTIVE", deletedAt: null },
              },
              select: { teacherId: true },
            },
            sections: {
              where: { deletedAt: null },
              orderBy: [{ position: "asc" }, { createdAt: "asc" }],
              include: {
                lessons: {
                  where: { deletedAt: null },
                  orderBy: [{ position: "asc" }, { createdAt: "asc" }],
                  include: {
                    attachments: {
                      where: {
                        file: {
                          deletedAt: null,
                          uploadStatus: "READY",
                          virusScanStatus: requireCleanFiles
                            ? "CLEAN"
                            : { in: ["CLEAN", "NOT_SCANNED"] },
                        },
                      },
                      orderBy: { position: "asc" },
                      select: { fileId: true, position: true },
                    },
                  },
                },
              },
            },
            assignments: {
              where: { deletedAt: null },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            },
            tests: {
              where: { deletedAt: null },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              include: {
                questions: {
                  orderBy: [{ position: "asc" }, { id: "asc" }],
                  include: { options: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
                },
              },
            },
            gradebookSettings: true,
          },
        });
        if (!source) throw new ApiError(404, "COURSE_NOT_FOUND", "Курс не найден.");

        let slug = slugWithSuffix(source.slug, "-copy");
        let suffix = 2;
        while (await tx.course.findUnique({ where: { slug }, select: { id: true } })) {
          slug = slugWithSuffix(source.slug, `-copy-${suffix}`);
          suffix += 1;
          if (suffix > 1000) {
            throw new ApiError(
              409,
              "COURSE_COPY_SLUG_UNAVAILABLE",
              "Не удалось подобрать уникальный адрес курса.",
            );
          }
        }

        const copiedCourse = await tx.course.create({
          data: {
            subjectId: source.subjectId,
            termId: source.termId,
            academicYearId: source.academicYearId,
            specialtyId: source.specialtyId,
            title: copyTitle(source.title, source.language),
            slug,
            category: source.category,
            summary: source.summary,
            description:
              source.description === null
                ? Prisma.DbNull
                : (source.description as Prisma.InputJsonValue),
            language: source.language,
            status: "DRAFT",
            createdById: actor.id,
          },
          select: { id: true, title: true, slug: true, status: true },
        });

        const teacherIds =
          actor.role === "TEACHER"
            ? [actor.id]
            : source.teacherAssignments.map((assignment) => assignment.teacherId);
        if (teacherIds.length) {
          await tx.courseTeacher.createMany({
            data: [...new Set(teacherIds)].map((teacherId) => ({
              courseId: copiedCourse.id,
              teacherId,
              assignedById: actor.id,
            })),
          });
        }

        const sectionIds = new Map<string, string>();
        const lessonIds = new Map<string, string>();
        let copiedLessons = 0;
        let copiedAttachments = 0;
        for (const sourceSection of source.sections) {
          const section = await tx.courseSection.create({
            data: {
              courseId: copiedCourse.id,
              title: sourceSection.title,
              summary: sourceSection.summary,
              position: sourceSection.position,
              isPublished: false,
              createdById: actor.id,
            },
            select: { id: true },
          });
          sectionIds.set(sourceSection.id, section.id);

          for (const sourceLesson of sourceSection.lessons) {
            const lesson = await tx.lesson.create({
              data: {
                sectionId: section.id,
                type: sourceLesson.type,
                title: sourceLesson.title,
                content:
                  sourceLesson.content === null
                    ? Prisma.DbNull
                    : (sourceLesson.content as Prisma.InputJsonValue),
                externalUrl: sourceLesson.externalUrl,
                position: sourceLesson.position,
                isPublished: false,
                createdById: actor.id,
              },
              select: { id: true },
            });
            lessonIds.set(sourceLesson.id, lesson.id);
            copiedLessons += 1;

            if (sourceLesson.attachments.length) {
              await tx.lessonAttachment.createMany({
                data: sourceLesson.attachments.map((attachment) => ({
                  lessonId: lesson.id,
                  fileId: attachment.fileId,
                  position: attachment.position,
                })),
              });
              copiedAttachments += sourceLesson.attachments.length;
            }
          }
        }

        let copiedAssignments = 0;
        for (const assignment of source.assignments) {
          await tx.assignment.create({
            data: {
              courseId: copiedCourse.id,
              sectionId: assignment.sectionId
                ? (sectionIds.get(assignment.sectionId) ?? null)
                : null,
              title: assignment.title,
              description: assignment.description,
              instructions: assignment.instructions,
              type: assignment.type,
              maxScore: assignment.maxScore,
              weight: assignment.weight,
              dueAt: null,
              allowLate: assignment.allowLate,
              latePenaltyPercent: assignment.latePenaltyPercent,
              maxAttempts: assignment.maxAttempts,
              allowResubmission: assignment.allowResubmission,
              status: "DRAFT",
              createdById: actor.id,
            },
          });
          copiedAssignments += 1;
        }

        let copiedTests = 0;
        let copiedQuestions = 0;
        for (const test of source.tests) {
          await tx.test.create({
            data: {
              courseId: copiedCourse.id,
              lessonId: test.lessonId ? (lessonIds.get(test.lessonId) ?? null) : null,
              title: test.title,
              description: test.description,
              timeLimitMinutes: test.timeLimitMinutes,
              attemptsAllowed: test.attemptsAllowed,
              shuffleQuestions: test.shuffleQuestions,
              passingPercent: test.passingPercent,
              status: "DRAFT",
              createdById: actor.id,
              questions: {
                create: test.questions.map((question) => ({
                  type: question.type,
                  prompt: question.prompt,
                  points: question.points,
                  position: question.position,
                  acceptedAnswers:
                    question.acceptedAnswers === null
                      ? Prisma.DbNull
                      : (question.acceptedAnswers as Prisma.InputJsonValue),
                  caseSensitive: question.caseSensitive,
                  options: {
                    create: question.options.map((option) => ({
                      text: option.text,
                      isCorrect: option.isCorrect,
                      position: option.position,
                    })),
                  },
                })),
              },
            },
          });
          copiedTests += 1;
          copiedQuestions += test.questions.length;
        }

        if (source.gradebookSettings) {
          await tx.gradebookSettings.create({
            data: {
              courseId: copiedCourse.id,
              scale: source.gradebookSettings.scale,
              passingScore: source.gradebookSettings.passingScore,
              rounding: source.gradebookSettings.rounding,
              updatedById: actor.id,
            },
          });
        }

        const copied = {
          sections: sectionIds.size,
          lessons: copiedLessons,
          attachments: copiedAttachments,
          assignments: copiedAssignments,
          tests: copiedTests,
          questions: copiedQuestions,
          teachers: new Set(teacherIds).size,
        };
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: "course.copied",
            entityType: "Course",
            entityId: copiedCourse.id,
            beforeJson: { sourceCourseId: source.id, sourceSlug: source.slug },
            afterJson: {
              title: copiedCourse.title,
              slug: copiedCourse.slug,
              copied,
              rostersAndResultsCopied: false,
            },
            ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
            userAgent: request.headers.get("user-agent")?.slice(0, 1000) || null,
          },
        });

        return { item: copiedCourse, copied };
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new ApiError(
        409,
        "COURSE_COPY_CONFLICT",
        "Не удалось создать копию из-за конфликта уникального адреса.",
      );
    }
    throw error;
  }
}
