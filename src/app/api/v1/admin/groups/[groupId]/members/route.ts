import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor, requireAdminRole } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ groupId: string }> };
const bodySchema = z.object({
  studentId: z.uuid(),
  isGroupLeader: z.boolean().optional().default(false),
});

async function groupIdFrom(context: RouteContext) {
  const { groupId } = await context.params;
  if (!z.uuid().safeParse(groupId).success)
    throw new ApiError(404, "GROUP_NOT_FOUND", "Группа не найдена.");
  return groupId;
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const groupId = await groupIdFrom(context);
    const members = await getPrisma().groupMember.findMany({
      where: { groupId, leftAt: null },
      include: {
        student: { select: { id: true, name: true, email: true, username: true, status: true } },
      },
      orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
    });
    return Response.json(
      { items: members },
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
    const groupId = await groupIdFrom(context);
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
        "Укажите студента.",
        parsed.error.flatten().fieldErrors,
      );

    const result = await getPrisma().$transaction(async (tx) => {
      const [group, student] = await Promise.all([
        tx.studyGroup.findUnique({
          where: { id: groupId },
          select: { id: true, name: true, isActive: true, capacity: true },
        }),
        tx.user.findUnique({
          where: { id: parsed.data.studentId },
          select: { id: true, name: true, role: true, status: true, deletedAt: true },
        }),
      ]);
      if (!group || !group.isActive)
        throw new ApiError(404, "GROUP_NOT_FOUND", "Активная группа не найдена.");
      if (
        !student ||
        student.role !== "STUDENT" ||
        student.status !== "ACTIVE" ||
        student.deletedAt
      ) {
        throw new ApiError(422, "INVALID_STUDENT", "Выберите активного студента.");
      }
      const current = await tx.groupMember.findFirst({
        where: { studentId: student.id, leftAt: null },
      });
      if (current?.groupId === groupId) {
        if (parsed.data.isGroupLeader) {
          await tx.groupMember.updateMany({
            where: { groupId, leftAt: null, isGroupLeader: true, id: { not: current.id } },
            data: { isGroupLeader: false },
          });
        }
        const updated =
          current.isGroupLeader === parsed.data.isGroupLeader
            ? current
            : await tx.groupMember.update({
                where: { id: current.id },
                data: { isGroupLeader: parsed.data.isGroupLeader },
              });
        if (current.isGroupLeader !== parsed.data.isGroupLeader) {
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: "group.student_role_updated",
              entityType: "group",
              entityId: groupId,
              beforeJson: { studentId: student.id, isGroupLeader: current.isGroupLeader },
              afterJson: {
                groupId,
                groupName: group.name,
                studentId: student.id,
                studentName: student.name,
                isGroupLeader: parsed.data.isGroupLeader,
              },
              userAgent: request.headers.get("user-agent")?.slice(0, 1000) || null,
            },
          });
        }
        return { membership: updated, status: 200 };
      }
      const currentCount = await tx.groupMember.count({ where: { groupId, leftAt: null } });
      if (group.capacity !== null && currentCount >= group.capacity)
        throw new ApiError(409, "GROUP_CAPACITY_REACHED", "В группе достигнут лимит студентов.");

      const now = new Date();
      if (current)
        await tx.groupMember.update({
          where: { id: current.id },
          data: { leftAt: now, isGroupLeader: false },
        });
      if (parsed.data.isGroupLeader) {
        await tx.groupMember.updateMany({
          where: { groupId, leftAt: null, isGroupLeader: true },
          data: { isGroupLeader: false },
        });
      }
      const created = await tx.groupMember.create({
        data: {
          groupId,
          studentId: student.id,
          joinedAt: now,
          isGroupLeader: parsed.data.isGroupLeader,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: current ? "group.student_transferred" : "group.student_added",
          entityType: "group",
          entityId: groupId,
          beforeJson: current ? { groupId: current.groupId, studentId: student.id } : undefined,
          afterJson: {
            groupId,
            groupName: group.name,
            studentId: student.id,
            studentName: student.name,
            isGroupLeader: parsed.data.isGroupLeader,
          },
          userAgent: request.headers.get("user-agent")?.slice(0, 1000) || null,
        },
      });
      return { membership: created, status: 201 };
    });
    return Response.json(
      { membership: result.membership },
      {
        status: result.status,
        headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return apiErrorResponse(
        new ApiError(
          409,
          "STUDENT_GROUP_CONFLICT",
          "Одновременно можно состоять только в одной активной группе.",
        ),
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
    const groupId = await groupIdFrom(context);
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
        "Укажите студента.",
        parsed.error.flatten().fieldErrors,
      );
    const result = await getPrisma().$transaction(async (tx) => {
      const membership = await tx.groupMember.findFirst({
        where: { groupId, studentId: parsed.data.studentId, leftAt: null },
      });
      if (!membership)
        throw new ApiError(
          404,
          "MEMBERSHIP_NOT_FOUND",
          "Активное зачисление студента в группу не найдено.",
        );
      const ended = await tx.groupMember.update({
        where: { id: membership.id },
        data: { leftAt: new Date(), isGroupLeader: false },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "group.student_removed",
          entityType: "group",
          entityId: groupId,
          beforeJson: { groupId, studentId: membership.studentId },
          afterJson: { leftAt: ended.leftAt?.toISOString() },
          userAgent: request.headers.get("user-agent")?.slice(0, 1000) || null,
        },
      });
      return ended;
    });
    return Response.json(
      { membership: result },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
