import { z } from "zod";
import { buildAuditEventInsert, type JsonRecord } from "@/lib/audit-correspondence";

export const applicationOfferResponses = ["accept", "decline"] as const;
export const applicationOfferAcceptedAction = "offer.accepted";
export const applicationOfferDeclinedAction = "offer.declined";
export const applicationOfferReminderEligibleAction = "offer.reminder_eligible";
export const applicationOfferLapsedAction = "offer.lapsed";
export const applicationOfferEntityType = "application_offer";
export const applicationOfferAcceptedTemplateKey = "offer_accepted_confirmation";
export const applicationOfferDeclinedTemplateKey = "offer_declined_confirmation";
export const applicationOfferDeadlineReminderTemplateKey = "offer_deadline_reminder";
export const applicationOfferLapsedTemplateKey = "offer_lapsed_notice";

export type ApplicationOfferResponse = (typeof applicationOfferResponses)[number];
export type ApplicationOfferStatus = "issued" | "withdrawn" | "accepted" | "declined" | "lapsed";

export interface ApplicantOfferAccessRow {
  status: ApplicationOfferStatus | string;
  deadlineAt?: string | null;
}

export interface ApplicantOfferResponseAccessDecision {
  allowed: boolean;
  reason: "allowed" | "offer_not_issued" | "offer_deadline_passed";
}

export interface ApplicationOfferResponseAuditInput {
  offerId: string;
  applicationId: string;
  admissionLeadId: string;
  personId: string;
  response: ApplicationOfferResponse;
  deadlineAt?: string | null;
  correspondenceLogId?: string | null;
}

export interface ApplicationOfferDeadlineWorkflowAuditInput {
  offerId: string;
  applicationId: string;
  admissionLeadId: string;
  personId: string;
  deadlineAt: string;
  correspondenceLogId?: string | null;
  referenceTime?: string | null;
  reminderWindowDays?: number | null;
}

const idSchema = z.string().uuid();
const reminderWindowDaysSchema = z.coerce.number().int().min(0).max(30).default(3);

const offerResponseFormSchema = z.object({
  offer_id: idSchema,
  offer_response: z.enum(applicationOfferResponses)
});

const offerDeadlineWorkflowFormSchema = z.object({
  reminder_window_days: reminderWindowDaysSchema
});

export type RespondToApplicationOfferPayload = z.infer<typeof offerResponseFormSchema>;
export type ProcessApplicationOfferDeadlineWorkflowPayload = z.infer<typeof offerDeadlineWorkflowFormSchema>;

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export function parseRespondToApplicationOfferForm(formData: FormData): RespondToApplicationOfferPayload {
  return offerResponseFormSchema.parse({
    offer_id: formString(formData, "offer_id"),
    offer_response: formString(formData, "offer_response")
  });
}

export function parseProcessApplicationOfferDeadlineWorkflowForm(
  formData: FormData
): ProcessApplicationOfferDeadlineWorkflowPayload {
  return offerDeadlineWorkflowFormSchema.parse({
    reminder_window_days: formString(formData, "reminder_window_days") || "3"
  });
}

export function canRespondToApplicationOffer(
  row: ApplicantOfferAccessRow,
  now: Date = new Date()
): ApplicantOfferResponseAccessDecision {
  if (row.status !== "issued") {
    return { allowed: false, reason: "offer_not_issued" };
  }

  if (row.deadlineAt && new Date(row.deadlineAt).getTime() <= now.getTime()) {
    return { allowed: false, reason: "offer_deadline_passed" };
  }

  return { allowed: true, reason: "allowed" };
}

export function buildApplicationOfferResponseAuditMetadata(input: ApplicationOfferResponseAuditInput): JsonRecord {
  return buildAuditEventInsert({
    actor_type: "applicant",
    action: input.response === "accept" ? applicationOfferAcceptedAction : applicationOfferDeclinedAction,
    entity_type: applicationOfferEntityType,
    entity_id: input.offerId,
    metadata: {
      offer_id: input.offerId,
      application_id: input.applicationId,
      admission_lead_id: input.admissionLeadId,
      person_id: input.personId,
      response: input.response,
      deadline_at: input.deadlineAt ?? null,
      correspondence_log_id: input.correspondenceLogId ?? null,
      production_email_send_enabled: false,
      provider_message_id: null
    }
  }).metadata;
}

export function buildApplicationOfferReminderAuditMetadata(input: ApplicationOfferDeadlineWorkflowAuditInput): JsonRecord {
  return buildAuditEventInsert({
    actor_type: "staff",
    action: applicationOfferReminderEligibleAction,
    entity_type: applicationOfferEntityType,
    entity_id: input.offerId,
    metadata: {
      offer_id: input.offerId,
      application_id: input.applicationId,
      admission_lead_id: input.admissionLeadId,
      person_id: input.personId,
      deadline_at: input.deadlineAt,
      reference_time: input.referenceTime ?? null,
      reminder_window_days: input.reminderWindowDays ?? null,
      correspondence_log_id: input.correspondenceLogId ?? null,
      delivery_status: "suppressed",
      production_email_send_enabled: false,
      provider_message_id: null
    }
  }).metadata;
}

export function buildApplicationOfferLapsedAuditMetadata(input: ApplicationOfferDeadlineWorkflowAuditInput): JsonRecord {
  return buildAuditEventInsert({
    actor_type: "staff",
    action: applicationOfferLapsedAction,
    entity_type: applicationOfferEntityType,
    entity_id: input.offerId,
    metadata: {
      offer_id: input.offerId,
      application_id: input.applicationId,
      admission_lead_id: input.admissionLeadId,
      person_id: input.personId,
      deadline_at: input.deadlineAt,
      reference_time: input.referenceTime ?? null,
      correspondence_log_id: input.correspondenceLogId ?? null,
      delivery_status: "suppressed",
      production_email_send_enabled: false,
      provider_message_id: null
    }
  }).metadata;
}
