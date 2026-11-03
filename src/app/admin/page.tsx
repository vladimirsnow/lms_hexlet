import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowUpRight, BookOpenCheck, ListFilter, UserRoundCheck, UsersRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import type { Prisma } from "../../../generated/prisma/client";
import { auth } from "@/lib/auth";
import { getPrisma } from "@/lib/db/prisma";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { isUserRole } from "@/server/policies/users";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ groupId?: string | string[] }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (
    !isUserRole(session.user.role) ||
    (session.user.role !== "SUPER_ADMIN" && session.user.role !== "ADMIN")
  ) {
    redirect("/dashboard");
  }
  const locale = normalizeLocale(session.user.locale);
  const copy = getMessages(locale).dashboard.admin;
  const actionLabels: Record<string, string> = {
    "user.created": copy.actions.created,
    "user.updated": copy.actions.updated,
    "user.password_reset": copy.actions.passwordReset,
    "user.password_changed": copy.actions.passwordChanged,
    "system.bootstrap_user_created": copy.actions.bootstrapCreated,
  };
  const dateLocale = locale === "ru" ? "ru-RU" : locale === "kk" ? "kk-KZ" : "en-US";

  const prisma = getPrisma();
  const groups = await prisma.studyGroup.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const requestedGroupId = (await searchParams).groupId;
  const groupFilterId = Array.isArray(requestedGroupId) ? requestedGroupId[0] : requestedGroupId;
  const selectedGroupId = groups.some((group) => group.id === groupFilterId) ? groupFilterId : "";
  const reviewWhere: Prisma.SubmissionWhereInput = {
    status: { in: ["SUBMITTED", "RESUBMISSION_REQUIRED"] },
    assignment: { deletedAt: null },
    ...(selectedGroupId
      ? {
          student: { groupMemberships: { some: { groupId: selectedGroupId, leftAt: null } } },
          assignment: {
            deletedAt: null,
            course: { enrollments: { some: { groupId: selectedGroupId, status: "ACTIVE" } } },
          },
        }
      : {}),
  };
  const [
    students,
    teachers,
    admins,
    activeCourses,
    pendingReview,
    pendingSubmissions,
    recentActivity,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "STUDENT", status: "ACTIVE" } }),
    prisma.user.count({ where: { role: "TEACHER", status: "ACTIVE" } }),
    prisma.user.count({ where: { role: { in: ["SUPER_ADMIN", "ADMIN"] }, status: "ACTIVE" } }),
    prisma.course.count({ where: { status: "PUBLISHED", deletedAt: null } }),
    prisma.submission.count({ where: reviewWhere }),
    prisma.submission.findMany({
      where: reviewWhere,
      select: {
        id: true,
        submittedAt: true,
        student: {
          select: {
            name: true,
            groupMemberships: {
              where: { leftAt: null },
              include: { group: { select: { name: true } } },
            },
          },
        },
        assignment: { select: { id: true, title: true, course: { select: { title: true } } } },
      },
      orderBy: { submittedAt: "asc" },
      take: 8,
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { actor: { select: { name: true } } },
    }),
  ]);

  return (
    <AppShell
      active="overview"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <div className="app-page-wrap">
        <header className="app-page-header">
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>
              {copy.greeting}, {session.user.firstName}
            </h1>
            <p>{copy.intro}</p>
          </div>
          <Link className="button button-primary" href="/admin/users">
            {copy.users} <ArrowUpRight aria-hidden="true" size={16} />
          </Link>
        </header>

        <section aria-label={copy.activeAccounts} className="admin-stat-grid">
          <article className="admin-stat-card">
            <div className="admin-stat-icon">
              <UsersRound aria-hidden="true" size={18} />
            </div>
            <span>{copy.students}</span>
            <strong>{students}</strong>
            <small>{copy.activeAccounts}</small>
          </article>
          <article className="admin-stat-card">
            <div className="admin-stat-icon">
              <BookOpenCheck aria-hidden="true" size={18} />
            </div>
            <span>{copy.publishedCourses}</span>
            <strong>{activeCourses}</strong>
            <small>{copy.availableToStudents}</small>
          </article>
          <article className="admin-stat-card">
            <div className="admin-stat-icon">
              <UsersRound aria-hidden="true" size={18} />
            </div>
            <span>{copy.reviewQueue}</span>
            <strong>{pendingReview}</strong>
            <small>{copy.awaitingTeacher}</small>
          </article>
          <article className="admin-stat-card">
            <div className="admin-stat-icon">
              <BookOpenCheck aria-hidden="true" size={18} />
            </div>
            <span>{copy.teachers}</span>
            <strong>{teachers}</strong>
            <small>{copy.activeAccounts}</small>
          </article>
          <article className="admin-stat-card">
            <div className="admin-stat-icon">
              <UserRoundCheck aria-hidden="true" size={18} />
            </div>
            <span>{copy.admins}</span>
            <strong>{admins}</strong>
            <small>{copy.activeAccounts}</small>
          </article>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <p className="eyebrow">Работы студентов</p>
              <h2>{copy.reviewQueue}</h2>
            </div>
            <span className="users-total">
              {pendingReview} {copy.awaitingTeacher}
            </span>
            <details className="dashboard-group-menu">
              <summary aria-label="Выбрать группу для списка работ">
                <ListFilter aria-hidden="true" size={17} />
              </summary>
              <form action="/admin" method="get">
                <label>
                  Группа
                  <select name="groupId" defaultValue={selectedGroupId}>
                    <option value="">Все группы</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="button button-primary" type="submit">
                  Показать
                </button>
              </form>
            </details>
          </div>
          {pendingSubmissions.length ? (
            <ul className="dashboard-list">
              {pendingSubmissions.map((submission) => (
                <li key={submission.id}>
                  <div>
                    <strong>{submission.assignment.title}</strong>
                    <span>
                      {submission.student.name} · {submission.assignment.course.title} ·{" "}
                      {submission.student.groupMemberships[0]?.group.name ?? "группа не указана"}
                    </span>
                  </div>
                  <Link href={`/assignments/${submission.assignment.id}`}>Открыть</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty-state">Работ на проверку нет.</p>
          )}
        </section>

        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <p className="eyebrow">{copy.recentEvents}</p>
              <h2>{copy.activityLog}</h2>
            </div>
            <Link className="admin-inline-link" href="/admin/audit">
              {copy.openLog} <ArrowUpRight aria-hidden="true" size={15} />
            </Link>
          </div>
          {recentActivity.length ? (
            <div className="admin-activity-list">
              {recentActivity.map((entry) => (
                <article className="admin-activity-row" key={entry.id}>
                  <span className="admin-activity-dot" aria-hidden="true" />
                  <div>
                    <strong>{actionLabels[entry.action] ?? entry.action}</strong>
                    <span>{entry.actor?.name ?? copy.system}</span>
                  </div>
                  <time dateTime={entry.createdAt.toISOString()}>
                    {entry.createdAt.toLocaleString(dateLocale, {
                      timeZone: "Asia/Almaty",
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-empty-state">{copy.noEvents}</p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
