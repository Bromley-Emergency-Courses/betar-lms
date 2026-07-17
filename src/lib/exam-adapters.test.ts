import { describe, expect, it } from "vitest";
import { normalizeInboundExamResult } from "@/lib/exam-adapters";
import { getAppData } from "@/lib/seed";

describe("exam adapter normalization", () => {
  it("maps inbound exam results to LMS records", () => {
    const data = getAppData();
    const normalized = normalizeInboundExamResult(
      {
        sourceSystem: "theory_portal",
        sourceAttemptId: "theory-new-1",
        componentType: "theory",
        cccuStudentId: "CCCU240184",
        moduleCode: "POCUS-CORE",
        termName: "April-June 2026",
        score: 72,
        passMark: 50,
        takenOn: "2026-06-29"
      },
      data
    );

    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.result.studentId).toBe("student-1");
      expect(normalized.result.passed).toBe(true);
      expect(normalized.result.resitRequired).toBe(false);
    }
  });

  it("rejects unknown students with an explicit reason", () => {
    const data = getAppData();
    const normalized = normalizeInboundExamResult(
      {
        sourceSystem: "practical_osce",
        sourceAttemptId: "osce-new-1",
        componentType: "practical",
        cccuStudentId: "NOPE",
        moduleCode: "POCUS-CARD",
        termName: "April-June 2026",
        score: 42,
        passMark: 50,
        takenOn: "2026-06-30"
      },
      data
    );

    expect(normalized).toEqual({ ok: false, sourceAttemptId: "osce-new-1", reason: "student_not_found" });
  });
});
