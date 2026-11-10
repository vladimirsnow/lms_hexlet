"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";

type Allocation = {
  groupId: string;
  courseId: string;
  teacherName: string;
  hours: number;
  rooms: string[];
};
type Config = {
  termId: string;
  rooms: string[];
  slots: { startTime: string; endTime: string; hours: number }[];
  vacations: { startsOn: string; endsOn: string }[];
  extraDaysOff: string[];
  allocations: Allocation[];
};
type Data = {
  terms: { id: string; name: string; startsOn: string; endsOn: string; academicYearId: string }[];
  groups: {
    id: string;
    name: string;
    academicYearId: string;
    specialtyId: string;
  }[];
  courses: {
    id: string;
    title: string;
    termId: string;
    specialtyId: string;
    specialtyName: string;
    teachers: { id: string; name: string }[];
  }[];
  teachers: { id: string; name: string }[];
  imported: null | {
    fileName: string;
    groups: { id: string; name: string }[];
    subjects: string[];
    rooms: string[];
    slots: { startTime: string; endTime: string; hours: number }[];
    teacherNames: string[];
    lessons: number;
    suggestedAllocations: Omit<Allocation, "rooms">[];
  };
  config: Config | null;
};
type Preview = {
  count: number;
  teachingDays: number;
  daysOff: string[];
  sample: {
    date: string;
    startTime: string;
    groupName: string;
    subject: string;
    teacher: string | null;
    room: string | null;
  }[];
};

function defaults(data: Data, termId: string): Config {
  const rooms = data.imported?.rooms.length ? data.imported.rooms : ["101"];
  const slots = data.imported?.slots.length
    ? data.imported.slots.slice(0, 8)
    : [
        { startTime: "09:00", endTime: "09:45", hours: 1 },
        { startTime: "09:55", endTime: "10:40", hours: 1 },
        { startTime: "10:50", endTime: "11:35", hours: 1 },
        { startTime: "11:45", endTime: "12:30", hours: 1 },
      ];
  return {
    termId,
    rooms,
    slots,
    vacations: [],
    extraDaysOff: [],
    allocations: (data.imported?.suggestedAllocations ?? []).map((item) => ({ ...item, rooms })),
  };
}

export function SchedulePlanner() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [termId, setTermId] = useState("");
  const [config, setConfig] = useState<Config | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [roomsDraft, setRoomsDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch(`/api/v1/schedule/planner${termId ? `?termId=${encodeURIComponent(termId)}` : ""}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? "Не удалось загрузить данные.");
        return result as Data;
      })
      .then((result) => {
        if (!active) return;
        if (!termId && result.terms[0]) {
          setTermId(result.terms[0].id);
          return;
        }
        setData(result);
        const nextConfig = result.config ?? defaults(result, termId);
        setConfig(nextConfig);
        setRoomsDraft(nextConfig.rooms.join("\n"));
        setPreview(null);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Не удалось загрузить данные.");
      });
    return () => {
      active = false;
    };
  }, [termId]);

  const term = data?.terms.find((item) => item.id === termId);
  const groups = useMemo(
    () => (data?.groups ?? []).filter((item) => item.academicYearId === term?.academicYearId),
    [data, term],
  );
  const courses = useMemo(
    () => (data?.courses ?? []).filter((item) => item.termId === termId),
    [data, termId],
  );
  const teacherNames = [
    ...new Set([
      ...(data?.imported?.teacherNames ?? []),
      ...(data?.teachers ?? []).map((item) => item.name),
    ]),
  ];
  const filterCourses = courses.filter(
    (course) =>
      !groupFilter ||
      course.specialtyId === groups.find((group) => group.id === groupFilter)?.specialtyId,
  );
  const filterTeachers = [
    ...new Set([
      ...(config?.allocations ?? []).map((item) => item.teacherName.trim()).filter(Boolean),
      ...(teacherFilter && teacherFilter !== "__unassigned__" ? [teacherFilter] : []),
    ]),
  ].sort((a, b) => a.localeCompare(b, "ru"));
  const visibleAllocations = (config?.allocations ?? [])
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        (!groupFilter || item.groupId === groupFilter) &&
        (!courseFilter || item.courseId === courseFilter) &&
        (!teacherFilter ||
          (teacherFilter === "__unassigned__"
            ? !item.teacherName.trim()
            : item.teacherName.trim() === teacherFilter)),
    );
  if (!data || !config)
    return (
      <section className="content-panel">
        <h2>Генератор расписания</h2>
        <p role={error ? "alert" : undefined}>{error || "Загрузка настроек…"}</p>
      </section>
    );

  function change(patch: Partial<Config>) {
    setConfig((current) => (current ? { ...current, ...patch } : current));
    setPreview(null);
    setMessage("");
  }
  function updateAllocation(index: number, patch: Partial<Allocation>) {
    change({
      allocations: config!.allocations.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    });
  }
  function addAllocation() {
    const selectedCourse = courses.find((course) => course.id === courseFilter);
    const groupId =
      groupFilter ||
      (selectedCourse
        ? groups.find((group) => group.specialtyId === selectedCourse.specialtyId)?.id
        : groups[0]?.id) ||
      "";
    change({
      allocations: [
        ...config!.allocations,
        {
          groupId,
          courseId: courseFilter,
          teacherName: teacherFilter === "__unassigned__" ? "" : teacherFilter,
          hours: 1,
          rooms: config!.rooms,
        },
      ],
    });
  }
  async function action(kind: "sync" | "preview" | "save" | "publish") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch("/api/v1/schedule/planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "sync" ? { action: kind, termId } : { action: kind, config }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Операция не выполнена.");
      if (kind === "preview") {
        setPreview(payload.result);
        setMessage(
          `Размещено ${payload.result.count} занятий за ${payload.result.teachingDays} учебных дней.`,
        );
      }
      if (kind === "save") setMessage("Настройки сохранены.");
      if (kind === "publish") {
        setMessage(
          `Опубликовано ${payload.result.count} занятий. Обновите страницу для просмотра.`,
        );
        router.refresh();
      }
      if (kind === "sync") {
        setMessage(
          `Добавлено предметов: ${payload.result.subjectsCreated}, курсов: ${payload.result.coursesCreated}, назначений: ${payload.result.assignmentsCreated}, записей студентов: ${payload.result.enrollmentsCreated}. Демо-курсов скрыто: ${payload.result.archivedDemo}.${payload.result.unmatchedTeachers.length ? ` Не найдены преподаватели: ${payload.result.unmatchedTeachers.join(", ")}.` : ""}`,
        );
        const refreshed = await apiFetch(
          `/api/v1/schedule/planner?termId=${encodeURIComponent(termId)}`,
        ).then((response) => response.json());
        setData(refreshed);
        const nextConfig = refreshed.config ?? defaults(refreshed, termId);
        setConfig(nextConfig);
        setRoomsDraft(nextConfig.rooms.join("\n"));
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Операция не выполнена.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content-panel schedule-planner" aria-label="Генератор расписания">
      <datalist id="schedule-planner-teachers">
        {teacherNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div className="section-heading">
        <div>
          <p className="eyebrow">АДМИНИСТРИРОВАНИЕ</p>
          <h2>Генератор расписания</h2>
        </div>
        <p>
          Все существующие курсы доступны в <Link href="/admin/academic">учебной структуре</Link>.
          Там администратор может добавить новый курс и назначить преподавателя.
        </p>
      </div>
      <p>
        Укажите академические часы для каждой группы и курса и число часов в каждом интервале.
        Генератор учитывает кабинеты, преподавателей, занятые ручными занятиями интервалы, каникулы
        и выходные Казахстана.
      </p>
      <label>
        Семестр
        <select
          value={termId}
          onChange={(event) => {
            setTermId(event.target.value);
            setGroupFilter("");
            setCourseFilter("");
            setTeacherFilter("");
            setError("");
            setMessage("");
          }}
        >
          {data.terms.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.startsOn} — {item.endsOn}
            </option>
          ))}
        </select>
      </label>
      {data.imported ? (
        <div className="schedule-planner-source">
          <p>
            Текущее расписание: <strong>{data.imported.fileName}</strong> · {data.imported.lessons}{" "}
            занятий. Группы: {data.imported.groups.map((item) => item.name).join(", ") || "нет"}.
          </p>
          <p>Предметы из расписания: {data.imported.subjects.join(", ") || "нет"}.</p>
          <button
            className="button button-muted"
            type="button"
            disabled={busy}
            onClick={() => action("sync")}
          >
            Перенести предметы и курсы из расписания
          </button>
        </div>
      ) : (
        <p>Загрузите существующее расписание XLSX выше, чтобы перенести его предметы и группы.</p>
      )}
      <div className="schedule-planner-grid">
        <label>
          Кабинеты (по одному в строке)
          <textarea
            rows={5}
            value={roomsDraft}
            onChange={(event) => setRoomsDraft(event.target.value)}
            onBlur={() => {
              const rooms = [
                ...new Set(
                  roomsDraft
                    .split(/\n|,/)
                    .map((room) => room.trim())
                    .filter(Boolean),
                ),
              ];
              change({
                rooms,
                allocations: config.allocations.map((item) => ({
                  ...item,
                  rooms:
                    item.rooms.length === config.rooms.length
                      ? rooms
                      : item.rooms.filter((room) => rooms.includes(room)),
                })),
              });
            }}
          />
        </label>
        <div>
          <strong>Время занятий</strong>
          {config.slots.map((slot, index) => (
            <div className="schedule-planner-row" key={index}>
              <input
                aria-label={`Начало занятия ${index + 1}`}
                type="time"
                value={slot.startTime}
                onChange={(event) =>
                  change({
                    slots: config.slots.map((item, i) =>
                      i === index ? { ...item, startTime: event.target.value } : item,
                    ),
                  })
                }
              />
              <input
                aria-label={`Конец занятия ${index + 1}`}
                type="time"
                value={slot.endTime}
                onChange={(event) =>
                  change({
                    slots: config.slots.map((item, i) =>
                      i === index ? { ...item, endTime: event.target.value } : item,
                    ),
                  })
                }
              />
              <select
                aria-label={`Академических часов в интервале ${index + 1}`}
                value={slot.hours}
                onChange={(event) =>
                  change({
                    slots: config.slots.map((item, i) =>
                      i === index ? { ...item, hours: Number(event.target.value) } : item,
                    ),
                  })
                }
              >
                <option value={1}>1 час</option>
                <option value={2}>2 часа</option>
              </select>
              <button
                type="button"
                className="button button-muted"
                aria-label={`Удалить интервал ${index + 1}`}
                onClick={() => change({ slots: config.slots.filter((_, i) => i !== index) })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button button-muted"
            disabled={config.slots.length >= 8}
            onClick={() =>
              change({
                slots: [...config.slots, { startTime: "13:00", endTime: "13:45", hours: 1 }],
              })
            }
          >
            Добавить интервал
          </button>
        </div>
      </div>
      <div className="schedule-planner-grid">
        <div>
          <strong>Каникулы</strong>
          {config.vacations.map((range, index) => (
            <div className="schedule-planner-row" key={index}>
              <input
                aria-label={`Начало каникул ${index + 1}`}
                type="date"
                value={range.startsOn}
                onChange={(event) =>
                  change({
                    vacations: config.vacations.map((item, i) =>
                      i === index ? { ...item, startsOn: event.target.value } : item,
                    ),
                  })
                }
              />
              <input
                aria-label={`Конец каникул ${index + 1}`}
                type="date"
                value={range.endsOn}
                onChange={(event) =>
                  change({
                    vacations: config.vacations.map((item, i) =>
                      i === index ? { ...item, endsOn: event.target.value } : item,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="button button-muted"
                onClick={() =>
                  change({ vacations: config.vacations.filter((_, i) => i !== index) })
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button button-muted"
            onClick={() =>
              change({
                vacations: [
                  ...config.vacations,
                  { startsOn: term?.startsOn ?? "", endsOn: term?.startsOn ?? "" },
                ],
              })
            }
          >
            Добавить каникулы
          </button>
        </div>
        <label>
          Дополнительные выходные (по одной дате в строке)
          <textarea
            rows={4}
            value={config.extraDaysOff.join("\n")}
            onChange={(event) =>
              change({ extraDaysOff: event.target.value.split(/\s|,/).filter(Boolean) })
            }
            placeholder="2027-05-17"
          />
          <small>
            Государственные праздники учитываются автоматически. Дата Курбан-айта 2027 года
            предварительная; уточните её перед публикацией.
          </small>
        </label>
      </div>
      <h3>Нагрузка по группам</h3>
      <p>
        В списке доступны все группы учебного года. Часы из импорта подставлены как начальные
        значения — проверьте и задайте план на весь семестр. Для занятий без преподавателя в
        исходном файле заполните его имя перед проверкой.
      </p>
      <div className="schedule-planner-filters" role="group" aria-label="Фильтры нагрузки">
        <label>
          Группа
          <select
            value={groupFilter}
            onChange={(event) => {
              const nextGroupId = event.target.value;
              setGroupFilter(nextGroupId);
              const specialtyId = groups.find((group) => group.id === nextGroupId)?.specialtyId;
              if (
                courseFilter &&
                specialtyId &&
                courses.find((course) => course.id === courseFilter)?.specialtyId !== specialtyId
              )
                setCourseFilter("");
            }}
          >
            <option value="">Все группы</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Курс
          <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
            <option value="">Все курсы</option>
            {filterCourses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title} · {course.specialtyName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Преподаватель
          <select value={teacherFilter} onChange={(event) => setTeacherFilter(event.target.value)}>
            <option value="">Все преподаватели</option>
            {filterTeachers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {config.allocations.some((item) => !item.teacherName.trim()) ||
            teacherFilter === "__unassigned__" ? (
              <option value="__unassigned__">Не указан</option>
            ) : null}
          </select>
        </label>
      </div>
      <div className="schedule-planner-filter-summary">
        <p className="schedule-planner-filter-count" role="status">
          Показано {visibleAllocations.length} из {config.allocations.length} строк нагрузки.
        </p>
        {groupFilter || courseFilter || teacherFilter ? (
          <button
            type="button"
            className="button button-muted"
            onClick={() => {
              setGroupFilter("");
              setCourseFilter("");
              setTeacherFilter("");
            }}
          >
            Сбросить фильтры
          </button>
        ) : null}
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Группа</th>
              <th>Курс</th>
              <th>Преподаватель</th>
              <th>Часов</th>
              <th>Кабинет</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleAllocations.map(({ item, index }) => {
              const group = groups.find((candidate) => candidate.id === item.groupId);
              const availableCourses = courses.filter(
                (candidate) => !group || candidate.specialtyId === group.specialtyId,
              );
              return (
                <tr key={index}>
                  <td>
                    <select
                      aria-label={`Группа ${index + 1}`}
                      value={item.groupId}
                      onChange={(event) => {
                        if (groupFilter && event.target.value !== groupFilter) setGroupFilter("");
                        if (courseFilter) setCourseFilter("");
                        if (teacherFilter) setTeacherFilter("");
                        updateAllocation(index, {
                          groupId: event.target.value,
                          courseId: "",
                          teacherName: "",
                        });
                      }}
                    >
                      <option value="">Выберите</option>
                      {groups.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`Курс ${index + 1}`}
                      value={item.courseId}
                      onChange={(event) => {
                        if (courseFilter && event.target.value !== courseFilter)
                          setCourseFilter("");
                        const course = courses.find(
                          (candidate) => candidate.id === event.target.value,
                        );
                        if (teacherFilter && course?.teachers[0]?.name !== teacherFilter)
                          setTeacherFilter("");
                        updateAllocation(index, {
                          courseId: event.target.value,
                          teacherName: course?.teachers[0]?.name ?? "",
                        });
                      }}
                    >
                      <option value="">Выберите</option>
                      {availableCourses.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.title}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Преподаватель ${index + 1}`}
                      list="schedule-planner-teachers"
                      value={item.teacherName}
                      onChange={(event) => {
                        if (teacherFilter && event.target.value.trim() !== teacherFilter)
                          setTeacherFilter("");
                        updateAllocation(index, { teacherName: event.target.value });
                      }}
                      placeholder="Фамилия И.О."
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Часов ${index + 1}`}
                      type="number"
                      min={1}
                      max={1000}
                      value={item.hours}
                      onChange={(event) =>
                        updateAllocation(index, { hours: Number(event.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Кабинет ${index + 1}`}
                      value={
                        item.rooms.length === config.rooms.length ? "*" : (item.rooms[0] ?? "*")
                      }
                      onChange={(event) =>
                        updateAllocation(index, {
                          rooms: event.target.value === "*" ? config.rooms : [event.target.value],
                        })
                      }
                    >
                      <option value="*">Любой свободный</option>
                      {config.rooms.map((room) => (
                        <option key={room} value={room}>
                          {room}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button button-muted"
                      aria-label={`Удалить нагрузку ${index + 1}`}
                      onClick={() =>
                        change({ allocations: config.allocations.filter((_, i) => i !== index) })
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
            {visibleAllocations.length === 0 ? (
              <tr>
                <td colSpan={6}>По выбранным фильтрам строк нет.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <button type="button" className="button button-muted" onClick={addAllocation}>
        Добавить курс группе
      </button>
      {error ? (
        <p className="schedule-form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      <div className="schedule-form-actions">
        <button
          type="button"
          className="button button-muted"
          disabled={busy}
          onClick={() => action("preview")}
        >
          Проверить расписание
        </button>
        <button
          type="button"
          className="button button-muted"
          disabled={busy}
          onClick={() => action("save")}
        >
          Сохранить настройки
        </button>
        <button
          type="button"
          className="button"
          disabled={busy || !preview}
          onClick={() => action("publish")}
        >
          Опубликовать расписание
        </button>
      </div>
      {preview ? (
        <details open>
          <summary>
            Предпросмотр: {preview.count} занятий, {preview.daysOff.length} праздничных и
            дополнительных выходных
          </summary>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Время</th>
                  <th>Группа</th>
                  <th>Курс</th>
                  <th>Преподаватель</th>
                  <th>Кабинет</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((item, index) => (
                  <tr key={index}>
                    <td>{item.date}</td>
                    <td>{item.startTime}</td>
                    <td>{item.groupName}</td>
                    <td>{item.subject}</td>
                    <td>{item.teacher}</td>
                    <td>{item.room}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
