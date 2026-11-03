import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { UsersManagement } from "@/app/admin/users/users-management";
import { auth } from "@/lib/auth";
import { isUserRole } from "@/server/policies/users";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (
    !isUserRole(session.user.role) ||
    (session.user.role !== "SUPER_ADMIN" && session.user.role !== "ADMIN")
  ) {
    redirect("/dashboard");
  }

  return (
    <AppShell
      active="users"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <UsersManagement actorRole={session.user.role} locale={session.user.locale} />
    </AppShell>
  );
}
