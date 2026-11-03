import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { QuizWorkspace } from "@/components/quiz-workspace";
import { auth } from "@/lib/auth";
import { normalizeLocale } from "@/lib/i18n";
import { isUserRole } from "@/server/policies/users";
import { getTest } from "@/server/services/quizzes";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ testId: string }> };

export default async function TestPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!isUserRole(session.user.role)) redirect("/login");
  const { testId } = await params;
  let test;
  try {
    test = await getTest(
      {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        status: "ACTIVE",
        mustChangePassword: false,
      },
      testId,
    );
  } catch {
    notFound();
  }
  if (!test) notFound();
  const dto = JSON.parse(
    JSON.stringify(test, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
  );
  return (
    <AppShell
      active="overview"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <QuizWorkspace
        test={dto}
        role={session.user.role}
        locale={normalizeLocale(session.user.locale)}
      />
    </AppShell>
  );
}
