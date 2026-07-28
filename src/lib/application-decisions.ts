import { z } from "zod";
import { buildAuditEventInsert, type JsonRecord } from "@/lib/audit-correspondence";
import type { AdmissionLeadStage } from "@/lib/types";

export const applicationDecisionOutcomes = ["offer", "rejection"] as const;
export const applicationDecisionOfferIssuedAction = "offer.issued";
export const applicationDecisionRejectionRecordedAction = "application.rejected";
export const applicationDecisionEntityType = "application_decision";
export const applicationOfferTemplateKey = "offer_issued";
export const applicationRejectionTemplateKey = "rejection";

export type ApplicationDecisionOutcome = (typeof applicationDecisionOutcomes)[number];

export interface StaffApplicationDecisionAccessRow {
  applicationStatus: "draft" | "submitted";
  leadStage: AdmissionLeadStage | string;
  archived: boolean;
  convertedStudentId?: string | null;
  readinessStatus?: "not_ready" | "needs_information" | "ready_for_decision" | null;
  existingDecisionOutcome?: ApplicationDecisionOutcome | null;
}

export interface StaffApplicationDecisionAccessDecision {
  allowed: boolean;
  reason:
    | "allowed"
    | "application_not_submitted"
    | "lead_not_decisionable"
    | "review_not_ready"
    | "decision_already_recorded";
}

export interface ApplicationDecisionAuditInput {
  decisionId: string;
  applicationId: string;
  admissionLeadId: string;
  personId: string;
  outcome: ApplicationDecisionOutcome;
  decisionReason: string;
  offerId?: string | null;
  rejectionId?: string | null;
  correspondenceLogId?: string | null;
  deadlineAt?: string | null;
  offeredModuleOfferingCount?: number | null;
}

const idSchema = z.string().uuid();
const optionalDeadlineSchema = z
  .string()
  .trim()
  .max(80)
  .transform((value, context) => {
    if (value.length === 0) {
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `${value}T23:59:59+00:00`;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Offer deadline must be a valid date."
      });
      return z.NEVER;
    }

    return parsed.toISOString();
  });

const decisionFormSchema = z.object({
  application_id: idSchema,
  decision_outcome: z.enum(applicationDecisionOutcomes),
  decision_reason: z
    .string()
    .trim()
    .min(1, "Decision reason is required.")
    .max(4000),
  offer_deadline_at: optionalDeadlineSchema
});

export type RecordApplicationDecisionPayload = z.infer<typeof decisionFormSchema>;

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export function parseRecordApplicationDecisionForm(formData: FormData): RecordApplicationDecisionPayload {
  return decisionFormSchema.parse({
    application_id: formString(formData, "application_id"),
    decision_outcome: formString(formData, "decision_outcome"),
    decision_reason: formString(formData, "decision_reason"),
    offer_deadline_at: formString(formData, "offer_deadline_at")
  });
}

export function canRecordApplicationDecision(
  row: StaffApplicationDecisionAccessRow
): StaffApplicationDecisionAccessDecision {
  if (row.applicationStatus !== "submitted") {
    return { allowed: false, reason: "application_not_submitted" };
  }

  if (row.archived || row.convertedStudentId || !["submitted", "reviewed"].includes(row.leadStage)) {
    return { allowed: false, reason: "lead_not_decisionable" };
  }

  if (row.readinessStatus !== "ready_for_decision") {
    return { allowed: false, reason: "review_not_ready" };
  }

  if (row.existingDecisionOutcome) {
    return { allowed: false, reason: "decision_already_recorded" };
  }

  return { allowed: true, reason: "allowed" };
}

export function buildApplicationDecisionAuditMetadata(input: ApplicationDecisionAuditInput): JsonRecord {
  return buildAuditEventInsert({
    actor_type: "staff",
    action:
      input.outcome === "offer" ? applicationDecisionOfferIssuedAction : applicationDecisionRejectionRecordedAction,
    entity_type: applicationDecisionEntityType,
    entity_id: input.decisionId,
    reason: input.decisionReason,
    metadata: {
      application_id: input.applicationId,
      admission_lead_id: input.admissionLeadId,
      person_id: input.personId,
      outcome: input.outcome,
      has_decision_reason: input.decisionReason.length > 0,
      offer_id: input.offerId ?? null,
      rejection_id: input.rejectionId ?? null,
      correspondence_log_id: input.correspondenceLogId ?? null,
      deadline_at: input.deadlineAt ?? null,
      offered_module_offering_count: input.offeredModuleOfferingCount ?? null,
      production_email_send_enabled: false
    }
  }).metadata;
}
