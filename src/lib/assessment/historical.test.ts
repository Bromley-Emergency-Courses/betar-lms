import React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoricalAssessmentResults } from "@/components/historical-assessment-results";
import { OutcomeBadge } from "@/components/assessment-register";
import { assessmentExportCsv } from "./exports";
import { studentAcademicRisk } from "@/lib/rules";
import type { Enrolment } from "@/lib/types";
import { historicalComponent, retainHistoricalOutcomes } from "./historical";
import type { AssessmentAttempt, AssessmentEvaluation, AssessmentOutcome, HistoricalAssessmentResult } from "./types";

vi.mock("@/app/assessments/workspace-actions", () => ({ saveWorkspaceAssessment: vi.fn() }));
beforeAll(() => { vi.stubGlobal("React", React); });

const result: HistoricalAssessmentResult = {
  id: "historical-1", enrolment_id: "enrolment-1", student_id: "student-1", offering_id: "offering-1",
  student_identifier: "PSEUDO-1", student_name: "Test Learner", module_code: "TEST", module_title: "Test module",
  original_cohort: "Original teaching term", original_term_id: "term-1", component: "theory", score: 32, pass_mark: 50,
  passed: false, resit_required: true, attempt_number: 1, is_resit: false, prior_attempt_missing: false,
  resit_of_result_id: null, taken_on: "2025-01-01", source_system: "manual", source_attempt_id: "original-1",
  represented_by_attempt_id: null, reviewed_backfill: false
};
const outcome: AssessmentOutcome = {
  enrolment_id: "enrolment-1", student_id: "student-1", student_identifier: "PSEUDO-1", student_name: "Test Learner",
  module_code: "TEST", module_title: "Test module", original_cohort: "Original teaching term",
  legacy_status: "completed", legacy_credits: 10, legacy_final_mark: 73, legacy_grade: "Merit",
  assessment: { needs_plan: true, revision: 0 } as AssessmentEvaluation
};

describe("historical assessment continuity", () => {
  it("shows the current In progress state rather than the captured Planned label", () => {
    const assessment = {
      ...outcome.assessment, effective_status: "In progress", awarded_credits: 10,
      historical: { protected: true, status: "planned", current_term_in_progress: true, credits: 10, final_mark: null, grade: null, review_flags: [] }
    } as AssessmentEvaluation;
    const html = renderToStaticMarkup(React.createElement(OutcomeBadge, { assessment }));
    expect(html).toContain(">In progress</span>");
    expect(html).not.toContain("Recorded · planned");
  });
  it("retains ongoing status and awarded credits through history merging and exports", () => {
    const ongoing = { ...outcome, legacy_status: "planned", legacy_final_mark: null, legacy_grade: null,
      assessment: { ...outcome.assessment, effective_status: "In progress", awarded_credits: 10, effective_indicators: [],
        historical: { protected: true, status: "planned", current_term_in_progress: true, credits: 10, final_mark: null, grade: null, review_flags: [] }
      } as AssessmentEvaluation };
    const [retained] = retainHistoricalOutcomes([ongoing], []);
    expect(retained.assessment).toMatchObject({ effective_status: "In progress", awarded_credits: 10, historical: { status: "planned", credits: 10 } });
    const csv = assessmentExportCsv("outcomes", [retained], [], []);
    expect(csv).toContain(",In progress,");
    expect(csv).toContain("planned,10");
    const amended = { ...retained.assessment, effective_status: "Planned", overrides: [{ kind: "status", value: "Planned", indicator: "", reason: "Explicit review" }] } as AssessmentEvaluation;
    expect(renderToStaticMarkup(React.createElement(OutcomeBadge, { assessment: amended }))).toContain("Recorded · Planned (amended)");
  });
  it("does not label protected ongoing enrolments as historical teaching", () => {
    for (const status of ["planned", "in_progress"]) {
      const assessment = {
        ...outcome.assessment, effective_status: status === "planned" ? "Planned" : "In progress",
        historical: { protected: true, status, final_mark: null, grade: null, review_flags: [] }
      } as AssessmentEvaluation;
      const html = renderToStaticMarkup(React.createElement(OutcomeBadge, { assessment }));
      expect(html).toContain(`Recorded · ${status.replaceAll("_", " ")}`);
      expect(html).not.toContain("Historical ·");
    }
  });
  it("preserves recorded outcome, credits and legacy marks without recalculating a failed score", () => {
    const original = structuredClone(outcome);
    const [retained] = retainHistoricalOutcomes([outcome], [result]);
    expect(retained.assessment).toMatchObject({ awarded_credits: 10, effective_status: "Pass", calculated_status: "Historical", historical: { status: "completed", final_mark: 73, grade: "Merit" }, components: { theory: { score: 32, passed: false } } });
    expect(retained.assessment.historical?.review_flags).toContain("Recorded completion differs from available Theory evidence");
    expect(outcome).toEqual(original);
    expect(retained.assessment.plan).toBeUndefined();
  });

  it("keeps old statuses explicit rather than inventing deferral or abandonment decisions", () => {
    for (const status of ["resit", "deferred", "did_not_complete"]) {
      const [retained] = retainHistoricalOutcomes([{ ...outcome, legacy_status: status }], []);
      expect(retained.assessment.effective_status).toBe("Historical");
      expect(renderToStaticMarkup(React.createElement(OutcomeBadge, { assessment: retained.assessment }))).toContain(`Historical · ${status.replaceAll("_", " ")}`);
    }
  });

  it("keeps every failed and resit record while resolving only the latest recorded component flag", () => {
    const resit = { ...result, id: "resit", score: 75, passed: true, resit_required: false, taken_on: "2025-06-01", attempt_number: 2, is_resit: true, resit_of_result_id: result.id };
    const [retained] = retainHistoricalOutcomes([outcome], [result, resit]);
    expect(retained.assessment.components.theory.score).toBe(75);
    expect(retained.assessment.historical?.review_flags).not.toContain("Historical failure / resit requires review");
    const html = renderToStaticMarkup(React.createElement(HistoricalAssessmentResults, { results: [result, resit] }));
    expect(html).toContain("Recorded attempt 1");
    expect(html).toContain("Recorded attempt 2");
    expect(html).toContain("32%");
    expect(html).toContain("75%");
    expect(html).not.toContain("<button");
  });

  it("does not discard historical Practical scores when today's module is online", () => {
    const [retained] = retainHistoricalOutcomes([{ ...outcome, assessment: { needs_plan: false, plan: { mode: "online" } } as AssessmentEvaluation }], [{ ...result, component: "practical" }]);
    expect(retained.assessment.components.practical?.score).toBe(32);
    const csv = assessmentExportCsv("outcomes", [retained], [], [], [{ ...result, component: "practical" }]);
    expect(csv).not.toContain("N/A");
    expect(csv).toContain("Historical record");
    expect(csv).toContain("Merit");
  });

  it("does not infer the latest result when recorded ordering ties", () => {
    expect(historicalComponent([result, { ...result, id: "duplicate", score: 80 }], "theory")).toMatchObject({ score: null, passed: null, attempt_count: 2 });
  });

  it("keeps administrative reconciliation flags separate from unresolved academic failures", () => {
    const passed = { ...result, score: 75, passed: true, resit_required: false };
    const [retained] = retainHistoricalOutcomes([outcome], [passed]);
    expect(retained.assessment.historical?.review_flags.length).toBeGreaterThan(0);
    expect(retained.assessment.effective_indicators).toEqual([]);
    const enrolment = { studentId: "student-1", assessment: retained.assessment } as Enrolment;
    expect(studentAcademicRisk("student-1", { enrolments: [enrolment], encounters: [], examResults: [] })).toBe("none");
    const [failed] = retainHistoricalOutcomes([outcome], [result]);
    expect(studentAcademicRisk("student-1", { enrolments: [{ ...enrolment, assessment: failed.assessment }], encounters: [], examResults: [] })).toBe("watch");
  });

  it("preserves status-only historical awards even after an ongoing plan is assigned", () => {
    const [retained] = retainHistoricalOutcomes([{ ...outcome, assessment: { needs_plan: false } as AssessmentEvaluation }], []);
    expect(retained.assessment).toMatchObject({ historical: { status: "completed", final_mark: 73 }, awarded_credits: 10 });
  });

  it("requires reviewed backfill rather than automatic source linking before changing credit authority", () => {
    const modern = { ...outcome, assessment: { ...outcome.assessment, needs_plan: false, awarded_credits: 0 } };
    expect(retainHistoricalOutcomes([modern], [{ ...result, represented_by_attempt_id: "accepted" }])[0].assessment.awarded_credits).toBe(10);
    expect(retainHistoricalOutcomes([modern], [{ ...result, represented_by_attempt_id: "accepted", reviewed_backfill: true }])[0]).toBe(modern);
  });

  it("retains permanent protection and explicit amendments after reviewed backfill", () => {
    const amended = { ...outcome, assessment: {
      ...outcome.assessment, needs_plan: false, effective_status: "Fail", awarded_credits: 0,
      historical: { protected: true, status: "completed", credits: 10, final_mark: 73, grade: "Merit", review_flags: [] },
      overrides: [{ kind: "status", indicator: "", value: "Fail", reason: "Reviewed original decision" }],
      components: { theory: historicalComponent([result], "theory") }, effective_indicators: []
    } as AssessmentEvaluation };
    const [retained] = retainHistoricalOutcomes([amended], [{ ...result, represented_by_attempt_id: "accepted", reviewed_backfill: true }]);
    expect(retained.assessment).toMatchObject({ effective_status: "Fail", awarded_credits: 0, historical: { protected: true, status: "completed", credits: 10 }, overrides: amended.assessment.overrides });
    expect(renderToStaticMarkup(React.createElement(OutcomeBadge, { assessment: retained.assessment }))).toContain("Recorded · Fail (amended)");
    const csv = assessmentExportCsv("outcomes", [retained], [], []);
    expect(csv).toContain(",Fail,");
    expect(csv).toContain("Reviewed original decision");
    expect(csv).toContain("Original recorded status,Original recorded credits");
    expect(csv).toContain("Merit,completed,10");
  });

  it("does not reinstate automatic attendance or failure flags on protected historical awards", () => {
    const protectedOutcome = { ...outcome, assessment: {
      ...outcome.assessment, effective_status: "Pass", awarded_credits: 10, effective_indicators: [], overrides: [],
      historical: { protected: true, status: "completed", credits: 10, final_mark: 73, grade: "Merit", review_flags: [] }
    } as AssessmentEvaluation };
    const [retained] = retainHistoricalOutcomes([protectedOutcome], [result]);
    expect(retained.assessment.effective_indicators).toEqual([]);
    expect(retained.assessment.historical?.review_flags).toContain("Recorded completion differs from available Theory evidence");
    expect(studentAcademicRisk("student-1", { enrolments: [{ studentId: "student-1", assessment: retained.assessment } as Enrolment], encounters: [], examResults: [] })).toBe("none");
  });

  it("exports original flags and unknown sitting term honestly without inventing revision or items", () => {
    const csv = assessmentExportCsv("cccu", [], [], [], [result, { ...result, id: "orphan", enrolment_id: null }]);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain("Test Learner,,TEST,Test module,theory,32,50,No,Yes,1,No,No,2025-01-01,manual,Original teaching term,,,");
    expect(csv).toContain("historical-1");
    expect(csv).toContain("orphan");
  });

  it("does not duplicate linked results or resurrect excluded accepted attempts in exports", () => {
    const accepted = { id: "accepted", enrolment_id: "enrolment-1", active: true, component: "theory", ordinal: 1, score: 32, pass_mark: 50, passed: false } as AssessmentAttempt;
    const linked = { ...result, represented_by_attempt_id: accepted.id };
    expect(assessmentExportCsv("cccu", [outcome], [accepted], [], [linked]).split("\n")).toHaveLength(2);
    expect(assessmentExportCsv("cccu", [outcome], [{ ...accepted, active: false }], [], [linked]).split("\n")).toHaveLength(1);
  });

  it("escapes formula-like historical identities in exported evidence", () => {
    expect(assessmentExportCsv("cccu", [], [], [], [{ ...result, student_name: "=unsafe" }])).toContain("'=unsafe");
  });
});
