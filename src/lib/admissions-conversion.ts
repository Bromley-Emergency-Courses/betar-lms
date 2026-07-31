import { z } from "zod";
import { buildAuditEventInsert, type JsonRecord } from "@/lib/audit-correspondence";

export const admissionsRegistrationConvertedAction = "registration.converted_to_student";
export const admissionsConversionRequestEntityType = "admissions_conversion_request";
export const admissionsRegistrationCompleteStatus = "complete";

export interface StaffRegistrationConversionAccessRow {
  registrationStatus?: string | null;
  requiredDocumentCount: number;
  uploadedRequiredDocumentCount: number;
  moduleConfirmationAccepted: boolean;
  termsAcceptedAt?: string | null;
  convertedStudentId?: string | null;
  leadStage: string;
}

export interface StaffRegistrationConversionAccessDecision {
  allowed: boolean;
  reason:
    | "allowed"
    | "already_converted"
    | "registration_not_submitted"
    | "required_documents_missing"
    | "modules_not_confirmed"
    | "terms_not_accepted"
    | "lead_not_convertible";
}

export interface RegistrationConversionAuditInput {
  conversionRequestId: string;
  registrationId: string;
  applicationId: string;
  admissionLeadId: string;
  offerId: string;
  personId: string;
  studentId: string;
  initialModuleOfferingIds: string[];
}

const idSchema = z.string().uuid();

const conversionFormSchema = z.object({
  registration_id: idSchema,
  application_id: idSchema
});

export type ConvertSubmittedAdmissionsRegistrationPayload = z.infer<typeof conversionFormSchema>;

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export function parseConvertSubmittedAdmissionsRegistrationForm(
  formData: FormData
): ConvertSubmittedAdmissionsRegistrationPayload {
  return conversionFormSchema.parse({
    registration_id: formString(formData, "registration_id"),
    application_id: formString(formData, "application_id")
  });
}

export function canConvertSubmittedRegistration(
  row: StaffRegistrationConversionAccessRow
): StaffRegistrationConversionAccessDecision {
  if (row.convertedStudentId || row.registrationStatus === admissionsRegistrationCompleteStatus) {
    return { allowed: false, reason: "already_converted" };
  }

  if (row.registrationStatus !== "submitted") {
    return { allowed: false, reason: "registration_not_submitted" };
  }

  if (!["accepted", "registration_in_progress"].includes(row.leadStage)) {
    return { allowed: false, reason: "lead_not_convertible" };
  }

  if (!row.moduleConfirmationAccepted) {
    return { allowed: false, reason: "modules_not_confirmed" };
  }

  if (!row.termsAcceptedAt) {
    return { allowed: false, reason: "terms_not_accepted" };
  }

  if (row.uploadedRequiredDocumentCount < row.requiredDocumentCount || row.requiredDocumentCount === 0) {
    return { allowed: false, reason: "required_documents_missing" };
  }

  return { allowed: true, reason: "allowed" };
}

export function buildRegistrationConversionAuditMetadata(input: RegistrationConversionAuditInput): JsonRecord {
  return buildAuditEventInsert({
    actor_type: "staff",
    action: admissionsRegistrationConvertedAction,
    entity_type: admissionsConversionRequestEntityType,
    entity_id: input.conversionRequestId,
    metadata: {
      registration_id: input.registrationId,
      application_id: input.applicationId,
      admission_lead_id: input.admissionLeadId,
      offer_id: input.offerId,
      person_id: input.personId,
      student_id: input.studentId,
      initial_module_offering_ids: input.initialModuleOfferingIds,
      finance_generation_enabled: false
    }
  }).metadata;
}
