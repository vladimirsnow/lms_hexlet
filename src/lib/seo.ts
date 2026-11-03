import { getSiteUrl } from "@/lib/site-url";

export const seoLocales = ["ru", "kk", "en"] as const;
export type SeoLocale = (typeof seoLocales)[number];

type SeoEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, "APP_URL" | "NODE_ENV" | "SEO_INDEXING_ENABLED" | "VERCEL_URL">
>;

export function isSeoIndexingEnabled(environment: SeoEnvironment = process.env) {
  if (environment.NODE_ENV !== "production" || environment.SEO_INDEXING_ENABLED !== "true") {
    return false;
  }

  const configuredUrl =
    environment.APP_URL ??
    (environment.VERCEL_URL ? `https://${environment.VERCEL_URL}` : "http://127.0.0.1:3000");
  const site = new URL(configuredUrl);
  const hostname = site.hostname.toLowerCase();
  const isLocalHost =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".example") ||
    hostname.endsWith(".invalid") ||
    hostname.startsWith("[") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);

  return site.protocol === "https:" && !isLocalHost;
}

export function localizedSiteUrl(path: string, locale: SeoLocale, baseUrl = getSiteUrl()): URL {
  const url = new URL(path, baseUrl);
  if (locale !== "ru") url.searchParams.set("locale", locale);
  return url;
}

export function localizedAlternates(path: string, baseUrl = getSiteUrl()) {
  return Object.fromEntries(
    seoLocales.map((locale) => [locale, localizedSiteUrl(path, locale, baseUrl).href]),
  );
}

export function getSeoRobots(indexable = isSeoIndexingEnabled()) {
  return {
    index: indexable,
    follow: indexable,
    googleBot: {
      index: indexable,
      follow: indexable,
      "max-image-preview": "large" as const,
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  };
}

export function organizationJsonLd(name: string, description: string, siteUrl = getSiteUrl()) {
  return {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    "@id": new URL("/#organization", siteUrl).href,
    name,
    description,
    url: siteUrl.href,
    logo: new URL("/hexlet-college-logo.svg", siteUrl).href,
  };
}
