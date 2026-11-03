import { apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { requireActor } from "@/server/auth/session";
import { csvEscape } from "@/server/services/assignments";
import { getAttendanceReport } from "@/server/services/schedule";
import { createXlsx } from "@/server/services/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const url = new URL(request.url);
    const report = await getAttendanceReport(
      actor,
      url.searchParams.get("from"),
      url.searchParams.get("to"),
    );
    const format = url.searchParams.get("format");
    if (format === "csv" || format === "xlsx") {
      const header = [
        "Дата",
        "Студент",
        "Группа",
        "Курс",
        "Преподаватель",
        "Начало",
        "Конец",
        "Аудитория",
        "Статус",
        "Комментарий",
      ];
      const rows = report.records.map((record) => [
        record.date,
        record.student.name,
        record.group,
        record.course,
        record.teacher,
        record.startTime,
        record.endTime,
        record.room,
        record.status,
        record.note,
      ]);
      if (format === "xlsx") {
        const xlsx = createXlsx([header, ...rows]);
        return new Response(new Uint8Array(xlsx), {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="attendance-${report.from}-${report.to}.xlsx"`,
            "Cache-Control": "no-store",
            "X-Request-ID": requestId,
          },
        });
      }
      const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n")}`;
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="attendance-${report.from}-${report.to}.csv"`,
          "Cache-Control": "no-store",
          "X-Request-ID": requestId,
        },
      });
    }
    return Response.json(report, {
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
