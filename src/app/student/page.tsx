import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BookOpen, CalendarDays, ClipboardCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getPrisma } from "@/lib/db/prisma";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { isUserRole } from "@/server/policies/users";

export const dynamic = "force-dynamic";

export default async function StudentHomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!isUserRole(session.user.role) || session.user.role !== "STUDENT") redirect("/dashboard");
  const locale = normalizeLocale(session.user.locale);
  const copy = getMessages(locale).dashboard.student;
  const dateLocale = locale === "ru" ? "ru-RU" : locale === "kk" ? "kk-KZ" : "en-US";

  const prisma = getPrisma();
  const now = new Date();
  const [courses, upcomingAssignments, recentGrades] = await Promise.all([
    prisma.course.findMany({
      where: {
        status: "PUBLISHED",
        deletedAt: null,
        enrollments: { some: { studentId: session.user.id, status: "ACTIVE" } },
      },
      include: {
        subject: { select: { nameRu: true, nameKk: true, nameEn: true } },
        term: { select: { name: true } },
        academicYear: { select: { name: true } },
        specialty: { select: { code: true } },
      },
      orderBy: { title: "asc" },
    }),
    prisma.assignment.findMany({
      where: {
        status: "PUBLISHED",
        deletedAt: null,
        OR: [{ dueAt: null }, { dueAt: { gte: now } }],
        course: {
          status: "PUBLISHED",
          deletedAt: null,
          enrollments: { some: { studentId: session.user.id, status: "ACTIVE" } },
        },
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        course: { select: { title: true } },
        submissions: {
          where: { studentId: session.user.id },
          orderBy: { attemptNo: "desc" },
          take: 1,
          select: { status: true },
        },
      },
      orderBy: [{ dueAt: "asc" }, { title: "asc" }],
      take: 5,
    }),
    prisma.submission.findMany({
      where: { studentId: session.user.id, status: "GRADED" },
      select: {
        id: true,
        score: true,
        gradedAt: true,
        assignment: { select: { title: true, course: { select: { title: true } } } },
      },
      orderBy: { gradedAt: "desc" },
      take: 5,
    }),
  ]);

  return (
    <AppShell
      active="overview"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <div className="app-page-wrap student-dashboard">
        <header className="student-dashboard-hero">
          <div className="student-dashboard-hero-copy">
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>
              {copy.greeting}, {session.user.firstName}
            </h1>
            <p>{copy.intro}</p>
            <div className="student-dashboard-actions">
              <Link className="button button-primary" href="/schedule">
                <CalendarDays aria-hidden="true" size={17} /> {copy.openSchedule}
              </Link>
              <Link className="button button-on-hero" href="/student/grades">
                <ClipboardCheck aria-hidden="true" size={17} /> {copy.openGrades}
              </Link>
            </div>
          </div>
          <div className="student-dashboard-hero-card">
            <span className="student-dashboard-hero-icon">
              <BookOpen aria-hidden="true" size={23} />
            </span>
            <span>{copy.learning}</span>
            <strong>{courses.length}</strong>
            <small>{copy.activeCourses(courses.length)}</small>
          </div>
        </header>

        <section className="student-dashboard-stats" aria-label={copy.learning}>
          <article>
            <span className="student-dashboard-stat-icon student-stat-purple">
              <BookOpen aria-hidden="true" size={18} />
            </span>
            <div>
              <strong>{courses.length}</strong>
              <span>{copy.courses}</span>
            </div>
          </article>
          <article>
            <span className="student-dashboard-stat-icon student-stat-orange">
              <CalendarDays aria-hidden="true" size={18} />
            </span>
            <div>
              <strong>{upcomingAssignments.length}</strong>
              <span>{copy.upcoming}</span>
            </div>
          </article>
          <article>
            <span className="student-dashboard-stat-icon student-stat-green">
              <ClipboardCheck aria-hidden="true" size={18} />
            </span>
            <div>
              <strong>{recentGrades.length}</strong>
              <span>{copy.recentGrades}</span>
            </div>
          </article>
        </section>

        <div className="student-dashboard-content">
          <section className="admin-panel student-dashboard-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{copy.next}</p>
                <h2>{copy.upcoming}</h2>
              </div>
              <Link className="admin-inline-link" href="/student/grades">
                {copy.gradebook}
              </Link>
            </div>
            {upcomingAssignments.length ? (
              <ul className="dashboard-list">
                {upcomingAssignments.map((assignment) => (
                  <li key={assignment.id}>
                    <div>
                      <strong>{assignment.title}</strong>
                      <span>
                        {assignment.course.title}
                        {assignment.dueAt
                          ? ` · ${copy.deadline} ${assignment.dueAt.toLocaleString(dateLocale, { timeZone: "Asia/Almaty", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
                          : copy.deadlineMissing}
                      </span>
                    </div>
                    <Link href={`/assignments/${assignment.id}`}>
                      {assignment.submissions[0]?.status === "SUBMITTED" ||
                      assignment.submissions[0]?.status === "GRADED"
                        ? copy.open
                        : copy.complete}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-empty-state">{copy.noAssignments}</p>
            )}
          </section>

          <div className="student-dashboard-sidebar">
            <section className="admin-panel student-dashboard-panel">
              <div className="admin-panel-heading">
                <div>
                  <p className="eyebrow">{copy.learning}</p>
                  <h2>{copy.courses}</h2>
                </div>
              </div>
              {courses.length ? (
                <ul className="student-course-list">
                  {courses.map((course) => (
                    <li key={course.id}>
                      <span className="student-course-icon">
                        <BookOpen aria-hidden="true" size={17} />
                      </span>
                      <div>
                        <strong>{course.title}</strong>
                        <span>
                          {(locale === "kk"
                            ? course.subject.nameKk
                            : locale === "en"
                              ? course.subject.nameEn
                              : null) ?? course.subject.nameRu}
                          {` · ${course.term.name}`}
                        </span>
                      </div>
                      <Link
                        aria-label={`${copy.goToCourse}: ${course.title}`}
                        href={`/courses/${course.slug}`}
                      >
                        →
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="admin-empty-state">{copy.noCourses}</p>
              )}
            </section>

            <section className="admin-panel student-dashboard-panel">
              <div className="admin-panel-heading">
                <div>
                  <p className="eyebrow">{copy.results}</p>
                  <h2>{copy.recentGrades}</h2>
                </div>
              </div>
              {recentGrades.length ? (
                <ul className="dashboard-list student-grade-list">
                  {recentGrades.map((submission) => (
                    <li key={submission.id}>
                      <div>
                        <strong>{submission.assignment.title}</strong>
                        <span>
                          {submission.assignment.course.title}
                          {submission.gradedAt
                            ? ` · ${submission.gradedAt.toLocaleDateString(dateLocale, { timeZone: "Asia/Almaty", day: "2-digit", month: "short" })}`
                            : ""}
                        </span>
                      </div>
                      <b>{submission.score?.toString() ?? "—"}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="admin-empty-state">{copy.noGrades}</p>
              )}
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
