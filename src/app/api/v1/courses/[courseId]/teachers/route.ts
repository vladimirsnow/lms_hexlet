import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor, requireAdminRole } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ courseId: string }> };
const bodySchema = z.object({ teacherId: z.uuid() });

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
    const assignments = await getPrisma().courseTeacher.findMany({
      where: { courseId },
      include: { teacher: { select: { id: true, name: true, email: true } } },
      orderBy: { assignedAt: "asc" },
    });
    return Response.json(
      { items: assignments },
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
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success)
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Укажите преподавателя.",
        parsed.error.flatten().fieldErrors,
      );

    const prisma = getPrisma();
    const assignment = await prisma.$transaction(async (tx) => {
      const [course, teacher] = await Promise.all([
        tx.course.findUnique({
          where: { id: courseId },
          select: { id: true, deletedAt: true, status: true },
        }),
        tx.user.findUnique({
          where: { id: parsed.data.teacherId },
          select: { id: true, name: true, role: true, status: true },
        }),
      ]);
      if (!course || course.deletedAt || course.status === "ARCHIVED")
        throw new ApiError(404, "COURSE_NOT_FOUND", "Курс не найден.");
      if (!teacher || teacher.role !== "TEACHER" || teacher.status !== "ACTIVE") {
        throw new ApiError(
          422,
          "INVALID_TEACHER",
          "Назначить можно только активного преподавателя.",
        );
      }
      const created = await tx.courseTeacher.create({
        data: { courseId, teacherId: teacher.id, assignedById: actor.id },
        include: { teacher: { select: { id: true, name: true, email: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "course.teacher_assigned",
          entityType: "course",
          entityId: courseId,
          afterJson: { teacherId: teacher.id, teacherName: teacher.name },
          userAgent: request.headers.get("user-agent")?.slice(0, 1000) || null,
        },
      });
      return created;
    });
    return Response.json(
      { assignment },
      { status: 201, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return apiErrorResponse(
        new ApiError(409, "TEACHER_ALREADY_ASSIGNED", "Этот преподаватель уже назначен на курс."),
        requestId,
      );
    }
    return apiErrorResponse(error, requestId);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
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
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success)
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Укажите преподавателя.",
        parsed.error.flatten().fieldErrors,
      );
    const prisma = getPrisma();
    const removed = await prisma.$transaction(async (tx) => {
      const assignment = await tx.courseTeacher.findUnique({
        where: { courseId_teacherId: { courseId, teacherId: parsed.data.teacherId } },
        include: { teacher: { select: { name: true } } },
      });
      if (!assignment)
        throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Назначение преподавателя не найдено.");
      await tx.courseTeacher.delete({ where: { id: assignment.id } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "course.teacher_unassigned",
          entityType: "course",
          entityId: courseId,
          beforeJson: { teacherId: assignment.teacherId, teacherName: assignment.teacher.name },
          userAgent: request.headers.get("user-agent")?.slice(0, 1000) || null,
        },
      });
      return { teacherId: assignment.teacherId };
    });
    return Response.json(
      { removed },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
