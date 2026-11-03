import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { getPrisma } from "@/lib/db/prisma";
import { isUserRole } from "@/server/policies/users";

export const dynamic = "force-dynamic";
const perPage = 25;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.status !== "ACTIVE") redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  if (
    !isUserRole(session.user.role) ||
    (session.user.role !== "SUPER_ADMIN" && session.user.role !== "ADMIN")
  ) {
    redirect("/dashboard");
  }

  const { page: pageParam } = await searchParams;
  const appLocale = normalizeLocale(session.user.locale);
  const t = getMessages(appLocale).audit;
  const dateLocale = appLocale === "kk" ? "kk-KZ" : appLocale === "en" ? "en-GB" : "ru-RU";
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const prisma = getPrisma();
  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      include: { actor: { select: { name: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.auditLog.count(),
  ]);
  const pages = Math.max(1, Math.ceil(total / perPage));

  return (
    <AppShell
      active="audit"
      name={session.user.name}
      role={session.user.role}
      locale={session.user.locale}
    >
      <div className="app-page-wrap">
        <header className="app-page-header">
          <div>
            <p className="eyebrow">{t.eyebrow}</p>
            <h1>{t.title}</h1>
            <p>{t.description}</p>
          </div>
        </header>

        <section className="admin-panel audit-panel">
          {entries.length ? (
            <div className="audit-list">
              {entries.map((entry) => (
                <article className="audit-entry" key={entry.id}>
                  <div className="audit-entry-marker" aria-hidden="true" />
                  <div className="audit-entry-main">
                    <div className="audit-entry-title">
                      <strong>
                        {t.actions[entry.action as keyof typeof t.actions] ?? entry.action}
                      </strong>
                      <span>
                        {t.entities[entry.entityType as keyof typeof t.entities] ??
                          entry.entityType}
                        {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ""}
                      </span>
                    </div>
                    <p>
                      {entry.actor?.name ?? t.system} · {entry.actor?.email ?? t.automatic}
                    </p>
                    {entry.afterJson ? <pre>{JSON.stringify(entry.afterJson, null, 2)}</pre> : null}
                  </div>
                  <time dateTime={entry.createdAt.toISOString()}>
                    {entry.createdAt.toLocaleString(dateLocale, {
                      timeZone: "Asia/Almaty",
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-empty-state">{t.empty}</p>
          )}
          <div className="users-pagination">
            <span>{t.page(page, pages, total)}</span>
            <div>
              {page > 1 ? (
                <Link href={`/admin/audit?page=${page - 1}`}>
                  <ArrowLeft aria-hidden="true" size={15} /> {t.previous}
                </Link>
              ) : null}
              {page < pages ? (
                <Link href={`/admin/audit?page=${page + 1}`}>
                  {t.next} <ArrowRight aria-hidden="true" size={15} />
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
