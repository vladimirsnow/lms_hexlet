import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AssignmentManager } from "@/components/assignment-manager";
import { QuizManager } from "@/components/quiz-manager";
import { CourseContentManager } from "@/components/course-content-manager";
import { LessonProgressButton } from "@/components/lesson-progress-button";
import { RichTextContent } from "@/components/rich-text-content";
import { auth } from "@/lib/auth";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { getPrisma } from "@/lib/db/prisma";
import { isUserRole } from "@/server/policies/users";
import { listCourseSections } from "@/server/services/course-content";
import { listAssignments } from "@/server/services/assignments";
import { listCourseTests } from "@/server/services/quizzes";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

export default async function CoursePage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!isUserRole(session.user.role)) redirect("/login");
  const appLocale = normalizeLocale(session.user.locale);
  const t = getMessages(appLocale).course;
  const dateLocale = appLocale === "kk" ? "kk-KZ" : appLocale === "en" ? "en-GB" : "ru-RU";
  const { slug } = await params;
  const access =
    session.user.role === "STUDENT"
      ? {
          status: "PUBLISHED" as const,
          enrollments: { some: { studentId: session.user.id, status: "ACTIVE" as const } },
        }
      : session.user.role === "TEACHER"
        ? {
            status: { not: "ARCHIVED" as const },
            OR: [
              { teacherAssignments: { some: { teacherId: session.user.id } } },
              {
                enrollments: {
                  some: {
                    status: "ACTIVE" as const,
                    group: { curatorId: session.user.id },
                  },
                },
              },
            ],
          }
        : {};
  const course = await getPrisma().course.findFirst({
    where: { slug, deletedAt: null, ...access },
    include: {
      subject: {
        select: { code: true, nameRu: true, description: true, credits: true, totalHours: true },
      },
      term: { select: { name: true, startsOn: true, endsOn: true } },
      academicYear: { select: { name: true } },
      specialty: { select: { code: true, nameRu: true } },
      teacherAssignments: { include: { teacher: { select: { name: true } } } },
    },
  });
  if (!course) notFound();
  const actor = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
    status: "ACTIVE" as const,
    mustChangePassword: false,
  };
  const sections = await listCourseSections(actor, course.id);
  const [assignments, tests] = await Promise.all([
    listAssignments(actor, course.id),
    listCourseTests(actor, course.id),
  ]);
  const canManageContent =
    session.user.role === "SUPER_ADMIN" ||
    session.user.role === "ADMIN" ||
    (session.user.role === "TEACHER" &&
      course.teacherAssignments.some((assignment) => assignment.teacherId === session.user.id));
  const formatBytes = (value: bigint) => {
    const isBytes = value < BigInt(1024);
    const amount = isBytes ? Number(value) : Number(value) / 1024 / 1024;
    const formatter = new Intl.NumberFormat(dateLocale, {
      style: "unit",
      unit: isBytes ? "byte" : "megabyte",
      unitDisplay: "short",
      maximumFractionDigits: 1,
    });
    return formatter.format(amount);
  };
  const assignmentDtos = JSON.parse(
    JSON.stringify(assignments, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );

  return (
    <AppShell
      active="overview"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <div className="app-page-wrap course-detail">
        <p className="eyebrow">
          {t.label} · {course.category}
        </p>
        <section className="course-detail-header">
          <span className={`course-status course-status-${course.status.toLowerCase()}`}>
            {course.status === "PUBLISHED" ? t.published : t.draft}
          </span>
          <h1>{course.title}</h1>
          <p>{course.summary || course.subject.description || t.summaryMissing}</p>
          <div className="course-detail-meta">
            <span>
              {course.subject.code} · {course.subject.nameRu}
            </span>
            <span>
              {course.specialty.code} · {course.specialty.nameRu}
            </span>
            <span>
              {course.academicYear.name} · {course.term.name}
            </span>
          </div>
          <p className="course-detail-teachers">
            {t.teachers}:{" "}
            {course.teacherAssignments.map(({ teacher }) => teacher.name).join(", ") ||
              t.noTeachers}
          </p>
        </section>
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <p className="eyebrow">{t.studyPlan}</p>
              <h2>{t.subjectPeriod}</h2>
            </div>
          </div>
          <p className="course-subject-description">
            {course.subject.description || t.subjectDescriptionMissing}
          </p>
          <div className="course-detail-meta">
            <span>
              {t.term}: {course.term.startsOn.toLocaleDateString(dateLocale)} —{" "}
              {course.term.endsOn.toLocaleDateString(dateLocale)}
            </span>
            {course.subject.credits ? (
              <span>
                {course.subject.credits.toString()} {t.credits}
              </span>
            ) : null}
            {course.subject.totalHours ? (
              <span>
                {course.subject.totalHours} {t.hours}
              </span>
            ) : null}
          </div>
        </section>
        <section className="course-materials-section">
          <div className="course-materials-heading">
            <div>
              <p className="eyebrow">{t.learning}</p>
              <h2>{t.materials}</h2>
            </div>
            <span>{t.sectionCount(sections.length)}</span>
          </div>
          {sections.length ? (
            sections.map((section) => (
              <article className="course-material-section" key={section.id}>
                <div className="course-material-section-heading">
                  <div>
                    <span className="course-material-position">{section.position + 1}</span>
                    <div>
                      <h3>{section.title}</h3>
                      {section.summary ? <p>{section.summary}</p> : null}
                    </div>
                  </div>
                  {canManageContent ? (
                    <span
                      className={
                        section.isPublished ? "course-material-published" : "course-material-draft"
                      }
                    >
                      {section.isPublished ? t.published : t.draft}
                    </span>
                  ) : null}
                </div>
                {section.lessons.length ? (
                  section.lessons.map((lesson) => {
                    const progress = "progress" in lesson ? lesson.progress[0] : undefined;
                    return (
                      <div className="course-lesson-card" key={lesson.id}>
                        <div className="course-lesson-card-heading">
                          <div>
                            <span>
                              {lesson.type === "TEXT"
                                ? t.text
                                : lesson.type === "FILE"
                                  ? t.files
                                  : lesson.type === "VIDEO"
                                    ? t.video
                                    : t.link}
                            </span>
                            <h4>{lesson.title}</h4>
                          </div>
                          {canManageContent ? (
                            <span
                              className={
                                lesson.isPublished
                                  ? "course-material-published"
                                  : "course-material-draft"
                              }
                            >
                              {lesson.isPublished ? t.published : t.draft}
                            </span>
                          ) : null}
                        </div>
                        {typeof lesson.content === "string" ? (
                          <RichTextContent content={lesson.content} />
                        ) : null}
                        {lesson.externalUrl ? (
                          <a
                            className="admin-inline-link"
                            href={lesson.externalUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t.openMaterial}
                          </a>
                        ) : null}
                        {lesson.attachments.map(({ file }) => (
                          <a
                            className="course-file-link"
                            href={`/api/v1/files/${file.id}/download`}
                            key={file.id}
                          >
                            <span>
                              <strong>{file.originalName}</strong>
                              <small>{formatBytes(file.sizeBytes)}</small>
                            </span>
                            <span aria-hidden="true">↓</span>
                          </a>
                        ))}
                        {session.user.role === "STUDENT" ? (
                          <LessonProgressButton
                            lessonId={lesson.id}
                            complete={Boolean(progress?.completedAt)}
                            locale={appLocale}
                          />
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="course-material-empty">{t.noSectionMaterials}</p>
                )}
              </article>
            ))
          ) : (
            <div className="course-material-empty course-material-empty-card">{t.noMaterials}</div>
          )}
        </section>
        {canManageContent ? (
          <CourseContentManager
            courseId={course.id}
            locale={appLocale}
            sections={sections.map((section) => ({
              id: section.id,
              title: section.title,
              position: section.position,
              isPublished: section.isPublished,
              lessons: section.lessons.map((lesson) => ({
                id: lesson.id,
                title: lesson.title,
                type: lesson.type,
                isPublished: lesson.isPublished,
              })),
            }))}
          />
        ) : null}
        <AssignmentManager
          courseId={course.id}
          courseSlug={course.slug}
          assignments={assignmentDtos}
          canManage={canManageContent}
          locale={appLocale}
        />
        <QuizManager
          courseId={course.id}
          tests={JSON.parse(JSON.stringify(tests))}
          canManage={canManageContent}
          locale={appLocale}
        />
        <Link
          className="admin-inline-link"
          href={
            session.user.role === "STUDENT"
              ? "/student"
              : session.user.role === "TEACHER"
                ? "/teacher"
                : "/admin/academic"
          }
        >
          {t.backToWorkspace}
        </Link>
      </div>
    </AppShell>
  );
}
