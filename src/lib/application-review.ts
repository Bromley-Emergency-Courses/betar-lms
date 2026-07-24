import { z } from "zod";
import { buildAuditEventInsert, type JsonRecord } from "@/lib/audit-correspondence";
import { applicationDocumentSlotKeys } from "@/lib/application-documents";

export const applicationReviewRecordedAction = "application.review_recorded";
export const applicationReviewEntityType = "application";
export const applicationDocumentVerifiedAction = "document.verified";
export const applicationDocumentRejectedAction = "document.rejected";
export const applicationDocumentVerificationResetAction = "document.verification_reset";
export const applicationSupportNeedsViewedAction = "application_support_needs.viewed";

export const applicationReviewReadinessStatuses = ["not_ready", "needs_information", "ready_for_decision"] as const;

export type ApplicationReviewReadinessStatus = (typeof applicationReviewReadinessStatuses)[number];

export interface StaffApplicationReviewAccessActor {
  role: "admin" | "teacher" | "reception";
}

export interface StaffApplicationReviewAccessDecision {
  allowed: boolean;
  reason: "allowed" | "staff_role_not_allowed" | "application_not_submitted" | "lead_not_reviewable";
}

export interface StaffApplicationReviewAccessRow {
  applicationStatus: "draft" | "submitted";
  leadStage: string;
  archived: boolean;
  convertedStudentId?: string | null;
}

export interface StaffApplicationReviewAuditInput {
  applicationId: string;
  admissionLeadId: string;
  personId: string;
  previousReadinessStatus?: ApplicationReviewReadinessStatus | null;
  readinessStatus: ApplicationReviewReadinessStatus;
  reviewNotes?: string | null;
  decisionReasonNotes?: string | null;
  requiredDocumentCount: number;
  verifiedRequiredDocumentCount: number;
}

export interface ApplicationDocumentVerificationAuditInput {
  slotId: string;
  applicationId: string;
  admissionLeadId: string;
  personId: string;
  slotKey: string;
  required: boolean;
  previousStatus: "unverified" | "verified" | "rejected";
  verificationStatus: "unverified" | "verified" | "rejected";
  managedFileId: string;
  verificationNote?: string | null;
}

export interface ApplicationSupportNeedsViewedAuditInput {
  applicationId: string;
  admissionLeadId: string;
  personId: string;
  disclosed: boolean;
  supportDetail?: string | null;
  requestedAdjustments?: string | null;
}

const idSchema = z.string().uuid();

const verificationFormSchema = z.object({
  slot_id: idSchema,
  application_id: idSchema,
  verification_status: z.enum(["unverified", "verified", "rejected"]),
  verification_note: z
    .string()
    .trim()
    .max(2000)
    .transform((value) => (value.length > 0 ? value : null))
});

const reviewFormSchema = z.object({
  application_id: idSchema,
  readiness_status: z.enum(applicationReviewReadinessStatuses),
  review_notes: z
    .string()
    .trim()
    .max(6000)
    .transform((value) => (value.length > 0 ? value : null)),
  decision_reason_notes: z
    .string()
    .trim()
    .max(4000)
    .transform((value) => (value.length > 0 ? value : null))
});

export type VerifyApplicationDocumentPayload = z.infer<typeof verificationFormSchema>;
export type RecordStaffApplicationReviewPayload = z.infer<typeof reviewFormSchema>;

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export function parseVerifyApplicationDocumentForm(formData: FormData): VerifyApplicationDocumentPayload {
  return verificationFormSchema.parse({
    slot_id: formString(formData, "slot_id"),
    application_id: formString(formData, "application_id"),
    verification_status: formString(formData, "verification_status"),
    verification_note: formString(formData, "verification_note")
  });
}

export function parseRecordStaffApplicationReviewForm(formData: FormData): RecordStaffApplicationReviewPayload {
  return reviewFormSchema.parse({
    application_id: formString(formData, "application_id"),
    readiness_status: formString(formData, "readiness_status"),
    review_notes: formString(formData, "review_notes"),
    decision_reason_notes: formString(formData, "decision_reason_notes")
  });
}

export function canReviewSubmittedApplication(
  actor: StaffApplicationReviewAccessActor,
  row: StaffApplicationReviewAccessRow
): StaffApplicationReviewAccessDecision {
  if (actor.role !== "admin") {
    return { allowed: false, reason: "staff_role_not_allowed" };
  }

  if (row.applicationStatus !== "submitted") {
    return { allowed: false, reason: "application_not_submitted" };
  }

  if (row.archived || row.convertedStudentId || !["submitted", "reviewed"].includes(row.leadStage)) {
    return { allowed: false, reason: "lead_not_reviewable" };
  }

  return { allowed: true, reason: "allowed" };
}

export function buildStaffApplicationReviewAuditMetadata(input: StaffApplicationReviewAuditInput): JsonRecord {
  return buildAuditEventInsert({
    actor_type: "staff",
    action: applicationReviewRecordedAction,
    entity_type: applicationReviewEntityType,
    entity_id: input.applicationId,
    metadata: {
      admission_lead_id: input.admissionLeadId,
      person_id: input.personId,
      previous_readiness_status: input.previousReadinessStatus ?? null,
      readiness_status: input.readinessStatus,
      has_review_notes: Boolean(input.reviewNotes),
      has_decision_reason_notes: Boolean(input.decisionReasonNotes),
      required_document_count: input.requiredDocumentCount,
      verified_required_document_count: input.verifiedRequiredDocumentCount
    }
  }).metadata;
}

export function buildApplicationDocumentVerificationAuditMetadata(input: ApplicationDocumentVerificationAuditInput): JsonRecord {
  return buildAuditEventInsert({
    actor_type: "staff",
    action:
      input.verificationStatus === "verified"
        ? applicationDocumentVerifiedAction
        : input.verificationStatus === "rejected"
          ? applicationDocumentRejectedAction
          : applicationDocumentVerificationResetAction,
    entity_type: "application_document",
    entity_id: input.slotId,
    metadata: {
      application_id: input.applicationId,
      admission_lead_id: input.admissionLeadId,
      person_id: input.personId,
      slot_key: input.slotKey,
      required: input.required,
      previous_status: input.previousStatus,
      verification_status: input.verificationStatus,
      managed_file_id: input.managedFileId,
      has_note: Boolean(input.verificationNote)
    }
  }).metadata;
}

export function buildApplicationSupportNeedsViewedAuditMetadata(input: ApplicationSupportNeedsViewedAuditInput): JsonRecord {
  return buildAuditEventInsert({
    actor_type: "staff",
    action: applicationSupportNeedsViewedAction,
    entity_type: "application_support_needs",
    entity_id: input.applicationId,
    metadata: {
      application_id: input.applicationId,
      admission_lead_id: input.admissionLeadId,
      person_id: input.personId,
      disclosed: input.disclosed,
      has_support_detail: Boolean(input.supportDetail),
      has_requested_adjustments: Boolean(input.requestedAdjustments)
    }
  }).metadata;
}

export function isKnownApplicationDocumentSlotKey(value: string): boolean {
  return (applicationDocumentSlotKeys as readonly string[]).includes(value);
}
