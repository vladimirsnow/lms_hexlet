import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getPrisma } from "@/lib/db/prisma";
import { getRequestId } from "@/lib/http/request-id";
import { requireActor, requireAdminRole } from "@/server/auth/session";
import { userRoles, type UserRole } from "@/server/policies/users";
import { csvEscape } from "@/server/services/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const exportSchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.enum(userRoles).optional(),
  status: z.enum(["ACTIVE", "BLOCKED", "ARCHIVED"]).optional(),
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
  createdAt: true,
  lastLoginAt: true,
} as const;

const columns = [
  "username",
  "email",
  "role",
  "status",
  "firstName",
  "lastName",
  "middleName",
  "phone",
  "locale",
  "createdAt",
  "lastLoginAt",
];

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const url = new URL(request.url);
    const parsed = exportSchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Проверьте параметры экспорта.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const { q, role, status } = parsed.data;
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
    const encoder = new TextEncoder();
    let cursorId: string | undefined;
    let headerSent = false;
    let closed = false;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (closed) return;
        if (!headerSent) {
          controller.enqueue(encoder.encode(`\uFEFF${columns.map(csvEscape).join(",")}\r\n`));
          headerSent = true;
        }
        try {
          const users = await prisma.user.findMany({
            where,
            select: userSelect,
            orderBy: { id: "asc" },
            ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
            take: 500,
          });
          if (!users.length) {
            closed = true;
            controller.close();
            return;
          }
          const content = users
            .map((user) =>
              [
                user.username,
                user.email,
                user.role,
                user.status,
                user.firstName,
                user.lastName,
                user.middleName,
                user.phone,
                user.locale,
                user.createdAt.toISOString(),
                user.lastLoginAt?.toISOString() ?? "",
              ]
                .map(csvEscape)
                .join(","),
            )
            .join("\r\n");
          controller.enqueue(encoder.encode(`${content}\r\n`));
          cursorId = users.at(-1)?.id;
          if (users.length < 500) {
            closed = true;
            controller.close();
          }
        } catch (error) {
          closed = true;
          controller.error(error);
        }
      },
      cancel() {
        closed = true;
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="users-export.csv"',
        "Cache-Control": "no-store",
        "X-Request-ID": requestId,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
