import { describe, expect, it } from "vitest";
import { getAppData } from "@/lib/seed";
import {
  canAddEnrolmentForTerm,
  completionBlockersForEnrolment,
  creditsAwardedForStudent,
  financeDiscrepancy,
  attendedDaysInTerm,
  hasAttendanceGap,
  isPresentationRequiredForEnrolment,
  normalizeExamResultScore,
  recommendedOngoingEnrolmentStatus,
  requiredAttendanceDays,
  requiredAttendanceDaysForTerm,
  studentAcademicRisk
} from "@/lib/rules";
import type { AppData, EnrolmentStatus } from "@/lib/types";

function addPriorCardiacAttempt(
  data: AppData,
  status: Extract<EnrolmentStatus, "deferred" | "did_not_complete" | "failed">
) {
  data.offerings.push({
    id: "offering-cardiac-jan",
    moduleId: "module-cardiac",
    termId: "term-2026-jan",
    pricePence: 90000,
    capacity: 18,
    attendanceDaysRequiredFirstPractical: 2,
    attendanceDaysRequiredSubsequentPractical: 2,
    presentationRequired: true
  });
  data.offerings.push({
    id: "offering-cardiac-sep-return",
    moduleId: "module-cardiac",
    termId: "term-2026-sep",
    pricePence: 90000,
    capacity: 18,
    attendanceDaysRequiredFirstPractical: 2,
    attendanceDaysRequiredSubsequentPractical: 2,
    presentationRequired: true
  });
  data.enrolments.push({
    id: `enrolment-cardiac-jan-${status}`,
    studentId: "student-3",
    offeringId: "offering-cardiac-jan",
    status,
    creditsAwarded: 0
  });
  data.enrolments.push({
    id: "enrolment-cardiac-sep-return",
    studentId: "student-3",
    offeringId: "offering-cardiac-sep-return",
    status: "in_progress",
    creditsAwarded: 0
  });
  data.sessions.push({
    id: "session-cardiac-jan",
    termId: "term-2026-jan",
    offeringId: "offering-cardiac-jan",
    sessionDate: "2026-01-12",
    startsAt: "09:00",
    endsAt: "17:00",
    location: "BETAR Skills Lab 1",
    expectedStudentIds: ["student-3"]
  });
  data.attendance.push({
    id: "attendance-cardiac-jan",
    sessionId: "session-cardiac-jan",
    studentId: "student-3",
    status: "attended"
  });
  data.presentationScores.push({
    id: "presentation-cardiac-jan",
    studentId: "student-3",
    offeringId: "offering-cardiac-jan",
    staffUserId: "user-teacher-1",
    occurredOn: "2026-01-12",
    presentationType: "case_presentation",
    durationMinutes: 20,
    scores: {},
    totalScore: 40
  });

  const returnEnrolment = data.enrolments.find((candidate) => candidate.id === "enrolment-cardiac-sep-return");
  const returnOffering = data.offerings.find((candidate) => candidate.id === "offering-cardiac-sep-return");
  expect(returnEnrolment).toBeDefined();
  expect(returnOffering).toBeDefined();

  return { returnEnrolment: returnEnrolment!, returnOffering: returnOffering! };
}

describe("LMS domain rules", () => {
  it("totals awarded credits for a student", () => {
    const data = getAppData();
    expect(creditsAwardedForStudent("student-1", data.enrolments)).toBe(10);
  });

  it("enforces the two-module-per-term operational cap", () => {
    const data = getAppData();
    expect(canAddEnrolmentForTerm("student-1", "term-2026-apr", data)).toBe(false);
    expect(canAddEnrolmentForTerm("student-3", "term-2026-apr", data)).toBe(true);
  });

  it("uses first practical attendance requirements only for first practical module", () => {
    const data = getAppData();
    const offering = data.offerings.find((candidate) => candidate.id === "offering-cardiac-apr");
    expect(offering).toBeDefined();
    expect(requiredAttendanceDays("student-1", offering!, data)).toBe(3);
  });

  it("aggregates practical attendance requirements across a term", () => {
    const data = getAppData();
    expect(requiredAttendanceDaysForTerm("student-2", "term-2026-apr", data)).toBe(5);
  });

  it("does not clear two practical modules after only two attended dates", () => {
    const data = structuredClone(getAppData());
    data.offerings.push({
      id: "offering-vascular-jan",
      moduleId: "module-vascular",
      termId: "term-2026-jan",
      pricePence: 90000,
      capacity: 16,
      attendanceDaysRequiredFirstPractical: 3,
      attendanceDaysRequiredSubsequentPractical: 2,
      presentationRequired: true
    });
    data.enrolments.push({
      id: "enrolment-prior-practical",
      studentId: "student-2",
      offeringId: "offering-vascular-jan",
      status: "completed",
      creditsAwarded: 10
    });
    data.attendance.push({
      id: "attendance-second-day",
      sessionId: "session-card-2",
      studentId: "student-2",
      status: "attended"
    });

    const cardiacOffering = data.offerings.find((candidate) => candidate.id === "offering-cardiac-apr");
    const lungOffering = data.offerings.find((candidate) => candidate.id === "offering-lung-apr");

    expect(attendedDaysInTerm("student-2", "term-2026-apr", data)).toBe(2);
    expect(requiredAttendanceDaysForTerm("student-2", "term-2026-apr", data)).toBe(4);
    expect(hasAttendanceGap("student-2", cardiacOffering!, data)).toBe(true);
    expect(hasAttendanceGap("student-2", lungOffering!, data)).toBe(true);
  });

  it("detects attendance gaps", () => {
    const data = getAppData();
    const offering = data.offerings.find((candidate) => candidate.id === "offering-cardiac-apr");
    expect(offering).toBeDefined();
    expect(hasAttendanceGap("student-1", offering!, data)).toBe(true);
  });

  it("does not add attendance or presentation blockers for a resit unless configured", () => {
    const data = structuredClone(getAppData());
    const enrolment = data.enrolments.find((candidate) => candidate.id === "enrolment-2");
    const offering = data.offerings.find((candidate) => candidate.id === "offering-cardiac-apr");
    expect(enrolment).toBeDefined();
    expect(offering).toBeDefined();

    enrolment!.status = "resit";

    expect(requiredAttendanceDays("student-1", offering!, data)).toBe(0);
    expect(hasAttendanceGap("student-1", offering!, data)).toBe(false);
    expect(isPresentationRequiredForEnrolment(enrolment!, offering!, data)).toBe(false);

    enrolment!.attendanceDaysRequiredOverride = 2;
    enrolment!.presentationRequiredOverride = true;

    expect(requiredAttendanceDays("student-1", offering!, data)).toBe(2);
    expect(isPresentationRequiredForEnrolment(enrolment!, offering!, data)).toBe(true);
  });

  it("excludes did-not-complete enrolments from attendance and presentation blockers", () => {
    const data = structuredClone(getAppData());
    const enrolment = data.enrolments.find((candidate) => candidate.id === "enrolment-2");
    const offering = data.offerings.find((candidate) => candidate.id === "offering-cardiac-apr");
    expect(enrolment).toBeDefined();
    expect(offering).toBeDefined();

    enrolment!.status = "did_not_complete";
    enrolment!.attendanceDaysRequiredOverride = 1;
    enrolment!.presentationRequiredOverride = true;

    expect(requiredAttendanceDays("student-1", offering!, data)).toBe(0);
    expect(hasAttendanceGap("student-1", offering!, data)).toBe(false);
    expect(isPresentationRequiredForEnrolment(enrolment!, offering!, data)).toBe(false);
  });

  it("excludes terminal enrolments from attendance and completion blockers", () => {
    for (const status of ["deferred", "did_not_complete", "failed"] as const) {
      const data = structuredClone(getAppData());
      const enrolment = data.enrolments.find((candidate) => candidate.id === "enrolment-2");
      const offering = data.offerings.find((candidate) => candidate.id === "offering-cardiac-apr");
      expect(enrolment).toBeDefined();
      expect(offering).toBeDefined();

      enrolment!.status = status;
      enrolment!.attendanceDaysRequiredOverride = 1;
      enrolment!.presentationRequiredOverride = true;

      expect(requiredAttendanceDays("student-1", offering!, data)).toBe(0);
      expect(hasAttendanceGap("student-1", offering!, data)).toBe(false);
      expect(isPresentationRequiredForEnrolment(enrolment!, offering!, data)).toBe(false);
      expect(completionBlockersForEnrolment(enrolment!, data)).toEqual([]);
    }
  });

  it("adds a completion blocker for a latest failed exam result", () => {
    const data = structuredClone(getAppData());
    const enrolment = data.enrolments.find((candidate) => candidate.id === "enrolment-1");
    const examResult = data.examResults.find((candidate) => candidate.id === "exam-1");
    expect(enrolment).toBeDefined();
    expect(examResult).toBeDefined();

    examResult!.passed = false;
    examResult!.resitRequired = true;

    expect(completionBlockersForEnrolment(enrolment!, data)).toEqual(["Theory failed"]);
  });

  it("requires practical modules to have latest theory and practical passes", () => {
    const data = structuredClone(getAppData());
    const enrolment = data.enrolments.find((candidate) => candidate.id === "enrolment-2");
    expect(enrolment).toBeDefined();
    enrolment!.attendanceDaysRequiredOverride = 0;
    enrolment!.presentationRequiredOverride = false;
    data.examResults.push({
      id: "exam-card-theory-pass",
      studentId: "student-1",
      offeringId: "offering-cardiac-apr",
      componentType: "theory",
      sourceSystem: "theory_portal",
      sourceAttemptId: "theory-card-pass",
      score: 70,
      passMark: 50,
      passed: true,
      resitRequired: false,
      isResit: false,
      attemptNumber: 1,
      priorAttemptMissing: false,
      takenOn: "2026-06-29",
      importedAt: "2026-07-01T09:00:00.000Z"
    });

    expect(completionBlockersForEnrolment(enrolment!, data)).toEqual(["Attendance", "Practical result"]);
    expect(recommendedOngoingEnrolmentStatus(enrolment!, data)).toBeUndefined();
  });

  it("recommends failed when any latest component has failed", () => {
    const data = structuredClone(getAppData());
    const enrolment = data.enrolments.find((candidate) => candidate.id === "enrolment-3");
    expect(enrolment).toBeDefined();

    expect(recommendedOngoingEnrolmentStatus(enrolment!, data)).toBe("failed");
  });

  it("recommends completed for a theory-only enrolment with all requirements complete", () => {
    const data = structuredClone(getAppData());
    const enrolment = data.enrolments.find((candidate) => candidate.id === "enrolment-1");
    expect(enrolment).toBeDefined();
    enrolment!.status = "in_progress";
    enrolment!.creditsAwarded = 0;

    expect(recommendedOngoingEnrolmentStatus(enrolment!, data)).toBe("completed");
  });

  it("carries attendance and presentation evidence from prior inactive same-module attempts", () => {
    for (const status of ["deferred", "did_not_complete", "failed"] as const) {
      const data = structuredClone(getAppData());
      const { returnEnrolment, returnOffering } = addPriorCardiacAttempt(data, status);

      expect(requiredAttendanceDays("student-3", returnOffering, data)).toBe(2);
      expect(attendedDaysInTerm("student-3", "term-2026-sep", data)).toBe(1);
      expect(hasAttendanceGap("student-3", returnOffering, data)).toBe(true);
      expect(isPresentationRequiredForEnrolment(returnEnrolment, returnOffering, data)).toBe(false);
    }
  });

  it("excludes withdrawn students from attendance and completion calculations", () => {
    const data = structuredClone(getAppData());
    const student = data.students.find((candidate) => candidate.id === "student-3");
    expect(student).toBeDefined();
    student!.status = "withdrawn";

    const { returnEnrolment, returnOffering } = addPriorCardiacAttempt(data, "deferred");

    expect(requiredAttendanceDays("student-3", returnOffering, data)).toBe(0);
    expect(attendedDaysInTerm("student-3", "term-2026-sep", data)).toBe(0);
    expect(hasAttendanceGap("student-3", returnOffering, data)).toBe(false);
    expect(isPresentationRequiredForEnrolment(returnEnrolment, returnOffering, data)).toBe(false);
    expect(completionBlockersForEnrolment(returnEnrolment, data)).toEqual([]);
  });

  it("calculates finance balance due from paid amount", () => {
    const data = getAppData();
    const record = data.financeRecords.find((candidate) => candidate.id === "finance-2");
    expect(record).toBeDefined();
    expect(financeDiscrepancy(record!)).toBe(180000);
  });

  it("marks exam resits below the pass mark", () => {
    expect(normalizeExamResultScore(49)).toEqual({ passed: false, resitRequired: true });
    expect(normalizeExamResultScore(50)).toEqual({ passed: true, resitRequired: false });
  });

  it("escalates academic risk from encounter and result signals", () => {
    const data = getAppData();
    expect(studentAcademicRisk("student-1", data)).toBe("watch");
    expect(studentAcademicRisk("student-2", data)).toBe("watch");
  });
});
