import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StudentSubmissionPanel, SubmissionReviewPanel } from "@/components/submission-panels";
import { auth } from "@/lib/auth";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { getAssignment, listAssignmentSubmissions } from "@/server/services/assignments";
import { isUserRole } from "@/server/policies/users";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ assignmentId: string }> };

export default async function AssignmentPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!isUserRole(session.user.role)) redirect("/login");
  const appLocale = normalizeLocale(session.user.locale);
  const t = getMessages(appLocale).assignments;
  const dateLocale = appLocale === "kk" ? "kk-KZ" : appLocale === "en" ? "en-GB" : "ru-RU";
  const { assignmentId } = await params;
  let assignment;
  let review;
  try {
    const actor = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
      status: "ACTIVE" as const,
      mustChangePassword: false,
    };
    assignment = await getAssignment(actor, assignmentId);
    if (!assignment) notFound();
    if (session.user.role !== "STUDENT")
      review = await listAssignmentSubmissions(actor, assignmentId);
  } catch {
    notFound();
  }
  if (!assignment) notFound();
  const assignmentDto = JSON.parse(
    JSON.stringify(assignment, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
  const reviewDto = review
    ? JSON.parse(
        JSON.stringify(review, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      )
    : null;

  return (
    <AppShell
      active="overview"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <div className="app-page-wrap course-detail">
        <section className="assignment-detail-card">
          <p className="eyebrow">
            {t.assignmentLabel} ·{" "}
            {assignment.type === "FILE"
              ? t.typeFile
              : assignment.type === "TEXT"
                ? t.typeText
                : t.typeEither}
          </p>
          <h1>{assignment.title}</h1>
          <p>
            {t.course}: {assignment.course.title} · {t.maximum} {assignment.maxScore.toString()} ·{" "}
            {t.weight} {assignment.weight.toString()}
          </p>
          {assignment.dueAt ? (
            <p>
              {t.due}: {assignment.dueAt.toLocaleString(dateLocale)}
              {assignment.allowLate ? " · " + t.lateDeadline : ""}
            </p>
          ) : (
            <p>{t.noDeadline}</p>
          )}
          {assignment.description ? <p>{assignment.description}</p> : null}
          {assignment.instructions ? (
            <div className="submission-answer">{assignment.instructions}</div>
          ) : null}
        </section>
        {session.user.role === "STUDENT" ? (
          <StudentSubmissionPanel assignment={assignmentDto} locale={appLocale} />
        ) : reviewDto ? (
          <SubmissionReviewPanel
            submissions={reviewDto.submissions}
            missingStudents={reviewDto.missingStudents}
            maxScore={assignment.maxScore.toString()}
            allowResubmission={reviewDto.allowResubmission}
            maxAttempts={reviewDto.maxAttempts}
            locale={appLocale}
          />
        ) : null}
        <Link className="admin-inline-link" href={`/courses/${assignment.course.slug}`}>
          {t.backToCourse}
        </Link>
      </div>
    </AppShell>
  );
}
