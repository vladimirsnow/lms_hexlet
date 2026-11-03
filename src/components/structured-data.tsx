import { headers } from "next/headers";
import { isSeoIndexingEnabled } from "@/lib/seo";

export async function StructuredData({ data }: { data: Record<string, unknown> }) {
  if (!isSeoIndexingEnabled()) return null;

  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");

  return (
    <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: json }} />
  );
}
