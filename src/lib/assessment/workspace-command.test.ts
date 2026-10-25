import { describe, expect, it } from "vitest";
import { workspaceCommandSchema } from "./workspace-command";

const base = { enrolment_id: "49000000-0000-4000-8000-000000000001", reason: "Reviewed evidence" };
const attempt = { ...base, type: "AddManualAttempt", component: "theory", sitting_date: "2026-01-02", items: [{ kind: "mcq", score: 0 }] };
const accepts = (command: unknown, expectedRevision: unknown = 3) => workspaceCommandSchema.safeParse({ command, expectedRevision }).success;

describe("workspace assessment command boundary", () => {
  it("restricts result lifecycle commands to reasoned exclusion or review of a known exclusion", () => {
    const exclusion = { ...base, type: "ExcludeAttempt", attempt_id: base.enrolment_id, category: "invalid" };
    const restoration = { ...base, type: "RestoreAttempt", attempt_id: base.enrolment_id, exclusion_id: base.enrolment_id };
    expect(accepts(exclusion)).toBe(true);
    expect(accepts(restoration)).toBe(true);
    for (const change of [{ category: "delete" }, { score: 100 }, { source_id: base.enrolment_id }, { reason: " " }]) expect(accepts({ ...exclusion, ...change })).toBe(false);
    expect(accepts({ ...restoration, exclusion_id: undefined })).toBe(false);
    expect(accepts({ ...restoration, reviewed_source_version_id: "latest" })).toBe(false);
  });
  it("accepts a focused imported correction without editable ownership, sitting or configuration", () => {
    const correction = { ...base, type: "CorrectImportedAttempt", attempt_id: base.enrolment_id, source_id: base.enrolment_id, expected_source_revision: 2, items: [{ kind: "mcq", score: 65 }] };
    expect(accepts(correction)).toBe(true);
    for (const change of [{ expected_source_revision: undefined }, { expected_source_revision: -1 }, { sitting_date: "2025-06-15" }, { component: "theory" }, { pass_mark: 40 }, { identity_override_reason: "move" }]) {
      expect(accepts({ ...correction, ...change })).toBe(false);
    }
  });
  it("accepts zero scores and requires a reason and a nonnegative integer revision", () => {
    expect(accepts(attempt)).toBe(true);
    expect(accepts({ ...attempt, reason: " " })).toBe(false);
    for (const revision of [undefined, -1, 0.5, "3"]) expect(accepts(attempt, revision === undefined ? null : revision)).toBe(false);
  });
  it("rejects plan, pass-mark, source-identity and arbitrary command injection", () => {
    for (const input of [{ pass_mark: 10 }, { plan_id: base.enrolment_id }, { source_id: base.enrolment_id }, { identity_override_reason: "move" }, { type: "MatchSourceResult" }, { type: "ChangeEnrolmentAssessmentPlan" }]) {
      expect(accepts({ ...attempt, ...input })).toBe(false);
    }
  });
  it("validates independent override values and individual clears", () => {
    expect(accepts({ ...base, type: "SetAssessmentOverride", kind: "credits", value: 0 })).toBe(true);
    expect(accepts({ ...base, type: "SetAssessmentOverride", kind: "indicator", indicator: "Attendance non-compliance", value: false })).toBe(true);
    expect(accepts({ ...base, type: "ClearAssessmentOverride", kind: "status" })).toBe(true);
    expect(accepts({ ...base, type: "SetAssessmentOverride", kind: "credits", value: "Pass" })).toBe(false);
    expect(accepts({ ...base, type: "ClearAssessmentOverride", kind: "indicator" })).toBe(false);
    expect(accepts({ ...base, type: "ClearAssessmentOverride", kind: "status", indicator: "Attendance non-compliance" })).toBe(false);
  });
  it("requires scheduling details and rejects invalid dates, scores and ambiguous carry-forward", () => {
    expect(accepts({ ...base, type: "ScheduleResit", component: "theory", note: "20 November 2026, morning session" })).toBe(true);
    expect(accepts({ ...base, type: "ScheduleResit", component: "theory", note: " " })).toBe(false);
    expect(accepts({ ...attempt, sitting_date: "2026-02-31" })).toBe(false);
    expect(accepts({ ...attempt, items: [{ kind: "mcq", score: 101 }] })).toBe(false);
    expect(accepts({ ...attempt, items: [{ kind: "physics", score: 0, carried_from_item_id: base.enrolment_id }] })).toBe(false);
  });
});
