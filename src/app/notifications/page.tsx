import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { NotificationsWorkspace } from "@/components/announcement-workspace";
import { auth } from "@/lib/auth";
import { isUserRole } from "@/server/policies/users";
import { listMyNotifications } from "@/server/services/announcements";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!isUserRole(session.user.role)) redirect("/login");
  const initial = JSON.parse(
    JSON.stringify(
      await listMyNotifications({
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        status: "ACTIVE",
        mustChangePassword: false,
      }),
    ),
  );
  return (
    <AppShell
      active="notifications"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <NotificationsWorkspace initial={initial} locale={session.user.locale} />
    </AppShell>
  );
}
