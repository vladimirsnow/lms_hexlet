import { describe, expect, it } from "vitest";
import {
  createSessionCsrfToken,
  getSessionTokenFromCookieHeader,
  verifySessionCsrfToken,
} from "./csrf";

const secret = "test-secret-that-is-long-enough-for-hmac";

describe("session-bound CSRF tokens", () => {
  it("reads the Better Auth session cookie with development and secure names", () => {
    expect(
      getSessionTokenFromCookieHeader("lms_locale=kk; better-auth.session_token=abc.def=="),
    ).toBe("abc.def==");
    expect(
      getSessionTokenFromCookieHeader("__Secure-better-auth.session_token=secure-token; other=x"),
    ).toBe("secure-token");
    expect(getSessionTokenFromCookieHeader("session=not-auth")).toBeNull();
    expect(getSessionTokenFromCookieHeader(null)).toBeNull();
  });

  it("creates a stable token for one session and a different token for another", () => {
    expect(createSessionCsrfToken("session-a", secret)).toBe(
      createSessionCsrfToken("session-a", secret),
    );
    expect(createSessionCsrfToken("session-a", secret)).not.toBe(
      createSessionCsrfToken("session-b", secret),
    );
    expect(createSessionCsrfToken("session-a", secret)).not.toBe(
      createSessionCsrfToken("session-a", `${secret}-rotated`),
    );
  });

  it("rejects absent, altered, and cross-session tokens", () => {
    const cookie = "better-auth.session_token=session-a";
    const token = createSessionCsrfToken("session-a", secret);

    expect(verifySessionCsrfToken(cookie, token, secret)).toBe(true);
    expect(verifySessionCsrfToken(cookie, null, secret)).toBe(false);
    expect(verifySessionCsrfToken(cookie, `${token}x`, secret)).toBe(false);
    expect(verifySessionCsrfToken("better-auth.session_token=session-b", token, secret)).toBe(
      false,
    );
    expect(verifySessionCsrfToken("other=value", token, secret)).toBe(false);
  });
});
