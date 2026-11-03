import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { GradebookTable } from "@/components/gradebook-table";
import { auth } from "@/lib/auth";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { getPrisma } from "@/lib/db/prisma";
import { isUserRole } from "@/server/policies/users";
import { getGradebook } from "@/server/services/assignments";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ slug: string }> };

export default async function CourseGradebookPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!isUserRole(session.user.role) || session.user.role === "STUDENT") redirect("/dashboard");
  const appLocale = normalizeLocale(session.user.locale);
  const t = getMessages(appLocale).gradebook;
  const { slug } = await params;
  const access =
    session.user.role === "TEACHER"
      ? {
          teacherAssignments: { some: { teacherId: session.user.id } },
          status: { not: "ARCHIVED" as const },
        }
      : {};
  const course = await getPrisma().course.findFirst({
    where: { slug, deletedAt: null, ...access },
    select: { id: true, title: true, slug: true },
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
  const gradebook = await getGradebook(actor, course.id);
  const gradebookDto = JSON.parse(
    JSON.stringify(gradebook, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
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
        <header className="app-page-header">
          <div>
            <p className="eyebrow">{t.pageEyebrow}</p>
            <h1>{course.title}</h1>
            <p>{t.pageDescription}</p>
          </div>
        </header>
        <GradebookTable courseId={course.id} gradebook={gradebookDto} locale={appLocale} />
        <Link className="admin-inline-link" href={`/courses/${course.slug}`}>
          {t.backToCourse}
        </Link>
      </div>
    </AppShell>
  );
}
