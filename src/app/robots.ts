import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";
import { isSeoIndexingEnabled } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const indexable = isSeoIndexingEnabled();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    ...(indexable ? { sitemap: new URL("/sitemap.xml", getSiteUrl()).href } : {}),
  };
}
