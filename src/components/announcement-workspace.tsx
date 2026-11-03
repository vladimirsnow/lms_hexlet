"use client";

import { apiFetch } from "@/lib/api-fetch";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getMessages, normalizeLocale, type AppLocale } from "@/lib/i18n";

type AnnouncementItem = {
  id: string;
  scope: "GLOBAL" | "COURSE" | "GROUP";
  title: string;
  body: string;
  publishedAt: string | null;
  expiresAt: string | null;
  createdBy: { id: string; name: string };
  course: { id: string; title: string; slug: string } | null;
  group: { id: string; name: string } | null;
  courseTargets?: Array<{ course: { id: string; title: string; slug: string } }>;
  groupTargets?: Array<{ group: { id: string; name: string } }>;
};
type AnnouncementOptions = {
  courses: { id: string; title: string }[];
  groups: { id: string; name: string }[];
  canPublishGlobal: boolean;
};

async function request(path: string, method: string, body: unknown, errorMessage: string) {
  const response = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage);
  return data;
}

export function AnnouncementWorkspace({
  announcements,
  options,
  role,
  actorId,
  locale,
}: {
  announcements: AnnouncementItem[];
  options?: AnnouncementOptions;
  role: "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT";
  actorId: string;
  locale: AppLocale | string;
}) {
  const appLocale = normalizeLocale(locale);
  const t = getMessages(appLocale).announcements;
  const dateLocale = appLocale === "kk" ? "kk-KZ" : appLocale === "en" ? "en-GB" : "ru-RU";
  const admin = role === "ADMIN" || role === "SUPER_ADMIN";
  const student = role === "STUDENT";
  const canCreate = admin || role === "TEACHER" || (student && Boolean(options?.groups.length));
  const router = useRouter();
  const [scope, setScope] = useState<"GLOBAL" | "COURSE" | "GROUP">(
    admin ? "GLOBAL" : student ? "GROUP" : "COURSE",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editId, setEditId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const expiry = String(data.get("expiresAt") || "");
    if (scope === "COURSE" && !selectedCourseIds.length) {
      setError(t.chooseAtLeastOneCourse);
      return;
    }
    if (scope === "GROUP" && !selectedGroupIds.length) {
      setError(t.chooseAtLeastOneGroup);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await request(
        "/api/v1/announcements",
        "POST",
        {
          scope,
          title: data.get("title"),
          body: data.get("body"),
          courseIds: scope === "COURSE" ? selectedCourseIds : [],
          groupIds: scope === "GROUP" ? selectedGroupIds : [],
          expiresAt: expiry ? new Date(expiry).toISOString() : null,
        },
        t.operationError,
      );
      form.reset();
      setSelectedCourseIds([]);
      setSelectedGroupIds([]);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.createError);
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(item: AnnouncementItem) {
    setEditId(item.id);
    setEditTitle(item.title);
    setEditBody(item.body);
    setError("");
  }
  async function saveEdit(item: AnnouncementItem) {
    setBusy(true);
    setError("");
    try {
      await request(
        `/api/v1/announcements/${item.id}`,
        "PATCH",
        {
          title: editTitle,
          body: editBody,
        },
        t.operationError,
      );
      setEditId("");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.saveError);
    } finally {
      setBusy(false);
    }
  }
  async function togglePublish(item: AnnouncementItem) {
    setBusy(true);
    setError("");
    try {
      await request(
        `/api/v1/announcements/${item.id}`,
        "PATCH",
        { publish: !item.publishedAt },
        t.operationError,
      );
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.publishError);
    } finally {
      setBusy(false);
    }
  }
  async function archive(item: AnnouncementItem) {
    if (!window.confirm(t.archiveConfirm)) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/v1/announcements/${item.id}`, "DELETE", undefined, t.operationError);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.archiveError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-page-wrap announcement-page">
      <header className="app-page-header">
        <div>
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p>{t.description}</p>
        </div>
        <Link className="button button-muted" href="/notifications">
          {t.openNotifications}
        </Link>
      </header>
      {canCreate && options ? (
        <section className="admin-panel announcement-create-panel">
          <div className="admin-panel-heading">
            <div>
              <p className="eyebrow">{t.create}</p>
              <h2>{t.newAnnouncement}</h2>
            </div>
          </div>
          <form className="announcement-form" onSubmit={create}>
            <label>
              {t.audience}
              <select
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value as typeof scope);
                  setSelectedCourseIds([]);
                  setSelectedGroupIds([]);
                }}
              >
                {options.canPublishGlobal ? <option value="GLOBAL">{t.everyone}</option> : null}
                {!student ? <option value="COURSE">{t.courses}</option> : null}
                <option value="GROUP">{t.groups}</option>
              </select>
            </label>
            {scope === "COURSE" ? (
              <fieldset className="announcement-target-picker announcement-wide">
                <legend>{t.chooseCourses}</legend>
                <div className="announcement-target-list">
                  {options.courses.map((course) => (
                    <label className="announcement-target-option" key={course.id}>
                      <input
                        checked={selectedCourseIds.includes(course.id)}
                        disabled={busy}
                        onChange={(event) =>
                          setSelectedCourseIds((current) =>
                            event.target.checked
                              ? [...current, course.id]
                              : current.filter((id) => id !== course.id),
                          )
                        }
                        type="checkbox"
                      />
                      <span>{course.title}</span>
                    </label>
                  ))}
                  {!options.courses.length ? <p>{t.noCoursesAvailable}</p> : null}
                </div>
                <small>{t.selectedCount(selectedCourseIds.length)}</small>
              </fieldset>
            ) : scope === "GROUP" ? (
              <fieldset className="announcement-target-picker announcement-wide">
                <legend>{t.chooseGroups}</legend>
                <div className="announcement-target-list">
                  {options.groups.map((group) => (
                    <label className="announcement-target-option" key={group.id}>
                      <input
                        checked={selectedGroupIds.includes(group.id)}
                        disabled={busy}
                        onChange={(event) =>
                          setSelectedGroupIds((current) =>
                            event.target.checked
                              ? [...current, group.id]
                              : current.filter((id) => id !== group.id),
                          )
                        }
                        type="checkbox"
                      />
                      <span>{group.name}</span>
                    </label>
                  ))}
                  {!options.groups.length ? <p>{t.noGroupsAvailable}</p> : null}
                </div>
                <small>{t.selectedCount(selectedGroupIds.length)}</small>
              </fieldset>
            ) : null}
            <label className="announcement-wide">
              {t.headline}
              <input required name="title" maxLength={200} />
            </label>
            <label className="announcement-wide">
              {t.body}
              <textarea required name="body" rows={5} maxLength={20000} />
            </label>
            <label>
              {t.expiresAt}
              <input name="expiresAt" type="datetime-local" />
            </label>
            <div className="announcement-form-actions">
              <button className="button button-primary" disabled={busy}>
                {busy ? t.saving : t.createAction}
              </button>
              {error ? (
                <span className="schedule-form-error" role="alert">
                  {error}
                </span>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}
      <section className="announcement-list" aria-label={t.listLabel}>
        {error && !editId ? (
          <p className="schedule-form-error" role="alert">
            {error}
          </p>
        ) : null}
        {announcements.length ? (
          announcements.map((item) => {
            const canEdit = canCreate && (admin || item.createdBy.id === actorId);
            const courseNames = item.courseTargets?.length
              ? item.courseTargets.map((target) => target.course.title)
              : item.course
                ? [item.course.title]
                : [];
            const groupNames = item.groupTargets?.length
              ? item.groupTargets.map((target) => target.group.name)
              : item.group
                ? [item.group.name]
                : [];
            const targetNames = [...courseNames, ...groupNames];
            return (
              <article className="announcement-card" key={item.id}>
                <div className="announcement-card-meta">
                  <span>
                    {item.scope === "GLOBAL"
                      ? t.everyone
                      : item.scope === "COURSE"
                        ? t.courses
                        : t.groups}
                    {targetNames.length ? ` · ${targetNames.join(", ")}` : ""}
                  </span>
                  <time dateTime={item.publishedAt ?? undefined}>
                    {item.publishedAt
                      ? new Date(item.publishedAt).toLocaleString(dateLocale)
                      : t.draft}
                  </time>
                </div>
                {editId === item.id ? (
                  <div className="announcement-edit-form">
                    <label>
                      {t.headline}
                      <input
                        maxLength={200}
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                      />
                    </label>
                    <label>
                      {t.body}
                      <textarea
                        rows={5}
                        maxLength={20000}
                        value={editBody}
                        onChange={(event) => setEditBody(event.target.value)}
                      />
                    </label>
                    <div className="announcement-actions">
                      <button
                        className="button button-primary"
                        disabled={busy}
                        type="button"
                        onClick={() => saveEdit(item)}
                      >
                        {t.save}
                      </button>
                      <button
                        className="button button-muted"
                        type="button"
                        onClick={() => setEditId("")}
                      >
                        {t.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2>{item.title}</h2>
                    <p className="announcement-body">{item.body}</p>
                  </>
                )}
                <div className="announcement-card-footer">
                  <span>
                    {t.author}: {item.createdBy.name}
                    {item.expiresAt
                      ? ` · ${t.until} ${new Date(item.expiresAt).toLocaleString(dateLocale)}`
                      : ""}
                  </span>
                  {canEdit ? (
                    <div className="announcement-actions">
                      <button
                        className="button button-muted"
                        type="button"
                        disabled={busy}
                        onClick={() => beginEdit(item)}
                      >
                        {t.edit}
                      </button>
                      <button
                        className="button button-muted"
                        type="button"
                        disabled={busy}
                        onClick={() => togglePublish(item)}
                      >
                        {item.publishedAt ? t.unpublish : t.publish}
                      </button>
                      <button
                        className="button button-muted"
                        type="button"
                        disabled={busy}
                        onClick={() => archive(item)}
                      >
                        {t.archive}
                      </button>
                    </div>
                  ) : null}
                </div>
                {error && editId === item.id ? (
                  <p className="schedule-form-error" role="alert">
                    {error}
                  </p>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="admin-panel">
            <p className="course-material-empty">{t.empty}</p>
          </div>
        )}
      </section>
    </div>
  );
}

export function NotificationsWorkspace({
  initial,
  locale,
}: {
  initial: {
    items: {
      id: string;
      title: string;
      body: string | null;
      link: string | null;
      type: string;
      readAt: string | null;
      createdAt: string;
      dataJson?: unknown;
    }[];
    unread: number;
  };
  locale: AppLocale | string;
}) {
  const appLocale = normalizeLocale(locale);
  const t = getMessages(appLocale).notifications;
  const dateLocale = appLocale === "kk" ? "kk-KZ" : appLocale === "en" ? "en-GB" : "ru-RU";
  const [items, setItems] = useState(initial.items);
  const [unread, setUnread] = useState(initial.unread);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function markRead(id: string) {
    try {
      await request(`/api/v1/notifications/${id}/read`, "POST", undefined, t.operationError);
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
        ),
      );
      setUnread((value) => Math.max(0, value - 1));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.markOneError);
    }
  }
  async function markAllRead() {
    setBusy(true);
    setError("");
    try {
      await request("/api/v1/me/notifications", "PATCH", undefined, t.operationError);
      const now = new Date().toISOString();
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
      setUnread(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.markAllError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-page-wrap notification-page">
      <header className="app-page-header">
        <div>
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p>
            {t.unread}: {unread}
          </p>
        </div>
        <Link className="button button-muted" href="/announcements">
          {t.announcements}
        </Link>
      </header>
      {unread ? (
        <div className="notification-toolbar">
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={markAllRead}
          >
            {busy ? t.refresh : t.markAllRead}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="schedule-form-error" role="alert">
          {error}
        </p>
      ) : null}
      {items.length ? (
        <section className="notification-list">
          {items.map((item) => (
            <article
              className={
                item.readAt ? "notification-card" : "notification-card notification-unread"
              }
              key={item.id}
            >
              <div>
                <p className="eyebrow">
                  {item.type === "ANNOUNCEMENT" ? t.announcement : item.type}
                </p>
                <h2>{item.title}</h2>
                {item.body ? <p>{item.body}</p> : null}
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString(dateLocale)}
                </time>
              </div>
              <div className="notification-actions">
                {item.link ? (
                  <Link
                    className="button button-secondary"
                    href={item.link}
                    onClick={() => {
                      if (!item.readAt) void markRead(item.id);
                    }}
                  >
                    {t.open}
                  </Link>
                ) : null}
                {!item.readAt ? (
                  <button
                    className="button button-muted"
                    type="button"
                    onClick={() => markRead(item.id)}
                  >
                    {t.read}
                  </button>
                ) : (
                  <span>{t.read}</span>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="admin-panel">
          <p className="course-material-empty">{t.empty}</p>
        </section>
      )}
    </div>
  );
}
