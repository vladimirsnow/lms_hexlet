import { describe, expect, it } from "vitest";
import { hasRichTextContent, sanitizeRichText } from "./sanitize-html";

describe("sanitizeRichText", () => {
  it("keeps supported formatting and strips active elements and attributes", () => {
    const sanitized = sanitizeRichText(
      '<p onclick="alert(1)">Lesson <strong>text</strong></p><script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)" target="_blank">unsafe link</a>',
    );

    expect(sanitized).toContain("<p>Lesson <strong>text</strong></p>");
    expect(sanitized).toContain("<a>unsafe link</a>");
    expect(sanitized).not.toMatch(/script|img|onclick|onerror|javascript|target=/i);
  });

  it("preserves links with safe URLs", () => {
    expect(sanitizeRichText('<p><a href="https://example.edu/lesson">Read more</a></p>')).toBe(
      '<p><a href="https://example.edu/lesson">Read more</a></p>',
    );
  });
});

describe("hasRichTextContent", () => {
  it("rejects empty editor markup and accepts visible text", () => {
    expect(hasRichTextContent("<p></p>")).toBe(false);
    expect(hasRichTextContent("<p>&nbsp;</p>")).toBe(false);
    expect(hasRichTextContent("<p>Lesson text</p>")).toBe(true);
  });
});
