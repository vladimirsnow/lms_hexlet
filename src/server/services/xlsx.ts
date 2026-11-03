import { deflateRawSync } from "node:zlib";

export type XlsxCell = string | number | boolean | null | undefined;

const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;

function xmlSafe(value: string) {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const valid =
      codePoint === 0x9 ||
      codePoint === 0xa ||
      codePoint === 0xd ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    if (!valid) continue;
    result += character
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }
  return result;
}

function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function worksheetXml(rows: readonly (readonly XlsxCell[])[]) {
  if (rows.length > MAX_ROWS) throw new RangeError("XLSX cannot contain more than 1,048,576 rows.");
  const populatedRows: string[] = [];
  rows.forEach((row, rowIndex) => {
    if (row.length > MAX_COLUMNS) {
      throw new RangeError("XLSX cannot contain more than 16,384 columns.");
    }
    const cells: string[] = [];
    row.forEach((value, columnIndex) => {
      if (value === null || value === undefined || value === "") return;
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === "number") {
        if (!Number.isFinite(value)) return;
        cells.push(`<c r="${reference}"><v>${value}</v></c>`);
      } else if (typeof value === "boolean") {
        cells.push(`<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`);
      } else {
        // Inline strings stay literal in spreadsheet applications, including values beginning with '='.
        if (value.length > 32_767) {
          throw new RangeError("XLSX cells cannot contain more than 32,767 characters.");
        }
        cells.push(
          `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlSafe(value)}</t></is></c>`,
        );
      }
    });
    populatedRows.push(`<row r="${rowIndex + 1}">${cells.join("")}</row>`);
  });

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${populatedRows.join("")}</sheetData></worksheet>`
  );
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: ReadonlyArray<{ name: string; content: string }>) {
  const localParts: Buffer[] = [];
  const directoryParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = Buffer.from(file.content, "utf8");
    const compressed = deflateRawSync(raw);
    const checksum = crc32(raw);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 file names.
    localHeader.writeUInt16LE(8, 8); // Deflate.
    localHeader.writeUInt16LE(0x0021, 14); // 1980-01-01, the earliest DOS ZIP date.
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, compressed);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt16LE(0x0021, 14);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    directoryParts.push(directory, name);
    offset += localHeader.length + name.length + compressed.length;
  }

  const directorySize = directoryParts.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...directoryParts, end]);
}

export function createXlsx(rows: readonly (readonly XlsxCell[])[]) {
  return zip([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        "</Relationships>",
    },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml(rows) },
  ]);
}
