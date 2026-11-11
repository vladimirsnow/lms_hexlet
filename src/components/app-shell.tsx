import Link from "next/link";
import {
  Activity,
  Bell,
  BookOpen,
  CalendarDays,
  GraduationCap,
  ClipboardList,
  LayoutDashboard,
  Megaphone,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import type { UserRole } from "@/server/policies/users";
import { SignOutButton } from "@/components/sign-out-button";
import { GlobalSearch } from "@/components/global-search";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { getMessages, normalizeLocale } from "@/lib/i18n";

interface AppShellProps {
  name: string;
  role: UserRole;
  locale: string;
  active:
    | "overview"
    | "users"
    | "audit"
    | "academic"
    | "schedule"
    | "grades"
    | "announcements"
    | "notifications";
  children: ReactNode;
}

export function AppShell({ name, role, locale, active, children }: AppShellProps) {
  const appLocale = normalizeLocale(locale);
  const messages = getMessages(appLocale);
  const roleLabels: Record<UserRole, string> = {
    SUPER_ADMIN: messages.roleSuperAdmin,
    ADMIN: messages.roleAdmin,
    TEACHER: messages.roleTeacher,
    STUDENT: messages.roleStudent,
  };
  const admin = role === "SUPER_ADMIN" || role === "ADMIN";
  const items = admin
    ? [
        { href: "/admin", label: messages.navOverview, key: "overview", icon: LayoutDashboard },
        { href: "/admin/users", label: messages.navUsers, key: "users", icon: Users },
        { href: "/admin/academic", label: messages.navAcademic, key: "academic", icon: BookOpen },
        { href: "/schedule", label: messages.navSchedule, key: "schedule", icon: CalendarDays },
        {
          href: "/announcements",
          label: messages.navAnnouncements,
          key: "announcements",
          icon: Megaphone,
        },
        {
          href: "/notifications",
          label: messages.navNotifications,
          key: "notifications",
          icon: Bell,
        },
        { href: "/admin/audit", label: messages.navAudit, key: "audit", icon: Activity },
      ]
    : role === "TEACHER"
      ? [
          { href: "/teacher", label: messages.navOverview, key: "overview", icon: LayoutDashboard },
          { href: "/schedule", label: messages.navSchedule, key: "schedule", icon: CalendarDays },
          {
            href: "/teacher/grades",
            label: messages.navLessonGrades,
            key: "grades",
            icon: ClipboardList,
          },
          {
            href: "/announcements",
            label: messages.navAnnouncements,
            key: "announcements",
            icon: Megaphone,
          },
          {
            href: "/notifications",
            label: messages.navNotifications,
            key: "notifications",
            icon: Bell,
          },
        ]
      : [
          { href: "/student", label: messages.navOverview, key: "overview", icon: LayoutDashboard },
          { href: "/schedule", label: messages.navSchedule, key: "schedule", icon: CalendarDays },
          {
            href: "/announcements",
            label: messages.navAnnouncements,
            key: "announcements",
            icon: Megaphone,
          },
          {
            href: "/notifications",
            label: messages.navNotifications,
            key: "notifications",
            icon: Bell,
          },
        ];
  const navigationLinks = items.map(({ href, label, key, icon: Icon }) => (
    <Link
      aria-current={active === key ? "page" : undefined}
      className={active === key ? "app-nav-link app-nav-link-active" : "app-nav-link"}
      href={href}
      key={href}
      prefetch={true}
    >
      <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
      <span>{label}</span>
    </Link>
  ));

  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        {messages.skipToContent}
      </a>
      <aside className="app-sidebar">
        <Link className="brand app-brand" href="/">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">{messages.landing.brand}</span>
        </Link>
        <div className="app-sidebar-label">{messages.workspace}</div>
        <nav aria-label={messages.primaryNavigation} className="app-nav">
          {navigationLinks}
        </nav>
        <details className="app-mobile-nav">
          <summary>{messages.mobileMenu}</summary>
          <nav aria-label={messages.primaryNavigation} className="app-nav">
            {navigationLinks}
          </nav>
        </details>
        <div className="app-sidebar-bottom">
          <div className="app-user-avatar" aria-hidden="true">
            <GraduationCap size={18} />
          </div>
          <div className="app-user-meta">
            <strong>{name}</strong>
            <span>{roleLabels[role]}</span>
          </div>
          <SignOutButton locale={appLocale} />
        </div>
      </aside>
      <main className="app-main" id="main-content" tabIndex={-1}>
        <div className="app-topbar">
          <div className="app-topbar-tools">
            <GlobalSearch locale={appLocale} />
            <LocaleSwitcher locale={appLocale} />
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
