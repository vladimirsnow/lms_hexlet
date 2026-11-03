import { sanitizeRichText } from "@/lib/security/sanitize-html";

export function RichTextContent({ content }: { content: string }) {
  return (
    <div
      className="course-lesson-text rich-text-content"
      dangerouslySetInnerHTML={{ __html: sanitizeRichText(content) }}
    />
  );
}
