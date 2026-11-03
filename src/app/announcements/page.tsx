import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AnnouncementWorkspace } from "@/components/announcement-workspace";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { isUserRole } from "@/server/policies/users";
import { getAnnouncementOptions, listAnnouncements } from "@/server/services/announcements";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (!isUserRole(session.user.role)) redirect("/login");
  const actor = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
    status: "ACTIVE" as const,
    mustChangePassword: false,
  };
  const [announcements, options] = await Promise.all([
    listAnnouncements(actor),
    actor.role === "ADMIN" ||
    actor.role === "SUPER_ADMIN" ||
    actor.role === "TEACHER" ||
    actor.role === "STUDENT"
      ? getAnnouncementOptions(actor)
      : Promise.resolve(undefined),
  ]);
  const dto = JSON.parse(JSON.stringify(announcements));
  return (
    <AppShell
      active="announcements"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <AnnouncementWorkspace
        announcements={dto}
        options={options}
        role={actor.role}
        actorId={actor.id}
        locale={session.user.locale}
      />
    </AppShell>
  );
}
