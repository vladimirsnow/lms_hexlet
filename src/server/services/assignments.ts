import { Prisma } from "../../../generated/prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/http/api-error";
import { csvEscape as escapeCsv } from "@/server/services/csv";
import { isDeadlinePassed } from "./deadlines";
import type { Actor } from "@/server/auth/session";
import { assertCourseManageable, assertCourseReadable } from "@/server/services/course-content";

const dateTime = z.iso.datetime({ offset: true }).nullable().optional();
const createSchema = z.object({
  sectionId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10000).nullable().optional(),
  instructions: z.string().trim().max(30000).nullable().optional(),
  type: z.enum(["FILE", "TEXT", "FILE_OR_TEXT"]),
  maxScore: z.coerce.number().positive().max(999999.99),
  weight: z.coerce.number().min(0).max(999.99).default(1),
  dueAt: dateTime,
  allowLate: z.boolean().default(false),
  latePenaltyPercent: z.coerce.number().min(0).max(100).default(0),
  maxAttempts: z.coerce.number().int().min(1).max(20).default(1),
  allowResubmission: z.boolean().default(false),
  status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]).default("DRAFT"),
});
const updateSchema = z.object({
  sectionId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  instructions: z.string().trim().max(30000).nullable().optional(),
  type: z.enum(["FILE", "TEXT", "FILE_OR_TEXT"]).optional(),
  maxScore: z.coerce.number().positive().max(999999.99).optional(),
  weight: z.coerce.number().min(0).max(999.99).optional(),
  dueAt: dateTime,
  allowLate: z.boolean().optional(),
  latePenaltyPercent: z.coerce.number().min(0).max(100).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(20).optional(),
  allowResubmission: z.boolean().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]).optional(),
});
const draftSchema = z.object({ textContent: z.string().trim().max(50000).nullable().optional() });
const gradeSchema = z.object({
  score: z.coerce.number().min(0).max(999999.99),
  feedback: z.string().trim().max(10000).nullable().optional(),
});
const returnSchema = z.object({ feedback: z.string().trim().min(1).max(10000) });
const finalGradeSchema = z.object({
  score: z.coerce.number().min(0).max(999999.99).nullable().optional(),
  gradeLabel: z.string().trim().max(40).nullable().optional(),
  comment: z.string().trim().max(5000).nullable().optional(),
});
const gradebookSettingsSchema = z.object({
  scale: z.enum(["SCORE_100", "SCORE_5", "PASS_FAIL"]),
  passingScore: z.coerce.number().min(0).max(100).nullable().optional(),
  rounding: z.coerce.number().int().min(0).max(4),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Проверьте поля формы.",
      parsed.error.flatten().fieldErrors,
    );
  return parsed.data;
}

function asDate(value: string | null | undefined): Date | null | undefined {
  return value === undefined ? undefined : value === null ? null : new Date(value);
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

async function validateSection(courseId: string, sectionId: string | null | undefined) {
  if (!sectionId) return;
  const section = await getPrisma().courseSection.findFirst({
    where: { id: sectionId, courseId, deletedAt: null },
    select: { id: true },
  });
  if (!section)
    throw new ApiError(
      422,
      "INVALID_SECTION",
      "Раздел должен принадлежать этому курсу и быть активным.",
    );
}

export async function listAssignments(actor: Actor, courseId: string) {
  await assertCourseReadable(actor, courseId);
  const student = actor.role === "STUDENT";
  return getPrisma().assignment.findMany({
    where: { courseId, deletedAt: null, ...(student ? { status: "PUBLISHED" } : {}) },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    include: {
      section: { select: { id: true, title: true } },
      ...(student
        ? {
            submissions: {
              where: { studentId: actor.id },
              orderBy: { attemptNo: "desc" },
              take: 1,
              select: {
                id: true,
                attemptNo: true,
                status: true,
                submittedAt: true,
                isLate: true,
                score: true,
                feedback: true,
              },
            },
          }
        : { _count: { select: { submissions: true } } }),
    },
  });
}

export async function createAssignment(
  actor: Actor,
  courseId: string,
  input: unknown,
  request: Request,
) {
  await assertCourseManageable(actor, courseId);
  const value = parse(createSchema, input);
  await validateSection(courseId, value.sectionId);
  const assignment = await getPrisma().$transaction(async (tx) => {
    const created = await tx.assignment.create({
      data: {
        courseId,
        sectionId: value.sectionId ?? null,
        title: value.title,
        description: value.description ?? null,
        instructions: value.instructions ?? null,
        type: value.type,
        maxScore: value.maxScore,
        weight: value.weight,
        dueAt: asDate(value.dueAt),
        allowLate: value.allowLate,
        latePenaltyPercent: value.latePenaltyPercent,
        maxAttempts: value.maxAttempts,
        allowResubmission: value.allowResubmission,
        status: value.status,
        createdById: actor.id,
      },
    });
    await audit(
      tx,
      actor,
      "assignment.created",
      "Assignment",
      created.id,
      undefined,
      { courseId, title: created.title, status: created.status },
      request,
    );
    return created;
  });
  return assignment;
}

async function getManageableAssignment(actor: Actor, assignmentId: string) {
  const assignment = await getPrisma().assignment.findFirst({
    where: { id: assignmentId, deletedAt: null },
    select: {
      id: true,
      courseId: true,
      title: true,
      type: true,
      maxScore: true,
      dueAt: true,
      status: true,
      maxAttempts: true,
      allowResubmission: true,
      _count: { select: { submissions: true } },
    },
  });
  if (!assignment) throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Задание не найдено.");
  await assertCourseManageable(actor, assignment.courseId);
  return assignment;
}

export async function getAssignment(actor: Actor, assignmentId: string) {
  const assignment = await getPrisma().assignment.findFirst({
    where: { id: assignmentId, deletedAt: null },
    select: { id: true, courseId: true, status: true },
  });
  if (!assignment || (actor.role === "STUDENT" && assignment.status !== "PUBLISHED")) {
    throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Задание не найдено.");
  }
  await assertCourseReadable(actor, assignment.courseId);
  return getPrisma().assignment.findUnique({
    where: { id: assignment.id },
    include: {
      course: { select: { id: true, slug: true, title: true } },
      section: { select: { id: true, title: true } },
      ...(actor.role === "STUDENT"
        ? {
            submissions: {
              where: { studentId: actor.id },
              orderBy: { attemptNo: "desc" },
              select: {
                id: true,
                attemptNo: true,
                textContent: true,
                status: true,
                submittedAt: true,
                isLate: true,
                score: true,
                feedback: true,
                files: {
                  include: {
                    file: {
                      select: {
                        id: true,
                        originalName: true,
                        uploadStatus: true,
                        virusScanStatus: true,
                      },
                    },
                  },
                },
              },
            },
          }
        : {}),
    },
  });
}

export async function updateAssignment(
  actor: Actor,
  assignmentId: string,
  input: unknown,
  request: Request,
) {
  const existing = await getManageableAssignment(actor, assignmentId);
  const value = parse(updateSchema, input);
  if (Object.keys(value).length === 0)
    throw new ApiError(422, "EMPTY_UPDATE", "Укажите поля для изменения.");
  if (
    existing._count.submissions > 0 &&
    ((value.maxScore !== undefined && value.maxScore !== Number(existing.maxScore)) ||
      (value.type !== undefined && value.type !== existing.type))
  ) {
    throw new ApiError(
      409,
      "ASSIGNMENT_LOCKED",
      "Тип и максимальный балл нельзя менять после появления работ.",
    );
  }
  if (value.sectionId !== undefined) await validateSection(existing.courseId, value.sectionId);
  return getPrisma().$transaction(async (tx) => {
    const updated = await tx.assignment.update({
      where: { id: assignmentId },
      data: { ...value, dueAt: asDate(value.dueAt), updatedById: actor.id },
    });
    await audit(
      tx,
      actor,
      "assignment.updated",
      "Assignment",
      assignmentId,
      { title: existing.title, status: existing.status },
      { title: updated.title, status: updated.status },
      request,
    );
    return updated;
  });
}

export async function archiveAssignment(actor: Actor, assignmentId: string, request: Request) {
  const existing = await getManageableAssignment(actor, assignmentId);
  await getPrisma().$transaction(async (tx) => {
    await tx.assignment.update({
      where: { id: assignmentId },
      data: { deletedAt: new Date(), status: "CLOSED", updatedById: actor.id },
    });
    await audit(
      tx,
      actor,
      "assignment.archived",
      "Assignment",
      assignmentId,
      { title: existing.title, status: existing.status },
      undefined,
      request,
    );
  });
}

async function loadStudentAssignment(actor: Actor, assignmentId: string) {
  if (actor.role !== "STUDENT")
    throw new ApiError(403, "FORBIDDEN", "Сдавать задание может только студент.");
  const assignment = await getPrisma().assignment.findFirst({
    where: {
      id: assignmentId,
      deletedAt: null,
      status: "PUBLISHED",
      course: {
        status: "PUBLISHED",
        deletedAt: null,
        enrollments: { some: { studentId: actor.id, status: "ACTIVE" } },
      },
    },
    select: {
      id: true,
      courseId: true,
      type: true,
      status: true,
      dueAt: true,
      allowLate: true,
      maxAttempts: true,
      allowResubmission: true,
    },
  });
  if (!assignment) throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Задание не найдено.");
  return assignment;
}

export async function createSubmissionDraft(
  actor: Actor,
  assignmentId: string,
  input: unknown,
  request: Request,
) {
  const value = parse(draftSchema, input);
  const assignment = await loadStudentAssignment(actor, assignmentId);
  if (assignment.type === "TEXT" && !value.textContent)
    throw new ApiError(422, "TEXT_REQUIRED", "Добавьте текст ответа.");
  if (isDeadlinePassed(assignment.dueAt) && !assignment.allowLate) {
    throw new ApiError(409, "DEADLINE_PASSED", "Срок сдачи задания истёк.");
  }
  return getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${assignment.id}:${actor.id}`}, 0))::text`;
    const latest = await tx.submission.findFirst({
      where: { assignmentId, studentId: actor.id },
      orderBy: { attemptNo: "desc" },
      select: { attemptNo: true, status: true },
    });
    if (latest) {
      const canRetry =
        assignment.allowResubmission &&
        ["GRADED", "RETURNED", "RESUBMISSION_REQUIRED"].includes(latest.status);
      if (!canRetry)
        throw new ApiError(
          409,
          "SUBMISSION_ALREADY_EXISTS",
          "Нельзя создать ещё одну попытку, пока предыдущая не проверена или пересдача не разрешена.",
        );
    }
    const attemptNo = (latest?.attemptNo ?? 0) + 1;
    if (attemptNo > assignment.maxAttempts)
      throw new ApiError(409, "ATTEMPTS_EXHAUSTED", "Достигнут лимит попыток.");
    const submission = await tx.submission.create({
      data: {
        assignmentId,
        studentId: actor.id,
        attemptNo,
        textContent: value.textContent ?? null,
      },
    });
    await audit(
      tx,
      actor,
      "submission.draft.created",
      "Submission",
      submission.id,
      undefined,
      { assignmentId, attemptNo },
      request,
    );
    return submission;
  });
}

export async function updateSubmissionDraft(actor: Actor, submissionId: string, input: unknown) {
  if (actor.role !== "STUDENT")
    throw new ApiError(403, "FORBIDDEN", "Изменять черновик может только студент.");
  const value = parse(draftSchema, input);
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
          enrollments: { some: { studentId: actor.id, status: "ACTIVE" } },
        },
      },
    },
    select: { id: true, assignment: { select: { type: true } } },
  });
  if (!submission) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "Черновик работы не найден.");
  if (submission.assignment.type === "TEXT" && !value.textContent)
    throw new ApiError(422, "TEXT_REQUIRED", "Добавьте текст ответа.");
  return getPrisma().submission.update({
    where: { id: submissionId },
    data: { textContent: value.textContent ?? null },
    select: { id: true, textContent: true, status: true },
  });
}

export async function submitDraft(actor: Actor, submissionId: string, request: Request) {
  if (actor.role !== "STUDENT")
    throw new ApiError(403, "FORBIDDEN", "Отправить работу может только студент.");
  return getPrisma().$transaction(async (tx) => {
    const submission = await tx.submission.findFirst({
      where: {
        id: submissionId,
        studentId: actor.id,
        status: "DRAFT",
        assignment: {
          status: "PUBLISHED",
          deletedAt: null,
          course: {
            status: "PUBLISHED",
            enrollments: { some: { studentId: actor.id, status: "ACTIVE" } },
          },
        },
      },
      include: {
        assignment: { select: { id: true, type: true, dueAt: true, allowLate: true } },
        files: { include: { file: { select: { uploadStatus: true, deletedAt: true } } } },
      },
    });
    if (!submission) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "Черновик работы не найден.");
    const hasReadyFile = submission.files.some(
      ({ file }) => file.deletedAt === null && file.uploadStatus === "READY",
    );
    const hasPendingFile = submission.files.some(
      ({ file }) => file.deletedAt === null && file.uploadStatus === "PENDING",
    );
    if (hasPendingFile)
      throw new ApiError(409, "FILES_PENDING", "Дождитесь завершения загрузки файлов.");
    if (submission.assignment.type === "FILE" && !hasReadyFile)
      throw new ApiError(422, "FILE_REQUIRED", "Прикрепите файл к работе.");
    if (submission.assignment.type === "TEXT" && !submission.textContent?.trim())
      throw new ApiError(422, "TEXT_REQUIRED", "Добавьте текст ответа.");
    if (
      submission.assignment.type === "FILE_OR_TEXT" &&
      !hasReadyFile &&
      !submission.textContent?.trim()
    )
      throw new ApiError(422, "SUBMISSION_CONTENT_REQUIRED", "Добавьте текст или файл.");
    const now = new Date();
    const isLate = isDeadlinePassed(submission.assignment.dueAt, now);
    if (isLate && !submission.assignment.allowLate)
      throw new ApiError(409, "DEADLINE_PASSED", "Срок сдачи задания истёк.");
    const updated = await tx.submission.update({
      where: { id: submissionId },
      data: { status: "SUBMITTED", submittedAt: now, isLate },
    });
    await audit(
      tx,
      actor,
      "submission.submitted",
      "Submission",
      submissionId,
      { status: "DRAFT" },
      { status: "SUBMITTED", isLate },
      request,
    );
    return updated;
  });
}

async function getVisibleSubmission(actor: Actor, submissionId: string) {
  const submission = await getPrisma().submission.findFirst({
    where: { id: submissionId, assignment: { deletedAt: null } },
    select: {
      id: true,
      studentId: true,
      assignment: { select: { id: true, courseId: true, status: true } },
    },
  });
  if (!submission) throw new ApiError(404, "SUBMISSION_NOT_FOUND", "Работа не найдена.");
  if (actor.role === "STUDENT") {
    if (submission.studentId !== actor.id)
      throw new ApiError(404, "SUBMISSION_NOT_FOUND", "Работа не найдена.");
    await assertCourseReadable(actor, submission.assignment.courseId);
  } else {
    await assertCourseManageable(actor, submission.assignment.courseId);
  }
  return submission;
}

export async function getSubmission(actor: Actor, submissionId: string) {
  const allowed = await getVisibleSubmission(actor, submissionId);
  return getPrisma().submission.findUnique({
    where: { id: allowed.id },
    include: {
      assignment: {
        select: {
          id: true,
          courseId: true,
          title: true,
          type: true,
          maxScore: true,
          dueAt: true,
          latePenaltyPercent: true,
        },
      },
      student: { select: { id: true, name: true, email: true } },
      files: {
        include: {
          file: {
            select: { id: true, originalName: true, uploadStatus: true, virusScanStatus: true },
          },
        },
      },
    },
  });
}

export async function listAssignmentSubmissions(actor: Actor, assignmentId: string) {
  if (actor.role === "STUDENT")
    throw new ApiError(403, "FORBIDDEN", "Список работ доступен преподавателю и администратору.");
  const assignment = await getManageableAssignment(actor, assignmentId);
  const [submissions, enrolled] = await Promise.all([
    getPrisma().submission.findMany({
      where: { assignmentId },
      orderBy: [{ studentId: "asc" }, { attemptNo: "desc" }],
      include: {
        student: { select: { id: true, name: true, email: true } },
        files: {
          include: { file: { select: { id: true, originalName: true, uploadStatus: true } } },
        },
      },
    }),
    getPrisma().enrollment.findMany({
      where: { courseId: assignment.courseId, status: "ACTIVE" },
      select: { studentId: true, student: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  const latest = new Map<string, (typeof submissions)[number]>();
  for (const submission of submissions)
    if (!latest.has(submission.studentId)) latest.set(submission.studentId, submission);
  return {
    submissions,
    missingStudents: enrolled
      .filter(({ studentId }) => !latest.has(studentId))
      .map(({ student }) => student),
    allowResubmission: assignment.allowResubmission,
    maxAttempts: assignment.maxAttempts,
  };
}

export async function gradeSubmission(
  actor: Actor,
  submissionId: string,
  input: unknown,
  request: Request,
) {
  await getVisibleSubmission(actor, submissionId);
  if (actor.role === "STUDENT")
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Оценивать работу может только преподаватель или администратор.",
    );
  const value = parse(gradeSchema, input);
  const current = await getPrisma().submission.findUnique({
    where: { id: submissionId },
    include: { assignment: { select: { maxScore: true, latePenaltyPercent: true } } },
  });
  if (!current || !["SUBMITTED", "GRADED"].includes(current.status))
    throw new ApiError(
      409,
      "SUBMISSION_NOT_GRADEABLE",
      "Работа должна быть отправлена перед оцениванием.",
    );
  const maxScore = Number(current.assignment.maxScore);
  if (value.score > maxScore)
    throw new ApiError(422, "SCORE_TOO_HIGH", `Оценка не может превышать ${maxScore}.`);
  const rawScore = Math.round(value.score * 100) / 100;
  const score = current.isLate
    ? Math.round(rawScore * (1 - Number(current.assignment.latePenaltyPercent) / 100) * 100) / 100
    : rawScore;
  return getPrisma().$transaction(async (tx) => {
    const updated = await tx.submission.update({
      where: { id: submissionId },
      data: {
        status: "GRADED",
        score,
        feedback: value.feedback ?? null,
        gradedById: actor.id,
        gradedAt: new Date(),
      },
    });
    await audit(
      tx,
      actor,
      "submission.graded",
      "Submission",
      submissionId,
      { score: current.score?.toString() ?? null, status: current.status },
      { rawScore, score, feedback: value.feedback ?? null, isLate: current.isLate },
      request,
    );
    return updated;
  });
}

export async function returnSubmission(
  actor: Actor,
  submissionId: string,
  input: unknown,
  request: Request,
) {
  await getVisibleSubmission(actor, submissionId);
  if (actor.role === "STUDENT")
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Вернуть работу может только преподаватель или администратор.",
    );
  const value = parse(returnSchema, input);
  const current = await getPrisma().submission.findUnique({
    where: { id: submissionId },
    select: {
      status: true,
      score: true,
      attemptNo: true,
      assignment: { select: { allowResubmission: true, maxAttempts: true } },
    },
  });
  if (!current || !["SUBMITTED", "GRADED"].includes(current.status))
    throw new ApiError(
      409,
      "SUBMISSION_NOT_RETURNABLE",
      "Можно вернуть только отправленную или проверенную работу.",
    );
  if (
    !current.assignment.allowResubmission ||
    current.attemptNo >= current.assignment.maxAttempts
  ) {
    throw new ApiError(
      409,
      "RESUBMISSION_DISABLED",
      "Нельзя вернуть работу: пересдача отключена или закончились попытки.",
    );
  }
  return getPrisma().$transaction(async (tx) => {
    const updated = await tx.submission.update({
      where: { id: submissionId },
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        score: null,
        gradedById: null,
        gradedAt: null,
        feedback: value.feedback,
      },
    });
    await audit(
      tx,
      actor,
      "submission.returned",
      "Submission",
      submissionId,
      { score: current.score?.toString() ?? null, status: current.status },
      { status: "RETURNED", feedback: value.feedback },
      request,
    );
    return updated;
  });
}

export async function getMyGrades(actor: Actor) {
  if (actor.role !== "STUDENT")
    throw new ApiError(403, "FORBIDDEN", "Этот список доступен студенту.");
  return getPrisma().submission.findMany({
    where: { studentId: actor.id, status: "GRADED", assignment: { deletedAt: null } },
    orderBy: { gradedAt: "desc" },
    select: {
      id: true,
      score: true,
      feedback: true,
      gradedAt: true,
      assignment: {
        select: {
          id: true,
          title: true,
          maxScore: true,
          course: { select: { id: true, title: true, slug: true } },
        },
      },
    },
  });
}

export async function getGradebook(actor: Actor, courseId: string) {
  if (actor.role === "STUDENT")
    throw new ApiError(403, "FORBIDDEN", "Журнал оценок доступен преподавателю и администратору.");
  await assertCourseManageable(actor, courseId);
  const [assignments, enrollments, submissions, settings, finalGrades] = await Promise.all([
    getPrisma().assignment.findMany({
      where: { courseId, deletedAt: null, status: { in: ["PUBLISHED", "CLOSED"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, maxScore: true, weight: true },
    }),
    getPrisma().enrollment.findMany({
      where: { courseId, status: "ACTIVE" },
      orderBy: { student: { lastName: "asc" } },
      select: { student: { select: { id: true, name: true, email: true } } },
    }),
    getPrisma().submission.findMany({
      where: { assignment: { courseId, deletedAt: null }, status: "GRADED" },
      orderBy: { attemptNo: "desc" },
      select: { id: true, assignmentId: true, studentId: true, score: true, status: true },
    }),
    getPrisma().gradebookSettings.findUnique({ where: { courseId } }),
    getPrisma().finalGrade.findMany({
      where: { courseId },
      select: { studentId: true, score: true, gradeLabel: true, comment: true },
    }),
  ]);
  const latest = new Map<string, (typeof submissions)[number]>();
  for (const submission of submissions) {
    const key = `${submission.assignmentId}:${submission.studentId}`;
    if (!latest.has(key)) latest.set(key, submission);
  }
  const manual = new Map(finalGrades.map((grade) => [grade.studentId, grade]));
  const decimals = assignments.map((assignment) => ({
    id: assignment.id,
    title: assignment.title,
    maxScore: Number(assignment.maxScore),
    weight: Number(assignment.weight),
  }));
  const rows = enrollments.map(({ student }) => {
    const cells = decimals.map((assignment) => {
      const graded = latest.get(`${assignment.id}:${student.id}`);
      return {
        assignmentId: assignment.id,
        score: graded?.score === null || graded?.score === undefined ? null : Number(graded.score),
        maxScore: assignment.maxScore,
        weight: assignment.weight,
      };
    });
    const weighted = cells.reduce(
      (result, cell) => {
        if (cell.score === null || cell.weight <= 0) return result;
        result.total += (cell.score / cell.maxScore) * 100 * cell.weight;
        result.weight += cell.weight;
        return result;
      },
      { total: 0, weight: 0 },
    );
    const calculatedPercent = weighted.weight ? weighted.total / weighted.weight : null;
    const scale = settings?.scale ?? "SCORE_100";
    const precision = settings?.rounding ?? 0;
    const factor = 10 ** precision;
    const rounded =
      calculatedPercent === null ? null : Math.round(calculatedPercent * factor) / factor;
    const gradeLabel =
      scale === "PASS_FAIL"
        ? rounded === null
          ? null
          : rounded >= Number(settings?.passingScore ?? 50)
            ? "Зачёт"
            : "Незачёт"
        : scale === "SCORE_5"
          ? rounded === null
            ? null
            : rounded >= 90
              ? "5"
              : rounded >= 70
                ? "4"
                : rounded >= 50
                  ? "3"
                  : "2"
          : rounded === null
            ? null
            : `${rounded}%`;
    const override = manual.get(student.id);
    return {
      student,
      assignments: cells,
      calculatedPercent: rounded,
      gradeLabel,
      finalOverride: override
        ? {
            score: override.score === null ? null : Number(override.score),
            gradeLabel: override.gradeLabel,
            comment: override.comment,
          }
        : null,
    };
  });
  return {
    assignments: decimals,
    rows,
    settings: settings
      ? {
          scale: settings.scale,
          passingScore: settings.passingScore === null ? null : Number(settings.passingScore),
          rounding: settings.rounding,
        }
      : { scale: "SCORE_100", passingScore: null, rounding: 0 },
  };
}

export async function updateGradebookSettings(
  actor: Actor,
  courseId: string,
  input: unknown,
  request: Request,
) {
  if (actor.role === "STUDENT")
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Настройки журнала доступны преподавателю или администратору.",
    );
  await assertCourseManageable(actor, courseId);
  const value = parse(gradebookSettingsSchema, input);
  const before = await getPrisma().gradebookSettings.findUnique({ where: { courseId } });
  return getPrisma().$transaction(async (tx) => {
    const updated = await tx.gradebookSettings.upsert({
      where: { courseId },
      create: {
        courseId,
        scale: value.scale,
        passingScore: value.passingScore ?? null,
        rounding: value.rounding,
        updatedById: actor.id,
      },
      update: {
        scale: value.scale,
        passingScore: value.passingScore ?? null,
        rounding: value.rounding,
        updatedById: actor.id,
      },
    });
    await audit(
      tx,
      actor,
      "gradebook.settings.updated",
      "GradebookSettings",
      courseId,
      before
        ? {
            scale: before.scale,
            passingScore: before.passingScore?.toString() ?? null,
            rounding: before.rounding,
          }
        : undefined,
      {
        scale: updated.scale,
        passingScore: updated.passingScore?.toString() ?? null,
        rounding: updated.rounding,
      },
      request,
    );
    return updated;
  });
}

export async function setFinalGrade(
  actor: Actor,
  courseId: string,
  studentId: string,
  input: unknown,
  request: Request,
) {
  if (actor.role === "STUDENT")
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Изменять итоговую оценку может преподаватель или администратор.",
    );
  await assertCourseManageable(actor, courseId);
  const value = parse(finalGradeSchema, input);
  const settings = await getPrisma().gradebookSettings.findUnique({
    where: { courseId },
    select: { scale: true },
  });
  const maximum = settings?.scale === "SCORE_5" ? 5 : 100;
  if (value.score !== undefined && value.score !== null && value.score > maximum) {
    throw new ApiError(
      422,
      "FINAL_GRADE_TOO_HIGH",
      `Итоговая оценка не может превышать ${maximum} для выбранной шкалы.`,
    );
  }
  const enrollment = await getPrisma().enrollment.findFirst({
    where: {
      courseId,
      studentId,
      status: "ACTIVE",
      student: { role: "STUDENT", status: "ACTIVE" },
    },
    select: { id: true },
  });
  if (!enrollment)
    throw new ApiError(
      404,
      "STUDENT_NOT_ENROLLED",
      "Активное зачисление студента на курс не найдено.",
    );
  const before = await getPrisma().finalGrade.findUnique({
    where: { courseId_studentId: { courseId, studentId } },
  });
  return getPrisma().$transaction(async (tx) => {
    const grade = await tx.finalGrade.upsert({
      where: { courseId_studentId: { courseId, studentId } },
      create: {
        courseId,
        studentId,
        score: value.score ?? null,
        gradeLabel: value.gradeLabel ?? null,
        comment: value.comment ?? null,
        setById: actor.id,
      },
      update: {
        score: value.score ?? null,
        gradeLabel: value.gradeLabel ?? null,
        comment: value.comment ?? null,
        setById: actor.id,
        setAt: new Date(),
      },
    });
    await audit(
      tx,
      actor,
      "final-grade.overridden",
      "FinalGrade",
      grade.id,
      before
        ? {
            score: before.score?.toString() ?? null,
            gradeLabel: before.gradeLabel,
            comment: before.comment,
          }
        : undefined,
      {
        score: grade.score?.toString() ?? null,
        gradeLabel: grade.gradeLabel,
        comment: grade.comment,
        studentId,
      },
      request,
    );
    return grade;
  });
}

export function csvEscape(value: string | number | null | undefined): string {
  return escapeCsv(value);
}

export function parseAssignmentId(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Задание не найдено.");
  return parsed.data;
}
