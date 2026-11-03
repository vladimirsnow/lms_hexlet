import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor, requireAdminRole } from "@/server/auth/session";
import { userRoles } from "@/server/policies/users";
import { archiveUser, updateUser } from "@/server/services/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ userId: string }> };

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
} as const;

function userIdFrom(context: RouteContext): Promise<string> {
  return context.params.then(({ userId }) => {
    if (!z.uuid().safeParse(userId).success) {
      throw new ApiError(404, "USER_NOT_FOUND", "Пользователь не найден.");
    }
    return userId;
  });
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const userId = await userIdFrom(context);
    const user = await getPrisma().user.findUnique({ where: { id: userId }, select: userSelect });
    if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Пользователь не найден.");

    return Response.json(
      { user },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}

const updateSchema = z
  .object({
    email: z.email().trim().max(254).optional(),
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    middleName: z.string().trim().max(80).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    locale: z.enum(["ru", "kk", "en"]).optional(),
    role: z.enum(userRoles).optional(),
    status: z.enum(["ACTIVE", "BLOCKED", "ARCHIVED"]).optional(),
    curatedGroupIds: z.array(z.uuid()).max(200).optional(),
    studentGroupId: z.uuid().nullable().optional(),
    isGroupLeader: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Укажите хотя бы одно поле для изменения.");

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const userId = await userIdFrom(context);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Тело запроса должно быть JSON.");
    }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Проверьте данные пользователя.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const user = await updateUser(actor, userId, parsed.data, request);
    return Response.json(
      { user },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const userId = await userIdFrom(context);
    const user = await archiveUser(actor, userId, request);
    return Response.json(
      { user },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
