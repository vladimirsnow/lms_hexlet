import { z } from "zod";
import { Prisma } from "../../../../../generated/prisma/client";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getPrisma } from "@/lib/db/prisma";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor, requireAdminRole } from "@/server/auth/session";
import { createAcademicRecord } from "@/server/services/academic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  academicYearId: z.uuid().optional(),
  specialtyId: z.uuid().optional(),
  category: z.enum(["OOD", "OOM", "PM", "SPECIALTY", "COHORT"]).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
});

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Проверьте параметры каталога.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const { q, page, perPage, academicYearId, specialtyId, category, status } = parsed.data;
    const accessFilter: Prisma.CourseWhereInput =
      actor.role === "STUDENT"
        ? {
            status: "PUBLISHED",
            enrollments: { some: { studentId: actor.id, status: "ACTIVE" } },
          }
        : actor.role === "TEACHER"
          ? {
              ...(status ? { status } : { status: { not: "ARCHIVED" } }),
              teacherAssignments: { some: { teacherId: actor.id } },
            }
          : status
            ? { status }
            : {};
    const where: Prisma.CourseWhereInput = {
      deletedAt: null,
      ...accessFilter,
      ...(academicYearId ? { academicYearId } : {}),
      ...(specialtyId ? { specialtyId } : {}),
      ...(category ? { category } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { slug: { contains: q, mode: "insensitive" } },
              { subject: { nameRu: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const prisma = getPrisma();
    const [items, total] = await Promise.all([
      prisma.course.findMany({
        where,
        include: {
          subject: { select: { id: true, code: true, nameRu: true } },
          term: { select: { id: true, name: true } },
          academicYear: { select: { id: true, name: true } },
          specialty: { select: { id: true, code: true, nameRu: true } },
          teacherAssignments: { include: { teacher: { select: { id: true, name: true } } } },
        },
        orderBy: [{ academicYear: { startsOn: "desc" } }, { title: "asc" }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.course.count({ where }),
    ]);
    return Response.json(
      { items, total, page, perPage },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Тело запроса должно быть JSON.");
    }
    const item = await createAcademicRecord(actor, "courses", body, request);
    return Response.json(
      { item },
      { status: 201, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
