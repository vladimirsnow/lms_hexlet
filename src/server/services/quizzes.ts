import { Prisma } from "../../../generated/prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/http/api-error";
import type { Actor } from "@/server/auth/session";
import { assertCourseManageable, assertCourseReadable } from "@/server/services/course-content";

const idSchema = z.uuid();
const testCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10000).nullable().optional(),
  lessonId: z.uuid().nullable().optional(),
  timeLimitMinutes: z.preprocess((value) => value === "" || value === undefined ? null : value, z.coerce.number().int().min(1).max(600).nullable()).optional(),
  attemptsAllowed: z.coerce.number().int().min(1).max(20).default(1),
  shuffleQuestions: z.boolean().default(true),
  passingPercent: z.coerce.number().min(0).max(100).default(50),
});
const testUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  timeLimitMinutes: z.preprocess((value) => value === "" ? null : value, z.coerce.number().int().min(1).max(600).nullable()).optional(),
  attemptsAllowed: z.coerce.number().int().min(1).max(20).optional(),
  shuffleQuestions: z.boolean().optional(),
  passingPercent: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]).optional(),
});
const questionSchema = z.object({
  type: z.enum(["SINGLE", "MULTIPLE", "SHORT_ANSWER", "ESSAY"]),
  prompt: z.string().trim().min(1).max(10000),
  points: z.coerce.number().positive().max(9999.99),
  options: z.array(z.object({ text: z.string().trim().min(1).max(1000), isCorrect: z.boolean() })).max(20).default([]),
  acceptedAnswers: z.array(z.string().trim().min(1).max(1000)).max(50).default([]),
  caseSensitive: z.boolean().default(false),
});
const answerSchema = z.array(z.object({
  questionId: z.uuid(),
  answer: z.union([z.string().max(20000), z.array(z.uuid()).max(50), z.null()]),
})).max(200);
const essayGradeSchema = z.object({
  scores: z.array(z.object({ questionId: z.uuid(), points: z.coerce.number().min(0).max(9999.99), feedback: z.string().trim().max(5000).nullable().optional() })).min(1).max(200),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(422, "VALIDATION_ERROR", "Проверьте поля формы.", result.error.flatten().fieldErrors);
  return result.data;
}

export function parseTestId(value: string) {
  const result = idSchema.safeParse(value);
  if (!result.success) throw new ApiError(404, "TEST_NOT_FOUND", "Тест не найден.");
  return result.data;
}

export function parseQuestionId(value: string) {
  const result = idSchema.safeParse(value);
  if (!result.success) throw new ApiError(404, "QUESTION_NOT_FOUND", "Вопрос не найден.");
  return result.data;
}

export function parseTestAttemptId(value: string) {
  const result = idSchema.safeParse(value);
  if (!result.success) throw new ApiError(404, "ATTEMPT_NOT_FOUND", "Попытка не найдена.");
  return result.data;
}

function requireStudent(actor: Actor) {
  if (actor.role !== "STUDENT") throw new ApiError(403, "FORBIDDEN", "Тесты проходят только студенты.");
}

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function audit(tx: Prisma.TransactionClient, actor: Actor, action: string, entityType: string, entityId: string, before: unknown, after: unknown, request: Request) {
  await tx.auditLog.create({ data: {
    actorId: actor.id, action, entityType, entityId,
    beforeJson: before === undefined ? Prisma.JsonNull : auditJson(before),
    afterJson: after === undefined ? Prisma.JsonNull : auditJson(after),
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  } });
}

async function getManageableTest(actor: Actor, testId: string) {
  const test = await getPrisma().test.findFirst({ where: { id: testId, deletedAt: null }, select: { id: true, courseId: true, status: true, title: true, _count: { select: { attempts: true, questions: true } } } });
  if (!test) throw new ApiError(404, "TEST_NOT_FOUND", "Тест не найден.");
  await assertCourseManageable(actor, test.courseId);
  return test;
}

export async function listCourseTests(actor: Actor, courseId: string) {
  await assertCourseReadable(actor, courseId);
  return getPrisma().test.findMany({
    where: {
      courseId, deletedAt: null,
      ...(actor.role === "STUDENT" ? { OR: [
        { status: "PUBLISHED" },
        { status: "CLOSED", attempts: { some: { studentId: actor.id } } },
      ] } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { questions: true } },
      attempts: {
        where: actor.role === "STUDENT" ? { studentId: actor.id } : {},
        orderBy: { attemptNo: "desc" },
        select: { id: true, attemptNo: true, status: true, score: true, maxScore: true, isTimedOut: true, submittedAt: true, student: { select: { id: true, name: true } } },
      },
    },
  });
}

export async function createCourseTest(actor: Actor, courseId: string, body: unknown, request: Request) {
  await assertCourseManageable(actor, courseId);
  const value = parse(testCreateSchema, body);
  if (value.lessonId) {
    const lesson = await getPrisma().lesson.findFirst({ where: { id: value.lessonId, deletedAt: null, section: { courseId } }, select: { id: true } });
    if (!lesson) throw new ApiError(422, "INVALID_TEST_LESSON", "Урок должен принадлежать этому курсу и быть активным.");
  }
  return getPrisma().$transaction(async (tx) => {
    const test = await tx.test.create({ data: {
      courseId, lessonId: value.lessonId ?? null, title: value.title, description: value.description ?? null,
      timeLimitMinutes: value.timeLimitMinutes ?? null, attemptsAllowed: value.attemptsAllowed,
      shuffleQuestions: value.shuffleQuestions, passingPercent: value.passingPercent, createdById: actor.id,
    } });
    await audit(tx, actor, "test.created", "Test", test.id, undefined, { courseId, title: test.title }, request);
    return test;
  });
}

export async function getTest(actor: Actor, testId: string) {
  const test = await getPrisma().test.findFirst({ where: { id: testId, deletedAt: null }, select: { id: true, courseId: true, status: true } });
  if (!test) throw new ApiError(404, "TEST_NOT_FOUND", "Тест не найден.");
  if (actor.role === "STUDENT" && test.status !== "PUBLISHED") {
    const pastAttempt = await getPrisma().testAttempt.findFirst({ where: { testId, studentId: actor.id }, select: { id: true } });
    if (!pastAttempt) throw new ApiError(404, "TEST_NOT_FOUND", "Тест не найден.");
  }
  await assertCourseReadable(actor, test.courseId);
  const manager = actor.role !== "STUDENT";
  const include: Prisma.TestInclude = {
    course: { select: { id: true, slug: true, title: true } },
    _count: { select: { questions: true } },
    attempts: {
      where: manager ? {} : { studentId: actor.id },
      orderBy: { attemptNo: "desc" },
      select: { id: true, attemptNo: true, status: true, score: true, maxScore: true, isTimedOut: true, submittedAt: true, startedAt: true, student: { select: { id: true, name: true } } },
    },
  };
  if (manager) include.questions = { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } };
  return getPrisma().test.findUnique({
    where: { id: testId },
    include,
  });
}

export async function updateTest(actor: Actor, testId: string, body: unknown, request: Request) {
  const existing = await getManageableTest(actor, testId);
  const value = parse(testUpdateSchema, body);
  if (!Object.keys(value).length) throw new ApiError(422, "EMPTY_UPDATE", "Укажите поля для изменения.");
  if (existing._count.attempts > 0 && (value.attemptsAllowed !== undefined && value.attemptsAllowed < existing._count.attempts)) {
    throw new ApiError(409, "TEST_ATTEMPTS_LOCKED", "Лимит попыток нельзя уменьшить ниже числа уже начатых попыток.");
  }
  if (value.status === "PUBLISHED") {
    const questions = await getPrisma().question.findMany({ where: { testId }, include: { options: true } });
    if (!questions.length) throw new ApiError(422, "TEST_EMPTY", "Добавьте хотя бы один вопрос перед публикацией.");
    for (const question of questions) {
      if ((question.type === "SINGLE" || question.type === "MULTIPLE") && question.options.filter((option) => option.isCorrect).length === 0) throw new ApiError(422, "QUESTION_WITHOUT_ANSWER", "У каждого вопроса с вариантами должен быть отмечен правильный ответ.");
      if (question.type === "SINGLE" && question.options.filter((option) => option.isCorrect).length !== 1) throw new ApiError(422, "QUESTION_SINGLE_ANSWER", "Вопрос с одним ответом должен иметь ровно один правильный вариант.");
      if (question.type === "SHORT_ANSWER" && (!Array.isArray(question.acceptedAnswers) || question.acceptedAnswers.length === 0)) throw new ApiError(422, "QUESTION_WITHOUT_ANSWER", "Добавьте допустимые ответы для каждого короткого вопроса.");
    }
  }
  return getPrisma().$transaction(async (tx) => {
    const updated = await tx.test.update({ where: { id: testId }, data: { ...value, updatedById: actor.id } });
    await audit(tx, actor, "test.updated", "Test", testId, { title: existing.title, status: existing.status }, { title: updated.title, status: updated.status }, request);
    return updated;
  });
}

export async function addTestQuestion(actor: Actor, testId: string, body: unknown, request: Request) {
  const test = await getManageableTest(actor, testId);
  if (test.status !== "DRAFT" || test._count.attempts > 0) throw new ApiError(409, "TEST_CONTENT_LOCKED", "Вопросы можно менять только в неопубликованном тесте без попыток.");
  const value = parse(questionSchema, body);
  if ((value.type === "SINGLE" || value.type === "MULTIPLE") && value.options.length < 2) throw new ApiError(422, "QUESTION_OPTIONS_REQUIRED", "Добавьте не менее двух вариантов ответа.");
  if (value.type === "SINGLE" && value.options.filter((option) => option.isCorrect).length !== 1) throw new ApiError(422, "QUESTION_SINGLE_ANSWER", "Выберите ровно один правильный вариант.");
  if (value.type === "MULTIPLE" && value.options.filter((option) => option.isCorrect).length < 1) throw new ApiError(422, "QUESTION_MULTIPLE_ANSWER", "Выберите хотя бы один правильный вариант.");
  if (value.type === "SHORT_ANSWER" && !value.acceptedAnswers.length) throw new ApiError(422, "QUESTION_SHORT_ANSWER_REQUIRED", "Укажите хотя бы один допустимый ответ.");
  const question = await getPrisma().$transaction(async (tx) => {
    const position = await tx.question.count({ where: { testId } });
    const created = await tx.question.create({
      data: {
        testId, type: value.type, prompt: value.prompt, points: value.points, position,
        acceptedAnswers: value.type === "SHORT_ANSWER" ? value.acceptedAnswers : Prisma.JsonNull,
        caseSensitive: value.caseSensitive,
        options: value.type === "SINGLE" || value.type === "MULTIPLE" ? { create: value.options.map((option, optionPosition) => ({ ...option, position: optionPosition })) } : undefined,
      },
      include: { options: { orderBy: { position: "asc" } } },
    });
    await audit(tx, actor, "test.question_added", "Question", created.id, undefined, { testId, type: created.type, points: created.points.toString() }, request);
    return created;
  });
  return question;
}

export async function deleteTestQuestion(actor: Actor, questionId: string, request: Request) {
  const question = await getPrisma().question.findUnique({ where: { id: questionId }, select: { id: true, testId: true, test: { select: { status: true, _count: { select: { attempts: true } } } } } });
  if (!question) throw new ApiError(404, "QUESTION_NOT_FOUND", "Вопрос не найден.");
  await getManageableTest(actor, question.testId);
  if (question.test.status !== "DRAFT" || question.test._count.attempts > 0) throw new ApiError(409, "TEST_CONTENT_LOCKED", "Нельзя удалить вопрос опубликованного теста или теста с попытками.");
  await getPrisma().$transaction(async (tx) => {
    await tx.questionOption.deleteMany({ where: { questionId } });
    await tx.question.delete({ where: { id: questionId } });
    await audit(tx, actor, "test.question_deleted", "Question", questionId, { testId: question.testId }, undefined, request);
  });
  return { id: questionId, deleted: true };
}

async function getStudentTest(actor: Actor, testId: string) {
  requireStudent(actor);
  const test = await getPrisma().test.findFirst({ where: { id: testId, deletedAt: null, status: "PUBLISHED" }, include: { course: { select: { id: true, title: true } }, questions: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" }, select: { id: true, text: true, position: true } } } } } });
  if (!test) throw new ApiError(404, "TEST_NOT_FOUND", "Тест не найден.");
  const enrolled = await getPrisma().enrollment.findFirst({ where: { courseId: test.courseId, studentId: actor.id, status: "ACTIVE" }, select: { id: true } });
  if (!enrolled) throw new ApiError(404, "TEST_NOT_FOUND", "Тест не найден.");
  return test;
}

export async function startTestAttempt(actor: Actor, testId: string) {
  const test = await getStudentTest(actor, testId);
  if (!test.questions.length) throw new ApiError(409, "TEST_EMPTY", "В этом тесте пока нет вопросов.");
  const created = await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${testId}:${actor.id}`}))::text`;
    const existing = await tx.testAttempt.findFirst({ where: { testId, studentId: actor.id, status: "IN_PROGRESS" }, orderBy: { attemptNo: "desc" }, select: { id: true } });
    if (existing) return tx.testAttempt.findUnique({ where: { id: existing.id } });
    const count = await tx.testAttempt.count({ where: { testId, studentId: actor.id } });
    if (count >= test.attemptsAllowed) throw new ApiError(409, "ATTEMPTS_EXHAUSTED", "Допустимое число попыток уже использовано.");
    const questionOrder = test.questions.map((question) => question.id);
    if (test.shuffleQuestions) questionOrder.sort(() => Math.random() - 0.5);
    const maxScore = test.questions.reduce((total, question) => total + Number(question.points), 0);
    const now = new Date();
    return tx.testAttempt.create({ data: {
      testId, studentId: actor.id, attemptNo: count + 1, questionOrder,
      maxScore,
      expiresAt: test.timeLimitMinutes ? new Date(now.getTime() + test.timeLimitMinutes * 60000) : null,
    } });
  });
  if (!created) throw new ApiError(500, "ATTEMPT_CREATE_FAILED", "Не удалось начать попытку.");
  return getTestAttempt(actor, created.id);
}

async function accessibleAttempt(actor: Actor, attemptId: string) {
  const attempt = await getPrisma().testAttempt.findUnique({
    where: { id: attemptId },
    include: { test: { include: { course: { select: { id: true, title: true, slug: true } }, questions: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } } }, student: { select: { id: true, name: true } }, answers: true },
  });
  if (!attempt) throw new ApiError(404, "ATTEMPT_NOT_FOUND", "Попытка не найдена.");
  if (actor.role === "STUDENT") {
    if (attempt.studentId !== actor.id) throw new ApiError(404, "ATTEMPT_NOT_FOUND", "Попытка не найдена.");
  } else {
    await assertCourseManageable(actor, attempt.test.courseId);
  }
  return attempt;
}

function safeAnswer(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function getTestAttempt(actor: Actor, attemptId: string) {
  const attempt = await accessibleAttempt(actor, attemptId);
  const manager = actor.role !== "STUDENT";
  const questionIds = Array.isArray(attempt.questionOrder) ? attempt.questionOrder.filter((value): value is string => typeof value === "string") : [];
  const byId = new Map(attempt.test.questions.map((question) => [question.id, question]));
  const questions = questionIds.map((id) => byId.get(id)).filter((question): question is NonNullable<typeof question> => Boolean(question));
  return {
    id: attempt.id,
    attemptNo: attempt.attemptNo,
    status: attempt.status,
    score: attempt.score?.toString() ?? null,
    maxScore: attempt.maxScore.toString(),
    isTimedOut: attempt.isTimedOut || Boolean(attempt.expiresAt && attempt.expiresAt < new Date()),
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt,
    student: manager ? attempt.student : undefined,
    test: { id: attempt.test.id, title: attempt.test.title, passingPercent: attempt.test.passingPercent.toString(), course: attempt.test.course },
    questions: attempt.status === "IN_PROGRESS" || manager ? questions.map((question) => ({
      id: question.id, type: question.type, prompt: question.prompt, points: question.points.toString(), position: question.position,
      ...(question.type === "SHORT_ANSWER" && manager ? { acceptedAnswers: question.acceptedAnswers } : {}),
      options: question.options.map((option) => ({ id: option.id, text: option.text, position: option.position, ...(manager ? { isCorrect: option.isCorrect } : {}) })),
    })) : [],
    answers: attempt.answers.map((answer) => ({ questionId: answer.questionId, answer: answer.answerJson, pointsAwarded: answer.pointsAwarded?.toString() ?? null, feedback: manager ? answer.feedback : undefined })),
  };
}

async function saveDraftAnswers(actor: Actor, attemptId: string, input: unknown) {
  requireStudent(actor);
  const answers = parse(answerSchema, input);
  const attempt = await accessibleAttempt(actor, attemptId);
  if (attempt.status !== "IN_PROGRESS" || (attempt.expiresAt && attempt.expiresAt < new Date())) throw new ApiError(409, "ATTEMPT_EXPIRED", "Время попытки истекло. Отправьте ответы для завершения.");
  const validQuestions = new Set(attempt.test.questions.map((question) => question.id));
  if (answers.some((answer) => !validQuestions.has(answer.questionId))) throw new ApiError(422, "INVALID_QUESTION", "Ответ содержит вопрос, которого нет в этом тесте.");
  await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${attemptId}))::text`;
    for (const answer of answers) {
      await tx.testAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: answer.questionId } },
        create: { attemptId, questionId: answer.questionId, answerJson: safeAnswer(answer.answer) },
        update: { answerJson: safeAnswer(answer.answer) },
      });
    }
  });
  return { saved: answers.length };
}

export async function saveTestAttemptAnswers(actor: Actor, attemptId: string, body: unknown) {
  return saveDraftAnswers(actor, attemptId, body);
}

function exactSet(first: string[], second: string[]) {
  return first.length === second.length && first.every((value) => second.includes(value));
}

export async function submitTestAttempt(actor: Actor, attemptId: string, body: unknown, request: Request) {
  requireStudent(actor);
  const answers = parse(answerSchema, body);
  const attempt = await accessibleAttempt(actor, attemptId);
  if (attempt.status !== "IN_PROGRESS") throw new ApiError(409, "ATTEMPT_ALREADY_SUBMITTED", "Эта попытка уже отправлена.");
  const incoming = new Map(answers.map((answer) => [answer.questionId, answer.answer]));
  const questionIds = new Set(attempt.test.questions.map((question) => question.id));
  if (answers.some((answer) => !questionIds.has(answer.questionId))) throw new ApiError(422, "INVALID_QUESTION", "Ответ содержит вопрос, которого нет в этом тесте.");
  const previous = new Map(attempt.answers.map((answer) => [answer.questionId, answer.answerJson]));
  const now = new Date();
  const isTimedOut = Boolean(attempt.expiresAt && attempt.expiresAt < now);
  let autoScore = 0;
  let needsReview = false;
  const graded = attempt.test.questions.map((question) => {
    const answer = incoming.has(question.id) ? incoming.get(question.id) : previous.get(question.id);
    let pointsAwarded: number | null = null;
    if (question.type === "ESSAY") {
      needsReview = true;
    } else if (question.type === "SINGLE") {
      const correct = question.options.find((option) => option.isCorrect)?.id;
      pointsAwarded = typeof answer === "string" && answer === correct ? Number(question.points) : 0;
    } else if (question.type === "MULTIPLE") {
      const correct = question.options.filter((option) => option.isCorrect).map((option) => option.id);
      const selected = Array.isArray(answer) && answer.every((value) => typeof value === "string") ? answer : [];
      pointsAwarded = exactSet(correct, selected) ? Number(question.points) : 0;
    } else {
      const accepted = Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers.filter((item): item is string => typeof item === "string") : [];
      const candidate = typeof answer === "string" ? answer.trim() : "";
      pointsAwarded = accepted.some((item) => question.caseSensitive ? item.trim() === candidate : item.trim().toLocaleLowerCase() === candidate.toLocaleLowerCase()) ? Number(question.points) : 0;
    }
    if (pointsAwarded !== null) autoScore += pointsAwarded;
    return { question, answer: answer ?? null, pointsAwarded };
  });
  const status = needsReview ? "NEEDS_REVIEW" : isTimedOut ? "TIMED_OUT" : "GRADED";
  await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${attemptId}))::text`;
    const current = await tx.testAttempt.findUnique({ where: { id: attemptId }, select: { status: true, studentId: true } });
    if (!current || current.studentId !== actor.id || current.status !== "IN_PROGRESS") throw new ApiError(409, "ATTEMPT_ALREADY_SUBMITTED", "Эта попытка уже отправлена.");
    for (const item of graded) {
      await tx.testAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: item.question.id } },
        create: { attemptId, questionId: item.question.id, answerJson: safeAnswer(item.answer), pointsAwarded: item.pointsAwarded },
        update: { answerJson: safeAnswer(item.answer), pointsAwarded: item.pointsAwarded },
      });
    }
    await tx.testAttempt.update({ where: { id: attemptId }, data: { status, score: autoScore, submittedAt: now, isTimedOut, ...(!needsReview ? { gradedAt: now } : {}) } });
    await audit(tx, actor, "test_attempt.submitted", "TestAttempt", attemptId, { status: "IN_PROGRESS" }, { status, score: autoScore, maxScore: Number(attempt.maxScore), isTimedOut }, request);
  });
  return getTestAttempt(actor, attemptId);
}

export async function gradeTestEssays(actor: Actor, attemptId: string, body: unknown, request: Request) {
  const attempt = await accessibleAttempt(actor, attemptId);
  const value = parse(essayGradeSchema, body);
  const essayIds = new Set(attempt.test.questions.filter((question) => question.type === "ESSAY").map((question) => question.id));
  if (!essayIds.size || value.scores.some((item) => !essayIds.has(item.questionId))) throw new ApiError(422, "INVALID_ESSAY_GRADE", "Укажите баллы только для эссе этого теста.");
  const questionById = new Map(attempt.test.questions.map((question) => [question.id, question]));
  for (const item of value.scores) if (item.points > Number(questionById.get(item.questionId)?.points ?? 0)) throw new ApiError(422, "GRADE_EXCEEDS_MAX", "Баллы за эссе не могут превышать максимум вопроса.");
  return getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${attemptId}))::text`;
    const current = await tx.testAttempt.findUnique({ where: { id: attemptId }, select: { status: true } });
    if (!current || !["NEEDS_REVIEW", "TIMED_OUT"].includes(current.status)) throw new ApiError(409, "ATTEMPT_NOT_READY", "Нет отправленной попытки, ожидающей ручной проверки.");
    let score = Number(attempt.score ?? 0);
    const previousEssayScores = attempt.answers.filter((answer) => essayIds.has(answer.questionId)).reduce((total, answer) => total + Number(answer.pointsAwarded ?? 0), 0);
    score -= previousEssayScores;
    for (const item of value.scores) {
      score += item.points;
      await tx.testAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: item.questionId } },
        create: { attemptId, questionId: item.questionId, answerJson: Prisma.JsonNull, pointsAwarded: item.points, feedback: item.feedback ?? null },
        update: { pointsAwarded: item.points, feedback: item.feedback ?? null },
      });
    }
    const pendingEssays = [...essayIds].filter((id) => !value.scores.some((item) => item.questionId === id));
    const status = pendingEssays.length ? "NEEDS_REVIEW" : "GRADED";
    const updated = await tx.testAttempt.update({ where: { id: attemptId }, data: { score, status, gradedAt: status === "GRADED" ? new Date() : null } });
    await audit(tx, actor, "test_attempt.essays_graded", "TestAttempt", attemptId, { score: attempt.score?.toString(), status: attempt.status }, { score: updated.score?.toString(), status }, request);
    return { id: updated.id, score: updated.score?.toString() ?? "0", maxScore: updated.maxScore.toString(), status };
  });
}
