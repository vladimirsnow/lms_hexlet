import { NextRequest, NextResponse } from "next/server";

function getStorageOrigin(): string | null {
  const endpoint = process.env.MINIO_ENDPOINT;
  if (!endpoint) return null;

  try {
    const protocol = process.env.MINIO_USE_SSL === "true" ? "https" : "http";
    return new URL(`${protocol}://${endpoint}`).origin;
  } catch {
    return null;
  }
}

const privatePageRoots = [
  "admin",
  "announcements",
  "assignments",
  "change-password",
  "courses",
  "dashboard",
  "notifications",
  "schedule",
  "student",
  "teacher",
  "tests",
];

function isPrivatePagePath(pathname: string) {
  if (pathname === "/login") return true;
  const firstSegment = pathname.split("/").filter(Boolean)[0];
  return firstSegment !== undefined && privatePageRoots.includes(firstSegment);
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const storageOrigin = getStorageOrigin();
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const isHttps = request.nextUrl.protocol === "https:" || forwardedProto === "https";
  const connectSources = [
    "'self'",
    ...(storageOrigin ? [storageOrigin] : []),
    ...(isDevelopment ? ["ws:", "wss:"] : []),
  ];
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    `img-src 'self' blob: data:${storageOrigin ? ` ${storageOrigin}` : ""}`,
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (isPrivatePagePath(request.nextUrl.pathname)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  if (isHttps)
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
