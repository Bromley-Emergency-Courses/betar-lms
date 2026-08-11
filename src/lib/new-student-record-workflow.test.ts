import { describe, expect, it } from "vitest";
import { getNewStudentFullRecordAvailability } from "@/lib/new-student-record-workflow";

const readyReview = {
  journeyStage: "review" as const,
  sourceLeadStage: "reviewed",
  archived: false,
  hasApplication: true,
  applicationStatus: "submitted" as const,
  readinessStatus: "ready_for_decision" as const,
  hasActiveCorrection: false,
  requiredEvidence: [{ status: "verified", hasActiveOverride: false }]
};

describe("new-student full-record action availability", () => {
  it("allows eligible offer and rejection decisions without exposing a stage editor", () => {
    expect(getNewStudentFullRecordAvailability(readyReview)).toMatchObject({
      canOffer: true,
      canReject: true,
      offerBlockedReasons: []
    });
  });

  it("keeps rejection available while blocking an offer for active corrections or unresolved evidence", () => {
    const availability = getNewStudentFullRecordAvailability({
      ...readyReview,
      hasActiveCorrection: true,
      requiredEvidence: [{ status: "unverified", hasActiveOverride: false }]
    });
    expect(availability.canOffer).toBe(false);
    expect(availability.canReject).toBe(true);
    expect(availability.offerBlockedReasons).toEqual(["active_correction", "required_evidence_unresolved"]);
  });

  it("never treats rejected evidence as overrideable offer evidence", () => {
    const availability = getNewStudentFullRecordAvailability({
      ...readyReview,
      requiredEvidence: [{ status: "rejected", hasActiveOverride: true }]
    });
    expect(availability.canOffer).toBe(false);
    expect(availability.offerBlockedReasons).toContain("rejected_evidence");
  });

  it("allows invitation only for an editable pre-application admission", () => {
    expect(getNewStudentFullRecordAvailability({
      journeyStage: "enquiry",
      sourceLeadStage: "interest",
      archived: false,
      hasApplication: false,
      hasActiveCorrection: false,
      requiredEvidence: []
    })).toMatchObject({ canEditAdministrativeDetails: true, canInvite: true, canOffer: false, canReject: false });

    expect(getNewStudentFullRecordAvailability({
      journeyStage: "complete",
      sourceLeadStage: "registered",
      archived: false,
      convertedStudentId: "student-1",
      hasApplication: true,
      applicationStatus: "submitted",
      decisionOutcome: "offer",
      hasActiveCorrection: false,
      requiredEvidence: [{ status: "verified", hasActiveOverride: false }]
    })).toMatchObject({ canEditAdministrativeDetails: false, canInvite: false, canReviewEvidence: false });
  });
});
