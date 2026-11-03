import { ApiError, apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { assertSameOrigin, requireActor } from "@/server/auth/session";
import { importScheduleWorkbook } from "@/server/services/schedule-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(request.headers);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError(400, "INVALID_FORM", "Не удалось прочитать загруженный файл.");
    }
    const file = form.get("file");
    if (!(file instanceof File) || !file.size)
      throw new ApiError(422, "FILE_REQUIRED", "Выберите файл XLSX с расписанием.");
    if (file.size > 15 * 1024 * 1024)
      throw new ApiError(413, "FILE_TOO_LARGE", "Файл расписания больше 15 МБ.");
    if (!file.name.toLowerCase().endsWith(".xlsx"))
      throw new ApiError(422, "INVALID_FILE_TYPE", "Поддерживаются книги Excel в формате XLSX.");
    const result = await importScheduleWorkbook(
      actor,
      file.name,
      Buffer.from(await file.arrayBuffer()),
      request,
    );
    return Response.json(
      { item: result },
      { status: 201, headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
