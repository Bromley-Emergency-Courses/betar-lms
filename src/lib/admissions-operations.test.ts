import { describe, expect, it } from "vitest";
import { parseAdmissionsOperationalBatchForm } from "@/lib/admissions-operations";

const requestKey = "11111111-1111-4111-8111-111111111111";
const entityId = "22222222-2222-4222-8222-222222222222";
const personId = "33333333-3333-4333-8333-333333333333";

function correspondenceForm() {
  const formData = new FormData();
  formData.set("request_key", requestKey);
  formData.set("workspace", "new_students");
  formData.set("action", "invite_application");
  formData.set("scope", "all_matching");
  formData.set("reviewed_filters_json", JSON.stringify({ journey_stage: "enquiry" }));
  formData.set(
    "targets_json",
    JSON.stringify([
      {
        entity_type: "admission_lead",
        entity_id: entityId,
        person_id: personId,
        recipient_email: " Owner@Example.org ",
        recipient_name: "Owner Applicant",
        eligible: true,
        source_snapshot: { admission_lead_id: entityId, journey_stage: "enquiry" }
      }
    ])
  );
  formData.set("template_key", "application_invitation");
  formData.set("template_version", "1");
  formData.set("rendered_subject", "Your BETAR application invitation");
  formData.set("rendered_body", "Use the secure link to apply.");
  return formData;
}

describe("admissions operational batch parsing", () => {
  it("preserves an explicit reviewed scope and normalizes recipient addresses", () => {
    expect(parseAdmissionsOperationalBatchForm(correspondenceForm())).toMatchObject({
      request_key: requestKey,
      workspace: "new_students",
      action: "invite_application",
      scope: "all_matching",
      reviewed_filters: { journey_stage: "enquiry" },
      targets: [{ entity_id: entityId, recipient_email: "owner@example.org", eligible: true }]
    });
  });

  it("rejects workspace/action mismatches and duplicate targets", () => {
    const formData = correspondenceForm();
    formData.set("workspace", "returning_students");
    expect(() => parseAdmissionsOperationalBatchForm(formData)).toThrow();

    formData.set("workspace", "new_students");
    const targets = JSON.parse(String(formData.get("targets_json"))) as unknown[];
    formData.set("targets_json", JSON.stringify([...targets, ...targets]));
    expect(() => parseAdmissionsOperationalBatchForm(formData)).toThrow();
  });

  it("requires plain-language exclusions and complete correspondence snapshots", () => {
    const formData = correspondenceForm();
    formData.set(
      "targets_json",
      JSON.stringify([
        {
          entity_type: "admission_lead",
          entity_id: entityId,
          eligible: false,
          source_snapshot: { journey_stage: "closed" }
        }
      ])
    );
    expect(() => parseAdmissionsOperationalBatchForm(formData)).toThrow();

    formData.set(
      "targets_json",
      JSON.stringify([
        {
          entity_type: "admission_lead",
          entity_id: entityId,
          eligible: false,
          exclusion_reason: "The record is already closed.",
          source_snapshot: { journey_stage: "closed" }
        }
      ])
    );
    formData.delete("rendered_body");
    expect(() => parseAdmissionsOperationalBatchForm(formData)).toThrow();
  });
});
