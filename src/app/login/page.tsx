import type { Metadata } from "next";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { cookies } from "next/headers";
import { LoginForm } from "@/app/login/login-form";
import { PublicLocaleLinks } from "@/components/public-locale-links";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { getSeoRobots } from "@/lib/seo";

type LoginPageProps = {
  searchParams: Promise<{ passwordChanged?: string; locale?: string }>;
};

export async function generateMetadata({ searchParams }: LoginPageProps): Promise<Metadata> {
  const [{ locale: localeParam }, cookieStore] = await Promise.all([searchParams, cookies()]);
  const landing = getMessages(
    normalizeLocale(localeParam || cookieStore.get("lms_locale")?.value),
  ).landing;

  return {
    title: landing.signIn,
    description: landing.accessDescription,
    robots: getSeoRobots(false),
  };
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [{ passwordChanged, locale: localeParam }, cookieStore] = await Promise.all([
    searchParams,
    cookies(),
  ]);
  const locale = normalizeLocale(localeParam || cookieStore.get("lms_locale")?.value);
  const copy = getMessages(locale).auth.login;
  const messages = getMessages(locale);
  const landing = messages.landing;
  const homeHref = `/?locale=${locale}`;

  return (
    <main className="auth-page">
      <div className="auth-topbar">
        <a className="brand" href={homeHref}>
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">{landing.brand}</span>
        </a>
        <a className="auth-back-link" href={homeHref}>
          <ArrowLeft aria-hidden="true" size={15} />
          {messages.home}
        </a>
      </div>

      <div className="auth-content">
        <section className="auth-intro">
          <p className="eyebrow">
            <span className="eyebrow-dot" /> {copy.eyebrow}
          </p>
          <h1>
            {copy.greeting}
            <br />
            <em>{copy.returnGreeting}</em>
          </h1>
          <p>{copy.description}</p>
          <div className="auth-campus-card">
            <div className="auth-campus-icon">01</div>
            <div>
              <strong>{copy.campusTitle}</strong>
              <span>{copy.campusDetails}</span>
            </div>
            <ArrowUpRight aria-hidden="true" size={17} />
          </div>
        </section>

        <section aria-labelledby="login-title" className="auth-card">
          <div className="auth-card-heading">
            <div className="auth-card-icon">
              <span className="brand-mark" aria-hidden="true" />
            </div>
            <p className="eyebrow">{copy.cardEyebrow}</p>
            <h2 id="login-title">{copy.title}</h2>
            <p>{copy.instructions}</p>
          </div>
          {passwordChanged === "1" ? (
            <p className="auth-success" role="status">
              {copy.passwordChanged}
            </p>
          ) : null}
          <LoginForm locale={locale} copy={copy} />
          <div className="auth-card-footer">{copy.noAccount}</div>
        </section>
      </div>

      <footer className="auth-footer">
        <span>{copy.footer}</span>
        <PublicLocaleLinks
          href="/login"
          locale={locale}
          passwordChanged={passwordChanged === "1"}
        />
      </footer>
    </main>
  );
}
