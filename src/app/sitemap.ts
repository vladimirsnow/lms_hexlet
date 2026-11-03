import type { MetadataRoute } from "next";
import { getPrisma } from "@/lib/db/prisma";
import { getSiteUrl } from "@/lib/site-url";
import { isSeoIndexingEnabled, localizedAlternates, localizedSiteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isSeoIndexingEnabled()) return [];

  const site = getSiteUrl();
  const courses = await getPrisma().course.findMany({
    where: { status: "PUBLISHED", deletedAt: null },
    select: { slug: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 49_998,
  });

  return [
    {
      url: localizedSiteUrl("/", "ru", site).href,
      changeFrequency: "weekly",
      priority: 1,
      alternates: { languages: localizedAlternates("/", site) },
    },
    {
      url: localizedSiteUrl("/catalog", "ru", site).href,
      changeFrequency: "weekly",
      priority: 0.9,
      alternates: { languages: localizedAlternates("/catalog", site) },
    },
    ...courses.map((course) => ({
      url: localizedSiteUrl(`/catalog/${course.slug}`, "ru", site).href,
      lastModified: course.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.7,
      alternates: { languages: localizedAlternates(`/catalog/${course.slug}`, site) },
    })),
  ];
}
