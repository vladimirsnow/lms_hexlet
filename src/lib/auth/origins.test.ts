import { describe, expect, it } from "vitest";
import { getTrustedAuthOrigins } from "./origins";

describe("trusted auth origins", () => {
  it("allows the configured app URL and exact Vercel project hosts", () => {
    expect(
      getTrustedAuthOrigins("https://lms.example.kz", [
        "deployment-123.vercel.app",
        "branch-preview.vercel.app/",
        "lms.example.kz",
      ]),
    ).toEqual([
      "https://lms.example.kz",
      "https://deployment-123.vercel.app",
      "https://branch-preview.vercel.app",
    ]);
  });

  it("rejects insecure or malformed deployment origins", () => {
    expect(
      getTrustedAuthOrigins("https://lms.example.kz", [
        "http://preview.vercel.app",
        "https://preview.vercel.app/path",
        "not a host",
      ]),
    ).toEqual(["https://lms.example.kz"]);
  });
});
