import type { Metadata } from "next";
import { cookies } from "next/headers";
import { z } from "zod";
import type { Prisma } from "../../../generated/prisma/client";
import { PublicLocaleLinks } from "@/components/public-locale-links";
import { getMessages, getPublicCatalogMessages, normalizeLocale } from "@/lib/i18n";
import { getPrisma } from "@/lib/db/prisma";
import {
  findImportedCourseIdsForGroupQuery,
  resolveCourseGroupNames,
} from "@/server/services/course-groups";
import {
  getSeoRobots,
  isSeoIndexingEnabled,
  localizedAlternates,
  localizedSiteUrl,
} from "@/lib/seo";

export const dynamic = "force-dynamic";

const filtersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  academicYearId: z.uuid().optional(),
  specialtyId: z.uuid().optional(),
  category: z.enum(["OOD", "OOM", "PM", "SPECIALTY", "COHORT"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

const pageSize = 24;

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function localizedName(
  locale: "ru" | "kk" | "en",
  names: { nameRu: string; nameKk: string | null; nameEn: string | null },
) {
  if (locale === "kk") return names.nameKk || names.nameRu;
  if (locale === "en") return names.nameEn || names.nameRu;
  return names.nameRu;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);
  const queryLocale = params.locale;
  const locale = normalizeLocale(queryLocale ?? cookieStore.get("lms_locale")?.value);
  const copy = getPublicCatalogMessages(locale);
  const indexable = isSeoIndexingEnabled();
  const hasFilters = ["q", "academicYearId", "specialtyId", "category", "page"].some(
    (key) => params[key] !== undefined && params[key] !== "",
  );
  const canonical = localizedSiteUrl("/catalog", locale);
  const baseRobots = getSeoRobots(indexable && !hasFilters);

  return {
    title: copy.title,
    description: copy.description,
    robots: {
      ...baseRobots,
      ...(indexable && hasFilters
        ? { follow: true, googleBot: { ...baseRobots.googleBot, follow: true } }
        : {}),
    },
    ...(indexable
      ? {
          alternates: {
            canonical: canonical.href,
            ...(!hasFilters ? { languages: localizedAlternates("/catalog") } : {}),
          },
        }
      : {}),
    openGraph: {
      type: "website",
      title: copy.title,
      description: copy.description,
      url: canonical.href,
    },
  };
}

export default async function PublicCatalogPage({ searchParams }: PageProps) {
  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);
  const locale = normalizeLocale(params.locale ?? cookieStore.get("lms_locale")?.value);
  const copy = getPublicCatalogMessages(locale);
  const landing = getMessages(locale).landing;
  const parsedFilters = filtersSchema.safeParse({
    q: params.q,
    academicYearId: params.academicYearId,
    specialtyId: params.specialtyId,
    category: params.category,
    page: params.page,
  });
  const filters = parsedFilters.success ? parsedFilters.data : {};
  const query = filters.q || "";
  const requestedPage = filters.page || 1;
  const publishedCourse = { status: "PUBLISHED" as const, deletedAt: null };
  const prisma = getPrisma();
  const importedCourseIds = query
    ? await findImportedCourseIdsForGroupQuery(query).catch(() => [])
    : [];
  const where = {
    ...publishedCourse,
    ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
    ...(filters.specialtyId ? { specialtyId: filters.specialtyId } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" as const } },
            { slug: { contains: query, mode: "insensitive" as const } },
            { summary: { contains: query, mode: "insensitive" as const } },
            { subject: { code: { contains: query, mode: "insensitive" as const } } },
            { subject: { nameRu: { contains: query, mode: "insensitive" as const } } },
            { subject: { nameKk: { contains: query, mode: "insensitive" as const } } },
            { subject: { nameEn: { contains: query, mode: "insensitive" as const } } },
            {
              enrollments: {
                some: {
                  status: "ACTIVE",
                  group: { name: { contains: query, mode: "insensitive" as const } },
                },
              },
            },
            {
              scheduleEntries: {
                some: {
                  deletedAt: null,
                  group: { name: { contains: query, mode: "insensitive" as const } },
                },
              },
            },
            ...(importedCourseIds.length ? [{ id: { in: importedCourseIds } }] : []),
          ],
        }
      : {}),
  } satisfies Prisma.CourseWhereInput;
  const findCoursePage = (targetPage: number) =>
    prisma.course.findMany({
      where,
      select: {
        id: true,
        title: true,
        slug: true,
        specialtyId: true,
        summary: true,
        category: true,
        subject: { select: { code: true, nameRu: true, nameKk: true, nameEn: true } },
        academicYear: { select: { name: true } },
        term: { select: { name: true, startsOn: true, endsOn: true } },
        enrollments: {
          where: { status: "ACTIVE", groupId: { not: null } },
          select: { group: { select: { name: true } } },
          distinct: ["groupId"],
        },
        scheduleEntries: {
          where: { deletedAt: null },
          select: { group: { select: { name: true } } },
          distinct: ["groupId"],
        },
        specialty: { select: { code: true, nameRu: true, nameKk: true, nameEn: true } },
        teacherAssignments: {
          where: { teacher: { status: "ACTIVE", deletedAt: null } },
          select: { teacher: { select: { name: true } } },
          orderBy: { assignedAt: "asc" },
        },
      },
      orderBy: [{ academicYear: { startsOn: "desc" } }, { title: "asc" }],
      skip: (targetPage - 1) * pageSize,
      take: pageSize,
    });

  const [total, academicYears, specialties, requestedCourses] = await Promise.all([
    prisma.course.count({ where }),
    prisma.academicYear.findMany({
      where: { courses: { some: publishedCourse } },
      select: { id: true, name: true },
      orderBy: { startsOn: "desc" },
    }),
    prisma.specialty.findMany({
      where: { courses: { some: publishedCourse } },
      select: { id: true, code: true, nameRu: true, nameKk: true, nameEn: true },
      orderBy: { nameRu: "asc" },
    }),
    findCoursePage(requestedPage),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const courses = page === requestedPage ? requestedCourses : await findCoursePage(page);
  const courseGroups = await resolveCourseGroupNames(courses);

  function pageHref(nextPage: number) {
    const next = new URLSearchParams({ locale });
    if (query) next.set("q", query);
    if (filters.academicYearId) next.set("academicYearId", filters.academicYearId);
    if (filters.specialtyId) next.set("specialtyId", filters.specialtyId);
    if (filters.category) next.set("category", filters.category);
    next.set("page", String(nextPage));
    return `/catalog?${next.toString()}`;
  }

  const hasFilters = Boolean(
    query || filters.academicYearId || filters.specialtyId || filters.category,
  );

  return (
    <main>
      <header className="site-header public-catalog-topbar">
        <a className="brand" href={`/?locale=${locale}`}>
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">{landing.brand}</span>
        </a>
        <nav className="main-nav" aria-label={landing.navigation}>
          <a href={`/?locale=${locale}`}>{landing.home}</a>
          <a aria-current="page" href={`/catalog?locale=${locale}`}>
            {copy.navigation}
          </a>
        </nav>
        <div className="site-header-actions">
          <PublicLocaleLinks
            href="/catalog"
            label={getMessages(locale).languageHeader}
            locale={locale}
          />
          <a className="header-link" href={`/login?locale=${locale}`}>
            {landing.signIn}
          </a>
        </div>
      </header>

      <section className="public-catalog-page" aria-labelledby="catalog-title">
        <div className="public-catalog-heading">
          <p className="eyebrow">{copy.navigation}</p>
          <h1 id="catalog-title">{copy.title}</h1>
          <p>{copy.description}</p>
          {hasFilters ? (
            <a className="public-catalog-reset" href={`/catalog?locale=${locale}`}>
              {copy.resetFilters}
            </a>
          ) : null}
        </div>

        <form className="public-catalog-filters" method="get">
          <input type="hidden" name="locale" value={locale} />
          <label className="public-catalog-search">
            <span>{copy.search}</span>
            <input
              type="search"
              name="q"
              placeholder={copy.searchPlaceholder}
              defaultValue={query}
              maxLength={120}
            />
          </label>
          <label>
            <span>{copy.academicYear}</span>
            <select name="academicYearId" defaultValue={filters.academicYearId ?? ""}>
              <option value="">{copy.anyAcademicYear}</option>
              {academicYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{copy.specialty}</span>
            <select name="specialtyId" defaultValue={filters.specialtyId ?? ""}>
              <option value="">{copy.anySpecialty}</option>
              {specialties.map((specialty) => (
                <option key={specialty.id} value={specialty.id}>
                  {specialty.code} · {localizedName(locale, specialty)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{copy.category}</span>
            <select name="category" defaultValue={filters.category ?? ""}>
              <option value="">{copy.anyCategory}</option>
              {Object.entries(copy.categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="button button-primary" type="submit">
            {copy.apply}
          </button>
        </form>

        <div className="public-catalog-results" aria-live="polite">
          <p>
            {copy.matchingCourses}:{" "}
            {new Intl.NumberFormat(locale === "kk" ? "kk-KZ" : locale).format(total)}
          </p>
          {courses.length ? (
            <div className="course-card-grid public-course-grid">
              {courses.map((course) => (
                <article className="course-card public-course-card" key={course.id}>
                  <span>{copy.categoryLabels[course.category]}</span>
                  <h2>{course.title}</h2>
                  <p>{course.summary || localizedName(locale, course.subject)}</p>
                  <div className="public-course-meta">
                    <span>
                      {course.academicYear.name} · {course.term.name}
                    </span>
                    <span>
                      {course.specialty.code} · {localizedName(locale, course.specialty)}
                    </span>
                    <span>
                      {copy.groups}: {courseGroups.get(course.id)?.join(", ") || copy.noGroups}
                    </span>
                    <span>
                      {copy.teachers}:{" "}
                      {course.teacherAssignments.map(({ teacher }) => teacher.name).join(", ") ||
                        copy.noTeachers}
                    </span>
                  </div>
                  <a href={`/catalog/${course.slug}?locale=${locale}`}>{copy.viewCourse} →</a>
                </article>
              ))}
            </div>
          ) : (
            <div className="public-catalog-empty">
              <h2>{copy.emptyTitle}</h2>
              <p>{copy.emptyDescription}</p>
            </div>
          )}
          {pageCount > 1 ? (
            <nav className="public-catalog-pagination" aria-label={copy.title}>
              {page > 1 ? (
                <a className="button button-secondary" href={pageHref(page - 1)}>
                  ← {copy.previousPage}
                </a>
              ) : (
                <span />
              )}
              <span>
                {copy.pageLabel} {page} / {pageCount}
              </span>
              {page < pageCount ? (
                <a className="button button-secondary" href={pageHref(page + 1)}>
                  {copy.nextPage} →
                </a>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </div>
      </section>
    </main>
  );
}
