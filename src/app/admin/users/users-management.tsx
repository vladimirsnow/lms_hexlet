"use client";

import { apiFetch } from "@/lib/api-fetch";
import { useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  Download,
  KeyRound,
  Plus,
  Search,
  Shield,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import type { UserRole } from "@/server/policies/users";
import { getMessages, normalizeLocale, type AppLocale } from "@/lib/i18n";

type UserStatus = "ACTIVE" | "BLOCKED" | "ARCHIVED";
type EditableRoleChoice = UserRole | "CURATOR" | "GROUP_LEADER";
interface UserRecord {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: UserRole;
  status: UserStatus;
  firstName: string;
  lastName: string;
  middleName: string | null;
  phone: string | null;
  locale: string;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  curatedGroups?: Array<{ id: string; name: string }>;
  groupMemberships?: Array<{
    isGroupLeader: boolean;
    group: { id: string; name: string };
  }>;
}
interface GroupOption {
  id: string;
  name: string;
  curatorId: string | null;
  curator: { id: string; name: string } | null;
}
interface UsersResponse {
  items: UserRecord[];
  page: number;
  perPage: number;
  total: number;
  groups?: GroupOption[];
  error?: { message?: string };
}
interface AccountResponse {
  user?: UserRecord;
  temporaryPassword?: string;
  error?: { message?: string };
}
interface UsersImportResult {
  created: Array<{ row: number; email: string; username: string; temporaryPassword: string }>;
  errors: Array<{ row: number; email?: string; message: string }>;
  createdCount: number;
  errorCount: number;
}
interface UsersImportResponse {
  result?: UsersImportResult;
  error?: { message?: string };
}

function csvField(value: string) {
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function canManage(actorRole: UserRole, targetRole: UserRole) {
  return (
    actorRole === "SUPER_ADMIN" ||
    (actorRole === "ADMIN" && (targetRole === "STUDENT" || targetRole === "TEACHER"))
  );
}

function formatDate(value: string | null, locale: AppLocale, emptyLabel: string) {
  if (!value) return emptyLabel;
  const dateLocale = locale === "kk" ? "kk-KZ" : locale === "en" ? "en-GB" : "ru-RU";
  return new Date(value).toLocaleDateString(dateLocale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function UsersManagement({
  actorRole,
  locale,
}: {
  actorRole: UserRole;
  locale: AppLocale | string;
}) {
  const appLocale = normalizeLocale(locale);
  const messages = getMessages(appLocale);
  const t = messages.users;
  const roleLabels: Record<UserRole, string> = {
    SUPER_ADMIN: messages.roleSuperAdmin,
    ADMIN: messages.roleAdmin,
    TEACHER: messages.roleTeacher,
    STUDENT: messages.roleStudent,
  };
  const statusLabels: Record<UserStatus, string> = t.statuses;
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const [importResult, setImportResult] = useState<UsersImportResult>();
  const [credentials, setCredentials] = useState<{ user: UserRecord; password: string }>();
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    role: "STUDENT" as UserRole,
    roleChoice: "STUDENT" as EditableRoleChoice,
    status: "ACTIVE" as UserStatus,
    curatedGroupIds: [] as string[],
    studentGroupId: "",
    isGroupLeader: false,
  });

  useEffect(() => {
    let active = true;
    async function loadUsers() {
      setLoading(true);
      setError(undefined);
      const params = new URLSearchParams({ page: String(page), perPage: "20" });
      if (query) params.set("q", query);
      if (roleFilter !== "ALL") params.set("role", roleFilter);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      try {
        const response = await apiFetch(`/api/v1/admin/users?${params.toString()}`, {
          cache: "no-store",
        });
        const result = (await response.json()) as UsersResponse;
        if (!response.ok) throw new Error(result.error?.message ?? t.errors.load);
        if (active) {
          setUsers(result.items);
          setTotal(result.total);
          setGroups(result.groups ?? []);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : t.errors.load);
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadUsers();
    return () => {
      active = false;
    };
  }, [page, query, roleFilter, statusFilter, refresh, t.errors.load]);

  useEffect(() => {
    if (!editingId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) setEditingId(undefined);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [editingId, pending]);

  function startSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setQuery(searchInput.trim());
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(undefined);
    try {
      const response = await apiFetch("/api/v1/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const result = (await response.json()) as AccountResponse;
      if (!response.ok || !result.user || !result.temporaryPassword) {
        throw new Error(result.error?.message ?? t.errors.create);
      }
      setCredentials({ user: result.user, password: result.temporaryPassword });
      setCreateOpen(false);
      setStatusFilter("ALL");
      setRefresh((value) => value + 1);
      formElement.reset();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t.errors.create);
    } finally {
      setPending(false);
    }
  }

  async function importAccounts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setImportPending(true);
    setError(undefined);
    setImportResult(undefined);
    try {
      const response = await apiFetch("/api/v1/admin/users/import", {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as UsersImportResponse;
      if (!response.ok || !result.result) {
        throw new Error(result.error?.message ?? t.errors.import);
      }
      setImportResult(result.result);
      setStatusFilter("ALL");
      setPage(1);
      setRefresh((value) => value + 1);
      formElement.reset();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t.errors.import);
    } finally {
      setImportPending(false);
    }
  }

  function downloadImportedCredentials() {
    if (!importResult?.created.length) return;
    const rows = [
      ["username", "email", "temporary_password"],
      ...importResult.created.map((item) => [item.username, item.email, item.temporaryPassword]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `temporary-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function resetPassword(user: UserRecord) {
    setPending(true);
    setError(undefined);
    try {
      const response = await apiFetch(`/api/v1/admin/users/${user.id}/reset-password`, {
        method: "POST",
      });
      const result = (await response.json()) as AccountResponse;
      if (!response.ok || !result.user || !result.temporaryPassword) {
        throw new Error(result.error?.message ?? t.errors.reset);
      }
      setCredentials({ user: result.user, password: result.temporaryPassword });
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : t.errors.reset);
    } finally {
      setPending(false);
    }
  }

  function beginEdit(user: UserRecord) {
    setEditingId(user.id);
    setError(undefined);
    setMessage("");
    setDraft({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone ?? "",
      role: user.role,
      roleChoice:
        user.role === "TEACHER" && (user.curatedGroups?.length ?? 0) > 0
          ? "CURATOR"
          : user.role === "STUDENT" &&
              user.groupMemberships?.some((membership) => membership.isGroupLeader)
            ? "GROUP_LEADER"
            : user.role,
      status: user.status,
      curatedGroupIds: user.curatedGroups?.map((group) => group.id) ?? [],
      studentGroupId: user.groupMemberships?.[0]?.group.id ?? "",
      isGroupLeader: user.groupMemberships?.some((membership) => membership.isGroupLeader) ?? false,
    });
  }

  async function saveEdit(user: UserRecord) {
    if (
      draft.status === "ARCHIVED" &&
      user.status !== "ARCHIVED" &&
      !window.confirm(t.archiveConfirm(user.name))
    ) {
      return;
    }
    if (draft.roleChoice === "CURATOR" && draft.curatedGroupIds.length === 0) {
      setError(t.curatorNeedsGroup);
      return;
    }
    if (draft.roleChoice === "GROUP_LEADER" && !draft.studentGroupId) {
      setError(t.studentWithoutGroup);
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const payload: {
        email: string;
        firstName: string;
        lastName: string;
        phone: string;
        role: UserRole;
        status: UserStatus;
        curatedGroupIds?: string[];
        studentGroupId?: string | null;
        isGroupLeader?: boolean;
      } = {
        email: draft.email,
        firstName: draft.firstName,
        lastName: draft.lastName,
        phone: draft.phone,
        role: draft.role,
        status: draft.status,
      };
      if (draft.role === "TEACHER") {
        payload.curatedGroupIds = [...draft.curatedGroupIds];
      } else if (user.role === "TEACHER") {
        payload.curatedGroupIds = [];
      }
      if (draft.role === "STUDENT") {
        payload.studentGroupId = draft.studentGroupId || null;
        payload.isGroupLeader = draft.status === "ACTIVE" ? draft.isGroupLeader : false;
      } else if (user.role === "STUDENT") {
        payload.studentGroupId = null;
        payload.isGroupLeader = false;
      }
      const response = await apiFetch(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as AccountResponse;
      if (!response.ok) throw new Error(result.error?.message ?? t.errors.save);
      setEditingId(undefined);
      setStatusFilter("ALL");
      setRoleFilter("ALL");
      setPage(1);
      setMessage(t.savedChanges);
      setRefresh((value) => value + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t.errors.save);
    } finally {
      setPending(false);
    }
  }

  const availableRoles: UserRole[] =
    actorRole === "SUPER_ADMIN"
      ? ["STUDENT", "TEACHER", "ADMIN", "SUPER_ADMIN"]
      : ["STUDENT", "TEACHER"];
  const editableRoleChoices: EditableRoleChoice[] =
    actorRole === "SUPER_ADMIN"
      ? ["STUDENT", "GROUP_LEADER", "TEACHER", "CURATOR", "ADMIN", "SUPER_ADMIN"]
      : ["STUDENT", "GROUP_LEADER", "TEACHER", "CURATOR"];
  const editableRoleLabels: Record<EditableRoleChoice, string> = {
    ...roleLabels,
    CURATOR: t.curator,
    GROUP_LEADER: t.groupLeader,
  };
  const pageCount = Math.max(1, Math.ceil(total / 20));
  const exportParams = new URLSearchParams();
  if (query) exportParams.set("q", query);
  if (roleFilter !== "ALL") exportParams.set("role", roleFilter);
  if (statusFilter !== "ALL") exportParams.set("status", statusFilter);
  const exportHref = `/api/v1/admin/users/export${exportParams.size ? `?${exportParams}` : ""}`;
  const editingUser = users.find((user) => user.id === editingId);
  const editingMembership = editingUser?.groupMemberships?.[0];

  return (
    <div className="app-page-wrap">
      <header className="app-page-header">
        <div>
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p>{t.description}</p>
        </div>
        <div className="users-header-actions">
          <a className="button button-secondary" href={exportHref}>
            <Download aria-hidden="true" size={15} /> {t.exportCsv}
          </a>
          <button
            className="button button-secondary"
            onClick={() => {
              if (importOpen) setImportResult(undefined);
              setImportOpen((value) => !value);
            }}
            type="button"
          >
            <Upload aria-hidden="true" size={15} /> {t.importCsv}
          </button>
          <button
            className="button button-primary"
            onClick={() => setCreateOpen((value) => !value)}
            type="button"
          >
            <Plus aria-hidden="true" size={16} /> {t.newAccount}
          </button>
        </div>
      </header>

      {importOpen ? (
        <section className="admin-panel users-import-panel">
          <div className="admin-panel-heading">
            <div>
              <p className="eyebrow">{t.importCsv}</p>
              <h2>{t.importTitle}</h2>
              <p>{t.importHelp}</p>
            </div>
            <a className="admin-inline-link" href="/templates/users-import-template.csv" download>
              {t.downloadTemplate}
            </a>
          </div>
          <form className="users-import-form" onSubmit={importAccounts}>
            <label>
              {t.importFile}
              <input name="file" type="file" accept=".csv,text/csv" required />
            </label>
            <button className="button button-primary" disabled={importPending} type="submit">
              {importPending ? t.importing : t.importAction}
            </button>
          </form>
          {importResult ? (
            <div className="users-import-result" aria-live="polite">
              <p role="status">
                {t.importSummary(importResult.createdCount, importResult.errorCount)}
              </p>
              {importResult.created.length ? (
                <button
                  className="button button-secondary"
                  onClick={downloadImportedCredentials}
                  type="button"
                >
                  <Download aria-hidden="true" size={15} /> {t.downloadCredentials}
                </button>
              ) : null}
              {importResult.errors.length ? (
                <div>
                  <strong>{t.importErrorTitle}</strong>
                  <ul>
                    {importResult.errors.map((item) => (
                      <li key={`${item.row}:${item.email ?? ""}`}>
                        {t.importRow(item.row, item.email, item.message)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {error && !editingUser ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="users-success-note" role="status">
          {message}
        </p>
      ) : null}

      {credentials ? (
        <section className="one-time-credentials" aria-live="polite">
          <div className="one-time-credentials-heading">
            <div className="admin-stat-icon">
              <KeyRound aria-hidden="true" size={17} />
            </div>
            <div>
              <p className="eyebrow">{t.showUser}</p>
              <h2>{t.temporaryPasswordTitle}</h2>
            </div>
            <button
              aria-label={t.hidePassword}
              className="quiet-icon-button"
              onClick={() => setCredentials(undefined)}
              type="button"
            >
              <X aria-hidden="true" size={17} />
            </button>
          </div>
          <p>
            {credentials.user.name} · {credentials.user.username ?? credentials.user.email}
          </p>
          <code className="credential-value">{credentials.password}</code>
          <small>{t.temporaryPasswordNote}</small>
        </section>
      ) : null}

      {createOpen ? (
        <section className="admin-panel create-user-panel">
          <div className="admin-panel-heading">
            <div>
              <p className="eyebrow">{t.createEyebrow}</p>
              <h2>{t.createUser}</h2>
            </div>
            <button
              aria-label={t.closeForm}
              className="quiet-icon-button"
              onClick={() => setCreateOpen(false)}
              type="button"
            >
              <X aria-hidden="true" size={17} />
            </button>
          </div>
          <form className="admin-create-grid" onSubmit={createAccount}>
            <input name="locale" type="hidden" value={appLocale} />
            <label>
              {t.firstName}
              <input name="firstName" autoComplete="given-name" required maxLength={80} />
              <small>{t.firstNameHelp}</small>
            </label>
            <label>
              {t.lastName}
              <input name="lastName" autoComplete="family-name" required maxLength={80} />
              <small>{t.lastNameHelp}</small>
            </label>
            <label>
              {t.username}
              <input
                name="username"
                required
                minLength={3}
                maxLength={30}
                pattern="[A-Za-z0-9_.]+"
              />
              <small>{t.usernameHelp}</small>
            </label>
            <label>
              {t.email}
              <input name="email" type="email" required maxLength={254} />
              <small>{t.emailHelp}</small>
            </label>
            <label>
              {t.role}
              <select name="role" defaultValue="STUDENT">
                {availableRoles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
              <small>{t.roleHelp}</small>
            </label>
            <div className="admin-create-actions">
              <p>
                <Shield aria-hidden="true" size={14} /> {t.autoPassword}
              </p>
              <button className="button button-primary" disabled={pending} type="submit">
                {pending ? t.creating : t.createAccount} <UserPlus aria-hidden="true" size={15} />
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="admin-panel users-panel">
        <form className="users-filter-bar" onSubmit={startSearch}>
          <div className="users-search-field">
            <Search aria-hidden="true" size={17} />
            <input
              aria-label={t.search}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t.searchPlaceholder}
              value={searchInput}
            />
            <button type="submit">{t.find}</button>
          </div>
          <label className="users-filter-select">
            {t.role}
            <select
              onChange={(event) => {
                setRoleFilter(event.target.value);
                setPage(1);
              }}
              value={roleFilter}
            >
              <option value="ALL">{t.allRoles}</option>
              {Object.entries(roleLabels).map(([role, label]) => (
                <option key={role} value={role}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="users-filter-select">
            {t.status}
            <select
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
              value={statusFilter}
            >
              <option value="ACTIVE">{t.active}</option>
              <option value="BLOCKED">{t.blocked}</option>
              <option value="ARCHIVED">{t.archived}</option>
              <option value="ALL">{t.all}</option>
            </select>
          </label>
          <span className="users-total">
            {total} {t.accountCount}
          </span>
        </form>

        {loading ? <p className="admin-empty-state">{t.loading}</p> : null}
        {!loading && users.length === 0 ? (
          <div className="admin-empty-state">
            <Activity aria-hidden="true" size={19} /> {t.empty}
          </div>
        ) : null}
        {!loading && users.length > 0 ? (
          <div className="users-table-scroll">
            <table className="users-table">
              <thead>
                <tr>
                  <th>{t.user}</th>
                  <th>{t.role}</th>
                  <th>{t.status}</th>
                  <th>{t.lastLogin}</th>
                  <th>
                    <span className="sr-only">{t.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const editable = canManage(actorRole, user.role);
                  const curatedGroupNames = user.curatedGroups?.map((group) => group.name) ?? [];
                  const leaderGroups =
                    user.groupMemberships
                      ?.filter((item) => item.isGroupLeader)
                      .map((item) => item.group) ?? [];
                  const visibleRole =
                    user.role === "TEACHER" && curatedGroupNames.length
                      ? t.curator
                      : user.role === "STUDENT" && leaderGroups.length
                        ? t.groupLeader
                        : roleLabels[user.role];
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="user-identity">
                          <span>
                            <strong>{user.name}</strong>
                            <small>
                              {user.email} · @{user.username}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="users-role-stack">
                          <span
                            className={`role-pill role-pill-${user.role.toLowerCase()}`}
                            title={
                              user.role === "TEACHER" && curatedGroupNames.length
                                ? curatedGroupNames.join(", ")
                                : user.role === "STUDENT" && leaderGroups.length
                                  ? leaderGroups.map((group) => group.name).join(", ")
                                  : undefined
                            }
                          >
                            {visibleRole}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={`status-pill status-pill-${user.status.toLowerCase()}`}>
                          {statusLabels[user.status]}
                        </span>
                        {user.mustChangePassword ? (
                          <small className="user-first-login">{t.changePasswordAtLogin}</small>
                        ) : null}
                      </td>
                      <td className="user-date">
                        {formatDate(user.lastLoginAt, appLocale, t.neverLoggedIn)}
                      </td>
                      <td>
                        {editable ? (
                          <div className="user-row-actions">
                            <button
                              className="mini-action"
                              disabled={pending}
                              onClick={() => beginEdit(user)}
                              type="button"
                            >
                              {t.edit}
                            </button>
                            {user.status !== "ARCHIVED" ? (
                              <button
                                className="mini-action"
                                disabled={pending}
                                onClick={() => void resetPassword(user)}
                                type="button"
                              >
                                {t.password}
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="user-readonly">{t.readOnly}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="users-pagination">
          <span>
            {t.page} {page} {t.of} {pageCount}
          </span>
          <div>
            <button
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => value - 1)}
              type="button"
            >
              {t.previous}
            </button>
            <button
              disabled={page >= pageCount || loading}
              onClick={() => setPage((value) => value + 1)}
              type="button"
            >
              {t.next}
            </button>
          </div>
        </div>
      </section>
      {editingUser ? (
        <div
          className="users-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) setEditingId(undefined);
          }}
        >
          <section
            aria-labelledby="user-edit-modal-title"
            aria-modal="true"
            className="users-edit-modal"
            role="dialog"
          >
            <div className="users-edit-modal-heading">
              <div>
                <p className="eyebrow">{t.edit}</p>
                <h2 id="user-edit-modal-title">{editingUser.name}</h2>
              </div>
              <button
                aria-label={t.closeForm}
                className="quiet-icon-button"
                disabled={pending}
                onClick={() => setEditingId(undefined)}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </div>
            <form
              className="users-edit-modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveEdit(editingUser);
              }}
            >
              <p className="user-edit-help">{t.editHelp}</p>
              <div className="users-edit-modal-fields">
                <label>
                  {t.firstName}
                  <input
                    autoComplete="given-name"
                    maxLength={80}
                    onChange={(event) => setDraft({ ...draft, firstName: event.target.value })}
                    required
                    value={draft.firstName}
                  />
                  <small>{t.firstNameHelp}</small>
                </label>
                <label>
                  {t.lastName}
                  <input
                    autoComplete="family-name"
                    maxLength={80}
                    onChange={(event) => setDraft({ ...draft, lastName: event.target.value })}
                    required
                    value={draft.lastName}
                  />
                  <small>{t.lastNameHelp}</small>
                </label>
                <label>
                  {t.email}
                  <input
                    autoComplete="email"
                    maxLength={254}
                    onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                    required
                    type="email"
                    value={draft.email}
                  />
                  <small>{t.emailHelp}</small>
                </label>
                <label>
                  {t.phone}
                  <input
                    autoComplete="tel"
                    maxLength={40}
                    onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                    value={draft.phone}
                  />
                  <small>{t.phoneHelp}</small>
                </label>
                <label>
                  {t.role}
                  <select
                    onChange={(event) => {
                      const roleChoice = event.target.value as EditableRoleChoice;
                      const role: UserRole =
                        roleChoice === "CURATOR"
                          ? "TEACHER"
                          : roleChoice === "GROUP_LEADER"
                            ? "STUDENT"
                            : roleChoice;
                      setDraft((current) => ({
                        ...current,
                        role,
                        roleChoice,
                        curatedGroupIds:
                          roleChoice === "CURATOR" ? current.curatedGroupIds : [],
                        studentGroupId: role === "STUDENT" ? current.studentGroupId : "",
                        isGroupLeader: roleChoice === "GROUP_LEADER",
                      }));
                    }}
                    value={draft.roleChoice}
                  >
                    {editableRoleChoices.map((roleChoice) => (
                      <option
                        key={roleChoice}
                        disabled={
                          draft.status !== "ACTIVE" &&
                          (roleChoice === "CURATOR" || roleChoice === "GROUP_LEADER")
                        }
                        value={roleChoice}
                      >
                        {editableRoleLabels[roleChoice]}
                      </option>
                    ))}
                  </select>
                  <small>
                    {draft.roleChoice === "CURATOR"
                      ? t.curatorHelp
                      : draft.roleChoice === "GROUP_LEADER"
                        ? t.groupLeaderHelp
                        : t.roleHelp}
                  </small>
                </label>
                <label>
                  {t.status}
                  <select
                    onChange={(event) => {
                      const status = event.target.value as UserStatus;
                      setDraft((current) => ({
                        ...current,
                        status,
                        ...(status === "ACTIVE"
                          ? {}
                          : {
                              curatedGroupIds: [],
                              isGroupLeader: false,
                              roleChoice:
                                current.roleChoice === "CURATOR"
                                  ? "TEACHER"
                                  : current.roleChoice === "GROUP_LEADER"
                                    ? "STUDENT"
                                    : current.roleChoice,
                            }),
                      }));
                    }}
                    value={draft.status}
                  >
                    {(["ACTIVE", "BLOCKED", "ARCHIVED"] as const).map((status) => (
                      <option key={status} value={status}>
                        {statusLabels[status]}
                      </option>
                    ))}
                  </select>
                  <small>{t.statusHelp}</small>
                </label>
              </div>

              {draft.roleChoice === "CURATOR" ? (
                <section className="users-subrole-editor">
                  <div>
                    <h3>{t.curator}</h3>
                    <p>{t.curatorHelp}</p>
                  </div>
                  {draft.status === "ACTIVE" ? (
                    <div className="users-group-assignment-list">
                      {groups.map((group) => {
                        const assignedElsewhere = Boolean(
                          group.curatorId && group.curatorId !== editingUser.id,
                        );
                        return (
                          <label className="users-group-assignment" key={group.id}>
                            <input
                              checked={draft.curatedGroupIds.includes(group.id)}
                              disabled={pending || assignedElsewhere}
                              onChange={(event) => {
                                setDraft((current) => ({
                                  ...current,
                                  curatedGroupIds: event.target.checked
                                    ? [...current.curatedGroupIds, group.id]
                                    : current.curatedGroupIds.filter((id) => id !== group.id),
                                }));
                              }}
                              type="checkbox"
                            />
                            <span>
                              {group.name}
                              {assignedElsewhere && group.curator
                                ? ` · ${t.curatorAssignedTo(group.curator.name)}`
                                : ""}
                            </span>
                          </label>
                        );
                      })}
                      {!groups.length ? <p>{t.noGroups}</p> : null}
                    </div>
                  ) : (
                    <p className="users-subrole-note">{t.curatorInactiveHelp}</p>
                  )}
                </section>
              ) : null}

              {draft.role === "STUDENT" ? (
                <section className="users-subrole-editor">
                  <div>
                    <h3>{t.studentGroup}</h3>
                    <p>{t.studentGroupHelp}</p>
                  </div>
                  {draft.status !== "ARCHIVED" ? (
                    <label>
                      {t.studentGroup}
                      <select
                        disabled={pending}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            studentGroupId: event.target.value,
                            ...(event.target.value
                              ? {}
                              : {
                                  isGroupLeader: false,
                                  roleChoice:
                                    current.roleChoice === "GROUP_LEADER"
                                      ? "STUDENT"
                                      : current.roleChoice,
                                }),
                          }))
                        }
                        value={draft.studentGroupId}
                      >
                        <option value="">{t.studentNoGroupOption}</option>
                        {groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="users-subrole-note">{t.studentGroupArchivedHelp}</p>
                  )}
                  <div>
                    <h3>{t.groupLeader}</h3>
                    <p>{t.groupLeaderHelp}</p>
                  </div>
                  {draft.studentGroupId ? (
                    <label className="users-group-assignment">
                      <input
                        checked={draft.isGroupLeader}
                        disabled={pending || draft.status !== "ACTIVE"}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            isGroupLeader: event.target.checked,
                            roleChoice: event.target.checked ? "GROUP_LEADER" : "STUDENT",
                          }))
                        }
                        type="checkbox"
                      />
                      <span>
                        {groups.find((group) => group.id === draft.studentGroupId)?.name ??
                          editingMembership?.group.name}
                      </span>
                    </label>
                  ) : (
                    <p className="users-subrole-note">{t.studentWithoutGroup}</p>
                  )}
                </section>
              ) : null}

              {error ? (
                <p className="admin-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="users-edit-modal-actions">
                <button className="button button-primary" disabled={pending} type="submit">
                  {t.save}
                </button>
                <button
                  className="button button-muted"
                  disabled={pending}
                  onClick={() => setEditingId(undefined)}
                  type="button"
                >
                  {t.cancel}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
