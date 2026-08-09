import { describe, expect, it } from "vitest";
import {
  parseApplicationCorrectionDocumentUploadForm,
  parseApplicationEvidenceOverrideForm,
  parseCancelApplicationCorrectionForm,
  parseRequestApplicationCorrectionsForm,
  parseReviewApplicationCorrectionsForm,
  parseSaveApplicationCorrectionResponseForm
} from "@/lib/application-corrections";

const applicationId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const slotId = "44444444-4444-4444-8444-444444444444";

describe("application corrections", () => {
  it("parses a structured request and rejects duplicate or unknown targets", () => {
    const formData = new FormData();
    formData.set("application_id", applicationId);
    formData.set("summary", "Please correct the identity details and replace the certificate.");
    formData.set("due_at", "2027-02-01T12:00:00Z");
    formData.set(
      "items_json",
      JSON.stringify([
        { target_type: "application_field", target_key: "last_name", instructions: "Use your legal surname." },
        {
          target_type: "document_slot",
          target_key: "qualification_evidence",
          instructions: "Upload the complete certificate."
        }
      ])
    );

    expect(parseRequestApplicationCorrectionsForm(formData)).toMatchObject({
      application_id: applicationId,
      summary: "Please correct the identity details and replace the certificate.",
      due_at: "2027-02-01T12:00:00.000Z",
      items: [
        { target_type: "application_field", target_key: "last_name" },
        { target_type: "document_slot", target_key: "qualification_evidence" }
      ]
    });

    formData.set(
      "items_json",
      JSON.stringify([
        { target_type: "application_field", target_key: "last_name", instructions: "First request." },
        { target_type: "application_field", target_key: "last_name", instructions: "Duplicate request." }
      ])
    );
    expect(() => parseRequestApplicationCorrectionsForm(formData)).toThrow();
  });

  it("requires exactly one corrected value or replacement file", () => {
    const formData = new FormData();
    formData.set("item_id", itemId);
    formData.set("proposed_value_json", JSON.stringify("Corrected surname"));
    formData.set("response_note", "Matches my passport.");

    expect(parseSaveApplicationCorrectionResponseForm(formData)).toEqual({
      item_id: itemId,
      proposed_value: "Corrected surname",
      replacement_managed_file_id: null,
      clear_value: false,
      response_note: "Matches my passport."
    });

    formData.set("replacement_managed_file_id", slotId);
    expect(() => parseSaveApplicationCorrectionResponseForm(formData)).toThrow();

    formData.delete("proposed_value_json");
    formData.delete("replacement_managed_file_id");
    formData.set("clear_value", "on");
    expect(parseSaveApplicationCorrectionResponseForm(formData)).toMatchObject({
      proposed_value: undefined,
      replacement_managed_file_id: null,
      clear_value: true
    });
  });

  it("parses a targeted replacement-document upload", () => {
    const formData = new FormData();
    formData.set("application_id", applicationId);
    formData.set("item_id", itemId);
    formData.set("slot_key", "qualification_evidence");
    formData.set("response_note", "The complete certificate is attached.");

    expect(parseApplicationCorrectionDocumentUploadForm(formData)).toEqual({
      application_id: applicationId,
      item_id: itemId,
      slot_key: "qualification_evidence",
      response_note: "The complete certificate is attached."
    });

    formData.set("slot_key", "passport");
    expect(() => parseApplicationCorrectionDocumentUploadForm(formData)).toThrow();
  });

  it("requires instructions for revisions and reasons for cancellation or overrides", () => {
    const review = new FormData();
    review.set("application_id", applicationId);
    review.set("request_id", requestId);
    review.set("reviews_json", JSON.stringify([{ item_id: itemId, outcome: "revise", review_note: "" }]));
    expect(() => parseReviewApplicationCorrectionsForm(review)).toThrow();

    const cancel = new FormData();
    cancel.set("application_id", applicationId);
    cancel.set("request_id", requestId);
    cancel.set("reason", " ");
    expect(() => parseCancelApplicationCorrectionForm(cancel)).toThrow();

    const evidenceOverride = new FormData();
    evidenceOverride.set("application_id", applicationId);
    evidenceOverride.set("slot_id", slotId);
    evidenceOverride.set("reason", "Original verified directly with the awarding body.");
    expect(parseApplicationEvidenceOverrideForm(evidenceOverride)).toEqual({
      application_id: applicationId,
      slot_id: slotId,
      reason: "Original verified directly with the awarding body."
    });
  });
});
