import { z } from "zod";
import type { NewStudentJourneyStage } from "@/lib/admissions-staff-workflow";

const idSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(1, "A reason is required.").max(4000);

const admissionOutcomeSchema = z.object({
  admission_id: idSchema,
  reason: reasonSchema
});

const offerWithdrawalSchema = admissionOutcomeSchema.extend({
  application_id: idSchema,
  offer_id: idSchema
});

const offerReissueSchema = offerWithdrawalSchema.extend({
  new_deadline_at: z.string().trim().transform((value, context) => {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59Z`) : new Date(value);
    if (!value || Number.isNaN(parsed.getTime())) {
      context.addIssue({ code: "custom", message: "A valid new offer deadline is required." });
      return z.NEVER;
    }
    return parsed.toISOString();
  })
});

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export function parseAdmissionOutcomeForm(formData: FormData) {
  return admissionOutcomeSchema.parse({
    admission_id: formString(formData, "admission_id"),
    reason: formString(formData, "reason")
  });
}

export function parseOfferWithdrawalForm(formData: FormData) {
  return offerWithdrawalSchema.parse({
    admission_id: formString(formData, "admission_id"),
    application_id: formString(formData, "application_id"),
    offer_id: formString(formData, "offer_id"),
    reason: formString(formData, "reason")
  });
}

export function parseOfferReissueForm(formData: FormData) {
  return offerReissueSchema.parse({
    admission_id: formString(formData, "admission_id"),
    application_id: formString(formData, "application_id"),
    offer_id: formString(formData, "offer_id"),
    new_deadline_at: formString(formData, "new_deadline_at"),
    reason: formString(formData, "reason")
  });
}

export interface NewStudentTerminalActionFacts {
  journeyStage: NewStudentJourneyStage;
  sourceLeadStage: string;
  archived: boolean;
  convertedStudentId?: string;
  applicationStatus?: "draft" | "submitted";
  hasActiveAbandonment: boolean;
  offerStatus?: string;
  hasRegistration: boolean;
}

export function newStudentTerminalActionAvailability(facts: NewStudentTerminalActionFacts) {
  const mutable = !facts.archived && !facts.convertedStudentId;
  const canAbandon = mutable
    && !facts.hasActiveAbandonment
    && ["enquiry", "application"].includes(facts.journeyStage)
    && ["interest", "application_invited"].includes(facts.sourceLeadStage)
    && facts.applicationStatus !== "submitted";
  const canReopenAbandonment = mutable
    && facts.journeyStage === "closed"
    && facts.sourceLeadStage === "abandoned"
    && facts.hasActiveAbandonment
    && facts.applicationStatus !== "submitted";
  const canReissueOffer = mutable
    && facts.journeyStage === "offer"
    && facts.sourceLeadStage === "offer_lapsed"
    && facts.offerStatus === "lapsed"
    && !facts.hasRegistration;
  const canWithdrawOffer = mutable
    && facts.journeyStage === "offer"
    && ["offered", "offer_lapsed"].includes(facts.sourceLeadStage)
    && ["issued", "lapsed"].includes(facts.offerStatus ?? "")
    && !facts.hasRegistration;

  return { canAbandon, canReopenAbandonment, canReissueOffer, canWithdrawOffer };
}
