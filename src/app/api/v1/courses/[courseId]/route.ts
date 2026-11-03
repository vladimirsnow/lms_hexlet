import { z } from "zod";
import { Prisma } from "../../../../../../generated/prisma/client";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getPrisma } from "@/lib/db/prisma";
import { getRequestId } from "@/lib/http/request-id";
import { requireActor } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ courseId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const { courseId } = await context.params;
    if (!z.string().min(3).max(220).safeParse(courseId).success) {
      throw new ApiError(404, "COURSE_NOT_FOUND", "Курс не найден.");
    }
    const identifierFilter: Prisma.CourseWhereInput = z.uuid().safeParse(courseId).success
      ? { id: courseId }
      : { slug: courseId };
    const accessFilter: Prisma.CourseWhereInput =
      actor.role === "STUDENT"
        ? {
            status: "PUBLISHED",
            enrollments: { some: { studentId: actor.id, status: "ACTIVE" } },
          }
        : actor.role === "TEACHER"
          ? { status: { not: "ARCHIVED" }, teacherAssignments: { some: { teacherId: actor.id } } }
          : {};
    const course = await getPrisma().course.findFirst({
      where: {
        ...identifierFilter,
        deletedAt: null,
        ...accessFilter,
      },
      include: {
        subject: {
          select: { code: true, nameRu: true, description: true, credits: true, totalHours: true },
        },
        term: { select: { name: true, startsOn: true, endsOn: true } },
        academicYear: { select: { name: true } },
        specialty: { select: { code: true, nameRu: true } },
        teacherAssignments: { include: { teacher: { select: { id: true, name: true } } } },
      },
    });
    if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "Курс не найден.");
    return Response.json(
      { course },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
