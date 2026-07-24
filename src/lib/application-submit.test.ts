import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applicationDeclarationText,
  applicationDeclarationTextHash,
  applicationDeclarationVersion,
  applicationSubmittedAction,
  applicationSubmitEntityType,
  buildApplicationSubmittedAuditMetadata,
  findUnsavedApplicationDraftChanges,
  getClientIpAddress,
  parseSubmitApplicationForm,
  validateApplicationSubmitRequiredFields
} from "@/lib/application-submit";

const applicationId = "66666666-6666-4666-8666-666666666666";
const leadId = "11111111-1111-4111-8111-111111111111";
const startTermId = "22222222-2222-4222-8222-222222222222";
const offeringId = "33333333-3333-4333-8333-333333333333";

function submitForm(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  const values = {
    application_id: applicationId,
    declaration_accepted: "on",
    ...overrides
  };

  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }

  return formData;
}

describe("application final submit", () => {
  it("parses declaration acceptance separately from draft save payloads", () => {
    expect(parseSubmitApplicationForm(submitForm())).toEqual({
      application_id: applicationId,
      declaration_accepted: true
    });

    expect(() => parseSubmitApplicationForm(submitForm({ declaration_accepted: "" }))).toThrow(
      "Declaration acceptance is required before submission."
    );
    expect(() => parseSubmitApplicationForm(submitForm({ application_id: "not-a-uuid" }))).toThrow();
  });

  it("detects visible unsaved form edits before allowing final submission", () => {
    const savedDraft = {
      admission_lead_id: leadId,
      programme: "pgcert" as const,
      intended_start_term_id: startTermId,
      selected_module_offering_ids: [offeringId],
      title: "Dr",
      first_name: "Priya",
      middle_names: null,
      last_name: "Shah",
      preferred_name: null,
      previous_surname: null,
      date_of_birth: "1988-04-12",
      previous_study_detail: null,
      partner_student_id: null,
      email: "priya@example.nhs.uk",
      phone: "07123 456789",
      address_line_1: "1 Clinical Road",
      address_line_2: null,
      city: "London",
      postcode: "SE1 1AA",
      country: "United Kingdom",
      clinical_role: "Consultant",
      employer: "Example NHS Trust",
      department_specialty: "Acute medicine",
      professional_registration_body: "GMC",
      professional_registration_number: "1234567",
      highest_qualification: "MBBS",
      qualification_awarding_body: "Example University",
      qualification_year: 2016,
      qualification_result: null,
      qualification_country: null,
      work_experience: "Ten years of relevant experience.",
      nationality: "British",
      country_of_birth: null,
      country_of_residence: "United Kingdom",
      needs_visa_check: false,
      visa_notes: null,
      funding_source: "unknown" as const,
      funding_organisation: null,
      funding_contact: null,
      support_needs_disclosed: false,
      support_needs_detail: null,
      support_needs_adjustments: null,
      pocus_previous_experience: "I use POCUS weekly.",
      pocus_motivation: "I want structured supervision.",
      pocus_case_improved_management: "POCUS changed management.",
      pocus_limitations_case: "I escalated when views were limited.",
      evidence_summary: null
    };

    expect(findUnsavedApplicationDraftChanges(savedDraft, savedDraft)).toEqual([]);
    expect(findUnsavedApplicationDraftChanges({ ...savedDraft, phone: "07000 000000" }, savedDraft)).toEqual(["phone"]);
    expect(
      findUnsavedApplicationDraftChanges(
        { ...savedDraft, selected_module_offering_ids: [offeringId, "44444444-4444-4444-8444-444444444444"] },
        savedDraft
      )
    ).toEqual(["selected_module_offering_ids"]);
  });

  it("validates required saved application fields for final submission", () => {
    expect(
      validateApplicationSubmitRequiredFields({
        firstName: "Priya",
        lastName: "Shah",
        dateOfBirth: "1988-04-12",
        email: "priya@example.nhs.uk",
        phone: "07123 456789",
        addressLine1: "1 Clinical Road",
        city: "London",
        postcode: "SE1 1AA",
        country: "United Kingdom",
        clinicalRole: "Consultant",
        employer: "Example NHS Trust",
        departmentSpecialty: "Acute medicine",
        professionalRegistrationBody: "GMC",
        professionalRegistrationNumber: "1234567",
        workExperience: "Ten years of relevant experience.",
        highestQualification: "MBBS",
        qualificationAwardingBody: "Example University",
        qualificationYear: 2016,
        intendedStartTermId: startTermId,
        selectedModuleOfferingIds: [offeringId],
        nationality: "British",
        countryOfResidence: "United Kingdom",
        pocusPreviousExperience: "I use POCUS weekly.",
        pocusMotivation: "I want structured supervision.",
        pocusCaseImprovedManagement: "POCUS changed management.",
        pocusLimitationsCase: "I escalated when views were limited.",
        missingRequiredDocumentSlotKeys: []
      })
    ).toEqual([]);

    expect(
      validateApplicationSubmitRequiredFields({
        firstName: "",
        lastName: "Shah",
        dateOfBirth: null,
        email: "not-an-email",
        phone: null,
        addressLine1: null,
        city: null,
        postcode: null,
        country: null,
        clinicalRole: null,
        employer: null,
        departmentSpecialty: null,
        professionalRegistrationBody: null,
        professionalRegistrationNumber: null,
        workExperience: null,
        highestQualification: null,
        qualificationAwardingBody: null,
        qualificationYear: null,
        intendedStartTermId: null,
        selectedModuleOfferingIds: [],
        nationality: null,
        countryOfResidence: null,
        pocusPreviousExperience: null,
        pocusMotivation: null,
        pocusCaseImprovedManagement: null,
        pocusLimitationsCase: null,
        missingRequiredDocumentSlotKeys: ["qualification_evidence", "professional_registration_evidence"]
      })
    ).toContain("selected_module_offerings");

    expect(
      validateApplicationSubmitRequiredFields({
        firstName: "Priya",
        lastName: "Shah",
        dateOfBirth: "1988-04-12",
        email: "priya@example.nhs.uk",
        phone: "07123 456789",
        addressLine1: "1 Clinical Road",
        city: "London",
        postcode: "SE1 1AA",
        country: "United Kingdom",
        clinicalRole: "Consultant",
        employer: "Example NHS Trust",
        departmentSpecialty: "Acute medicine",
        professionalRegistrationBody: "GMC",
        professionalRegistrationNumber: "1234567",
        workExperience: "Ten years of relevant experience.",
        highestQualification: "MBBS",
        qualificationAwardingBody: "Example University",
        qualificationYear: 2016,
        intendedStartTermId: startTermId,
        selectedModuleOfferingIds: [offeringId],
        nationality: "British",
        countryOfResidence: "United Kingdom",
        pocusPreviousExperience: "I use POCUS weekly.",
        pocusMotivation: "I want structured supervision.",
        pocusCaseImprovedManagement: "POCUS changed management.",
        pocusLimitationsCase: "I escalated when views were limited.",
        missingRequiredDocumentSlotKeys: ["qualification_evidence"]
      })
    ).toContain("document:qualification_evidence");
  });

  it("captures client IP from forwarded headers without accepting a whole comma-separated chain", () => {
    expect(
      getClientIpAddress(
        new Headers({
          "x-forwarded-for": "203.0.113.10, 198.51.100.20",
          "x-real-ip": "198.51.100.30"
        })
      )
    ).toBe("203.0.113.10");

    expect(getClientIpAddress(new Headers({ "x-real-ip": "198.51.100.30" }))).toBe("198.51.100.30");
  });

  it("builds submitted audit metadata without application answers or support-needs content", () => {
    expect(applicationDeclarationVersion).toBe("application-declaration-2026-07-23-v1");
    expect(applicationDeclarationText).toContain("truthful, complete, and accurate");
    expect(applicationDeclarationTextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      buildApplicationSubmittedAuditMetadata({
        applicationId,
        admissionLeadId: leadId,
        programme: "pgcert",
        intendedStartTermId: startTermId,
        selectedModuleOfferingCount: 2,
        requiredDocumentSlotCount: 2
      })
    ).toEqual({
      admission_lead_id: leadId,
      programme: "pgcert",
      intended_start_term_id: startTermId,
      selected_module_offering_count: 2,
      required_document_slot_count: 2,
      declaration_version: applicationDeclarationVersion,
      declaration_text_hash: applicationDeclarationTextHash
    });
  });

  it("adds a transactional submit RPC without document, enrolment, finance, review, or offer side effects", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/0023_application_final_submit_declaration.sql"),
      "utf8"
    );

    expect(migration).toContain("create or replace function public.submit_application");
    expect(migration).toContain("p_declaration_accepted boolean");
    expect(migration).not.toContain("p_declaration_version");
    expect(migration).not.toContain("p_declaration_text_hash");
    expect(migration).toContain("v_declaration_version text := 'application-declaration-2026-07-23-v1'");
    expect(migration).toContain("v_declaration_text_hash text := '71b23b4f1e241df24f6c5d19a67fbe27d0419e58f663794f527e267a7d83986c'");
    expect(migration).toContain("declaration_actor_user_id");
    expect(migration).toContain("declaration_ip_address inet");
    expect(migration).toContain("status = 'submitted'");
    expect(migration).toContain("stage = 'submitted'");
    expect(migration).toContain("'application.submitted'");
    expect(migration).toContain("for update");
    expect(migration.indexOf("from public.admission_leads")).toBeLessThan(
      migration.indexOf("from public.applications\n  where id = p_application_id\n    and admission_lead_id = v_lead.id")
    );
    expect(migration).toContain("v_selected_offering_count not between 1 and 2");
    expect(migration).toContain("offering.term_id = v_application.intended_start_term_id");
    expect(migration).not.toContain("insert into public.enrolments");
    expect(migration).not.toContain("insert into public.finance_records");
    expect(migration).not.toContain("create table public.application_documents");
    expect(migration).not.toContain("create table public.application_reviews");
    expect(migration).not.toContain("create table public.offers");
    expect(applicationSubmittedAction).toBe("application.submitted");
    expect(applicationSubmitEntityType).toBe("application");
  });
});
