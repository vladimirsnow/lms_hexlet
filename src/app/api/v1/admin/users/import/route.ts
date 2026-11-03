import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor, requireAdminRole } from "@/server/auth/session";
import { CsvSyntaxError, parseCsvRecords } from "@/server/services/csv";
import { createUser } from "@/server/services/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const userImportSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_.]+$/),
  email: z.email().trim().max(254),
  role: z.enum(["STUDENT", "TEACHER"]),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  locale: z.enum(["ru", "kk", "en"]).optional().default("ru"),
});

const requiredHeaders = ["username", "email", "role", "firstname", "lastname"];

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    requireAdminRole(actor.role);
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 1_100_000) {
      throw new ApiError(413, "CSV_TOO_LARGE", "Размер CSV-файла не должен превышать 1 МБ.");
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv")) {
      throw new ApiError(422, "CSV_FILE_REQUIRED", "Выберите CSV-файл.");
    }
    if (file.size > 1_000_000) {
      throw new ApiError(413, "CSV_TOO_LARGE", "Размер CSV-файла не должен превышать 1 МБ.");
    }

    let records: string[][];
    try {
      records = parseCsvRecords(await file.text());
    } catch (error) {
      if (error instanceof CsvSyntaxError) {
        throw new ApiError(422, "INVALID_CSV", "Проверьте кавычки и разделители в CSV-файле.");
      }
      throw error;
    }
    if (!records.length) throw new ApiError(422, "EMPTY_CSV", "CSV-файл пуст.");
    const header = records[0].map((value) => value.toLowerCase());
    const headerSet = new Set(header);
    if (
      headerSet.size !== header.length ||
      requiredHeaders.some((required) => !headerSet.has(required))
    ) {
      throw new ApiError(
        422,
        "INVALID_CSV_HEADER",
        `CSV должен содержать столбцы: ${requiredHeaders.join(", ")}.`,
      );
    }
    if (records.length === 1) {
      throw new ApiError(422, "EMPTY_CSV", "В CSV нет строк пользователей.");
    }
    if (records.length - 1 > 500) {
      throw new ApiError(
        413,
        "CSV_TOO_LARGE",
        "За один раз можно импортировать не более 500 строк.",
      );
    }

    const column = Object.fromEntries(header.map((name, index) => [name, index]));
    const created: Array<{
      row: number;
      email: string;
      username: string;
      temporaryPassword: string;
    }> = [];
    const errors: Array<{ row: number; email?: string; message: string }> = [];
    const seenEmails = new Set<string>();
    const seenUsernames = new Set<string>();

    for (const [index, values] of records.slice(1).entries()) {
      const row = index + 2;
      const emailValue = values[column.email] ?? "";
      const email = emailValue.trim().toLowerCase();
      if (values.length !== header.length) {
        errors.push({ row, email: email || undefined, message: "Некорректное число столбцов." });
        continue;
      }
      const parsed = userImportSchema.safeParse({
        username: values[column.username],
        email: emailValue,
        role: values[column.role]?.trim().toUpperCase(),
        firstName: values[column.firstname],
        lastName: values[column.lastname],
        middleName: column.middlename === undefined ? "" : values[column.middlename],
        phone: column.phone === undefined ? "" : values[column.phone],
        locale: column.locale === undefined ? "ru" : values[column.locale],
      });
      if (!parsed.success) {
        errors.push({
          row,
          email: email || undefined,
          message: `Некорректные данные (${parsed.error.issues[0]?.path.join(".") || "строка"}).`,
        });
        continue;
      }

      const normalizedEmail = parsed.data.email.toLowerCase();
      const normalizedUsername = parsed.data.username.toLowerCase();
      if (seenEmails.has(normalizedEmail)) {
        errors.push({ row, email: normalizedEmail, message: "Email повторяется в файле." });
        continue;
      }
      if (seenUsernames.has(normalizedUsername)) {
        errors.push({ row, email: normalizedEmail, message: "Логин повторяется в файле." });
        continue;
      }
      seenEmails.add(normalizedEmail);
      seenUsernames.add(normalizedUsername);

      try {
        const result = await createUser(actor, parsed.data, request);
        created.push({
          row,
          email: result.user.email,
          username: result.user.username ?? parsed.data.username,
          temporaryPassword: result.temporaryPassword,
        });
      } catch (error) {
        errors.push({
          row,
          email: normalizedEmail,
          message:
            error instanceof ApiError && error.status === 409
              ? "Email или логин уже используется."
              : "Не удалось создать аккаунт.",
        });
      }
    }

    return Response.json(
      { result: { created, errors, createdCount: created.length, errorCount: errors.length } },
      { headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
