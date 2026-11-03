import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor, requireAdminRole } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ groupId: string }> };
type CsvRow = { row: number; email: string };

function parseCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(field.trim());
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) return null;
  fields.push(field.trim());
  return fields;
}

function parseRows(content: string): {
  rows: CsvRow[];
  errors: Array<{ row: number; email?: string; message: string }>;
} {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (!lines.length) throw new ApiError(422, "EMPTY_CSV", "CSV-файл пуст.");
  const header = parseCsvLine(lines[0])?.map((value) => value.toLowerCase());
  if (!header || !header.includes("email")) {
    throw new ApiError(422, "INVALID_CSV_HEADER", "В CSV должна быть колонка email.");
  }
  const emailIndex = header.indexOf("email");
  const errors: Array<{ row: number; email?: string; message: string }> = [];
  const rows: CsvRow[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.slice(1).entries()) {
    const rowNumber = index + 2;
    const values = parseCsvLine(line);
    if (!values || values.length !== header.length) {
      errors.push({ row: rowNumber, message: "Некорректная строка CSV." });
      continue;
    }
    const email = values[emailIndex]?.trim().toLowerCase() ?? "";
    if (!z.email().safeParse(email).success) {
      errors.push({ row: rowNumber, email, message: "Укажите корректный email." });
      continue;
    }
    if (seen.has(email)) {
      errors.push({ row: rowNumber, email, message: "Email повторяется в файле." });
      continue;
    }
    seen.add(email);
    rows.push({ row: rowNumber, email });
  }
  if (rows.length > 500)
    throw new ApiError(422, "CSV_TOO_LARGE", "За один раз можно импортировать не более 500 строк.");
  return { rows, errors };
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const { groupId } = await context.params;
    if (!z.uuid().safeParse(groupId).success)
      throw new ApiError(404, "GROUP_NOT_FOUND", "Группа не найдена.");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(422, "CSV_FILE_REQUIRED", "Выберите CSV-файл.");
    if (file.size > 1_000_000)
      throw new ApiError(413, "CSV_TOO_LARGE", "Размер CSV-файла не должен превышать 1 МБ.");
    const { rows, errors } = parseRows(await file.text());
    if (rows.length + errors.length > 500)
      throw new ApiError(
        422,
        "CSV_TOO_LARGE",
        "За один раз можно импортировать не более 500 строк.",
      );

    const result = await getPrisma().$transaction(async (tx) => {
      const group = await tx.studyGroup.findUnique({
        where: { id: groupId },
        select: { id: true, name: true, isActive: true, capacity: true },
      });
      if (!group || !group.isActive)
        throw new ApiError(404, "GROUP_NOT_FOUND", "Активная группа не найдена.");
      let currentCount = await tx.groupMember.count({ where: { groupId, leftAt: null } });
      let added = 0;
      let skipped = 0;
      for (const row of rows) {
        const student = await tx.user.findFirst({
          where: { normalizedEmail: row.email, role: "STUDENT", status: "ACTIVE", deletedAt: null },
          select: { id: true, name: true },
        });
        if (!student) {
          errors.push({
            row: row.row,
            email: row.email,
            message: "Активный аккаунт студента не найден.",
          });
          continue;
        }
        const current = await tx.groupMember.findFirst({
          where: { studentId: student.id, leftAt: null },
        });
        if (current?.groupId === groupId) {
          skipped += 1;
          continue;
        }
        if (current) {
          errors.push({
            row: row.row,
            email: row.email,
            message: "Студент уже состоит в другой группе.",
          });
          continue;
        }
        if (group.capacity !== null && currentCount >= group.capacity) {
          errors.push({
            row: row.row,
            email: row.email,
            message: "В группе достигнут лимит студентов.",
          });
          continue;
        }
        await tx.groupMember.create({ data: { groupId, studentId: student.id } });
        currentCount += 1;
        added += 1;
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "group.members_imported",
          entityType: "group",
          entityId: groupId,
          afterJson: { groupName: group.name, added, skipped, errorCount: errors.length },
          userAgent: request.headers.get("user-agent")?.slice(0, 1000) || null,
        },
      });
      return { groupId, groupName: group.name, added, skipped, errors };
    });
    return Response.json(
      { result },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
