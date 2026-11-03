import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { getMyGrades } from "@/server/services/assignments";
import { isUserRole } from "@/server/policies/users";

export const dynamic = "force-dynamic";

export default async function StudentGradesPage() {
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
  const grades = await getMyGrades(actor);
  const appLocale = normalizeLocale(session.user.locale);
  const t = getMessages(appLocale).studentGrades;
  const dateLocale = appLocale === "kk" ? "kk-KZ" : appLocale === "en" ? "en-GB" : "ru-RU";

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
          {grades.length ? (
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
                  {grades.map((grade) => (
                    <tr key={grade.id}>
                      <td>
                        <Link href={`/courses/${grade.assignment.course.slug}`}>
                          {grade.assignment.course.title}
                        </Link>
                      </td>
                      <td>{grade.assignment.title}</td>
                      <td>
                        {grade.score?.toString() ?? "—"} / {grade.assignment.maxScore.toString()}
                      </td>
                      <td>{grade.feedback || "—"}</td>
                      <td>{grade.gradedAt?.toLocaleString(dateLocale) ?? "—"}</td>
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
