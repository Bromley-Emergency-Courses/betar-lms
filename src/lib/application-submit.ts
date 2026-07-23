import { createHash } from "node:crypto";
import { z } from "zod";
import { buildAuditEventInsert, type JsonRecord } from "@/lib/audit-correspondence";
import type { ApplicationDraftPayload } from "@/lib/application-drafts";

export const applicationSubmittedAction = "application.submitted";
export const applicationSubmitEntityType = "application";
export const applicationDeclarationVersion = "application-declaration-2026-07-23-v1";
export const applicationDeclarationText =
  "I declare that the information I have submitted is truthful, complete, and accurate; that I have not omitted requested or material information; that I understand this application cannot be changed after submission except by staff reopening it; and that my personal data will be handled under the relevant privacy notice.";

export const applicationDeclarationTextHash = createHash("sha256").update(applicationDeclarationText).digest("hex");

const submitApplicationSchema = z
  .object({
    application_id: z.string().uuid(),
    declaration_accepted: z.boolean()
  })
  .superRefine((payload, context) => {
    if (!payload.declaration_accepted) {
      context.addIssue({
        code: "custom",
        path: ["declaration_accepted"],
        message: "Declaration acceptance is required before submission."
      });
    }
  });

export type SubmitApplicationPayload = z.infer<typeof submitApplicationSchema>;

export interface ApplicationSubmitRequiredFieldsInput {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  clinicalRole: string | null;
  employer: string | null;
  departmentSpecialty: string | null;
  professionalRegistrationBody: string | null;
  professionalRegistrationNumber: string | null;
  workExperience: string | null;
  highestQualification: string | null;
  qualificationAwardingBody: string | null;
  qualificationYear: number | null;
  intendedStartTermId: string | null;
  selectedModuleOfferingIds: string[];
  nationality: string | null;
  countryOfResidence: string | null;
  pocusPreviousExperience: string | null;
  pocusMotivation: string | null;
  pocusCaseImprovedManagement: string | null;
  pocusLimitationsCase: string | null;
}

export interface ApplicationSubmittedAuditInput {
  applicationId: string;
  admissionLeadId: string;
  programme: "pgcert" | "microcredential";
  intendedStartTermId: string;
  selectedModuleOfferingCount: number;
}

export type ApplicationSubmitSavedDraftSnapshot = ApplicationDraftPayload;

function formBoolean(formData: FormData, key: string): boolean {
  const value = String(formData.get(key) ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function isPresent(value: string | number | null | undefined): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  return typeof value === "string" && value.trim().length > 0;
}

export function parseSubmitApplicationForm(formData: FormData): SubmitApplicationPayload {
  return submitApplicationSchema.parse({
    application_id: String(formData.get("application_id") ?? ""),
    declaration_accepted: formBoolean(formData, "declaration_accepted")
  });
}

export function getClientIpAddress(headers: Pick<Headers, "get">): string | null {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headers.get("x-real-ip")?.trim();
  return forwardedFor || realIp || null;
}

export function validateApplicationSubmitRequiredFields(input: ApplicationSubmitRequiredFieldsInput): string[] {
  const requiredFields: Array<[keyof ApplicationSubmitRequiredFieldsInput, string]> = [
    ["firstName", "first_name"],
    ["lastName", "last_name"],
    ["dateOfBirth", "date_of_birth"],
    ["email", "email"],
    ["phone", "phone"],
    ["addressLine1", "address_line_1"],
    ["city", "city"],
    ["postcode", "postcode"],
    ["country", "country"],
    ["clinicalRole", "clinical_role"],
    ["employer", "employer"],
    ["departmentSpecialty", "department_specialty"],
    ["professionalRegistrationBody", "professional_registration_body"],
    ["professionalRegistrationNumber", "professional_registration_number"],
    ["workExperience", "work_experience"],
    ["highestQualification", "highest_qualification"],
    ["qualificationAwardingBody", "qualification_awarding_body"],
    ["qualificationYear", "qualification_year"],
    ["intendedStartTermId", "intended_start_term_id"],
    ["nationality", "nationality"],
    ["countryOfResidence", "country_of_residence"],
    ["pocusPreviousExperience", "pocus_previous_experience"],
    ["pocusMotivation", "pocus_motivation"],
    ["pocusCaseImprovedManagement", "pocus_case_improved_management"],
    ["pocusLimitationsCase", "pocus_limitations_case"]
  ];

  const missingFields = requiredFields
    .filter(([key]) => !isPresent(input[key] as string | number | null | undefined))
    .map(([, fieldName]) => fieldName);

  if (input.selectedModuleOfferingIds.length < 1 || input.selectedModuleOfferingIds.length > 2) {
    missingFields.push("selected_module_offerings");
  }

  if (input.email !== null && !z.string().email().safeParse(input.email).success) {
    missingFields.push("email");
  }

  return [...new Set(missingFields)];
}

export function findUnsavedApplicationDraftChanges(
  current: ApplicationDraftPayload,
  saved: ApplicationSubmitSavedDraftSnapshot
): string[] {
  const changedFields: string[] = [];
  const scalarFields: Array<keyof Omit<ApplicationDraftPayload, "selected_module_offering_ids">> = [
    "admission_lead_id",
    "programme",
    "intended_start_term_id",
    "title",
    "first_name",
    "middle_names",
    "last_name",
    "preferred_name",
    "previous_surname",
    "date_of_birth",
    "previous_study_detail",
    "partner_student_id",
    "email",
    "phone",
    "address_line_1",
    "address_line_2",
    "city",
    "postcode",
    "country",
    "clinical_role",
    "employer",
    "department_specialty",
    "professional_registration_body",
    "professional_registration_number",
    "highest_qualification",
    "qualification_awarding_body",
    "qualification_year",
    "qualification_result",
    "qualification_country",
    "work_experience",
    "nationality",
    "country_of_birth",
    "country_of_residence",
    "needs_visa_check",
    "visa_notes",
    "funding_source",
    "funding_organisation",
    "funding_contact",
    "support_needs_disclosed",
    "support_needs_detail",
    "support_needs_adjustments",
    "pocus_previous_experience",
    "pocus_motivation",
    "pocus_case_improved_management",
    "pocus_limitations_case",
    "evidence_summary"
  ];

  for (const field of scalarFields) {
    if (current[field] !== saved[field]) {
      changedFields.push(field);
    }
  }

  if (
    current.selected_module_offering_ids.length !== saved.selected_module_offering_ids.length ||
    current.selected_module_offering_ids.some((offeringId, index) => offeringId !== saved.selected_module_offering_ids[index])
  ) {
    changedFields.push("selected_module_offering_ids");
  }

  return changedFields;
}

export function buildApplicationSubmittedAuditMetadata(input: ApplicationSubmittedAuditInput): JsonRecord {
  return buildAuditEventInsert({
    actor_type: "applicant",
    action: applicationSubmittedAction,
    entity_type: applicationSubmitEntityType,
    entity_id: input.applicationId,
    metadata: {
      admission_lead_id: input.admissionLeadId,
      programme: input.programme,
      intended_start_term_id: input.intendedStartTermId,
      selected_module_offering_count: input.selectedModuleOfferingCount,
      declaration_version: applicationDeclarationVersion,
      declaration_text_hash: applicationDeclarationTextHash
    }
  }).metadata;
}
