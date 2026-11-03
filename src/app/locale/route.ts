import { NextRequest, NextResponse } from "next/server";
import { normalizeLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const locale = normalizeLocale(request.nextUrl.searchParams.get("locale"));
  const requestedReturnTo = request.nextUrl.searchParams.get("returnTo") ?? "/";
  let destination: URL;

  try {
    const candidate = new URL(requestedReturnTo, request.url);
    destination = candidate.origin === request.nextUrl.origin ? candidate : new URL("/", request.url);
  } catch {
    destination = new URL("/", request.url);
  }

  const response = NextResponse.redirect(destination);
  response.cookies.set("lms_locale", locale, {
    path: "/",
    maxAge: 31_536_000,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
