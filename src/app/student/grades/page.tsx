import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { getMyGrades } from "@/server/services/assignments";
import { getMyLessonGrades } from "@/server/services/lesson-grades";
import { isUserRole } from "@/server/policies/users";

export const dynamic = "force-dynamic";

export default async function StudentGradesPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!isUserRole(session.user.role) || session.user.role !== "STUDENT") redirect("/dashboard");
  const actor = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
    status: "ACTIVE" as const,
    mustChangePassword: false,
  };
  const [grades, lessonGrades, params] = await Promise.all([
    getMyGrades(actor),
    getMyLessonGrades(actor),
    searchParams,
  ]);
  const appLocale = normalizeLocale(session.user.locale);
  const t = getMessages(appLocale).studentGrades;
  const dateLocale = appLocale === "kk" ? "kk-KZ" : appLocale === "en" ? "en-GB" : "ru-RU";
  const rows = [
    ...grades.map((grade) => ({
      id: grade.id,
      course: grade.assignment.course.title,
      courseKey: grade.assignment.course.id,
      slug: grade.assignment.course.slug as string | null,
      title: grade.assignment.title,
      kind: t.assignment,
      score: `${grade.score?.toString() ?? "—"} / ${grade.assignment.maxScore.toString()}`,
      normalized:
        grade.score === null || Number(grade.assignment.maxScore) <= 0
          ? null
          : (Number(grade.score) / Number(grade.assignment.maxScore)) * 100,
      comment: grade.feedback || "—",
      date: grade.gradedAt ?? new Date(0),
    })),
    ...lessonGrades.map((grade) => ({
      id: grade.id,
      course: grade.courseTitle,
      courseKey: grade.courseKey,
      slug: grade.courseSlug,
      title: t.lesson,
      kind: t.lesson,
      score: `${grade.value} / 100`,
      normalized: grade.value as number | null,
      comment: "—",
      date: new Date(`${grade.date}T00:00:00Z`),
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
  const courses = [
    ...new Map(
      rows.map((row) => [row.courseKey, { key: row.courseKey, title: row.course }]),
    ).values(),
  ].sort((a, b) => a.title.localeCompare(b.title, dateLocale));
  const selectedCourse =
    typeof params.course === "string" && courses.some((course) => course.key === params.course)
      ? params.course
      : "";
  const visibleRows = rows.filter((row) => !selectedCourse || row.courseKey === selectedCourse);
  const scores = visibleRows.flatMap((row) => (row.normalized === null ? [] : [row.normalized]));
  const average = scores.length
    ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toLocaleString(dateLocale, {
        maximumFractionDigits: 1,
      })
    : "—";

  return (
    <AppShell
      active="overview"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <div className="app-page-wrap course-detail">
        <header className="app-page-header">
          <div>
            <p className="eyebrow">{t.eyebrow}</p>
            <h1>{t.title}</h1>
            <p>{t.description}</p>
          </div>
        </header>
        <section className="admin-panel">
          {courses.length ? (
            <form action="/student/grades" className="student-grades-filter" method="get">
              <label htmlFor="student-grades-course">{t.course}</label>
              <select id="student-grades-course" name="course" defaultValue={selectedCourse}>
                <option value="">{t.allCourses}</option>
                {courses.map((course) => (
                  <option key={course.key} value={course.key}>
                    {course.title}
                  </option>
                ))}
              </select>
              <button className="button button-muted" type="submit">
                {t.show}
              </button>
            </form>
          ) : null}
          {visibleRows.length ? (
            <div className="student-grades-summary" aria-live="polite">
              <div>
                <strong>{average} / 100</strong>
                <span>{t.average}</span>
              </div>
              <div>
                <strong>{scores.length}</strong>
                <span>{t.gradedCount}</span>
              </div>
            </div>
          ) : null}
          {visibleRows.length ? (
            <div className="gradebook-table-wrap">
              <table className="gradebook-table">
                <thead>
                  <tr>
                    <th>{t.course}</th>
                    <th>{t.assignment}</th>
                    <th>{t.score}</th>
                    <th>{t.comment}</th>
                    <th>{t.date}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((grade) => (
                    <tr key={`${grade.kind}:${grade.id}`}>
                      <td>
                        {grade.slug ? (
                          <Link href={`/courses/${grade.slug}`}>{grade.course}</Link>
                        ) : (
                          grade.course
                        )}
                      </td>
                      <td>{grade.title}</td>
                      <td>{grade.score}</td>
                      <td>{grade.comment}</td>
                      <td>
                        {grade.date.toLocaleDateString(dateLocale, { timeZone: "Asia/Almaty" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="course-material-empty">{t.empty}</p>
          )}
        </section>
        <Link className="admin-inline-link" href="/student">
          {t.back}
        </Link>
      </div>
    </AppShell>
  );
}
