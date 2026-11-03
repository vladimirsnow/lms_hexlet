import { describe, expect, it } from "vitest";
import {
  getSeoRobots,
  isSeoIndexingEnabled,
  localizedAlternates,
  localizedSiteUrl,
} from "@/lib/seo";

describe("SEO configuration", () => {
  it("keeps indexing disabled unless production explicitly opts in over HTTPS", () => {
    expect(isSeoIndexingEnabled({ NODE_ENV: "development", SEO_INDEXING_ENABLED: "true" })).toBe(
      false,
    );
    expect(
      isSeoIndexingEnabled({
        NODE_ENV: "production",
        SEO_INDEXING_ENABLED: "true",
        APP_URL: "http://college.example",
      }),
    ).toBe(false);
    expect(
      isSeoIndexingEnabled({
        NODE_ENV: "production",
        SEO_INDEXING_ENABLED: "true",
        APP_URL: "https://college.test",
      }),
    ).toBe(false);
    expect(
      isSeoIndexingEnabled({
        NODE_ENV: "production",
        SEO_INDEXING_ENABLED: "true",
        APP_URL: "https://college.kz",
      }),
    ).toBe(true);
    expect(
      isSeoIndexingEnabled({
        NODE_ENV: "production",
        SEO_INDEXING_ENABLED: "true",
        VERCEL_URL: "kzhexly-college.vercel.app",
      }),
    ).toBe(true);
    expect(
      isSeoIndexingEnabled({
        NODE_ENV: "production",
        SEO_INDEXING_ENABLED: "true",
        APP_URL: "https://[::1]",
      }),
    ).toBe(false);
  });

  it("builds stable canonical URLs for all supported locales", () => {
    const baseUrl = new URL("https://college.kz");
    expect(localizedSiteUrl("/catalog", "ru", baseUrl).href).toBe("https://college.kz/catalog");
    expect(localizedSiteUrl("/catalog", "kk", baseUrl).href).toBe(
      "https://college.kz/catalog?locale=kk",
    );
    expect(localizedAlternates("/catalog", baseUrl)).toEqual({
      ru: "https://college.kz/catalog",
      kk: "https://college.kz/catalog?locale=kk",
      en: "https://college.kz/catalog?locale=en",
    });
  });

  it("sets a noindex policy when the deployment is not approved for search", () => {
    const robots = getSeoRobots(false);
    expect(robots.index).toBe(false);
    expect(robots.follow).toBe(false);
    expect(robots.googleBot.index).toBe(false);
  });
});
