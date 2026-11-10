import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { normalizeLocale } from "@/lib/i18n";
import { getPrisma } from "@/lib/db/prisma";
import { isUserRole } from "@/server/policies/users";
import { AcademicManagement } from "@/app/admin/academic/academic-management";

export const dynamic = "force-dynamic";

export default async function AcademicPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (
    !isUserRole(session.user.role) ||
    (session.user.role !== "SUPER_ADMIN" && session.user.role !== "ADMIN")
  ) {
    redirect("/dashboard");
  }

  const prisma = getPrisma();
  const [years, terms, specialties, groups, subjects, courses, teachers, students] =
    await Promise.all([
      prisma.academicYear.findMany({ orderBy: { startsOn: "desc" }, take: 100 }),
      prisma.term.findMany({ orderBy: { startsOn: "desc" }, take: 100 }),
      prisma.specialty.findMany({
        where: { code: { not: { startsWith: "DEMO-" } } },
        orderBy: { nameRu: "asc" },
        take: 100,
      }),
      prisma.studyGroup.findMany({
        include: {
          academicYear: { select: { name: true } },
          specialty: { select: { code: true, nameRu: true } },
          curator: { select: { id: true, name: true } },
          memberships: {
            where: { leftAt: null, isGroupLeader: true },
            select: { studentId: true },
          },
          _count: { select: { memberships: { where: { leftAt: null } } } },
        },
        orderBy: { name: "asc" },
        take: 100,
      }),
      prisma.subject.findMany({
        where: { code: { not: { startsWith: "DEMO-" } } },
        orderBy: { nameRu: "asc" },
        take: 100,
      }),
      prisma.course.findMany({
        where: { deletedAt: null, slug: { not: { startsWith: "demo-" } } },
        include: {
          subject: { select: { nameRu: true } },
          term: { select: { name: true } },
          academicYear: { select: { name: true } },
          specialty: { select: { nameRu: true } },
          _count: { select: { enrollments: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      prisma.user.findMany({
        where: { role: "TEACHER", status: "ACTIVE", deletedAt: null },
        select: { id: true, name: true, email: true },
        orderBy: { lastName: "asc" },
        take: 200,
      }),
      prisma.user.findMany({
        where: { role: "STUDENT", status: "ACTIVE", deletedAt: null },
        select: { id: true, name: true, email: true, username: true },
        orderBy: { lastName: "asc" },
        take: 500,
      }),
    ]);

  return (
    <AppShell
      active="academic"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <AcademicManagement
        locale={normalizeLocale(session.user.locale)}
        years={years.map((item) => ({
          ...item,
          startsOn: item.startsOn.toISOString().slice(0, 10),
          endsOn: item.endsOn.toISOString().slice(0, 10),
        }))}
        terms={terms.map((item) => ({
          ...item,
          startsOn: item.startsOn.toISOString().slice(0, 10),
          endsOn: item.endsOn.toISOString().slice(0, 10),
        }))}
        specialties={specialties}
        groups={groups}
        subjects={subjects.map((item) => ({ ...item, credits: item.credits?.toString() ?? null }))}
        courses={courses}
        teachers={teachers}
        students={students}
      />
    </AppShell>
  );
}
