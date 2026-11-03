export function getTrustedAuthOrigins(
  appUrl: string,
  vercelHosts: Array<string | undefined>,
): string[] {
  const origins = new Set([new URL(appUrl).origin]);

  for (const host of vercelHosts) {
    const value = host?.trim();
    if (!value) continue;

    try {
      const candidate = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (
        candidate.protocol !== "https:" ||
        candidate.username ||
        candidate.password ||
        candidate.pathname !== "/" ||
        candidate.search ||
        candidate.hash
      ) {
        continue;
      }

      origins.add(candidate.origin);
    } catch {
      // Ignore malformed deployment host values; keep the configured APP_URL.
    }
  }

  return [...origins];
}
