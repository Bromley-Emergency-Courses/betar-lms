import { z } from "zod";
import { buildAuditEventInsert, type JsonRecord } from "@/lib/audit-correspondence";

export const applicationDraftSavedAction = "application.draft_saved";
export const applicationDraftEntityType = "application";

const programmeValues = ["pgcert", "microcredential"] as const;
const fundingSourceValues = ["self_funded", "employer_sponsor", "nhs_trust", "other", "unknown"] as const;

const nullableText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => (value.length > 0 ? value : null));

const nullableUuid = z
  .string()
  .trim()
  .transform((value, context) => {
    if (!value) {
      return null;
    }

    const parsed = z.string().uuid().safeParse(value);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: "Select a valid option."
      });
      return z.NEVER;
    }

    return parsed.data;
  });

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

const selectedOfferingIdsSchema = z
  .array(z.string().trim().uuid())
  .max(2, "Select no more than two module offerings.")
  .superRefine((offeringIds, context) => {
    if (new Set(offeringIds).size !== offeringIds.length) {
      context.addIssue({
        code: "custom",
        message: "Select each module offering only once."
      });
    }
  });

const optionalDate = z
  .string()
  .trim()
  .transform((value, context) => {
    if (!value) {
      return null;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid date."
      });
      return z.NEVER;
    }

    return value;
  });

const nullableEmail = z
  .string()
  .trim()
  .transform((value, context) => {
    if (!value) {
      return null;
    }

    const parsed = z.string().email().safeParse(value);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid email address."
      });
      return z.NEVER;
    }

    return parsed.data.toLowerCase();
  });

export const applicationDraftSchema = z.object({
  admission_lead_id: z.string().uuid(),
  programme: z.enum(programmeValues).default("pgcert"),
  intended_start_term_id: nullableUuid,
  selected_module_offering_ids: selectedOfferingIdsSchema,
  title: nullableText(40),
  first_name: nullableText(120),
  middle_names: nullableText(160),
  last_name: nullableText(120),
  preferred_name: nullableText(120),
  previous_surname: nullableText(120),
  date_of_birth: optionalDate,
  previous_study_detail: nullableText(500),
  partner_student_id: nullableText(80),
  email: nullableEmail,
  phone: nullableText(80),
  address_line_1: nullableText(180),
  address_line_2: nullableText(180),
  city: nullableText(120),
  postcode: nullableText(40),
  country: nullableText(120),
  clinical_role: nullableText(160),
  employer: nullableText(160),
  department_specialty: nullableText(160),
  professional_registration_body: nullableText(120),
  professional_registration_number: nullableText(120),
  highest_qualification: nullableText(220),
  qualification_awarding_body: nullableText(220),
  qualification_year: nullableYear,
  qualification_result: nullableText(120),
  qualification_country: nullableText(120),
  work_experience: nullableText(4000),
  nationality: nullableText(120),
  country_of_birth: nullableText(120),
  country_of_residence: nullableText(120),
  needs_visa_check: z.boolean(),
  visa_notes: nullableText(1000),
  funding_source: z.enum(fundingSourceValues).default("unknown"),
  funding_organisation: nullableText(180),
  funding_contact: nullableText(220),
  support_needs_disclosed: z.boolean(),
  support_needs_detail: nullableText(3000),
  support_needs_adjustments: nullableText(2000),
  pocus_previous_experience: nullableText(4000),
  pocus_motivation: nullableText(4000),
  pocus_case_improved_management: nullableText(4000),
  pocus_limitations_case: nullableText(4000),
  evidence_summary: nullableText(2000)
}).superRefine((payload, context) => {
  if (payload.selected_module_offering_ids.length > 0 && payload.intended_start_term_id === null) {
    context.addIssue({
      code: "custom",
      path: ["intended_start_term_id"],
      message: "Choose an intended start term before selecting module offerings."
    });
  }
});

export type ApplicationDraftPayload = z.infer<typeof applicationDraftSchema>;

export type ApplicationDraftStaffRole = "admin" | "teacher" | "reception";
export type ApplicationDraftPortalActorType = "applicant" | "student";

export type ApplicationDraftAccessActor =
  | {
      kind: "staff";
      role: ApplicationDraftStaffRole;
    }
  | {
      kind: "portal";
      actorType: ApplicationDraftPortalActorType;
      personId: string;
    };

export interface ApplicationDraftOwnedRow {
  personId: string;
}

export interface ApplicationDraftLeadAccessRow {
  personId: string | null;
  stage: string;
  archived: boolean;
  convertedStudentId?: string | null;
}

export type ApplicationDraftAccessReason =
  | "allowed"
  | "staff_role_not_allowed"
  | "portal_actor_not_allowed"
  | "portal_person_mismatch"
  | "lead_archived_or_converted"
  | "lead_stage_not_editable"
  | "application_not_draft";

export interface ApplicationOfferingValidationInput {
  intendedStartTermId: string | null;
  selectedOfferingIds: string[];
  offerings: {
    id: string;
    termId: string;
    moduleActive: boolean;
    termStatus: "draft" | "published" | "active" | "closed";
    termStartsOn: string;
  }[];
  today: string;
}

export interface ApplicationDraftAuditInput {
  applicationId: string;
  admissionLeadId: string;
  programme: ApplicationDraftPayload["programme"];
  intendedStartTermId: string | null;
  selectedModuleOfferingIds: string[];
  workExperience: string | null;
  highestQualification: string | null;
  supportNeedsDisclosed: boolean;
  supportNeedsDetail: string | null;
  pocusPreviousExperience: string | null;
  pocusMotivation: string | null;
  pocusCaseImprovedManagement: string | null;
  pocusLimitationsCase: string | null;
}

export interface ApplicationDraftAccessDecision {
  allowed: boolean;
  reason: ApplicationDraftAccessReason;
}

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function formBoolean(formData: FormData, key: string): boolean {
  const value = String(formData.get(key) ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

export function parseApplicationDraftForm(formData: FormData): ApplicationDraftPayload {
  return applicationDraftSchema.parse({
    admission_lead_id: formString(formData, "admission_lead_id"),
    programme: formString(formData, "programme") || "pgcert",
    intended_start_term_id: formString(formData, "intended_start_term_id"),
    selected_module_offering_ids: formData
      .getAll("selected_module_offering_ids")
      .map((value) => String(value).trim())
      .filter(Boolean),
    title: formString(formData, "title"),
    first_name: formString(formData, "first_name"),
    middle_names: formString(formData, "middle_names"),
    last_name: formString(formData, "last_name"),
    preferred_name: formString(formData, "preferred_name"),
    previous_surname: formString(formData, "previous_surname"),
    date_of_birth: formString(formData, "date_of_birth"),
    previous_study_detail: formString(formData, "previous_study_detail"),
    partner_student_id: formString(formData, "partner_student_id"),
    email: formString(formData, "email"),
    phone: formString(formData, "phone"),
    address_line_1: formString(formData, "address_line_1"),
    address_line_2: formString(formData, "address_line_2"),
    city: formString(formData, "city"),
    postcode: formString(formData, "postcode"),
    country: formString(formData, "country"),
    clinical_role: formString(formData, "clinical_role"),
    employer: formString(formData, "employer"),
    department_specialty: formString(formData, "department_specialty"),
    professional_registration_body: formString(formData, "professional_registration_body"),
    professional_registration_number: formString(formData, "professional_registration_number"),
    highest_qualification: formString(formData, "highest_qualification"),
    qualification_awarding_body: formString(formData, "qualification_awarding_body"),
    qualification_year: formString(formData, "qualification_year"),
    qualification_result: formString(formData, "qualification_result"),
    qualification_country: formString(formData, "qualification_country"),
    work_experience: formString(formData, "work_experience"),
    nationality: formString(formData, "nationality"),
    country_of_birth: formString(formData, "country_of_birth"),
    country_of_residence: formString(formData, "country_of_residence"),
    needs_visa_check: formBoolean(formData, "needs_visa_check"),
    visa_notes: formString(formData, "visa_notes"),
    funding_source: formString(formData, "funding_source") || "unknown",
    funding_organisation: formString(formData, "funding_organisation"),
    funding_contact: formString(formData, "funding_contact"),
    support_needs_disclosed: formBoolean(formData, "support_needs_disclosed"),
    support_needs_detail: formString(formData, "support_needs_detail"),
    support_needs_adjustments: formString(formData, "support_needs_adjustments"),
    pocus_previous_experience: formString(formData, "pocus_previous_experience"),
    pocus_motivation: formString(formData, "pocus_motivation"),
    pocus_case_improved_management: formString(formData, "pocus_case_improved_management"),
    pocus_limitations_case: formString(formData, "pocus_limitations_case"),
    evidence_summary: formString(formData, "evidence_summary")
  });
}

export function validateApplicationOfferingSelection(input: ApplicationOfferingValidationInput): string[] {
  const errors: string[] = [];
  const selectedOfferingIds = input.selectedOfferingIds.filter(Boolean);

  if (selectedOfferingIds.length > 2) {
    errors.push("Select no more than two module offerings.");
  }

  if (new Set(selectedOfferingIds).size !== selectedOfferingIds.length) {
    errors.push("Select each module offering only once.");
  }

  if (selectedOfferingIds.length > 0 && input.intendedStartTermId === null) {
    errors.push("Choose an intended start term before selecting module offerings.");
  }

  const offeringById = new Map(input.offerings.map((offering) => [offering.id, offering]));

  for (const offeringId of selectedOfferingIds) {
    const offering = offeringById.get(offeringId);
    if (!offering) {
      errors.push("Selected module offerings must be available for applications.");
      continue;
    }

    if (offering.termId !== input.intendedStartTermId) {
      errors.push("Selected module offerings must match the intended start term.");
    }

    if (!offering.moduleActive || !["published", "active"].includes(offering.termStatus) || offering.termStartsOn < input.today) {
      errors.push("Selected module offerings must be active modules in published or active future terms.");
    }
  }

  return [...new Set(errors)];
}

export function canReadApplicationDraftResource(
  actor: ApplicationDraftAccessActor,
  row: ApplicationDraftOwnedRow
): ApplicationDraftAccessDecision {
  if (actor.kind === "staff") {
    return actor.role === "admin"
      ? { allowed: true, reason: "allowed" }
      : { allowed: false, reason: "staff_role_not_allowed" };
  }

  if (actor.personId !== row.personId) {
    return { allowed: false, reason: "portal_person_mismatch" };
  }

  return { allowed: true, reason: "allowed" };
}

export function canReadApplicationSupportNeedsResource(
  actor: ApplicationDraftAccessActor,
  row: ApplicationDraftOwnedRow
): ApplicationDraftAccessDecision {
  if (actor.kind === "staff") {
    return actor.role === "admin"
      ? { allowed: true, reason: "allowed" }
      : { allowed: false, reason: "staff_role_not_allowed" };
  }

  if (actor.actorType !== "applicant") {
    return { allowed: false, reason: "portal_actor_not_allowed" };
  }

  if (actor.personId !== row.personId) {
    return { allowed: false, reason: "portal_person_mismatch" };
  }

  return { allowed: true, reason: "allowed" };
}

export function canWriteApplicationDraftResourceDirectly(
  actor: ApplicationDraftAccessActor,
  row: ApplicationDraftOwnedRow
): ApplicationDraftAccessDecision {
  if (actor.kind === "staff") {
    return actor.role === "admin"
      ? { allowed: true, reason: "allowed" }
      : { allowed: false, reason: "staff_role_not_allowed" };
  }

  if (actor.personId !== row.personId) {
    return { allowed: false, reason: "portal_person_mismatch" };
  }

  return { allowed: false, reason: "portal_actor_not_allowed" };
}

export function canSaveApplicationDraftForLead(
  actor: ApplicationDraftAccessActor,
  lead: ApplicationDraftLeadAccessRow,
  existingApplicationStatus: "draft" | "submitted" | null = null
): ApplicationDraftAccessDecision {
  if (actor.kind !== "portal" || actor.actorType !== "applicant") {
    return { allowed: false, reason: actor.kind === "staff" ? "staff_role_not_allowed" : "portal_actor_not_allowed" };
  }

  if (lead.personId !== actor.personId) {
    return { allowed: false, reason: "portal_person_mismatch" };
  }

  if (lead.archived || lead.convertedStudentId) {
    return { allowed: false, reason: "lead_archived_or_converted" };
  }

  if (lead.stage !== "application_invited") {
    return { allowed: false, reason: "lead_stage_not_editable" };
  }

  if (existingApplicationStatus !== null && existingApplicationStatus !== "draft") {
    return { allowed: false, reason: "application_not_draft" };
  }

  return { allowed: true, reason: "allowed" };
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
      intended_start_term_id: input.intendedStartTermId,
      selected_module_offering_count: input.selectedModuleOfferingIds.length,
      has_work_experience: input.workExperience !== null,
      has_qualification: input.highestQualification !== null,
      support_needs_disclosed: input.supportNeedsDisclosed,
      has_support_needs_detail: input.supportNeedsDetail !== null,
      has_pocus_previous_experience: input.pocusPreviousExperience !== null,
      has_pocus_motivation: input.pocusMotivation !== null,
      has_pocus_case_improved_management: input.pocusCaseImprovedManagement !== null,
      has_pocus_limitations_case: input.pocusLimitationsCase !== null
    }
  }).metadata;
}
