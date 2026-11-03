import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createXlsx } from "./xlsx";

function unzipTextEntries(archive: Buffer) {
  const entries = new Map<string, string>();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compression = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const dataOffset = offset + 30 + nameLength + extraLength;
    const name = archive.toString("utf8", offset + 30, offset + 30 + nameLength);
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const content = compression === 8 ? inflateRawSync(compressed) : compressed;
    entries.set(name, content.toString("utf8"));
    offset = dataOffset + compressedSize;
  }
  return entries;
}

describe("createXlsx", () => {
  it("creates a readable minimal OOXML workbook with escaped literal cells", () => {
    const archive = createXlsx([
      ['=HYPERLINK("https://example.test")', "<&>", 87],
      ["line\nbreak\u0000", null, true],
    ]);
    const entries = unzipTextEntries(archive);
    const worksheet = entries.get("xl/worksheets/sheet1.xml");

    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    expect(entries.has("[Content_Types].xml")).toBe(true);
    expect(entries.has("xl/workbook.xml")).toBe(true);
    expect(worksheet).toContain('r="A1" t="inlineStr"');
    expect(worksheet).toContain("=HYPERLINK(&quot;https://example.test&quot;)");
    expect(worksheet).toContain("&lt;&amp;&gt;");
    expect(worksheet).toContain('<c r="C1"><v>87</v></c>');
    expect(worksheet).toContain("line\nbreak");
    expect(worksheet).toContain('<c r="C2" t="b"><v>1</v></c>');
    expect(worksheet).not.toContain("<f>");
    expect(worksheet).not.toContain("\u0000");
  });

  it("rejects sheets that exceed Excel's row limit", () => {
    expect(() => createXlsx(Array.from({ length: 1_048_577 }, () => []))).toThrow(RangeError);
  });
});
