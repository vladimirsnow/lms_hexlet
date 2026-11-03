import DOMPurify from "isomorphic-dompurify";

const RICH_TEXT_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "h2",
  "h3",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strong",
  "u",
  "ul",
];

export function sanitizeRichText(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: RICH_TEXT_TAGS,
    ALLOWED_ATTR: ["href", "rel"],
    ALLOW_DATA_ATTR: false,
  });
}

export function hasRichTextContent(value: string): boolean {
  return (
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/&(?:nbsp|#160|#x0*a0);/gi, " ")
      .trim().length > 0
  );
}
