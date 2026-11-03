import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor, requireAdminRole } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ courseId: string }> };
const enrollmentSchema = z.object({ studentId: z.uuid() });

async function courseIdFrom(context: RouteContext) {
  const { courseId } = await context.params;
  if (!z.uuid().safeParse(courseId).success)
    throw new ApiError(404, "COURSE_NOT_FOUND", "Курс не найден.");
  return courseId;
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const courseId = await courseIdFrom(context);
    const items = await getPrisma().enrollment.findMany({
      where: { courseId },
      include: {
        student: { select: { id: true, name: true, email: true, username: true, status: true } },
        group: { select: { id: true, name: true } },
      },
      orderBy: [{ status: "asc" }, { student: { lastName: "asc" } }],
    });
    return Response.json(
      { items },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const courseId = await courseIdFrom(context);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Тело запроса должно быть JSON.");
    }
    const parsed = enrollmentSchema.safeParse(body);
    if (!parsed.success)
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Укажите студента.",
        parsed.error.flatten().fieldErrors,
      );

    const prisma = getPrisma();
    const enrollment = await prisma.$transaction(async (tx) => {
      const [course, student, membership] = await Promise.all([
        tx.course.findUnique({
          where: { id: courseId },
          select: {
            id: true,
            status: true,
            deletedAt: true,
            academicYearId: true,
            specialtyId: true,
          },
        }),
        tx.user.findUnique({
          where: { id: parsed.data.studentId },
          select: { id: true, role: true, status: true, deletedAt: true },
        }),
        tx.groupMember.findFirst({
          where: { studentId: parsed.data.studentId, leftAt: null },
          include: {
            group: {
              select: { id: true, academicYearId: true, specialtyId: true, isActive: true },
            },
          },
        }),
      ]);
      if (!course || course.deletedAt || course.status !== "PUBLISHED")
        throw new ApiError(
          409,
          "COURSE_NOT_ENROLLABLE",
          "Зачислять можно только на опубликованный курс.",
        );
      if (
        !student ||
        student.role !== "STUDENT" ||
        student.status !== "ACTIVE" ||
        student.deletedAt
      ) {
        throw new ApiError(422, "INVALID_STUDENT", "Выберите активного студента.");
      }
      if (
        membership &&
        (!membership.group.isActive ||
          membership.group.academicYearId !== course.academicYearId ||
          membership.group.specialtyId !== course.specialtyId)
      ) {
        throw new ApiError(
          422,
          "STUDENT_COURSE_MISMATCH",
          "Курс не соответствует текущей группе студента.",
        );
      }
      const key = { courseId_studentId: { courseId, studentId: student.id } };
      const previous = await tx.enrollment.findUnique({ where: key });
      if (previous && previous.status !== "WITHDRAWN") {
        throw new ApiError(409, "ALREADY_ENROLLED", "Студент уже зачислен на этот курс.");
      }
      const saved = previous
        ? await tx.enrollment.update({
            where: { id: previous.id },
            data: {
              status: "ACTIVE",
              groupId: membership?.groupId ?? null,
              enrolledAt: new Date(),
              completedAt: null,
            },
          })
        : await tx.enrollment.create({
            data: { courseId, studentId: student.id, groupId: membership?.groupId ?? null },
          });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: previous ? "course.enrollment_reactivated" : "course.student_enrolled",
          entityType: "course",
          entityId: courseId,
          afterJson: { studentId: student.id, enrollmentId: saved.id, groupId: saved.groupId },
          userAgent: request.headers.get("user-agent")?.slice(0, 1000) || null,
        },
      });
      return saved;
    });
    return Response.json(
      { enrollment },
      { status: 201, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
