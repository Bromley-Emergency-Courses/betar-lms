import { z } from "zod";
import { buildAuditEventInsert, type JsonRecord } from "@/lib/audit-correspondence";

export const applicationDraftSavedAction = "application.draft_saved";
export const applicationDraftEntityType = "application";

const programmeValues = ["pgcert", "microcredential"] as const;

const nullableText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => (value.length > 0 ? value : null));

const nullableYear = z
  .string()
  .trim()
  .transform((value, context) => {
    if (!value) {
      return null;
    }

    const year = Number(value);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid qualification year."
      });
      return z.NEVER;
    }

    return year;
  });

export const applicationDraftSchema = z.object({
  admission_lead_id: z.string().uuid(),
  programme: z.enum(programmeValues).default("pgcert"),
  module_interest_ids: z.array(z.string().trim().min(1)).max(20),
  clinical_role: nullableText(160),
  employer: nullableText(160),
  professional_registration: nullableText(160),
  highest_qualification: nullableText(220),
  qualification_awarding_body: nullableText(220),
  qualification_year: nullableYear,
  work_experience: nullableText(4000),
  personal_statement: nullableText(4000)
});

export type ApplicationDraftPayload = z.infer<typeof applicationDraftSchema>;

export interface ApplicationDraftAuditInput {
  applicationId: string;
  admissionLeadId: string;
  programme: ApplicationDraftPayload["programme"];
  moduleInterestIds: string[];
  workExperience: string | null;
  highestQualification: string | null;
  personalStatement: string | null;
}

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export function parseApplicationDraftForm(formData: FormData): ApplicationDraftPayload {
  return applicationDraftSchema.parse({
    admission_lead_id: formString(formData, "admission_lead_id"),
    programme: formString(formData, "programme") || "pgcert",
    module_interest_ids: formData
      .getAll("module_interest_ids")
      .map((value) => String(value).trim())
      .filter(Boolean),
    clinical_role: formString(formData, "clinical_role"),
    employer: formString(formData, "employer"),
    professional_registration: formString(formData, "professional_registration"),
    highest_qualification: formString(formData, "highest_qualification"),
    qualification_awarding_body: formString(formData, "qualification_awarding_body"),
    qualification_year: formString(formData, "qualification_year"),
    work_experience: formString(formData, "work_experience"),
    personal_statement: formString(formData, "personal_statement")
  });
}

export function buildApplicationDraftAuditMetadata(input: ApplicationDraftAuditInput): JsonRecord {
  return buildAuditEventInsert({
    actor_type: "applicant",
    action: applicationDraftSavedAction,
    entity_type: applicationDraftEntityType,
    entity_id: input.applicationId,
    metadata: {
      admission_lead_id: input.admissionLeadId,
      programme: input.programme,
      module_interest_count: input.moduleInterestIds.length,
      has_work_experience: input.workExperience !== null,
      has_qualification: input.highestQualification !== null,
      has_statement: input.personalStatement !== null
    }
  }).metadata;
}
