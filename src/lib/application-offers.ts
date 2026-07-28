import { z } from "zod";
import { buildAuditEventInsert, type JsonRecord } from "@/lib/audit-correspondence";

export const applicationOfferResponses = ["accept", "decline"] as const;
export const applicationOfferAcceptedAction = "offer.accepted";
export const applicationOfferDeclinedAction = "offer.declined";
export const applicationOfferEntityType = "application_offer";
export const applicationOfferAcceptedTemplateKey = "offer_accepted_confirmation";
export const applicationOfferDeclinedTemplateKey = "offer_declined_confirmation";

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

const idSchema = z.string().uuid();

const offerResponseFormSchema = z.object({
  offer_id: idSchema,
  offer_response: z.enum(applicationOfferResponses)
});

export type RespondToApplicationOfferPayload = z.infer<typeof offerResponseFormSchema>;

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export function parseRespondToApplicationOfferForm(formData: FormData): RespondToApplicationOfferPayload {
  return offerResponseFormSchema.parse({
    offer_id: formString(formData, "offer_id"),
    offer_response: formString(formData, "offer_response")
  });
}

export function canRespondToApplicationOffer(
  row: ApplicantOfferAccessRow,
  now: Date = new Date()
): ApplicantOfferResponseAccessDecision {
  if (row.status !== "issued") {
    return { allowed: false, reason: "offer_not_issued" };
  }

  if (row.deadlineAt && new Date(row.deadlineAt).getTime() < now.getTime()) {
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
