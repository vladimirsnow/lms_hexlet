import { describe, expect, it } from "vitest";
import { cleanScheduleGroupName, cleanScheduleSubjectName } from "./schedule-xlsx";

describe("schedule workbook labels", () => {
  it("removes the evening-study suffix from a group name", () => {
    expect(cleanScheduleGroupName(" 10   ТИС/24 з/о ")).toBe("10 ТИС/24");
  });

  it("keeps the subject and removes group codes, school classes, and practice notes", () => {
    expect(cleanScheduleSubjectName("ПМ 7 ТИС-23-9кл-УП на предприятии")).toBe("ПМ 7");
    expect(cleanScheduleSubjectName("ПМ 1 ВД-26-11кл")).toBe("ПМ 1");
  });

  it("preserves subject labels that do not contain group metadata", () => {
    expect(cleanScheduleSubjectName("ООД 01")).toBe("ООД 01");
  });
});
