import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor, requireAdminRole } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ courseId: string }> };
const bodySchema = z.object({ groupId: z.uuid() });

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const { courseId } = await context.params;
    if (!z.uuid().safeParse(courseId).success)
      throw new ApiError(404, "COURSE_NOT_FOUND", "Курс не найден.");
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
        "Выберите группу.",
        parsed.error.flatten().fieldErrors,
      );

    const result = await getPrisma().$transaction(async (tx) => {
      const [course, group] = await Promise.all([
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
        tx.studyGroup.findUnique({
          where: { id: parsed.data.groupId },
          select: { id: true, name: true, academicYearId: true, specialtyId: true, isActive: true },
        }),
      ]);
      if (!course || course.deletedAt || course.status !== "PUBLISHED")
        throw new ApiError(
          409,
          "COURSE_NOT_ENROLLABLE",
          "Зачислять можно только на опубликованный курс.",
        );
      if (
        !group ||
        !group.isActive ||
        group.academicYearId !== course.academicYearId ||
        group.specialtyId !== course.specialtyId
      ) {
        throw new ApiError(
          422,
          "GROUP_COURSE_MISMATCH",
          "Группа должна относиться к специальности и учебному году курса.",
        );
      }
      const members = await tx.groupMember.findMany({
        where: { groupId: group.id, leftAt: null },
        include: { student: { select: { id: true, role: true, status: true, deletedAt: true } } },
      });
      const studentIds = members
        .filter(
          ({ student }) =>
            student.role === "STUDENT" && student.status === "ACTIVE" && !student.deletedAt,
        )
        .map(({ student }) => student.id);
      if (!studentIds.length)
        throw new ApiError(409, "GROUP_EMPTY", "В активной группе нет студентов для зачисления.");

      let enrolled = 0;
      let alreadyEnrolled = 0;
      for (const studentId of studentIds) {
        const key = { courseId_studentId: { courseId, studentId } };
        const existing = await tx.enrollment.findUnique({ where: key });
        if (existing?.status === "ACTIVE" || existing?.status === "COMPLETED") {
          alreadyEnrolled += 1;
          continue;
        }
        if (existing) {
          await tx.enrollment.update({
            where: { id: existing.id },
            data: {
              status: "ACTIVE",
              groupId: group.id,
              enrolledAt: new Date(),
              completedAt: null,
            },
          });
        } else {
          await tx.enrollment.create({ data: { courseId, studentId, groupId: group.id } });
        }
        enrolled += 1;
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "course.group_enrolled",
          entityType: "course",
          entityId: courseId,
          afterJson: { groupId: group.id, groupName: group.name, enrolled, alreadyEnrolled },
          userAgent: request.headers.get("user-agent")?.slice(0, 1000) || null,
        },
      });
      return { groupId: group.id, groupName: group.name, enrolled, alreadyEnrolled };
    });
    return Response.json(
      { result },
      { status: 201, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
