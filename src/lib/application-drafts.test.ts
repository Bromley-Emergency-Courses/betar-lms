import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applicationDraftEntityType,
  applicationDraftSavedAction,
  buildApplicationDraftAuditMetadata,
  parseApplicationDraftForm
} from "@/lib/application-drafts";

const leadId = "11111111-1111-4111-8111-111111111111";
const cardiacModuleId = "22222222-2222-4222-8222-222222222222";
const lungModuleId = "33333333-3333-4333-8333-333333333333";

function draftForm(overrides: Record<string, string | string[]> = {}): FormData {
  const formData = new FormData();
  const values: Record<string, string | string[]> = {
    admission_lead_id: leadId,
    programme: "pgcert",
    module_interest_ids: [cardiacModuleId, lungModuleId],
    clinical_role: " Consultant ",
    employer: " NHS Trust ",
    professional_registration: " GMC 1234567 ",
    highest_qualification: " MBBS ",
    qualification_awarding_body: " Example University ",
    qualification_year: "2016",
    work_experience: "Ten years of acute medicine experience.",
    personal_statement: "I want to develop safer POCUS practice.",
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
  it("normalizes applicant draft form fields", () => {
    expect(parseApplicationDraftForm(draftForm())).toEqual({
      admission_lead_id: leadId,
      programme: "pgcert",
      module_interest_ids: [cardiacModuleId, lungModuleId],
      clinical_role: "Consultant",
      employer: "NHS Trust",
      professional_registration: "GMC 1234567",
      highest_qualification: "MBBS",
      qualification_awarding_body: "Example University",
      qualification_year: 2016,
      work_experience: "Ten years of acute medicine experience.",
      personal_statement: "I want to develop safer POCUS practice."
    });
  });

  it("keeps optional draft fields nullable while preserving programme defaults", () => {
    expect(
      parseApplicationDraftForm(
        draftForm({
          programme: "",
          module_interest_ids: [],
          clinical_role: "",
          employer: "",
          professional_registration: "",
          highest_qualification: "",
          qualification_awarding_body: "",
          qualification_year: "",
          work_experience: "",
          personal_statement: ""
        })
      )
    ).toMatchObject({
      programme: "pgcert",
      module_interest_ids: [],
      clinical_role: null,
      employer: null,
      professional_registration: null,
      highest_qualification: null,
      qualification_awarding_body: null,
      qualification_year: null,
      work_experience: null,
      personal_statement: null
    });
  });

  it("rejects invalid draft qualification years", () => {
    expect(() => parseApplicationDraftForm(draftForm({ qualification_year: "1899" }))).toThrow();
    expect(() => parseApplicationDraftForm(draftForm({ qualification_year: "not-a-year" }))).toThrow();
  });

  it("builds draft-save audit metadata without application content", () => {
    expect(
      buildApplicationDraftAuditMetadata({
        applicationId: "44444444-4444-4444-8444-444444444444",
        admissionLeadId: leadId,
        programme: "microcredential",
        moduleInterestIds: [cardiacModuleId],
        workExperience: "Clinical detail",
        highestQualification: null,
        personalStatement: "Statement detail"
      })
    ).toEqual({
      admission_lead_id: leadId,
      programme: "microcredential",
      module_interest_count: 1,
      has_work_experience: true,
      has_qualification: false,
      has_statement: true
    });
  });

  it("adds only authenticated draft-save persistence for this slice", () => {
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/0021_application_draft_save.sql"), "utf8");

    expect(migration).toContain("create table public.applications");
    expect(migration).toContain("status public.application_status not null default 'draft'");
    expect(migration).toContain("create or replace function public.save_application_draft");
    expect(migration).toContain("v_actor_type <> 'applicant'");
    expect(migration).toContain("where id = p_admission_lead_id");
    expect(migration).toContain("and person_id = v_person_id");
    expect(migration).toContain("if v_lead.stage <> 'application_invited' then");
    expect(migration).toContain(`'${applicationDraftSavedAction}'`);
    expect(migration).toContain(`'${applicationDraftEntityType}'`);
    expect(migration).toContain("portal users read own applications");
    expect(migration).toContain("portal users read active modules for applications");
    expect(migration).toContain("grant execute on function public.save_application_draft");
    expect(migration).not.toContain("create table public.application_documents");
    expect(migration).not.toContain("create table public.application_reviews");
    expect(migration).not.toContain("create table public.offers");
    expect(migration).not.toContain("create table public.registrations");
  });
});
