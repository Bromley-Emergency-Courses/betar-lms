import { describe, expect, it } from "vitest";
import { formatAttendanceTimestamp } from "./student-attendance";

describe("attendance timestamp presentation", () => {
  it.each([
    ["2026-01-24T23:25:00Z", "24 Jan 2026, 23:25"],
    ["2026-10-24T22:25:00Z", "24 Oct 2026, 23:25"],
    ["2026-07-01T23:00:00Z", "2 Jul 2026, 00:00"],
    ["2026-09-01T09:04:00Z", "1 Sep 2026, 10:04"]
  ])("renders %s with fixed punctuation and London local time", (input, expected) => {
    expect(formatAttendanceTimestamp(input)).toBe(expected);
  });
});
