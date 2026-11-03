"use client";

import { apiFetch } from "@/lib/api-fetch";
import { useState, type FormEvent } from "react";
import { getMessages, normalizeLocale, type AppLocale } from "@/lib/i18n";
import { RichTextEditor } from "@/components/rich-text-editor";

type LessonType = "TEXT" | "FILE" | "LINK" | "VIDEO";
type ManageableLesson = { id: string; title: string; type: LessonType; isPublished: boolean };
type ManageableSection = {
  id: string;
  title: string;
  position: number;
  isPublished: boolean;
  lessons: ManageableLesson[];
};

function errorFrom(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: { message?: string } }).error;
    if (error?.message) return error.message;
  }
  return fallback;
}

async function requestJson(path: string, method: string, body: unknown, fallback: string) {
  const response = await apiFetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorFrom(payload, fallback));
  return payload;
}

function mimeForFile(file: File): string {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const known: Record<string, string> = {
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/plain",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    zip: "application/zip",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return known[extension ?? ""] ?? file.type;
}

export function FileUpload({
  lessonId,
  submissionId,
  locale = "ru",
}: {
  lessonId?: string;
  submissionId?: string;
  locale?: AppLocale | string;
}) {
  const t = getMessages(normalizeLocale(locale)).course;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("file");
    const file = fileInput instanceof HTMLInputElement ? fileInput.files?.[0] : undefined;
    if (!file) {
      setError(t.chooseFile);
      return;
    }
    const mimeType = mimeForFile(file);
    if (!mimeType) {
      setError(t.unknownFileType);
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const presignResponse = await apiFetch("/api/v1/files/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(lessonId ? { lessonId } : { submissionId }),
          originalName: file.name,
          mimeType,
          sizeBytes: file.size,
        }),
      });
      const presignPayload = await presignResponse.json().catch(() => null);
      if (!presignResponse.ok) throw new Error(errorFrom(presignPayload, t.requestError));
      const upload = (
        presignPayload as {
          upload: {
            fileId: string;
            url: string;
            method: "POST" | "PUT";
            fields: Record<string, string>;
            headers: Record<string, string>;
          };
        }
      ).upload;
      const storageResponse =
        upload.method === "PUT"
          ? await fetch(upload.url, { method: "PUT", headers: upload.headers, body: file })
          : await (async () => {
              const data = new FormData();
              for (const [name, value] of Object.entries(upload.fields)) data.append(name, value);
              data.append("file", file, file.name);
              return fetch(upload.url, { method: "POST", body: data });
            })();
      if (!storageResponse.ok) throw new Error(t.storageRejected);
      await requestJson(`/api/v1/files/${upload.fileId}/complete`, "POST", {}, t.requestError);
      setMessage(t.uploaded);
      form.reset();
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.uploadError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="course-file-upload" onSubmit={upload}>
      <label>
        {t.uploadFile}
        <input
          name="file"
          type="file"
          accept=".pdf,.docx,.pptx,.xlsx,.zip,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
        />
      </label>
      <button className="button button-secondary" type="submit" disabled={busy}>
        {busy ? t.uploading : t.upload}
      </button>
      {message ? (
        <span className="form-success" role="status">
          {message}
        </span>
      ) : null}
      {error ? (
        <span className="form-error" role="alert">
          {error}
        </span>
      ) : null}
    </form>
  );
}

export function CourseContentManager({
  courseId,
  sections,
  locale,
}: {
  courseId: string;
  sections: ManageableSection[];
  locale: AppLocale | string;
}) {
  const t = getMessages(normalizeLocale(locale)).course;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function createSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await requestJson(
        `/api/v1/courses/${courseId}/sections`,
        "POST",
        {
          title: data.get("title"),
          summary: data.get("summary") || null,
        },
        t.requestError,
      );
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.requestError);
    } finally {
      setBusy(false);
    }
  }

  async function createLesson(event: FormEvent<HTMLFormElement>, sectionId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const type = String(data.get("type")) as LessonType;
    const body: Record<string, unknown> = {
      title: data.get("title"),
      type,
      isPublished: false,
    };
    if (type === "TEXT") body.content = data.get("content");
    if (type === "LINK" || type === "VIDEO") body.externalUrl = data.get("externalUrl");
    setBusy(true);
    setError("");
    try {
      await requestJson(`/api/v1/sections/${sectionId}/lessons`, "POST", body, t.requestError);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.requestError);
    } finally {
      setBusy(false);
    }
  }

  async function togglePublication(path: string, published: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestJson(path, "PATCH", { isPublished: !published }, t.requestError);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.requestError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="course-content-manager admin-panel">
      <div className="course-materials-heading">
        <div>
          <p className="eyebrow">{t.editing}</p>
          <h2>{t.manageMaterials}</h2>
        </div>
        <span>{t.createSequence}</span>
      </div>
      <form className="course-manager-section-form" onSubmit={createSection}>
        <label>
          {t.newSection}
          <input name="title" required maxLength={200} placeholder={t.sectionExample} />
        </label>
        <label>
          {t.shortDescription}
          <input name="summary" maxLength={1000} placeholder={t.optional} />
        </label>
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? t.saving : t.createSection}
        </button>
      </form>
      {sections.map((section) => (
        <div className="course-manager-section" key={section.id}>
          <div className="course-manager-section-heading">
            <div>
              <strong>
                {section.position + 1}. {section.title}
              </strong>
              <span>{t.materialCount(section.lessons.length)}</span>
            </div>
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                togglePublication(`/api/v1/sections/${section.id}`, section.isPublished)
              }
            >
              {section.isPublished ? t.hideSection : t.publishSection}
            </button>
          </div>
          {section.lessons.map((lesson) => (
            <div className="course-manager-lesson" key={lesson.id}>
              <span>
                <strong>{lesson.title}</strong>
                <small>
                  {lesson.type === "TEXT"
                    ? t.typeText
                    : lesson.type === "FILE"
                      ? t.typeFile
                      : lesson.type === "VIDEO"
                        ? t.typeVideo
                        : t.typeLink}
                </small>
              </span>
              <div>
                {lesson.type === "FILE" ? (
                  <FileUpload lessonId={lesson.id} locale={locale} />
                ) : null}
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    togglePublication(`/api/v1/lessons/${lesson.id}`, lesson.isPublished)
                  }
                >
                  {lesson.isPublished ? t.hide : t.publish}
                </button>
              </div>
            </div>
          ))}
          <form
            className="course-manager-lesson-form"
            onSubmit={(event) => createLesson(event, section.id)}
          >
            <label>
              {t.materialTitle}
              <input name="title" required maxLength={200} placeholder={t.newMaterial} />
            </label>
            <label>
              {t.type}
              <select name="type" defaultValue="TEXT">
                <option value="TEXT">{t.typeText}</option>
                <option value="FILE">{t.typeFile}</option>
                <option value="LINK">{t.typeLink}</option>
                <option value="VIDEO">{t.typeVideo}</option>
              </select>
            </label>
            <div className="course-manager-rich-text">
              <span>{t.textOrLink}</span>
              <RichTextEditor name="content" ariaLabel={t.contentHint} locale={locale} />
            </div>
            <label>
              {t.externalUrl}
              <input name="externalUrl" type="url" placeholder="https://…" />
            </label>
            <button className="button button-secondary" type="submit" disabled={busy}>
              {busy ? t.saving : t.addMaterial}
            </button>
          </form>
        </div>
      ))}
      {message ? (
        <p className="form-success" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
