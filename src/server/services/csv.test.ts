import { describe, expect, it } from "vitest";
import { csvEscape, CsvSyntaxError, parseCsvRecords } from "./csv";

describe("parseCsvRecords", () => {
  it("parses BOM, escaped quotes, commas, and newlines in quoted fields", () => {
    expect(
      parseCsvRecords(
        '\uFEFFusername,email,name\r\nstudent,student@example.test,"Last, First"\r\n',
      ),
    ).toEqual([
      ["username", "email", "name"],
      ["student", "student@example.test", "Last, First"],
    ]);
    expect(parseCsvRecords('value\n"first line\nsecond line"')).toEqual([
      ["value"],
      ["first line\nsecond line"],
    ]);
    expect(parseCsvRecords('"a""b",c')).toEqual([['a"b', "c"]]);
  });

  it("rejects unclosed or malformed quoted fields", () => {
    expect(() => parseCsvRecords('first,last\n"unclosed')).toThrow(CsvSyntaxError);
    expect(() => parseCsvRecords('first,last\nwrong"quote,value')).toThrow(CsvSyntaxError);
    expect(() => parseCsvRecords('first,last\n"closed"oops,value')).toThrow(CsvSyntaxError);
  });

  it("quotes CSV fields and neutralizes spreadsheet formulas", () => {
    expect(csvEscape('=HYPERLINK("example")')).toBe('"\'=HYPERLINK(""example"")"');
    expect(csvEscape("Normal, name")).toBe('"Normal, name"');
  });
});
