import { logger } from "@/lib/logger";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiErrorResponse(error: unknown, requestId: string): Response {
  const apiError = error instanceof ApiError ? error : undefined;
  const status = apiError?.status ?? 500;

  if (!apiError || status >= 500) {
    logger.error(
      {
        requestId,
        errorType: error instanceof Error ? error.name : "UnknownError",
      },
      "API request failed",
    );
  }

  return Response.json(
    {
      error: {
        code: apiError?.code ?? "INTERNAL_ERROR",
        message: apiError && status < 500 ? apiError.message : "Внутренняя ошибка сервера.",
        ...(apiError && apiError.details !== undefined ? { details: apiError.details } : {}),
      },
    },
    {
      status,
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    },
  );
}
