import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  admissionsRegistrationDocumentSlotDefinitions,
  admissionsRegistrationTermsHash,
  admissionsRegistrationTermsText,
  buildAdmissionsRegistrationDocumentObjectPath,
  canAccessAcceptedOfferRegistration,
  parseAdmissionsRegistrationDraftForm,
  parseAdmissionsRegistrationDocumentUploadForm,
  parseBeginAdmissionsRegistrationForm,
  parseSubmitAdmissionsRegistrationForm,
  validateAdmissionsRegistrationDocumentUpload
} from "@/lib/admissions-registration";

function uploadFile(overrides: Partial<Pick<File, "name" | "size" | "type">> = {}): Pick<File, "name" | "size" | "type"> {
  return {
    name: "Passport Scan.pdf",
    size: 512_000,
    type: "application/pdf",
    ...overrides
  };
}

describe("admissions registration", () => {
  it("defines required registration slots and optional student photo", () => {
    expect(admissionsRegistrationDocumentSlotDefinitions.map((slot) => [slot.key, slot.required, slot.bucket])).toEqual([
      ["identity_evidence", true, "id-documents"],
      ["qualification_evidence", true, "qualification-documents"],
      ["student_id_photo", false, "student-photos"]
    ]);
  });

  it("parses registration forms", () => {
    const formData = new FormData();
    formData.set("offer_id", "77777777-7777-4777-8777-777777777777");
    expect(parseBeginAdmissionsRegistrationForm(formData)).toEqual({
      offer_id: "77777777-7777-4777-8777-777777777777"
    });

    formData.set("registration_id", "88888888-8888-4888-8888-888888888888");
    formData.set("first_name", "Amara");
    formData.set("last_name", "Lewis");
    formData.set("email", "AMARA.LEWIS@example.nhs.uk");
    formData.set("module_confirmation_accepted", "on");
    expect(parseAdmissionsRegistrationDraftForm(formData)).toMatchObject({
      registration_id: "88888888-8888-4888-8888-888888888888",
      first_name: "Amara",
      last_name: "Lewis",
      email: "amara.lewis@example.nhs.uk",
      module_confirmation_accepted: true
    });

    formData.set("slot_key", "identity_evidence");
    expect(parseAdmissionsRegistrationDocumentUploadForm(formData)).toEqual({
      registration_id: "88888888-8888-4888-8888-888888888888",
      slot_key: "identity_evidence"
    });

    formData.set("terms_accepted", "on");
    expect(parseSubmitAdmissionsRegistrationForm(formData)).toEqual({
      registration_id: "88888888-8888-4888-8888-888888888888",
      terms_accepted: true
    });
  });

  it("validates registration document uploads by slot", () => {
    expect(validateAdmissionsRegistrationDocumentUpload({ file: uploadFile(), slotKey: "identity_evidence" })).toMatchObject({
      valid: true,
      sanitizedFilename: "passport-scan.pdf",
      extension: ".pdf"
    });

    expect(
      validateAdmissionsRegistrationDocumentUpload({
        file: uploadFile({ name: "photo.pdf", type: "application/pdf" }),
        slotKey: "student_id_photo"
      }).errors
    ).toContain("File type is not accepted for this slot.");

    expect(
      validateAdmissionsRegistrationDocumentUpload({
        file: uploadFile({ name: "passport.exe" }),
        slotKey: "identity_evidence"
      }).errors
    ).toContain("File extension is not accepted for this slot.");
  });

  it("builds object paths scoped to person, registration, and slot", () => {
    expect(
      buildAdmissionsRegistrationDocumentObjectPath(
        "person-1",
        "registration-1",
        "identity_evidence",
        "passport.pdf",
        "token-1"
      )
    ).toBe("person-1/registration-1/identity_evidence/token-1-passport.pdf");
  });

  it("gates registration to accepted owned offers only", () => {
    expect(
      canAccessAcceptedOfferRegistration({
        offerStatus: "accepted",
        offerPersonId: "person-1",
        actorPersonId: "person-1",
        leadStage: "accepted",
        archived: false
      })
    ).toBe(true);

    expect(
      canAccessAcceptedOfferRegistration({
        offerStatus: "issued",
        offerPersonId: "person-1",
        actorPersonId: "person-1",
        leadStage: "offered",
        archived: false
      })
    ).toBe(false);

    expect(
      canAccessAcceptedOfferRegistration({
        offerStatus: "accepted",
        offerPersonId: "person-1",
        actorPersonId: "person-2",
        leadStage: "accepted",
        archived: false
      })
    ).toBe(false);
  });

  it("keeps T&C versioning stable and adds migration foundations without conversion side effects", () => {
    expect(admissionsRegistrationTermsText.length).toBeGreaterThan(80);
    expect(admissionsRegistrationTermsHash).toMatch(/^[a-f0-9]{64}$/);

    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/0029_accepted_offer_registration_foundation.sql"),
      "utf8"
    );

    expect(migration).toContain("create type public.admissions_registration_status");
    expect(migration).toContain("create table public.admissions_registrations");
    expect(migration).toContain("create table public.admissions_registration_person_detail_versions");
    expect(migration).toContain("create table public.admissions_registration_document_slots");
    expect(migration).toContain("module_code text not null");
    expect(migration).toContain("module_title text not null");
    expect(migration).toContain("price_pence integer not null");
    expect(migration).toContain("join public.course_modules course_module");
    expect(migration).toContain("join public.terms term");
    expect(migration).toContain("create or replace function public.begin_admissions_registration");
    expect(migration).toContain("create or replace function public.save_admissions_registration");
    expect(migration).toContain("create or replace function public.record_admissions_registration_document_upload");
    expect(migration).toContain("create or replace function public.submit_admissions_registration");
    expect(migration).toContain("'registration.started'");
    expect(migration).toContain("'registration.saved'");
    expect(migration).toContain("'registration.submitted'");
    expect(migration).toContain("'registration.terms_accepted'");
    expect(migration).toContain("'document.uploaded'");
    expect(migration).toContain("v_offer.status <> 'accepted'");
    expect(migration).toContain("v_lead.stage not in ('accepted', 'registration_in_progress')");
    expect(migration).toContain("p_terms_version");
    expect(migration).toContain("p_terms_hash");
    expect(migration).not.toContain("convert_admissions_registration(");
    expect(migration).not.toContain("insert into public.enrolments");
    expect(migration).not.toContain("insert into public.finance_records");
    expect(migration).not.toContain("insert into public.students");

    const actions = readFileSync(join(process.cwd(), "src/app/portal/registration/actions.ts"), "utf8");
    expect(actions.indexOf("save_admissions_registration")).toBeLessThan(actions.indexOf("submit_admissions_registration"));
    expect(actions).toContain("from(\"admissions_registration_terms_versions\")");
  });
});
