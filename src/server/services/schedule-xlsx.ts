import { inflateRawSync } from "node:zlib";
import { posix as path } from "node:path";
import { ApiError } from "@/lib/http/api-error";

const MAX_UPLOAD = 15 * 1024 * 1024;
const MAX_XML = 40 * 1024 * 1024;
const encoder = new TextDecoder("utf-8", { fatal: true });

export type ImportedLesson = {
  groupName: string;
  groupId: string | null;
  date: string;
  week: number;
  pair: number;
  startTime: string;
  endTime: string;
  subject: string;
  teacher: string | null;
  room: string | null;
  sourceText: string;
};

export type ScheduleWorkbookResult = {
  entries: ImportedLesson[];
  summary: {
    rows: number;
    weeks: number[];
    mappedGroups: number;
    unmappedGroups: string[];
    skippedAdditionalCells: number;
  };
};

function fail(message: string): never {
  throw new ApiError(422, "INVALID_SCHEDULE_FILE", message);
}

function readZipEntries(bytes: Buffer) {
  if (bytes.length > MAX_UPLOAD) fail("Файл расписания больше 15 МБ.");
  let eocd = -1;
  for (let offset = Math.max(0, bytes.length - 65557); offset <= bytes.length - 22; offset += 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) eocd = offset;
  }
  if (eocd < 0) fail("Файл не похож на книгу Excel XLSX.");
  const count = bytes.readUInt16LE(eocd + 10);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (count > 1000 || centralOffset >= bytes.length) fail("В XLSX найдено слишком много частей.");
  const entries = new Map<string, Buffer>();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) fail("Повреждён каталог XLSX.");
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = encoder
      .decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
      .replaceAll("\\", "/");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.startsWith("/") || name.split("/").includes(".."))
      fail("В XLSX найден недопустимый путь.");
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    if (
      compressedSize > MAX_UPLOAD ||
      localOffset + 30 > bytes.length ||
      bytes.readUInt32LE(localOffset) !== 0x04034b50
    )
      fail("Повреждённая часть XLSX.");
    const localName = bytes.readUInt16LE(localOffset + 26);
    const localExtra = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    if (start + compressedSize > bytes.length) fail("Часть XLSX обрезана.");
    const compressed = bytes.subarray(start, start + compressedSize);
    let expanded: Buffer;
    try {
      expanded =
        method === 0
          ? Buffer.from(compressed)
          : method === 8
            ? inflateRawSync(compressed, { maxOutputLength: MAX_XML })
            : fail("Этот формат сжатия XLSX не поддерживается.");
    } catch {
      fail("Не удалось распаковать XLSX.");
    }
    if (expanded.length > MAX_XML) fail("Внутренняя часть XLSX превышает допустимый размер.");
    entries.set(name, expanded);
  }
  return entries;
}

function xmlText(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match?.[1];
}

function sharedStrings(xml: string | undefined) {
  if (!xml) return [];
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("Недопустимый XML в книге XLSX.");
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((item) =>
    [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => xmlText(part[1])).join(""),
  );
}

function parseSheet(xml: string, strings: string[]) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("Недопустимый XML в книге XLSX.");
  const cells = new Map<string, string>();
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const reference = attr(match[1], "r");
    if (!reference) continue;
    const body = match[2] ?? "";
    const type = attr(match[1], "t");
    let value = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
    if (type === "s") value = strings[Number(value)] ?? "";
    else if (type === "inlineStr")
      value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((part) => xmlText(part[1]))
        .join("");
    else value = xmlText(value);
    cells.set(reference, value.trim());
  }
  return cells;
}

function cell(cells: Map<string, string>, column: number, row: number) {
  let col = column;
  let letters = "";
  while (col > 0) {
    const remainder = (col - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    col = Math.floor((col - 1) / 26);
  }
  return cells.get(`${letters}${row}`) ?? "";
}

function normalName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

export function cleanScheduleGroupName(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+з\/о\s*$/i, "");
}

export function cleanScheduleSubjectName(value: string) {
  return value
    .replace(/\s*[-–—]\s*УП\s+на\s+предприятии\s*$/i, "")
    .replace(
      /(^|[^\p{L}\p{N}])(?:ВД|ТИС|МАР|РПО|ТИБ|МЕН)[\s/-]*\d{2}(?:\s*[-–—/]\s*(?:9|11)\s*кл(?:асс)?)?/giu,
      "$1",
    )
    .replace(/(^|[^\p{L}\p{N}])(?:9|11)\s*кл(?:асс)?/giu, "$1")
    .replace(/[\s–—-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function excelDate(header: string, year: number) {
  const match = header.match(/(?:^|\s)(\d{1,2})\.(\d{1,2})(?:\s|$)/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseScheduleWorkbook(
  bytes: Buffer,
  fileName: string,
  availableGroups: Array<{ id: string; name: string }>,
): ScheduleWorkbookResult {
  const zip = readZipEntries(bytes);
  const getXml = (name: string) => {
    const value = zip.get(name);
    if (!value) return undefined;
    try {
      return encoder.decode(value);
    } catch {
      return fail("Файл XLSX содержит XML не в UTF-8.");
    }
  };
  const workbook = getXml("xl/workbook.xml");
  const relationships = getXml("xl/_rels/workbook.xml.rels");
  if (!workbook || !relationships) fail("В XLSX отсутствует список листов.");
  if (/<!DOCTYPE|<!ENTITY/i.test(workbook + relationships)) fail("Недопустимый XML в книге XLSX.");
  const targets = new Map<string, string>();
  for (const rel of relationships.matchAll(/<Relationship\b([^>]*?)\/>/g)) {
    const id = attr(rel[1], "Id");
    const target = attr(rel[1], "Target");
    if (id && target && !/TargetMode="External"/.test(rel[1]))
      targets.set(
        id,
        path.normalize(target.startsWith("/") ? target.slice(1) : path.join("xl", target)),
      );
  }
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*?)\/>/g)].flatMap((sheet) => {
    const name = attr(sheet[1], "name");
    const id = attr(sheet[1], "r:id");
    const target = id ? targets.get(id) : undefined;
    const week = name?.match(/^Неделя\s+(\d+)$/i)?.[1];
    return name && target && week && Number(week) <= 5
      ? [{ name, target, week: Number(week) }]
      : [];
  });
  if (!sheets.length) fail("Не найдены листы «Неделя 1», «Неделя 2» и так далее.");
  const strings = sharedStrings(getXml("xl/sharedStrings.xml"));
  const year = Number(fileName.match(/20\d{2}/)?.[0] ?? new Date().getFullYear());
  const groupByName = new Map(availableGroups.map((group) => [normalName(group.name), group]));
  const entries: ImportedLesson[] = [];
  const encounteredGroups = new Map<string, string | null>();
  let skippedAdditionalCells = 0;
  const weeks: number[] = [];

  for (const sheet of sheets) {
    const xml = getXml(sheet.target);
    if (!xml) continue;
    const cells = parseSheet(xml, strings);
    let hasLessons = false;
    for (let day = 0; day < 5; day += 1) {
      const baseColumn = 2 + day * 9;
      const lessonDate = excelDate(cell(cells, baseColumn, 1), year);
      if (!lessonDate) continue;
      for (let row = 3; row <= 1002; row += 1) {
        const sourceGroupName = cell(cells, 1, row);
        if (!sourceGroupName) continue;
        const groupName = cleanScheduleGroupName(sourceGroupName);
        const mapped = groupByName.get(normalName(groupName));
        encounteredGroups.set(groupName, mapped?.id ?? null);
        for (let pair = 0; pair < 8; pair += 1) {
          const raw = cell(cells, baseColumn + pair, row);
          if (!raw) continue;
          const time = cell(cells, baseColumn + pair, 2).match(
            /(\d{2}:\d{2})\s*[–—-]\s*(\d{2}:\d{2})/,
          );
          if (!time) continue;
          const parts = raw
            .split(/\s*·\s*/)
            .map((part) => part.trim())
            .filter(Boolean);
          const subject = cleanScheduleSubjectName(parts[0] ?? raw);
          const room = parts.length > 2 ? (parts.at(-1) ?? null) : null;
          const teacher =
            parts.length > 2 ? parts.slice(1, -1).join(" · ") || null : (parts[1] ?? null);
          entries.push({
            groupName: groupName.trim(),
            groupId: mapped?.id ?? null,
            date: lessonDate,
            week: sheet.week,
            pair: pair + 1,
            startTime: time[1],
            endTime: time[2],
            subject,
            teacher,
            room,
            sourceText: raw,
          });
          hasLessons = true;
          if (entries.length > 10000)
            fail(
              "В расписании больше 10 000 занятий. Разделите файл и импортируйте части отдельно.",
            );
        }
        if (cell(cells, baseColumn + 8, row)) skippedAdditionalCells += 1;
      }
    }
    if (hasLessons) weeks.push(sheet.week);
  }
  if (!entries.length) fail("В листах недель не найдены занятия с распознаваемым временем пары.");
  const mappedGroups = [...encounteredGroups.values()].filter((groupId) => groupId !== null).length;
  return {
    entries,
    summary: {
      rows: entries.length,
      weeks: weeks.sort((a, b) => a - b),
      mappedGroups,
      unmappedGroups: [...encounteredGroups]
        .filter(([, id]) => !id)
        .map(([name]) => name)
        .sort((a, b) => a.localeCompare(b, "ru")),
      skippedAdditionalCells,
    },
  };
}
