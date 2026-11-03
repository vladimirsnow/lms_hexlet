import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardRedirect() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");

  switch (session.user.role) {
    case "SUPER_ADMIN":
    case "ADMIN":
      redirect("/admin");
    case "TEACHER":
      redirect("/teacher");
    case "STUDENT":
      redirect("/student");
    default:
      redirect("/login");
  }
}
