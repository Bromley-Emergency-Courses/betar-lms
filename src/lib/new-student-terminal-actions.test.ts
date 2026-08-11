import { describe, expect, it } from "vitest";
import {
  newStudentTerminalActionAvailability,
  parseAdmissionOutcomeForm,
  parseOfferReissueForm,
  parseOfferWithdrawalForm
} from "@/lib/new-student-terminal-actions";

const admissionId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";
const offerId = "33333333-3333-4333-8333-333333333333";

describe("new-student terminal and reversible actions", () => {
  it("parses reasoned abandonment, reissue, and withdrawal forms", () => {
    const abandonment = new FormData();
    abandonment.set("admission_id", admissionId);
    abandonment.set("reason", "Applicant confirmed they are not proceeding this intake.");
    expect(parseAdmissionOutcomeForm(abandonment).reason).toContain("not proceeding");

    const withdrawal = new FormData();
    withdrawal.set("admission_id", admissionId);
    withdrawal.set("application_id", applicationId);
    withdrawal.set("offer_id", offerId);
    withdrawal.set("reason", "Offer issued in error.");
    expect(parseOfferWithdrawalForm(withdrawal).offer_id).toBe(offerId);

    withdrawal.set("new_deadline_at", "2099-10-01");
    expect(parseOfferReissueForm(withdrawal).new_deadline_at).toBe("2099-10-01T23:59:59.000Z");
  });

  it("limits abandonment to enquiries and unsubmitted applications", () => {
    expect(newStudentTerminalActionAvailability({
      journeyStage: "enquiry",
      sourceLeadStage: "interest",
      archived: false,
      hasActiveAbandonment: false,
      hasRegistration: false
    }).canAbandon).toBe(true);
    expect(newStudentTerminalActionAvailability({
      journeyStage: "review",
      sourceLeadStage: "submitted",
      archived: false,
      applicationStatus: "submitted",
      hasActiveAbandonment: false,
      hasRegistration: false
    }).canAbandon).toBe(false);
  });

  it("reopens only active abandonment and never a terminal post-submission outcome", () => {
    expect(newStudentTerminalActionAvailability({
      journeyStage: "closed",
      sourceLeadStage: "abandoned",
      archived: false,
      applicationStatus: "draft",
      hasActiveAbandonment: true,
      hasRegistration: false
    }).canReopenAbandonment).toBe(true);
    expect(newStudentTerminalActionAvailability({
      journeyStage: "closed",
      sourceLeadStage: "withdrawn",
      archived: false,
      applicationStatus: "submitted",
      hasActiveAbandonment: false,
      offerStatus: "withdrawn",
      hasRegistration: false
    }).canReopenAbandonment).toBe(false);
  });

  it("allows reissue only from lapse and withdrawal from issued or lapsed offers without registration", () => {
    expect(newStudentTerminalActionAvailability({
      journeyStage: "offer",
      sourceLeadStage: "offer_lapsed",
      archived: false,
      applicationStatus: "submitted",
      hasActiveAbandonment: false,
      offerStatus: "lapsed",
      hasRegistration: false
    })).toMatchObject({ canReissueOffer: true, canWithdrawOffer: true });
    expect(newStudentTerminalActionAvailability({
      journeyStage: "registration",
      sourceLeadStage: "registration_in_progress",
      archived: false,
      applicationStatus: "submitted",
      hasActiveAbandonment: false,
      offerStatus: "accepted",
      hasRegistration: true
    })).toMatchObject({ canReissueOffer: false, canWithdrawOffer: false });
  });
});
