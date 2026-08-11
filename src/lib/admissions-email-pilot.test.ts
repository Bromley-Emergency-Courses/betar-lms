import { describe, expect, it } from "vitest";
import { parseAdmissionsEmailPilotActionForm } from "@/lib/admissions-email-pilot";

const entityId = "11111111-1111-4111-8111-111111111111";
const testRecordId = "22222222-2222-4222-8222-222222222222";

describe("admissions email pilot actions", () => {
  it("requires an explicit fake-record confirmation when marking", () => {
    const form = new FormData();
    form.set("intent", "mark");
    form.set("record_type", "new_applicant");
    form.set("entity_id", entityId);
    form.set("label", " Applicant pilot 1 ");
    form.set("reason", " Controlled end-to-end journey. ");
    form.set("confirmed_fake", "true");

    expect(parseAdmissionsEmailPilotActionForm(form)).toEqual({
      intent: "mark",
      record_type: "new_applicant",
      entity_id: entityId,
      label: "Applicant pilot 1",
      reason: "Controlled end-to-end journey.",
      confirmed_fake: "true"
    });

    form.delete("confirmed_fake");
    expect(() => parseAdmissionsEmailPilotActionForm(form)).toThrow(/Confirm that this is a fake record/);
  });

  it("requires the exact marker and a reason when removing pilot status", () => {
    const form = new FormData();
    form.set("intent", "unmark");
    form.set("record_type", "returning_student");
    form.set("entity_id", entityId);
    form.set("test_record_id", testRecordId);
    form.set("reason", "Pilot journey completed.");

    expect(parseAdmissionsEmailPilotActionForm(form)).toEqual({
      intent: "unmark",
      record_type: "returning_student",
      entity_id: entityId,
      test_record_id: testRecordId,
      reason: "Pilot journey completed."
    });
  });
});
