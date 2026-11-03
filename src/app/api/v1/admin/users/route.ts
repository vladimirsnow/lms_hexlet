import { z } from "zod";
import { getRequestId } from "@/lib/http/request-id";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getPrisma } from "@/lib/db/prisma";
import { requireActor, requireAdminRole, assertSameOrigin } from "@/server/auth/session";
import { userRoles, type UserRole } from "@/server/policies/users";
import { createUser } from "@/server/services/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const localeSchema = z.enum(["ru", "kk", "en"]).default("ru");
const searchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.enum(userRoles).optional(),
  status: z.enum(["ACTIVE", "BLOCKED", "ARCHIVED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

const userSelect = {
  id: true,
  name: true,
  email: true,
  username: true,
  role: true,
  status: true,
  firstName: true,
  lastName: true,
  middleName: true,
  phone: true,
  locale: true,
  mustChangePassword: true,
  createdAt: true,
  lastLoginAt: true,
  curatedGroups: {
    where: { isActive: true },
    select: { id: true, name: true },
  },
  groupMemberships: {
    where: { leftAt: null },
    select: {
      isGroupLeader: true,
      group: { select: { id: true, name: true } },
    },
  },
} as const;

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);

    const url = new URL(request.url);
    const parsed = searchSchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Проверьте параметры поиска.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const { q, role, status, page, perPage } = parsed.data;
    const where = {
      ...(role ? { role: role as UserRole } : {}),
      ...(status
        ? { status }
        : status === undefined
          ? { status: { not: "ARCHIVED" as const } }
          : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { normalizedEmail: { contains: q.toLowerCase() } },
              { username: { contains: q.toLowerCase() } },
            ],
          }
        : {}),
    };

    const prisma = getPrisma();
    const [items, total, groups] = await Promise.all([
      prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.user.count({ where }),
      prisma.studyGroup.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          curatorId: true,
          curator: { select: { id: true, name: true } },
        },
        orderBy: { name: "asc" },
      }),
    ]);

    return Response.json(
      { items, page, perPage, total, groups },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}

const createSchema = z.object({
  email: z.email().trim().max(254),
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_.]+$/),
  role: z.enum(userRoles),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  locale: localeSchema,
});

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
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Проверьте данные пользователя.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const result = await createUser(actor, parsed.data, request);
    return Response.json(result, {
      status: 201,
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
