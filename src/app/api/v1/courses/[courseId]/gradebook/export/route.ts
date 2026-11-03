import { apiErrorResponse } from "@/lib/http/api-error";
import { getRequestId } from "@/lib/http/request-id";
import { requireActor } from "@/server/auth/session";
import { csvEscape, getGradebook, parseAssignmentId } from "@/server/services/assignments";
import { createXlsx } from "@/server/services/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ courseId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const actor = await requireActor(request.headers);
    const { courseId: value } = await context.params;
    const gradebook = await getGradebook(actor, parseAssignmentId(value));
    const header = [
      "Студент",
      "Email",
      ...gradebook.assignments.map((assignment) => assignment.title),
      "Расчётный итог",
      "Оценка",
      "Ручной комментарий",
    ];
    const rows = gradebook.rows.map((row) => [
      row.student.name,
      row.student.email,
      ...row.assignments.map((cell) =>
        cell.score === null ? "" : `${cell.score}/${cell.maxScore}`,
      ),
      row.finalOverride?.score ?? row.calculatedPercent ?? "",
      row.finalOverride?.gradeLabel ?? row.gradeLabel ?? "",
      row.finalOverride?.comment ?? "",
    ]);
    if (new URL(request.url).searchParams.get("format") === "xlsx") {
      const xlsx = createXlsx([header, ...rows]);
      return new Response(new Uint8Array(xlsx), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="gradebook-${value}.xlsx"`,
          "Cache-Control": "no-store",
          "X-Request-ID": requestId,
        },
      });
    }
    const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n")}`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="gradebook-${value}.csv"`,
        "Cache-Control": "no-store",
        "X-Request-ID": requestId,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}
