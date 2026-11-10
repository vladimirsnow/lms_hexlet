import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { LessonGradebook } from "@/components/lesson-gradebook";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LessonGradesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (session.user.role !== "TEACHER") redirect("/dashboard");
  return (
    <AppShell
      active="grades"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <LessonGradebook locale={session.user.locale} />
    </AppShell>
  );
}
