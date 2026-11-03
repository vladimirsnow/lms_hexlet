import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  ClipboardCheck,
  GraduationCap,
  Sparkles,
} from "lucide-react";
import { PublicLocaleLinks } from "@/components/public-locale-links";
import { StructuredData } from "@/components/structured-data";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import {
  getSeoRobots,
  isSeoIndexingEnabled,
  localizedAlternates,
  localizedSiteUrl,
  organizationJsonLd,
} from "@/lib/seo";
import styles from "./landing.module.css";

type HomePageProps = { searchParams: Promise<{ locale?: string }> };

export async function generateMetadata({ searchParams }: HomePageProps): Promise<Metadata> {
  const [{ locale: localeParam }, cookieStore] = await Promise.all([searchParams, cookies()]);
  const locale = normalizeLocale(localeParam || cookieStore.get("lms_locale")?.value);
  const landing = getMessages(locale).landing;
  const indexable = isSeoIndexingEnabled();
  const canonical = localizedSiteUrl("/", locale);

  return {
    title: landing.seoTitle,
    description: landing.seoDescription,
    robots: getSeoRobots(indexable),
    alternates: indexable
      ? { canonical: canonical.href, languages: localizedAlternates("/") }
      : undefined,
    openGraph: {
      type: "website",
      siteName: landing.brand,
      title: landing.seoTitle,
      description: landing.seoDescription,
      url: canonical.href,
      locale: locale === "kk" ? "kk_KZ" : locale === "en" ? "en_US" : "ru_RU",
    },
    twitter: {
      card: "summary_large_image",
      title: landing.seoTitle,
      description: landing.seoDescription,
    },
  };
}

export default async function Home({ searchParams }: HomePageProps) {
  const [{ locale: localeParam }, cookieStore] = await Promise.all([searchParams, cookies()]);
  const locale = normalizeLocale(localeParam || cookieStore.get("lms_locale")?.value);
  const messages = getMessages(locale);
  const t = messages.landing;
  const loginHref = `/login?locale=${locale}`;
  const featureIcons = [BookOpen, ClipboardCheck, CalendarDays];
  const sectionIcons = [BookOpen, ClipboardCheck, GraduationCap];

  return (
    <main className={styles.page}>
      <StructuredData data={organizationJsonLd(t.brand, t.seoDescription)} />
      <header className={styles.header}>
        <Link aria-label={t.home} className={styles.brand} href={`/?locale=${locale}`}>
          <span className={styles.brandMark}>
            <GraduationCap aria-hidden="true" size={22} strokeWidth={2} />
          </span>
          <span className={styles.brandText}>{t.brand}</span>
        </Link>

        <nav aria-label={t.navigation} className={styles.navigation}>
          <Link href="#about">{t.about}</Link>
          <Link href="#features">{t.featuresLink}</Link>
        </nav>

        <div className={styles.headerActions}>
          <PublicLocaleLinks href="/" label={messages.languageHeader} locale={locale} />
          <Link className={styles.headerSignIn} href={loginHref}>
            {t.signIn}
            <ArrowUpRight aria-hidden="true" size={16} />
          </Link>
        </div>
      </header>

      <section aria-labelledby="landing-title" className={styles.hero} id="about">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowIcon}>
              <Sparkles aria-hidden="true" size={14} />
            </span>
            {t.heroEyebrow}
          </p>
          <h1 className={styles.heroTitle} id="landing-title">
            {t.heroTitle[0]} <em>{t.heroTitle[1]}</em>
            <br />
            <span>{t.heroTitle[2]}</span>
          </h1>
          <p className={styles.heroDescription}>{t.heroDescription}</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href={loginHref}>
              {t.studentSignIn}
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          </div>
          <div className={styles.heroFootnote}>
            <span className={styles.footnoteCheck}>
              <Check aria-hidden="true" size={13} strokeWidth={3} />
            </span>
            {t.heroNote}
          </div>
        </div>

        <div aria-label={t.illustration} className={styles.heroVisual} role="img">
          <div className={styles.visualHalo} />
          <div className={styles.visualOrb} />
          <div className={styles.dashboardCard}>
            <div className={styles.dashboardTopbar}>
              <span className={styles.dashboardBrandMark}>
                <GraduationCap aria-hidden="true" size={15} />
              </span>
              <span className={styles.dashboardBrand}>{t.brand}</span>
              <span className={styles.dashboardTopDots} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </div>
            <div className={styles.dashboardBody}>
              <div className={styles.dashboardGreeting}>
                <span>{t.today}</span>
                <span className={styles.todayDot} />
              </div>
              <div className={styles.lessonCard}>
                <span className={styles.lessonIcon}>
                  <BookOpen aria-hidden="true" size={19} />
                </span>
                <div className={styles.lessonCopy}>
                  <strong>{t.sampleCourse}</strong>
                  <span>
                    <CalendarDays aria-hidden="true" size={13} />
                    {t.sampleRoom}
                  </span>
                </div>
                <ArrowUpRight aria-hidden="true" className={styles.lessonArrow} size={17} />
              </div>

              <div className={styles.progressCard}>
                <div className={styles.progressHeading}>
                  <span>{t.progress}</span>
                  <strong>84%</strong>
                </div>
                <div className={styles.progressTrack}>
                  <span />
                </div>
                <div className={styles.progressFooter}>
                  <span>{t.progressMeta}</span>
                  <div className={styles.progressBars} aria-hidden="true">
                    {Array.from({ length: 8 }, (_, index) => (
                      <i key={index} />
                    ))}
                  </div>
                </div>
              </div>

              <div className={styles.dashboardSections}>
                {t.sections.map((section, index) => {
                  const Icon = sectionIcons[index] ?? BookOpen;
                  return (
                    <div className={styles.dashboardSection} key={section.title}>
                      <span className={styles.sectionIcon}>
                        <Icon aria-hidden="true" size={16} />
                      </span>
                      <span>{section.title}</span>
                      <ArrowUpRight aria-hidden="true" size={13} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className={styles.floatingNote}>
            <span className={styles.floatingNoteIcon}>
              <Check aria-hidden="true" size={16} strokeWidth={3} />
            </span>
            <span>{t.heroNote}</span>
          </div>
          <span aria-hidden="true" className={styles.visualSparkle}>
            ✳
          </span>
        </div>
      </section>

      <section aria-label={t.stripAria} className={styles.sectionStrip}>
        <div className={styles.stripIntro}>
          <span className={styles.stripLabel}>{t.stripLabel}</span>
          <strong>
            {t.stripIntro[0]} {t.stripIntro[1]}
          </strong>
        </div>
        {t.sections.map((section, index) => {
          const Icon = sectionIcons[index] ?? BookOpen;
          return (
            <article className={styles.stripItem} key={section.title}>
              <span className={styles.stripIcon}>
                <Icon aria-hidden="true" size={18} />
              </span>
              <span>
                <strong>{section.title}</strong>
                <small>{section.detail}</small>
              </span>
            </article>
          );
        })}
      </section>

      <section aria-labelledby="features-title" className={styles.featuresSection} id="features">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionEyebrow}>{t.featuresEyebrow}</p>
            <h2 id="features-title">
              {t.featuresTitle[0]} <em>{t.featuresTitle[1]}</em>
            </h2>
          </div>
          <p>{t.featuresDescription}</p>
        </div>
        <div className={styles.featureGrid}>
          {t.features.map((feature, index) => {
            const Icon = featureIcons[index] ?? BookOpen;
            return (
              <article className={styles.featureCard} key={feature.title}>
                <div className={styles.featureCardTop}>
                  <span className={styles.featureIcon}>
                    <Icon aria-hidden="true" size={20} />
                  </span>
                  <span className={styles.featureNumber}>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="access-title" className={styles.accessSection} id="access">
        <div className={styles.accessGlow} />
        <div className={styles.accessIcon}>
          <GraduationCap aria-hidden="true" size={23} />
        </div>
        <div className={styles.accessCopy}>
          <p>{t.accessEyebrow}</p>
          <h2 id="access-title">
            {t.accessTitle[0]} <em>{t.accessTitle[1]}</em>
          </h2>
          <span>{t.accessDescription}</span>
        </div>
        <Link className={styles.accessButton} href={loginHref}>
          {t.goToSignIn}
          <ArrowRight aria-hidden="true" size={18} />
        </Link>
      </section>

      <footer className={styles.footer}>
        <Link aria-label={t.home} className={styles.footerBrand} href={`/?locale=${locale}`}>
          <span className={styles.footerBrandMark}>
            <GraduationCap aria-hidden="true" size={17} />
          </span>
          <span>{t.brand}</span>
        </Link>
        <span className={styles.footerNote}>{t.footer}</span>
        <PublicLocaleLinks href="/" label={messages.languageFooter} locale={locale} />
      </footer>
    </main>
  );
}
