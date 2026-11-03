import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ScheduleWorkspace } from "@/components/schedule-workspace";
import { auth } from "@/lib/auth";
import { isUserRole } from "@/server/policies/users";
import {
  getAttendanceReport,
  getMyAttendance,
  listScheduleEntries,
} from "@/server/services/schedule";
import { getImportedSchedule } from "@/server/services/schedule-import";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
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
  const admin = actor.role === "SUPER_ADMIN" || actor.role === "ADMIN";
  const [entries, report, importedSchedule] = await Promise.all([
    admin ? Promise.resolve([]) : listScheduleEntries(actor),
    actor.role === "STUDENT"
      ? getMyAttendance(actor)
      : actor.role === "TEACHER"
        ? getAttendanceReport(actor)
        : Promise.resolve(null),
    getImportedSchedule(actor),
  ]);

  return (
    <AppShell
      active="schedule"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <ScheduleWorkspace
        entries={entries}
        report={report}
        importedSchedule={importedSchedule}
        role={actor.role}
        locale={session.user.locale}
      />
    </AppShell>
  );
}
