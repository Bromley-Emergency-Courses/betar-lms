export const newStudentJourneyStages = [
  "enquiry",
  "application",
  "review",
  "offer",
  "registration",
  "complete",
  "closed"
] as const;

export type NewStudentJourneyStage = (typeof newStudentJourneyStages)[number];

export const newStudentJourneyStageLabels: Record<NewStudentJourneyStage, string> = {
  enquiry: "Enquiry",
  application: "Application",
  review: "Review",
  offer: "Offer",
  registration: "Registration",
  complete: "Complete",
  closed: "Closed"
};

export const newStudentPrimaryActions = [
  "repair_inconsistency",
  "invite_applicant",
  "await_application_submission",
  "review_application",
  "resolve_information_request",
  "record_decision",
  "reissue_offer",
  "lapse_offer",
  "await_offer_response",
  "reopen_registration",
  "convert_registration",
  "await_registration",
  "none"
] as const;

export type NewStudentPrimaryAction = (typeof newStudentPrimaryActions)[number];

export interface StaffNewStudentAdmissionsWorkItem {
  admissionLeadId: string;
  personId?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  programme: "pgcert" | "microcredential";
  sourceLeadStage: string;
  journeyStage: NewStudentJourneyStage;
  targetTermId?: string;
  applicationId?: string;
  applicationStatus?: string;
  reviewReadinessStatus?: string;
  decisionOutcome?: string;
  offerId?: string;
  offerStatus?: string;
  registrationId?: string;
  registrationStatus?: string;
  hasDataInconsistency: boolean;
  attentionIndicators: string[];
  primaryNextAction: NewStudentPrimaryAction;
  currentDeadlineAt?: string;
  lastActivityAt: string;
  createdAt: string;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function mapStaffNewStudentAdmissionsWorkItem(row: Record<string, unknown>): StaffNewStudentAdmissionsWorkItem {
  const journeyStage = String(row.journey_stage) as NewStudentJourneyStage;
  const primaryNextAction = String(row.primary_next_action) as NewStudentPrimaryAction;

  if (!newStudentJourneyStages.includes(journeyStage)) {
    throw new Error(`Unknown new-student journey stage: ${journeyStage}`);
  }

  if (!newStudentPrimaryActions.includes(primaryNextAction)) {
    throw new Error(`Unknown new-student primary action: ${primaryNextAction}`);
  }

  return {
    admissionLeadId: String(row.admission_lead_id),
    personId: optionalString(row.person_id),
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    email: String(row.email),
    phone: optionalString(row.phone),
    programme: row.programme === "microcredential" ? "microcredential" : "pgcert",
    sourceLeadStage: String(row.source_lead_stage),
    journeyStage,
    targetTermId: optionalString(row.target_term_id),
    applicationId: optionalString(row.application_id),
    applicationStatus: optionalString(row.application_status),
    reviewReadinessStatus: optionalString(row.review_readiness_status),
    decisionOutcome: optionalString(row.decision_outcome),
    offerId: optionalString(row.offer_id),
    offerStatus: optionalString(row.offer_status),
    registrationId: optionalString(row.registration_id),
    registrationStatus: optionalString(row.registration_status),
    hasDataInconsistency: Boolean(row.has_data_inconsistency),
    attentionIndicators: Array.isArray(row.attention_indicators) ? row.attention_indicators.map(String) : [],
    primaryNextAction,
    currentDeadlineAt: optionalString(row.current_deadline_at),
    lastActivityAt: String(row.last_activity_at),
    createdAt: String(row.created_at)
  };
}
