const localFallback = "http://127.0.0.1:3000";

export function getSiteUrl(): URL {
  const configured =
    process.env.APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : localFallback);
  const site = new URL(configured);

  if (site.protocol !== "http:" && site.protocol !== "https:") {
    throw new Error("APP_URL must use HTTP or HTTPS.");
  }

  return new URL(site.origin);
}
