import { describe, expect, it } from "vitest";
import {
  normalizeInboundExamResult,
  parsePracticalModuleCodeMap,
  practicalCsvRowsToInboundExamResults
} from "@/lib/exam-adapters";
import { getAppData } from "@/lib/seed";
import type { AppData } from "@/lib/types";

function copyData(): AppData {
  return structuredClone(getAppData());
}

function addJanuaryCardiacResitEnrolment(data: AppData) {
  data.offerings.push({
    id: "offering-cardiac-jan",
    moduleId: "module-cardiac",
    termId: "term-2026-jan",
    pricePence: 90000,
    capacity: 18,
    attendanceDaysRequiredFirstPractical: 3,
    attendanceDaysRequiredSubsequentPractical: 2,
    presentationRequired: true
  });
  data.enrolments.push({
    id: "enrolment-cardiac-jan-student-3",
    studentId: "student-3",
    offeringId: "offering-cardiac-jan",
    status: "resit",
    creditsAwarded: 0
  });
}

describe("exam adapter normalization", () => {
  it("maps inbound exam results to LMS records", () => {
    const data = copyData();
    const normalized = normalizeInboundExamResult(
      {
        sourceSystem: "theory_portal",
        sourceAttemptId: "theory-new-1",
        componentType: "theory",
        cccuStudentId: "CCCU240184",
        moduleCode: "POCUS-CORE",
        termName: "April 2026",
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
      expect(normalized.result.isResit).toBe(false);
      expect(normalized.result.attemptNumber).toBe(1);
      expect(normalized.result.priorAttemptMissing).toBe(false);
    }
  });

  it("attaches previous-term resits to the original module offering", () => {
    const data = copyData();
    addJanuaryCardiacResitEnrolment(data);
    const normalized = normalizeInboundExamResult(
      {
        sourceSystem: "theory_portal",
        sourceAttemptId: "theory-card-resit-1",
        componentType: "theory",
        temporaryId: "BETAR-TMP-1003",
        moduleCode: "POCUS-CARD",
        termName: "April 2026",
        score: 62,
        passMark: 50,
        takenOn: "2026-06-29"
      },
      data
    );

    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.result.offeringId).toBe("offering-cardiac-jan");
      expect(normalized.result.isResit).toBe(true);
      expect(normalized.result.attemptNumber).toBe(2);
      expect(normalized.result.priorAttemptMissing).toBe(true);
    }
  });

  it("links a resit to the latest prior failed attempt when one exists", () => {
    const data = copyData();
    addJanuaryCardiacResitEnrolment(data);
    data.examResults.push({
      id: "exam-card-fail-jan",
      studentId: "student-3",
      offeringId: "offering-cardiac-jan",
      componentType: "theory",
      sourceSystem: "theory_portal",
      sourceAttemptId: "theory-card-fail-jan",
      score: 42,
      passMark: 50,
      passed: false,
      resitRequired: true,
      isResit: false,
      attemptNumber: 1,
      priorAttemptMissing: false,
      takenOn: "2026-03-24",
      importedAt: "2026-03-25T09:00:00.000Z"
    });

    const normalized = normalizeInboundExamResult(
      {
        sourceSystem: "theory_portal",
        sourceAttemptId: "theory-card-resit-2",
        componentType: "theory",
        temporaryId: "BETAR-TMP-1003",
        moduleCode: "POCUS-CARD",
        termName: "April 2026",
        score: 64,
        passMark: 50,
        takenOn: "2026-06-29"
      },
      data
    );

    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.result.isResit).toBe(true);
      expect(normalized.result.attemptNumber).toBe(2);
      expect(normalized.result.resitOfResultId).toBe("exam-card-fail-jan");
      expect(normalized.result.priorAttemptMissing).toBe(false);
    }
  });

  it("rejects unknown students with an explicit reason", () => {
    const data = copyData();
    const normalized = normalizeInboundExamResult(
      {
        sourceSystem: "practical_osce",
        sourceAttemptId: "osce-new-1",
        componentType: "practical",
        cccuStudentId: "NOPE",
        moduleCode: "POCUS-CARD",
        termName: "April 2026",
        score: 42,
        passMark: 50,
        takenOn: "2026-06-30"
      },
      data
    );

    expect(normalized).toEqual({ ok: false, sourceAttemptId: "osce-new-1", reason: "student_not_found" });
  });

  it("converts desktop practical CSV rows into practical adapter results", () => {
    const moduleCodeMap = parsePracticalModuleCodeMap("VA=POCUS-VASC\nLU=POCUS-LUNG");
    const results = practicalCsvRowsToInboundExamResults(
      [
        {
          "Student ID": "100117592",
          "Full Name": "Anna Lasis",
          Module: "VA",
          "Total Score": "63",
          "Max Score": "80",
          Percentage: "78.8"
        },
        {
          "Student ID": "100192882",
          "Full Name": "Charles Greenbury",
          Module: "LU",
          "Total Score": "64",
          "Max Score": "82",
          Percentage: ""
        }
      ],
      {
        termName: "April-June 2026",
        takenOn: "2026-07-03",
        passMark: 50,
        moduleCodeMap
      }
    );

    expect(results).toEqual([
      {
        sourceSystem: "practical_osce",
        sourceAttemptId: "practical:APRIL-JUNE-2026:POCUS-VASC:100117592:2026-07-03",
        componentType: "practical",
        cccuStudentId: "100117592",
        moduleCode: "POCUS-VASC",
        termName: "April-June 2026",
        score: 78.8,
        passMark: 50,
        takenOn: "2026-07-03"
      },
      {
        sourceSystem: "practical_osce",
        sourceAttemptId: "practical:APRIL-JUNE-2026:POCUS-LUNG:100192882:2026-07-03",
        componentType: "practical",
        cccuStudentId: "100192882",
        moduleCode: "POCUS-LUNG",
        termName: "April-June 2026",
        score: 78.05,
        passMark: 50,
        takenOn: "2026-07-03"
      }
    ]);
  });
});
