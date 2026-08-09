import { describe, expect, it } from "vitest";
import {
  admissionsBatchPreviewBlockingMessage,
  admissionsBatchReviewRequestSchema,
  batchScopeForSelection,
  newStudentBatchEligibility
} from "@/lib/admissions-batch-review";
import type { StaffNewStudentAdmissionsOperation } from "@/lib/admissions-workspace";

const enquiry = {
  admissionLeadId: "11111111-1111-4111-8111-111111111111",
  firstName: "Asha",
  lastName: "Patel",
  email: "asha@example.test",
  programme: "pgcert",
  sourceLeadStage: "interest",
  journeyStage: "enquiry",
  hasDataInconsistency: false,
  attentionIndicators: [],
  primaryNextAction: "invite_applicant",
  lastActivityAt: "2026-08-09T12:00:00Z",
  createdAt: "2026-08-09T12:00:00Z",
  applicantName: "Asha Patel",
  needsStaffAttention: false,
  isReadyToProgress: false,
  isAwaitingApplicant: false
} satisfies StaffNewStudentAdmissionsOperation;

describe("admissions batch review", () => {
  it("keeps invitation and abandonment eligibility contextual", () => {
    expect(newStudentBatchEligibility("invite_application", enquiry)).toEqual({ eligible: true });
    expect(newStudentBatchEligibility("close_abandoned", enquiry)).toEqual({ eligible: true });
    expect(newStudentBatchEligibility("close_abandoned", {
      ...enquiry,
      sourceLeadStage: "submitted",
      journeyStage: "review",
      applicationStatus: "submitted"
    })).toEqual({ eligible: false, reason: "Only enquiries and unsubmitted applications can be closed as abandoned." });
  });

  it("blocks every ordinary batch action when source data is inconsistent", () => {
    expect(newStudentBatchEligibility("invite_application", { ...enquiry, hasDataInconsistency: true })).toEqual({
      eligible: false,
      reason: "Data inconsistency must be repaired before this action."
    });
  });

  it("requires reviewed message content or a reason as appropriate", () => {
    const base = {
      workspace: "new_students",
      scope: "one",
      selected_ids: [enquiry.admissionLeadId],
      filters: { search: "", attention: "all", stage: "all" }
    };
    expect(admissionsBatchReviewRequestSchema.safeParse({ ...base, action: "invite_application" }).success).toBe(false);
    expect(admissionsBatchReviewRequestSchema.safeParse({
      ...base,
      action: "invite_application",
      rendered_subject: "Your BETAR application invitation",
      rendered_body: "This message forgot its secure link."
    }).success).toBe(false);
    expect(admissionsBatchReviewRequestSchema.safeParse({ ...base, action: "close_abandoned" }).success).toBe(false);
    expect(admissionsBatchReviewRequestSchema.safeParse({
      ...base,
      action: "invite_application",
      rendered_subject: "Your BETAR application invitation",
      rendered_body: "Use this secure link: {{action_link}}"
    }).success).toBe(true);
  });

  it("derives one, selected and all-matching scopes explicitly", () => {
    expect(batchScopeForSelection(false, 1)).toBe("one");
    expect(batchScopeForSelection(false, 2)).toBe("selected");
    expect(batchScopeForSelection(true, 500)).toBe("all_matching");
  });

  it("explains why a zero-eligible invitation batch cannot be queued", () => {
    expect(admissionsBatchPreviewBlockingMessage({
      workspace: "new_students",
      action: "invite_application",
      scope: "selected",
      reviewedCount: 2,
      eligibleCount: 0,
      excludedCount: 2,
      targets: [
        { entity_type: "admission_lead", entity_id: enquiry.admissionLeadId, eligible: false, exclusion_reason: "Email delivery is disabled.", source_snapshot: {} },
        { entity_type: "admission_lead", entity_id: "22222222-2222-4222-8222-222222222222", eligible: false, exclusion_reason: "Email delivery is disabled.", source_snapshot: {} }
      ]
    })).toMatch(/Email delivery is disabled/);

    expect(admissionsBatchPreviewBlockingMessage({
      workspace: "new_students",
      action: "close_abandoned",
      scope: "one",
      reviewedCount: 1,
      eligibleCount: 1,
      excludedCount: 0,
      targets: [{ entity_type: "admission_lead", entity_id: enquiry.admissionLeadId, eligible: true, source_snapshot: {} }]
    })).toBeNull();
  });
});
