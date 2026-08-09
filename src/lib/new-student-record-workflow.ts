import { canRecordApplicationDecision } from "@/lib/application-decisions";
import type { NewStudentJourneyStage } from "@/lib/admissions-staff-workflow";

export interface NewStudentFullRecordAvailabilityInput {
  journeyStage: NewStudentJourneyStage;
  sourceLeadStage: string;
  archived: boolean;
  convertedStudentId?: string;
  hasApplication: boolean;
  applicationStatus?: "draft" | "submitted";
  readinessStatus?: "not_ready" | "needs_information" | "ready_for_decision";
  decisionOutcome?: "offer" | "rejection";
  hasActiveCorrection: boolean;
  requiredEvidence: Array<{ status: string; hasActiveOverride: boolean }>;
}

export interface NewStudentFullRecordAvailability {
  canEditAdministrativeDetails: boolean;
  canInvite: boolean;
  canReviewEvidence: boolean;
  canCreateCorrection: boolean;
  canOffer: boolean;
  canReject: boolean;
  offerBlockedReasons: string[];
  decisionBlockedReason?: string;
}

export function getNewStudentFullRecordAvailability(
  input: NewStudentFullRecordAvailabilityInput
): NewStudentFullRecordAvailability {
  const completeOrClosed = input.journeyStage === "complete" || input.journeyStage === "closed";
  const canEditAdministrativeDetails = !input.archived && !input.convertedStudentId && !completeOrClosed;
  const canInvite = canEditAdministrativeDetails && !input.hasApplication && ["interest", "application_invited"].includes(input.sourceLeadStage);
  const canReviewEvidence = input.applicationStatus === "submitted" && !input.decisionOutcome && !input.archived;
  const canCreateCorrection = canReviewEvidence && !input.hasActiveCorrection;
  const decisionAccess = canRecordApplicationDecision({
    applicationStatus: input.applicationStatus ?? "draft",
    leadStage: input.sourceLeadStage,
    archived: input.archived,
    convertedStudentId: input.convertedStudentId,
    readinessStatus: input.readinessStatus,
    existingDecisionOutcome: input.decisionOutcome
  });
  const offerBlockedReasons: string[] = [];
  if (input.hasActiveCorrection) offerBlockedReasons.push("active_correction");
  if (input.requiredEvidence.length === 0) offerBlockedReasons.push("required_evidence_missing");
  if (input.requiredEvidence.some((slot) => slot.status === "rejected")) offerBlockedReasons.push("rejected_evidence");
  if (input.requiredEvidence.some((slot) => slot.status !== "verified" && !slot.hasActiveOverride)) {
    offerBlockedReasons.push("required_evidence_unresolved");
  }

  return {
    canEditAdministrativeDetails,
    canInvite,
    canReviewEvidence,
    canCreateCorrection,
    canOffer: decisionAccess.allowed && offerBlockedReasons.length === 0,
    canReject: decisionAccess.allowed,
    offerBlockedReasons: [...new Set(offerBlockedReasons)],
    decisionBlockedReason: decisionAccess.allowed ? undefined : decisionAccess.reason
  };
}
