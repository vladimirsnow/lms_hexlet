import { describe, expect, it } from "vitest";
import { isDeadlinePassed } from "./deadlines";

describe("assignment deadline boundary", () => {
  const deadline = new Date("2026-10-31T12:00:00.000Z");

  it("does not consider the exact due instant late", () => {
    expect(isDeadlinePassed(deadline, deadline)).toBe(false);
  });

  it("considers work late starting one millisecond after due time", () => {
    expect(isDeadlinePassed(deadline, new Date(deadline.getTime() + 1))).toBe(true);
  });

  it("does not mark a missing deadline as passed", () => {
    expect(isDeadlinePassed(null, deadline)).toBe(false);
  });
});
