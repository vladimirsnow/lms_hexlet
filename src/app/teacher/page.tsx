import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CalendarDays, ClipboardList, ListFilter, ArrowUpRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import type { Prisma } from "../../../generated/prisma/client";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getPrisma } from "@/lib/db/prisma";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { isUserRole } from "@/server/policies/users";

export const dynamic = "force-dynamic";

export default async function TeacherHomePage({
  searchParams,
}: {
  searchParams: Promise<{ groupId?: string | string[] }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!isUserRole(session.user.role) || session.user.role !== "TEACHER") redirect("/dashboard");
  const locale = normalizeLocale(session.user.locale);
  const copy = getMessages(locale).dashboard.teacher;
  const dateLocale = locale === "ru" ? "ru-RU" : locale === "kk" ? "kk-KZ" : "en-US";
  const requestedGroupId = (await searchParams).groupId;
  const groupFilterId = Array.isArray(requestedGroupId) ? requestedGroupId[0] : requestedGroupId;

  const prisma = getPrisma();
  const groups = await prisma.studyGroup.findMany({
    where: {
      isActive: true,
      OR: [
        { curatorId: session.user.id },
        {
          enrollments: {
            some: {
              status: "ACTIVE",
              course: { teacherAssignments: { some: { teacherId: session.user.id } } },
            },
          },
        },
      ],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const selectedGroupId = groups.some((group) => group.id === groupFilterId) ? groupFilterId : "";
  const reviewWhere: Prisma.SubmissionWhereInput = {
    status: { in: ["SUBMITTED", "RESUBMISSION_REQUIRED"] },
    assignment: {
      deletedAt: null,
      course: { teacherAssignments: { some: { teacherId: session.user.id } }, deletedAt: null },
    },
    ...(selectedGroupId
      ? {
          student: { groupMemberships: { some: { groupId: selectedGroupId, leftAt: null } } },
          assignment: {
            deletedAt: null,
            course: {
              teacherAssignments: { some: { teacherId: session.user.id } },
              deletedAt: null,
              enrollments: { some: { groupId: selectedGroupId, status: "ACTIVE" } },
            },
          },
        }
      : {}),
  };
  const [courses, pendingReview, recentSubmissions] = await Promise.all([
    prisma.course.findMany({
      where: {
        deletedAt: null,
        status: { not: "ARCHIVED" },
        OR: [
          { teacherAssignments: { some: { teacherId: session.user.id } } },
          { enrollments: { some: { status: "ACTIVE", group: { curatorId: session.user.id } } } },
        ],
      },
      include: {
        subject: { select: { nameRu: true, nameKk: true, nameEn: true } },
        term: { select: { name: true } },
        academicYear: { select: { name: true } },
        specialty: { select: { code: true } },
        _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
      },
      orderBy: { title: "asc" },
    }),
    prisma.submission.count({ where: reviewWhere }),
    prisma.submission.findMany({
      where: reviewWhere,
      select: {
        id: true,
        submittedAt: true,
        student: { select: { name: true } },
        assignment: { select: { id: true, title: true, course: { select: { title: true } } } },
      },
      orderBy: { submittedAt: "asc" },
      take: 6,
    }),
  ]);

  return (
    <AppShell
      active="overview"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <div className="app-page-wrap teacher-home-page">
        <header className="app-page-header teacher-home-hero">
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>
              {copy.greeting}, {session.user.firstName}
            </h1>
            <p>{copy.intro}</p>
            <div className="teacher-home-hero-actions">
              <Link className="button button-primary" href="/teacher/grades">
                <ClipboardList aria-hidden="true" size={17} /> Открыть журнал оценок
              </Link>
              <Link className="button button-muted" href="/schedule">
                <CalendarDays aria-hidden="true" size={17} /> Расписание
              </Link>
            </div>
          </div>
          <div className="teacher-home-hero-stats" aria-label="Сводка преподавателя">
            <div>
              <strong>{courses.length}</strong>
              <span>{copy.assignedCourses}</span>
            </div>
            <div>
              <strong>{pendingReview}</strong>
              <span>{copy.awaiting}</span>
            </div>
            <div>
              <strong>{groups.length}</strong>
              <span>Доступных групп</span>
            </div>
          </div>
        </header>
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <p className="eyebrow">{copy.teaching}</p>
              <h2>{copy.courses}</h2>
            </div>
            <span className="users-total">{copy.courseCount(courses.length)}</span>
          </div>
          {courses.length ? (
            <ul className="course-card-grid">
              {courses.map((course) => (
                <li key={course.id}>
                  <Link className="course-card" href={`/courses/${course.slug}`}>
                    <span>
                      {course.specialty.code} · {course.term.name} · {course.academicYear.name}
                    </span>
                    <h2>{course.title}</h2>
                    <p>
                      {(locale === "kk"
                        ? course.subject.nameKk
                        : locale === "en"
                          ? course.subject.nameEn
                          : null) ?? course.subject.nameRu}{" "}
                      · {copy.studentsCount(course._count.enrollments)}
                    </p>
                    <div className="course-card-actions">
                      <span>{copy.openCourse}</span>
                      <ArrowUpRight aria-hidden="true" size={17} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty-state">{copy.noCourses}</p>
          )}
        </section>
        <section className="role-dashboard-grid teacher-dashboard-grid">
          <div className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{copy.review}</p>
                <h2>{copy.reviewQueue}</h2>
              </div>
              <span className="users-total">
                {pendingReview} {copy.awaiting}
              </span>
              <details className="dashboard-group-menu">
                <summary aria-label="Выбрать группу для проверки работ">
                  <ListFilter aria-hidden="true" size={17} />
                </summary>
                <form action="/teacher" method="get">
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
            {recentSubmissions.length ? (
              <ul className="dashboard-list">
                {recentSubmissions.map((submission) => (
                  <li key={submission.id}>
                    <div>
                      <strong>{submission.assignment.title}</strong>
                      <span>
                        {submission.student.name} · {submission.assignment.course.title}
                        {submission.submittedAt
                          ? ` · ${submission.submittedAt.toLocaleDateString(dateLocale, { timeZone: "Asia/Almaty", day: "2-digit", month: "short" })}`
                          : ""}
                      </span>
                    </div>
                    <Link href={`/assignments/${submission.assignment.id}`}>{copy.check}</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-empty-state">{copy.noSubmissions}</p>
            )}
          </div>
          <div className="admin-panel dashboard-summary-panel">
            <p className="eyebrow">{copy.workload}</p>
            <strong>{courses.length}</strong>
            <span>{copy.assignedCourses}</span>
            <Link className="admin-inline-link" href="/schedule">
              {copy.openSchedule}
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
