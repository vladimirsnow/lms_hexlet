import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { PasswordChangeCard } from "@/app/change-password/change-password-form";
import { PublicLocaleLinks } from "@/components/public-locale-links";
import { getMessages, normalizeLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const { locale: localeParam } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (!session.user.mustChangePassword) redirect("/dashboard");
  const locale = normalizeLocale(localeParam ?? session.user.locale);
  const copy = getMessages(locale).auth;

  return (
    <main className="auth-page">
      <div className="auth-topbar">
        <Link className="brand" href={`/?locale=${locale}`}>
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">{getMessages(locale).landing.brand}</span>
        </Link>
        <Link className="auth-back-link" href={`/login?locale=${locale}`}>
          <ArrowLeft aria-hidden="true" size={15} />
          {copy.changePassword.backToLogin}
        </Link>
      </div>
      <div className="auth-change-password-content">
        <PasswordChangeCard locale={locale} />
      </div>
      <footer className="auth-footer">
        <span>{copy.login.footer}</span>
        <PublicLocaleLinks href="/change-password" locale={locale} />
      </footer>
    </main>
  );
}
