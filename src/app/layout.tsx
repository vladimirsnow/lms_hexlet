import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { getSeoRobots } from "@/lib/seo";
import { getSiteUrl } from "@/lib/site-url";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = normalizeLocale((await cookies()).get("lms_locale")?.value);
  const landing = getMessages(locale).landing;
  return {
    metadataBase: getSiteUrl(),
    title: { default: landing.seoTitle, template: `%s | ${landing.brand}` },
    description: landing.seoDescription,
    applicationName: landing.brand,
    publisher: landing.brand,
    category: "education",
    formatDetection: { telephone: false, address: false, email: false },
    robots: getSeoRobots(),
    openGraph: {
      type: "website",
      siteName: landing.brand,
      title: landing.seoTitle,
      description: landing.seoDescription,
      locale: locale === "kk" ? "kk_KZ" : locale === "en" ? "en_US" : "ru_RU",
    },
    twitter: {
      card: "summary_large_image",
      title: landing.seoTitle,
      description: landing.seoDescription,
    },
    icons: { icon: "/icon.svg" },
    manifest: "/manifest.webmanifest",
  };
}

export const viewport: Viewport = {
  themeColor: "#6c3f8f",
  colorScheme: "light dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const locale = normalizeLocale(cookieStore.get("lms_locale")?.value);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;

  return (
    <html lang={locale} data-scroll-behavior="smooth">
      <body>
        <script defer nonce={nonce} src="/register-service-worker.js" />
        {children}
      </body>
    </html>
  );
}
