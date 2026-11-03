import { cache } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { PublicLocaleLinks } from "@/components/public-locale-links";
import { getMessages, getPublicCatalogMessages, normalizeLocale } from "@/lib/i18n";
import { getPrisma } from "@/lib/db/prisma";
import { isSeoIndexingEnabled, localizedAlternates, localizedSiteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ locale?: string }>;
};

function localizedName(
  locale: "ru" | "kk" | "en",
  names: { nameRu: string; nameKk: string | null; nameEn: string | null },
) {
  if (locale === "kk") return names.nameKk || names.nameRu;
  if (locale === "en") return names.nameEn || names.nameRu;
  return names.nameRu;
}

const getPublishedCourse = cache(async (slug: string) =>
  getPrisma().course.findFirst({
    where: { slug, status: "PUBLISHED", deletedAt: null },
    select: {
      title: true,
      slug: true,
      summary: true,
      category: true,
      subject: {
        select: { code: true, nameRu: true, nameKk: true, nameEn: true, description: true },
      },
      academicYear: { select: { name: true } },
      term: { select: { name: true, startsOn: true, endsOn: true } },
      specialty: {
        select: { code: true, nameRu: true, nameKk: true, nameEn: true, qualification: true },
      },
      teacherAssignments: {
        where: { teacher: { status: "ACTIVE", deletedAt: null } },
        select: { teacher: { select: { name: true } } },
        orderBy: { assignedAt: "asc" },
      },
    },
  }),
);

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ slug }, query, cookieStore] = await Promise.all([params, searchParams, cookies()]);
  const locale = normalizeLocale(query.locale ?? cookieStore.get("lms_locale")?.value);
  const course = await getPublishedCourse(slug);
  if (!course) return { title: "Course" };
  const indexable = isSeoIndexingEnabled();
  const description =
    course.summary || course.subject.description || localizedName(locale, course.subject);
  const canonical = localizedSiteUrl(`/catalog/${course.slug}`, locale);

  return {
    title: course.title,
    description,
    ...(indexable
      ? {
          alternates: {
            canonical: canonical.href,
            languages: localizedAlternates(`/catalog/${course.slug}`),
          },
        }
      : {}),
    openGraph: {
      type: "website",
      title: course.title,
      description,
      url: canonical.href,
    },
  };
}

export default async function PublicCoursePage({ params, searchParams }: PageProps) {
  const [{ slug }, query, cookieStore] = await Promise.all([params, searchParams, cookies()]);
  const locale = normalizeLocale(query.locale ?? cookieStore.get("lms_locale")?.value);
  const copy = getPublicCatalogMessages(locale);
  const landing = getMessages(locale).landing;
  const course = await getPublishedCourse(slug);
  if (!course) notFound();

  return (
    <main>
      <header className="site-header public-catalog-topbar">
        <a className="brand" href={`/?locale=${locale}`}>
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">{landing.brand}</span>
        </a>
        <nav className="main-nav" aria-label={landing.navigation}>
          <a href={`/?locale=${locale}`}>{landing.home}</a>
          <a href={`/catalog?locale=${locale}`}>{copy.navigation}</a>
        </nav>
        <div className="site-header-actions">
          <PublicLocaleLinks
            href={`/catalog/${course.slug}`}
            label={getMessages(locale).languageHeader}
            locale={locale}
          />
          <a className="header-link" href={`/login?locale=${locale}`}>
            {landing.signIn}
          </a>
        </div>
      </header>

      <article className="public-course-detail">
        <a className="public-course-back" href={`/catalog?locale=${locale}`}>
          {copy.backToCatalog}
        </a>
        <p className="eyebrow">{copy.categoryLabels[course.category]}</p>
        <section className="course-detail-header public-course-summary">
          <h1>{course.title}</h1>
          <p>
            {course.summary || course.subject.description || localizedName(locale, course.subject)}
          </p>
          <div className="course-detail-meta">
            <span>
              {copy.subject}: {course.subject.code} · {localizedName(locale, course.subject)}
            </span>
            <span>
              {copy.specialtyLabel}: {course.specialty.code} ·{" "}
              {localizedName(locale, course.specialty)}
            </span>
            <span>
              {copy.yearLabel}: {course.academicYear.name} · {course.term.name}
            </span>
          </div>
          <p className="course-detail-teachers">
            {copy.teachers}:{" "}
            {course.teacherAssignments.map(({ teacher }) => teacher.name).join(", ") ||
              copy.noTeachers}
          </p>
        </section>

        <section className="public-course-about">
          <div>
            <p className="eyebrow">{copy.termLabel}</p>
            <h2>{course.term.name}</h2>
            <p>
              {course.term.startsOn.toLocaleDateString(locale === "kk" ? "kk-KZ" : locale)} —{" "}
              {course.term.endsOn.toLocaleDateString(locale === "kk" ? "kk-KZ" : locale)}
            </p>
          </div>
          {course.specialty.qualification ? <p>{course.specialty.qualification}</p> : null}
          <a className="button button-primary" href={`/login?locale=${locale}`}>
            {copy.signInToStudy}
          </a>
        </section>
      </article>
    </main>
  );
}
