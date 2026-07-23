import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applicationDraftEntityType,
  applicationDraftSavedAction,
  buildApplicationDraftAuditMetadata,
  canReadApplicationDraftResource,
  canReadApplicationSupportNeedsResource,
  canSaveApplicationDraftForLead,
  canWriteApplicationDraftResourceDirectly,
  parseApplicationDraftForm,
  validateApplicationOfferingSelection
} from "@/lib/application-drafts";

const leadId = "11111111-1111-4111-8111-111111111111";
const startTermId = "22222222-2222-4222-8222-222222222222";
const cardiacOfferingId = "33333333-3333-4333-8333-333333333333";
const lungOfferingId = "44444444-4444-4444-8444-444444444444";
const inactiveOfferingId = "55555555-5555-4555-8555-555555555555";
const applicant = { kind: "portal" as const, actorType: "applicant" as const, personId: "person-1" };
const otherApplicant = { kind: "portal" as const, actorType: "applicant" as const, personId: "person-2" };
const student = { kind: "portal" as const, actorType: "student" as const, personId: "person-1" };
const admin = { kind: "staff" as const, role: "admin" as const };
const teacher = { kind: "staff" as const, role: "teacher" as const };
const reception = { kind: "staff" as const, role: "reception" as const };

function draftForm(overrides: Record<string, string | string[]> = {}): FormData {
  const formData = new FormData();
  const values: Record<string, string | string[]> = {
    admission_lead_id: leadId,
    programme: "pgcert",
    intended_start_term_id: startTermId,
    selected_module_offering_ids: [cardiacOfferingId, lungOfferingId],
    title: " Dr ",
    first_name: " Priya ",
    middle_names: " A ",
    last_name: " Shah ",
    preferred_name: " Priya ",
    previous_surname: "",
    date_of_birth: "1988-04-12",
    previous_study_detail: "No previous BETAR study",
    partner_student_id: "CCCU123",
    email: " PRIYA.SHAH@EXAMPLE.NHS.UK ",
    phone: " 07123 456789 ",
    address_line_1: " 1 Clinical Road ",
    address_line_2: "",
    city: " London ",
    postcode: " SE1 1AA ",
    country: " United Kingdom ",
    clinical_role: " Consultant ",
    employer: " NHS Trust ",
    department_specialty: " Acute medicine ",
    professional_registration_body: " GMC ",
    professional_registration_number: " 1234567 ",
    highest_qualification: " MBBS ",
    qualification_awarding_body: " Example University ",
    qualification_year: "2016",
    qualification_result: "Pass",
    qualification_country: "United Kingdom",
    work_experience: "Ten years of acute medicine experience.",
    nationality: "British",
    country_of_birth: "United Kingdom",
    country_of_residence: "United Kingdom",
    needs_visa_check: "on",
    visa_notes: "Right to study confirmed by employer.",
    funding_source: "nhs_trust",
    funding_organisation: "Example NHS Trust",
    funding_contact: "education@example.nhs.uk",
    support_needs_disclosed: "on",
    support_needs_detail: "Support detail is sensitive.",
    support_needs_adjustments: "Extra time for practical assessments.",
    pocus_previous_experience: "I use POCUS weekly.",
    pocus_motivation: "I want structured supervision.",
    pocus_case_improved_management: "POCUS changed fluid-management decisions.",
    pocus_limitations_case: "I escalated when views were inadequate.",
    evidence_summary: "CV and qualification evidence to follow.",
    ...overrides
  };

  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => formData.append(key, entry));
    } else {
      formData.append(key, value);
    }
  }

  return formData;
}

describe("application draft save", () => {
  it("normalizes expanded applicant draft form fields", () => {
    expect(parseApplicationDraftForm(draftForm())).toEqual({
      admission_lead_id: leadId,
      programme: "pgcert",
      intended_start_term_id: startTermId,
      selected_module_offering_ids: [cardiacOfferingId, lungOfferingId],
      title: "Dr",
      first_name: "Priya",
      middle_names: "A",
      last_name: "Shah",
      preferred_name: "Priya",
      previous_surname: null,
      date_of_birth: "1988-04-12",
      previous_study_detail: "No previous BETAR study",
      partner_student_id: "CCCU123",
      email: "priya.shah@example.nhs.uk",
      phone: "07123 456789",
      address_line_1: "1 Clinical Road",
      address_line_2: null,
      city: "London",
      postcode: "SE1 1AA",
      country: "United Kingdom",
      clinical_role: "Consultant",
      employer: "NHS Trust",
      department_specialty: "Acute medicine",
      professional_registration_body: "GMC",
      professional_registration_number: "1234567",
      highest_qualification: "MBBS",
      qualification_awarding_body: "Example University",
      qualification_year: 2016,
      qualification_result: "Pass",
      qualification_country: "United Kingdom",
      work_experience: "Ten years of acute medicine experience.",
      nationality: "British",
      country_of_birth: "United Kingdom",
      country_of_residence: "United Kingdom",
      needs_visa_check: true,
      visa_notes: "Right to study confirmed by employer.",
      funding_source: "nhs_trust",
      funding_organisation: "Example NHS Trust",
      funding_contact: "education@example.nhs.uk",
      support_needs_disclosed: true,
      support_needs_detail: "Support detail is sensitive.",
      support_needs_adjustments: "Extra time for practical assessments.",
      pocus_previous_experience: "I use POCUS weekly.",
      pocus_motivation: "I want structured supervision.",
      pocus_case_improved_management: "POCUS changed fluid-management decisions.",
      pocus_limitations_case: "I escalated when views were inadequate.",
      evidence_summary: "CV and qualification evidence to follow."
    });
  });

  it("keeps optional draft fields nullable while preserving programme and funding defaults", () => {
    expect(
      parseApplicationDraftForm(
        draftForm({
          programme: "",
          intended_start_term_id: "",
          selected_module_offering_ids: [],
          title: "",
          first_name: "",
          middle_names: "",
          last_name: "",
          preferred_name: "",
          date_of_birth: "",
          email: "",
          needs_visa_check: "",
          funding_source: "",
          support_needs_disclosed: "",
          support_needs_detail: "",
          support_needs_adjustments: "",
          pocus_previous_experience: "",
          pocus_motivation: "",
          pocus_case_improved_management: "",
          pocus_limitations_case: ""
        })
      )
    ).toMatchObject({
      programme: "pgcert",
      intended_start_term_id: null,
      selected_module_offering_ids: [],
      first_name: null,
      last_name: null,
      date_of_birth: null,
      email: null,
      needs_visa_check: false,
      funding_source: "unknown",
      support_needs_disclosed: false,
      support_needs_detail: null,
      support_needs_adjustments: null
    });
  });

  it("rejects invalid years, email addresses, dates, and oversized offering choices", () => {
    expect(() => parseApplicationDraftForm(draftForm({ qualification_year: "1899" }))).toThrow();
    expect(() => parseApplicationDraftForm(draftForm({ qualification_year: "not-a-year" }))).toThrow();
    expect(() => parseApplicationDraftForm(draftForm({ email: "not-an-email" }))).toThrow();
    expect(() => parseApplicationDraftForm(draftForm({ date_of_birth: "not-a-date" }))).toThrow();
    expect(() =>
      parseApplicationDraftForm(
        draftForm({
          selected_module_offering_ids: [cardiacOfferingId, lungOfferingId, inactiveOfferingId]
        })
      )
    ).toThrow();
  });

  it("requires an intended start term before parsing selected offerings", () => {
    expect(() =>
      parseApplicationDraftForm(
        draftForm({
          intended_start_term_id: "",
          selected_module_offering_ids: [cardiacOfferingId]
        })
      )
    ).toThrow();
  });

  it("validates selected offerings against future active module offerings for the chosen term", () => {
    const offerings = [
      {
        id: cardiacOfferingId,
        termId: startTermId,
        moduleActive: true,
        termStatus: "published" as const,
        termStartsOn: "2026-09-07"
      },
      {
        id: inactiveOfferingId,
        termId: startTermId,
        moduleActive: false,
        termStatus: "published" as const,
        termStartsOn: "2026-09-07"
      }
    ];

    expect(
      validateApplicationOfferingSelection({
        intendedStartTermId: startTermId,
        selectedOfferingIds: [cardiacOfferingId],
        offerings,
        today: "2026-07-23"
      })
    ).toEqual([]);

    expect(
      validateApplicationOfferingSelection({
        intendedStartTermId: startTermId,
        selectedOfferingIds: [inactiveOfferingId],
        offerings,
        today: "2026-07-23"
      })
    ).toEqual(["Selected module offerings must be active modules in published or active future terms."]);
  });

  it("rejects duplicate, cross-term, missing, and past selected offerings with executable validation", () => {
    const otherTermId = "77777777-7777-4777-8777-777777777777";
    const offerings = [
      {
        id: cardiacOfferingId,
        termId: startTermId,
        moduleActive: true,
        termStatus: "published" as const,
        termStartsOn: "2026-09-07"
      },
      {
        id: lungOfferingId,
        termId: otherTermId,
        moduleActive: true,
        termStatus: "published" as const,
        termStartsOn: "2026-09-07"
      },
      {
        id: inactiveOfferingId,
        termId: startTermId,
        moduleActive: true,
        termStatus: "active" as const,
        termStartsOn: "2026-01-05"
      }
    ];

    expect(
      validateApplicationOfferingSelection({
        intendedStartTermId: startTermId,
        selectedOfferingIds: [cardiacOfferingId, cardiacOfferingId],
        offerings,
        today: "2026-07-23"
      })
    ).toEqual(["Select each module offering only once."]);

    expect(
      validateApplicationOfferingSelection({
        intendedStartTermId: startTermId,
        selectedOfferingIds: [lungOfferingId],
        offerings,
        today: "2026-07-23"
      })
    ).toContain("Selected module offerings must match the intended start term.");

    expect(
      validateApplicationOfferingSelection({
        intendedStartTermId: startTermId,
        selectedOfferingIds: ["88888888-8888-4888-8888-888888888888"],
        offerings,
        today: "2026-07-23"
      })
    ).toEqual(["Selected module offerings must be available for applications."]);

    expect(
      validateApplicationOfferingSelection({
        intendedStartTermId: startTermId,
        selectedOfferingIds: [inactiveOfferingId],
        offerings,
        today: "2026-07-23"
      })
    ).toEqual(["Selected module offerings must be active modules in published or active future terms."]);
  });

  it("allows only the owning applicant to save an editable invited lead", () => {
    const lead = {
      personId: "person-1",
      stage: "application_invited",
      archived: false,
      convertedStudentId: null
    };

    expect(canSaveApplicationDraftForLead(applicant, lead)).toEqual({ allowed: true, reason: "allowed" });
    expect(canSaveApplicationDraftForLead(otherApplicant, lead)).toEqual({
      allowed: false,
      reason: "portal_person_mismatch"
    });
    expect(canSaveApplicationDraftForLead(student, lead)).toEqual({
      allowed: false,
      reason: "portal_actor_not_allowed"
    });
    expect(canSaveApplicationDraftForLead(admin, lead)).toEqual({
      allowed: false,
      reason: "staff_role_not_allowed"
    });
  });

  it("blocks draft save for archived, converted, non-invited, and submitted applications", () => {
    const lead = {
      personId: "person-1",
      stage: "application_invited",
      archived: false,
      convertedStudentId: null
    };

    expect(canSaveApplicationDraftForLead(applicant, { ...lead, archived: true })).toEqual({
      allowed: false,
      reason: "lead_archived_or_converted"
    });
    expect(canSaveApplicationDraftForLead(applicant, { ...lead, convertedStudentId: "student-1" })).toEqual({
      allowed: false,
      reason: "lead_archived_or_converted"
    });
    expect(canSaveApplicationDraftForLead(applicant, { ...lead, stage: "submitted" })).toEqual({
      allowed: false,
      reason: "lead_stage_not_editable"
    });
    expect(canSaveApplicationDraftForLead(applicant, lead, "submitted")).toEqual({
      allowed: false,
      reason: "application_not_draft"
    });
  });

  it("executes access rules for general application draft resources", () => {
    const row = { personId: "person-1" };

    expect(canReadApplicationDraftResource(admin, row)).toEqual({ allowed: true, reason: "allowed" });
    expect(canReadApplicationDraftResource(applicant, row)).toEqual({ allowed: true, reason: "allowed" });
    expect(canReadApplicationDraftResource(student, row)).toEqual({ allowed: true, reason: "allowed" });
    expect(canReadApplicationDraftResource(otherApplicant, row)).toEqual({
      allowed: false,
      reason: "portal_person_mismatch"
    });
    expect(canReadApplicationDraftResource(teacher, row)).toEqual({
      allowed: false,
      reason: "staff_role_not_allowed"
    });
    expect(canReadApplicationDraftResource(reception, row)).toEqual({
      allowed: false,
      reason: "staff_role_not_allowed"
    });

    expect(canWriteApplicationDraftResourceDirectly(admin, row)).toEqual({ allowed: true, reason: "allowed" });
    expect(canWriteApplicationDraftResourceDirectly(applicant, row)).toEqual({
      allowed: false,
      reason: "portal_actor_not_allowed"
    });
    expect(canWriteApplicationDraftResourceDirectly(teacher, row)).toEqual({
      allowed: false,
      reason: "staff_role_not_allowed"
    });
  });

  it("limits support-needs reads to admins and owning applicant identities only", () => {
    const row = { personId: "person-1" };

    expect(canReadApplicationSupportNeedsResource(admin, row)).toEqual({ allowed: true, reason: "allowed" });
    expect(canReadApplicationSupportNeedsResource(applicant, row)).toEqual({ allowed: true, reason: "allowed" });
    expect(canReadApplicationSupportNeedsResource(student, row)).toEqual({
      allowed: false,
      reason: "portal_actor_not_allowed"
    });
    expect(canReadApplicationSupportNeedsResource(otherApplicant, row)).toEqual({
      allowed: false,
      reason: "portal_person_mismatch"
    });
    expect(canReadApplicationSupportNeedsResource(teacher, row)).toEqual({
      allowed: false,
      reason: "staff_role_not_allowed"
    });
    expect(canReadApplicationSupportNeedsResource(reception, row)).toEqual({
      allowed: false,
      reason: "staff_role_not_allowed"
    });
  });

  it("builds draft-save audit metadata without application or support-needs content", () => {
    expect(
      buildApplicationDraftAuditMetadata({
        applicationId: "66666666-6666-4666-8666-666666666666",
        admissionLeadId: leadId,
        programme: "microcredential",
        intendedStartTermId: startTermId,
        selectedModuleOfferingIds: [cardiacOfferingId],
        workExperience: "Clinical detail",
        highestQualification: null,
        supportNeedsDisclosed: true,
        supportNeedsDetail: "Do not include this",
        pocusPreviousExperience: "Do not include this",
        pocusMotivation: null,
        pocusCaseImprovedManagement: "Do not include this",
        pocusLimitationsCase: null
      })
    ).toEqual({
      admission_lead_id: leadId,
      programme: "microcredential",
      intended_start_term_id: startTermId,
      selected_module_offering_count: 1,
      has_work_experience: true,
      has_qualification: false,
      support_needs_disclosed: true,
      has_support_needs_detail: true,
      has_pocus_previous_experience: true,
      has_pocus_motivation: false,
      has_pocus_case_improved_management: true,
      has_pocus_limitations_case: false
    });
  });

  it("keeps application choices as intended offerings without enrolment or finance side effects", () => {
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/0022_expanded_application_draft.sql"), "utf8");

    expect(migration).toContain("create table public.application_module_offering_choices");
    expect(migration).toContain("p_selected_module_offering_ids uuid[]");
    expect(migration).toContain("from public.module_offerings offering");
    expect(migration).toContain("term.starts_on >= current_date");
    expect(migration).toContain("course_module.active = true");
    expect(migration).toContain("term.status in ('published', 'active')");
    expect(migration).toContain("Applicants may select one or two module offerings");
    expect(migration).not.toContain("insert into public.enrolments");
    expect(migration).not.toContain("insert into public.finance_records");
    expect(migration).not.toContain("update public.module_offerings");
  });

  it("stores support needs separately with restricted access and redacted audit metadata", () => {
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/0022_expanded_application_draft.sql"), "utf8");

    expect(migration).toContain("create table public.application_support_needs");
    expect(migration).toContain("alter table public.application_support_needs enable row level security");
    expect(migration).toContain("admins manage application support needs");
    expect(migration).toContain("portal users read own application support needs");
    expect(migration).toContain("public.current_portal_actor_type() = 'applicant'");
    expect(migration).not.toContain("teachers");
    expect(migration).toContain("'has_support_needs_detail'");
    expect(migration).not.toContain("'support_needs_detail'");
  });

  it("retains the original draft-save foundation without document, review, or offer tables", () => {
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/0021_application_draft_save.sql"), "utf8");

    expect(migration).toContain("create table public.applications");
    expect(migration).toContain("status public.application_status not null default 'draft'");
    expect(migration).toContain("portal users read own applications");
    expect(migration).not.toContain("create table public.application_documents");
    expect(migration).not.toContain("create table public.application_reviews");
    expect(migration).not.toContain("create table public.offers");
    expect(migration).not.toContain("create table public.registrations");
    expect(applicationDraftSavedAction).toBe("application.draft_saved");
    expect(applicationDraftEntityType).toBe("application");
  });
});
