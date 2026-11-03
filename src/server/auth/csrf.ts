import { createHmac, timingSafeEqual } from "node:crypto";

const sessionCookieNames = new Set([
  "better-auth.session_token",
  "better-auth.session-token",
  "__Secure-better-auth.session_token",
  "__Secure-better-auth.session-token",
]);

export function getSessionTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (sessionCookieNames.has(name) && value) return value;
  }

  return null;
}

export function createSessionCsrfToken(sessionToken: string, secret: string): string {
  const message = `kzhexly-csrf-v1\0${sessionToken.length}\0${sessionToken}`;
  const digest = createHmac("sha256", secret).update(message).digest("base64url");
  return `v1.${digest}`;
}

export function verifySessionCsrfToken(
  cookieHeader: string | null,
  candidate: string | null,
  secret: string,
): boolean {
  if (!candidate || candidate.length > 128) return false;

  const sessionToken = getSessionTokenFromCookieHeader(cookieHeader);
  if (!sessionToken) return false;

  const expectedBytes = Buffer.from(createSessionCsrfToken(sessionToken, secret));
  const candidateBytes = Buffer.from(candidate);
  return (
    expectedBytes.length === candidateBytes.length && timingSafeEqual(expectedBytes, candidateBytes)
  );
}
