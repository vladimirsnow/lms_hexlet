"use client";

import { apiFetch } from "@/lib/api-fetch";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { AppLocale } from "@/lib/i18n";
import { getMessages } from "@/lib/i18n";

type AcademicCopy = ReturnType<typeof getMessages>["academic"];

type Choice = { id: string; name: string };
type AcademicData = {
  years: Array<Choice & { startsOn: string; endsOn: string; isActive: boolean }>;
  terms: Array<
    Choice & { academicYearId: string; startsOn: string; endsOn: string; isActive: boolean }
  >;
  specialties: Array<{ id: string; code: string; nameRu: string; isActive: boolean }>;
  groups: Array<
    Choice & {
      academicYearId: string;
      specialtyId: string;
      isActive: boolean;
      academicYear: { name: string };
      specialty: { code: string; nameRu: string };
      curatorId: string | null;
      curator: { id: string; name: string } | null;
      memberships: Array<{ studentId: string }>;
      _count: { memberships: number };
    }
  >;
  subjects: Array<{
    id: string;
    code: string;
    nameRu: string;
    credits: string | null;
    totalHours: number | null;
    isActive: boolean;
  }>;
  courses: Array<{
    id: string;
    title: string;
    slug: string;
    status: string;
    subject: { nameRu: string };
    term: { name: string };
    academicYear: { name: string };
    specialty: { code: string };
    _count: { enrollments: number };
  }>;
  teachers: Array<{ id: string; name: string; email: string }>;
  students: Array<{ id: string; name: string; email: string; username: string | null }>;
};

type Section = "academic-years" | "terms" | "specialties" | "groups" | "subjects" | "courses";

export function AcademicManagement({ locale, ...data }: AcademicData & { locale: AppLocale }) {
  const t = getMessages(locale).academic;
  const sections: Array<[Section, string]> = [
    ["academic-years", t.tabs.years],
    ["terms", t.tabs.terms],
    ["specialties", t.tabs.specialties],
    ["groups", t.tabs.groups],
    ["subjects", t.tabs.subjects],
    ["courses", t.tabs.courses],
  ];
  const courseStatusLabel = (status: string) =>
    status === "PUBLISHED"
      ? t.records.published
      : status === "ARCHIVED"
        ? t.records.archiveStatus
        : t.records.draft;
  const router = useRouter();
  const [section, setSection] = useState<Section>("academic-years");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedGroupStudent, setSelectedGroupStudent] = useState("");
  const [isGroupLeader, setIsGroupLeader] = useState(false);
  const [curatorGroupId, setCuratorGroupId] = useState("");
  const [curatorIdDraft, setCuratorIdDraft] = useState("");
  const [importReport, setImportReport] = useState<{
    added: number;
    skipped: number;
    errors: Array<{ row: number; email?: string; message: string }>;
  } | null>(null);

  async function create(event: FormEvent<HTMLFormElement>, resource: Section) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    for (const key of ["curatorId", "capacity", "credits", "totalHours", "summary"]) {
      if (payload[key] === "") payload[key] = null as unknown as FormDataEntryValue;
    }
    try {
      const response = await apiFetch(`/api/v1/admin/${resource}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? t.errors.save);
      form.reset();
      setMessage(t.success.created);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.errors.save);
    } finally {
      setBusy(false);
    }
  }

  async function mutate(path: string, method: "PATCH" | "DELETE", body?: unknown) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await apiFetch(path, {
        method,
        ...(body
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? t.errors.change);
      setMessage(t.success.saved);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.errors.change);
    } finally {
      setBusy(false);
    }
  }

  async function assignCurator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const groupId = curatorGroupId;
    const curatorId = curatorIdDraft || null;
    if (!groupId) return;
    await mutate(`/api/v1/admin/groups/${groupId}`, "PATCH", { curatorId });
  }

  async function copyCourse(courseId: string) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await apiFetch(`/api/v1/courses/${courseId}/copy`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? t.errors.copyCourse);
      setMessage(t.success.courseCopied(result.item.title));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.errors.copyCourse);
    } finally {
      setBusy(false);
    }
  }

  async function submitRelation(
    event: FormEvent<HTMLFormElement>,
    kind: "teacher" | "enrollment" | "group-member",
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const courseId = String(values.courseId ?? selectedCourse);
    const groupId = String(values.groupId ?? selectedGroup);
    const teacherId = String(values.teacherId ?? "");
    const studentId = String(values.studentId ?? "");
    const url =
      kind === "teacher"
        ? `/api/v1/courses/${courseId}/teachers`
        : kind === "enrollment"
          ? `/api/v1/courses/${courseId}/enrollments`
          : `/api/v1/admin/groups/${groupId}/members`;
    const body =
      kind === "teacher"
        ? { teacherId }
        : kind === "group-member"
          ? { studentId, isGroupLeader: values.isGroupLeader === "on" }
          : { studentId };
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? t.errors.relation);
      form.reset();
      setMessage(
        kind === "teacher"
          ? t.success.teacherAssigned
          : kind === "enrollment"
            ? t.success.studentEnrolled
            : t.success.groupUpdated,
      );
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.errors.relation);
    } finally {
      setBusy(false);
    }
  }

  async function enrollGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const groupId = String(new FormData(event.currentTarget).get("groupId") ?? "");
    if (!selectedCourse) {
      setError(t.errors.chooseCourse);
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await apiFetch(`/api/v1/courses/${selectedCourse}/enrollments/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? t.errors.enrollGroup);
      setMessage(t.success.enrollGroup(result.result.enrolled, result.result.alreadyEnrolled));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.errors.enrollGroup);
    } finally {
      setBusy(false);
    }
  }

  async function importMembers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const groupId = String(values.get("groupId") ?? "");
    const file = values.get("file");
    if (!(file instanceof File) || !groupId) {
      setError(t.errors.chooseFile);
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    setImportReport(null);
    try {
      const response = await apiFetch(`/api/v1/admin/groups/${groupId}/members/import`, {
        method: "POST",
        body: values,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? t.errors.import);
      setImportReport(result.result);
      setMessage(
        t.success.imported(result.result.added, result.result.skipped, result.result.errors.length),
      );
      form.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.errors.import);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-page-wrap academic-page">
      <header className="app-page-header">
        <div>
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p>{t.description}</p>
        </div>
      </header>

      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="academic-success" role="status">
          {message}
        </p>
      ) : null}

      <nav className="academic-tabs" aria-label={t.navLabel}>
        {sections.map(([key, label]) => (
          <button
            className={section === key ? "academic-tab academic-tab-active" : "academic-tab"}
            key={key}
            onClick={() => setSection(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {section === "academic-years" ? (
        <>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{t.panels.calendar}</p>
                <h2>{t.headings.newYear}</h2>
              </div>
            </div>
            <form
              className="admin-create-grid"
              onSubmit={(event) => create(event, "academic-years")}
            >
              <label>
                {t.labels.name}
                <input name="name" placeholder="2026–2027" required />
              </label>
              <label>
                {t.labels.start}
                <input name="startsOn" type="date" required />
              </label>
              <label>
                {t.labels.end}
                <input name="endsOn" type="date" required />
              </label>
              <div className="admin-create-actions">
                <p>{t.help.activateYear}</p>
                <button className="button button-primary" disabled={busy}>
                  {t.actions.createYear}
                </button>
              </div>
            </form>
          </section>
          <RecordList
            title={t.tabs.years}
            items={data.years.map((item) => ({
              id: item.id,
              title: item.name,
              meta: `${item.startsOn} — ${item.endsOn}${item.isActive ? ` · ${t.records.active}` : ""}`,
            }))}
            resource="academic-years"
            busy={busy}
            mutate={mutate}
            t={t}
          />
        </>
      ) : null}

      {section === "terms" ? (
        <>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{t.panels.academicCalendar}</p>
                <h2>{t.headings.newTerm}</h2>
              </div>
            </div>
            <form className="admin-create-grid" onSubmit={(event) => create(event, "terms")}>
              <label>
                {t.labels.year}
                <select name="academicYearId" required defaultValue="">
                  <option value="" disabled>
                    {t.choose.year}
                  </option>
                  {data.years.map((year) => (
                    <option value={year.id} key={year.id}>
                      {year.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.labels.name}
                <input
                  name="name"
                  placeholder={`1 ${t.labels.term.toLocaleLowerCase()}`}
                  required
                />
              </label>
              <label>
                {t.labels.start}
                <input name="startsOn" type="date" required />
              </label>
              <label>
                {t.labels.end}
                <input name="endsOn" type="date" required />
              </label>
              <div className="admin-create-actions">
                <p>{t.help.termDates}</p>
                <button className="button button-primary" disabled={busy}>
                  {t.actions.createTerm}
                </button>
              </div>
            </form>
          </section>
          <RecordList
            title={t.tabs.terms}
            items={data.terms.map((item) => ({
              id: item.id,
              title: item.name,
              meta: `${data.years.find((year) => year.id === item.academicYearId)?.name ?? t.labels.year} · ${item.startsOn} — ${item.endsOn}${item.isActive ? ` · ${t.records.active}` : ""}`,
            }))}
            resource="terms"
            busy={busy}
            mutate={mutate}
            t={t}
          />
        </>
      ) : null}

      {section === "specialties" ? (
        <>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{t.panels.programs}</p>
                <h2>{t.headings.newSpecialty}</h2>
              </div>
            </div>
            <form className="admin-create-grid" onSubmit={(event) => create(event, "specialties")}>
              <label>
                {t.labels.code}
                <input name="code" placeholder="IT-01" required />
              </label>
              <label>
                {t.labels.nameRu}
                <input name="nameRu" required />
              </label>
              <label>
                {t.labels.nameKk}
                <input name="nameKk" />
              </label>
              <label>
                {t.labels.qualification}
                <input name="qualification" />
              </label>
              <div className="admin-create-actions">
                <p>{t.help.specialtyCode}</p>
                <button className="button button-primary" disabled={busy}>
                  {t.actions.createSpecialty}
                </button>
              </div>
            </form>
          </section>
          <RecordList
            title={t.tabs.specialties}
            items={data.specialties.map((item) => ({
              id: item.id,
              title: item.nameRu,
              meta: `${item.code}${item.isActive ? ` · ${t.records.activeF}` : ` · ${t.records.archivedF}`}`,
            }))}
            resource="specialties"
            busy={busy}
            mutate={mutate}
            t={t}
          />
        </>
      ) : null}

      {section === "groups" ? (
        <>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{t.panels.college}</p>
                <h2>{t.headings.newGroup}</h2>
              </div>
            </div>
            <form className="admin-create-grid" onSubmit={(event) => create(event, "groups")}>
              <label>
                {t.labels.year}
                <select name="academicYearId" required defaultValue="">
                  <option value="" disabled>
                    {t.choose.year}
                  </option>
                  {data.years.map((year) => (
                    <option value={year.id} key={year.id}>
                      {year.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.labels.specialty}
                <select name="specialtyId" required defaultValue="">
                  <option value="" disabled>
                    {t.choose.specialty}
                  </option>
                  {data.specialties
                    .filter((item) => item.isActive)
                    .map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.code} · {item.nameRu}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t.labels.group}
                <input name="name" placeholder="ИС-26-1А" required />
              </label>
              <label>
                {t.labels.courseYear}
                <input name="courseYear" type="number" min="1" max="6" defaultValue="1" required />
              </label>
              <label>
                {t.labels.curator}
                <select name="curatorId" defaultValue="">
                  <option value="">{t.help.unassigned}</option>
                  {data.teachers.map((teacher) => (
                    <option value={teacher.id} key={teacher.id}>
                      {teacher.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.labels.capacity}
                <input name="capacity" type="number" min="1" placeholder={t.help.noLimit} />
              </label>
              <div className="admin-create-actions">
                <p>{t.help.groupHistory}</p>
                <button className="button button-primary" disabled={busy}>
                  {t.actions.createGroup}
                </button>
              </div>
            </form>
          </section>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{t.panels.groupMembers}</p>
                <h2>{t.headings.assignCurator}</h2>
              </div>
            </div>
            <p className="academic-role-help">{t.help.curatorAssignment}</p>
            <form className="admin-create-grid academic-role-form" onSubmit={assignCurator}>
              <label>
                {t.labels.group}
                <select
                  name="groupId"
                  required
                  value={curatorGroupId}
                  onChange={(event) => {
                    const groupId = event.target.value;
                    const group = data.groups.find((item) => item.id === groupId);
                    setCuratorGroupId(groupId);
                    setCuratorIdDraft(group?.curatorId ?? "");
                  }}
                >
                  <option value="" disabled>
                    {t.choose.group}
                  </option>
                  {data.groups
                    .filter((item) => item.isActive)
                    .map((group) => (
                      <option value={group.id} key={group.id}>
                        {group.name} · {t.labels.curator}:{" "}
                        {group.curator?.name ?? t.help.unassigned}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t.labels.curator}
                <select
                  name="curatorId"
                  value={curatorIdDraft}
                  onChange={(event) => setCuratorIdDraft(event.target.value)}
                >
                  <option value="">{t.help.unassigned}</option>
                  {data.teachers.map((teacher) => (
                    <option value={teacher.id} key={teacher.id}>
                      {teacher.name} · {teacher.email}
                    </option>
                  ))}
                </select>
                <small>{t.help.curatorRights}</small>
              </label>
              <div className="admin-create-actions">
                <p>{t.help.curatorAssignment}</p>
                <button className="button button-primary" disabled={busy}>
                  {t.actions.saveCurator}
                </button>
              </div>
            </form>
          </section>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{t.panels.groupMembers}</p>
                <h2>{t.headings.addOrMoveStudent}</h2>
              </div>
            </div>
            <form
              className="admin-create-grid"
              onSubmit={(event) => submitRelation(event, "group-member")}
            >
              <label>
                {t.labels.group}
                <select
                  name="groupId"
                  required
                  value={selectedGroup}
                  onChange={(event) => {
                    const groupId = event.target.value;
                    const group = data.groups.find((item) => item.id === groupId);
                    setSelectedGroup(groupId);
                    setIsGroupLeader(
                      Boolean(
                        group?.memberships.some(
                          (membership) => membership.studentId === selectedGroupStudent,
                        ),
                      ),
                    );
                  }}
                >
                  <option value="" disabled>
                    {t.choose.group}
                  </option>
                  {data.groups
                    .filter((item) => item.isActive)
                    .map((group) => (
                      <option value={group.id} key={group.id}>
                        {group.name} · {group.specialty.code} · {group.academicYear.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t.labels.student}
                <select
                  name="studentId"
                  required
                  value={selectedGroupStudent}
                  onChange={(event) => {
                    const studentId = event.target.value;
                    const group = data.groups.find((item) => item.id === selectedGroup);
                    setSelectedGroupStudent(studentId);
                    setIsGroupLeader(
                      Boolean(
                        group?.memberships.some((membership) => membership.studentId === studentId),
                      ),
                    );
                  }}
                >
                  <option value="" disabled>
                    {t.choose.student}
                  </option>
                  {data.students.map((student) => (
                    <option value={student.id} key={student.id}>
                      {student.name} · {student.username ?? student.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-checkbox-label">
                <input
                  checked={isGroupLeader}
                  name="isGroupLeader"
                  onChange={(event) => setIsGroupLeader(event.target.checked)}
                  type="checkbox"
                />
                {t.labels.groupLeader}
              </label>
              <div className="admin-create-actions">
                <p>{t.help.groupLeaderAssignment}</p>
                <button className="button button-primary" disabled={busy || !selectedGroup}>
                  {t.actions.saveMembers}
                </button>
              </div>
            </form>
          </section>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{t.panels.csvImport}</p>
                <h2>{t.headings.importGroup}</h2>
              </div>
            </div>
            <form className="admin-create-grid" onSubmit={importMembers}>
              <label>
                {t.labels.group}
                <select name="groupId" required defaultValue="">
                  <option value="" disabled>
                    {t.choose.group}
                  </option>
                  {data.groups
                    .filter((item) => item.isActive)
                    .map((group) => (
                      <option value={group.id} key={group.id}>
                        {group.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t.labels.csv}
                <input name="file" type="file" accept=".csv,text/csv" required />
              </label>
              <div className="admin-create-actions">
                <p>{t.help.csvLimit}</p>
                <button className="button button-primary" disabled={busy}>
                  {t.actions.import}
                </button>
              </div>
            </form>
            {importReport?.errors.length ? (
              <div className="academic-import-errors" role="status">
                <strong>{t.importErrors.title}</strong>
                {importReport.errors.map((item, index) => (
                  <p key={`${item.row}-${index}`}>
                    {t.importErrors.row(item.row, item.email, item.message)}
                  </p>
                ))}
              </div>
            ) : null}
          </section>
          <RecordList
            title={t.tabs.groups}
            items={data.groups.map((item) => ({
              id: item.id,
              title: item.name,
              meta: `${item.specialty.code} · ${item.academicYear.name} · ${item._count.memberships} ${t.records.students} · ${t.labels.curator}: ${item.curator?.name ?? t.help.unassigned}${item.isActive ? "" : ` · ${t.records.archivedF}`}`,
            }))}
            resource="groups"
            busy={busy}
            mutate={mutate}
            t={t}
          />
        </>
      ) : null}

      {section === "subjects" ? (
        <>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{t.panels.curriculum}</p>
                <h2>{t.headings.newSubject}</h2>
              </div>
            </div>
            <form className="admin-create-grid" onSubmit={(event) => create(event, "subjects")}>
              <label>
                {t.labels.code}
                <input name="code" placeholder="MAT-01" required />
              </label>
              <label>
                {t.labels.name}
                <input name="nameRu" required />
              </label>
              <label>
                {t.labels.credits}
                <input name="credits" type="number" min="0" step="0.25" />
              </label>
              <label>
                {t.labels.hours}
                <input name="totalHours" type="number" min="0" />
              </label>
              <label className="academic-full-width">
                {t.labels.description}
                <textarea name="description" rows={3} />
              </label>
              <div className="admin-create-actions">
                <p>{t.help.uniqueSubject}</p>
                <button className="button button-primary" disabled={busy}>
                  {t.actions.createSubject}
                </button>
              </div>
            </form>
          </section>
          <RecordList
            title={t.tabs.subjects}
            items={data.subjects.map((item) => ({
              id: item.id,
              title: item.nameRu,
              meta: `${item.code}${item.totalHours !== null ? ` · ${item.totalHours} ${t.labels.hoursShort}` : ""}${item.isActive ? "" : ` · ${t.records.archived}`}`,
            }))}
            resource="subjects"
            busy={busy}
            mutate={mutate}
            t={t}
          />
        </>
      ) : null}

      {section === "courses" ? (
        <>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{t.panels.catalog}</p>
                <h2>{t.headings.newCourse}</h2>
              </div>
            </div>
            <form className="admin-create-grid" onSubmit={(event) => create(event, "courses")}>
              <label>
                {t.labels.title}
                <input name="title" required />
              </label>
              <label>
                {t.labels.slug}
                <input
                  name="slug"
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  placeholder="osnovy-programmirovaniya"
                  required
                />
              </label>
              <label>
                {t.labels.name}
                <select name="subjectId" required defaultValue="">
                  <option value="" disabled>
                    {t.choose.subject}
                  </option>
                  {data.subjects
                    .filter((item) => item.isActive)
                    .map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.code} · {item.nameRu}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t.labels.year}
                <select name="academicYearId" required defaultValue="">
                  <option value="" disabled>
                    {t.choose.year}
                  </option>
                  {data.years.map((year) => (
                    <option value={year.id} key={year.id}>
                      {year.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.labels.term}
                <select name="termId" required defaultValue="">
                  <option value="" disabled>
                    {t.choose.term}
                  </option>
                  {data.terms.map((term) => (
                    <option value={term.id} key={term.id}>
                      {term.name} ·{" "}
                      {data.years.find((year) => year.id === term.academicYearId)?.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.labels.specialty}
                <select name="specialtyId" required defaultValue="">
                  <option value="" disabled>
                    {t.choose.specialty}
                  </option>
                  {data.specialties
                    .filter((item) => item.isActive)
                    .map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.code} · {item.nameRu}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t.labels.category}
                <select name="category" defaultValue="SPECIALTY">
                  {Object.entries(t.help.categories).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="academic-full-width">
                {t.labels.summary}
                <textarea name="summary" rows={2} />
              </label>
              <div className="admin-create-actions">
                <p>{t.help.draftCourse}</p>
                <button className="button button-primary" disabled={busy}>
                  {t.actions.createCourse}
                </button>
              </div>
            </form>
          </section>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{t.panels.team}</p>
                <h2>{t.headings.assignments}</h2>
              </div>
            </div>
            <div className="admin-create-grid">
              <label>
                {t.labels.selectedCourse}
                <select
                  value={selectedCourse}
                  onChange={(event) => setSelectedCourse(event.target.value)}
                >
                  <option value="">{t.choose.course}</option>
                  {data.courses
                    .filter((item) => item.status !== "ARCHIVED")
                    .map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title} · {courseStatusLabel(course.status)}
                      </option>
                    ))}
                </select>
              </label>
              <form
                className="academic-inline-form"
                onSubmit={(event) => submitRelation(event, "teacher")}
              >
                <input type="hidden" name="courseId" value={selectedCourse} />
                <label>
                  {t.labels.teacher}
                  <select name="teacherId" required defaultValue="">
                    <option value="" disabled>
                      {t.choose.teacher}
                    </option>
                    {data.teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="button button-muted" disabled={busy || !selectedCourse}>
                  {t.actions.assignTeacher}
                </button>
              </form>
              <div className="academic-action-buttons">
                <button
                  className="button button-muted"
                  disabled={busy || !selectedCourse}
                  onClick={() =>
                    void mutate(`/api/v1/admin/courses/${selectedCourse}`, "PATCH", {
                      status: "PUBLISHED",
                    })
                  }
                >
                  {t.actions.publishCourse}
                </button>
                <button
                  className="button button-danger"
                  disabled={busy || !selectedCourse}
                  onClick={() => void mutate(`/api/v1/admin/courses/${selectedCourse}`, "DELETE")}
                >
                  {t.actions.archiveCourse}
                </button>
              </div>
              <form
                className="admin-create-grid academic-inline-form academic-enrollment-form"
                onSubmit={enrollGroup}
              >
                <label>
                  {t.labels.group}
                  <select name="groupId" required defaultValue="">
                    <option value="" disabled>
                      {t.choose.group}
                    </option>
                    {data.groups
                      .filter((item) => item.isActive)
                      .map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name} · {group.specialty.code} · {group.academicYear.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="admin-create-actions">
                  <p>{t.help.activeStudents}</p>
                  <button className="button button-primary" disabled={busy || !selectedCourse}>
                    {t.actions.enrollGroup}
                  </button>
                </div>
              </form>
              <form
                className="admin-create-grid academic-inline-form academic-enrollment-form"
                onSubmit={(event) => submitRelation(event, "enrollment")}
              >
                <input type="hidden" name="courseId" value={selectedCourse} />
                <label>
                  {t.labels.student}
                  <select name="studentId" required defaultValue="">
                    <option value="" disabled>
                      {t.choose.student}
                    </option>
                    {data.students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.name} · {student.username ?? student.email}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="admin-create-actions">
                  <p>{t.help.individualEnrollment}</p>
                  <button className="button button-primary" disabled={busy || !selectedCourse}>
                    {t.actions.enrollStudent}
                  </button>
                </div>
              </form>
            </div>
          </section>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <p className="eyebrow">{t.panels.courses}</p>
                <h2>{t.headings.courseCatalog}</h2>
              </div>
            </div>
            {data.courses.length ? (
              <div className="academic-record-list">
                {data.courses.map((course) => (
                  <article className="academic-record-row" key={course.id}>
                    <div>
                      <strong>{course.title}</strong>
                      <span>
                        {course.subject.nameRu} · {course.specialty.code} ·{" "}
                        {course.academicYear.name} · {course.term.name}
                      </span>
                      <small>
                        {course._count.enrollments} {t.records.enrollmentRows}
                      </small>
                    </div>
                    <span className={`course-status course-status-${course.status.toLowerCase()}`}>
                      {courseStatusLabel(course.status)}
                    </span>
                    <Link className="admin-inline-link" href={`/courses/${course.slug}`}>
                      {t.actions.open}
                    </Link>
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => void copyCourse(course.id)}
                      type="button"
                    >
                      {t.actions.copyCourse}
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="admin-empty-state">{t.records.firstCourse}</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function RecordList({
  title,
  items,
  resource,
  busy,
  mutate,
  t,
}: {
  title: string;
  items: Array<{ id: string; title: string; meta: string }>;
  resource: Section;
  busy: boolean;
  mutate: (path: string, method: "PATCH" | "DELETE", body?: unknown) => Promise<void>;
  t: AcademicCopy;
}) {
  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div>
          <p className="eyebrow">{t.panels.list}</p>
          <h2>{title}</h2>
        </div>
      </div>
      {items.length ? (
        <div className="academic-record-list">
          {items.map((item) => (
            <article className="academic-record-row" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.meta}</span>
              </div>
              <button
                className="button button-danger"
                disabled={busy}
                onClick={() => void mutate(`/api/v1/admin/${resource}/${item.id}`, "DELETE")}
              >
                {t.actions.archive}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="admin-empty-state">{t.records.noRecords}</p>
      )}
    </section>
  );
}
