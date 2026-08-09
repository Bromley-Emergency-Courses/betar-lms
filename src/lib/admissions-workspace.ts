import { z } from "zod";
import {
  mapStaffNewStudentAdmissionsWorkItem,
  newStudentJourneyStages,
  type StaffNewStudentAdmissionsWorkItem
} from "@/lib/admissions-staff-workflow";

export const admissionsWorkspacePageSizes = [25, 50, 100] as const;
export const admissionsAttentionFilters = ["all", "needs_attention", "ready", "waiting"] as const;
export const returningStudentWorkspaceStatuses = ["all", "active", "deferred", "interrupted", "removed"] as const;
export const admissionsBatchStatuses = ["all", "queued", "running", "succeeded", "failed", "excluded"] as const;

export type AdmissionsAttentionFilter = (typeof admissionsAttentionFilters)[number];
export type ReturningStudentWorkspaceStatus = (typeof returningStudentWorkspaceStatuses)[number];

export interface AdmissionsWorkspaceQuery {
  search: string;
  attention: AdmissionsAttentionFilter;
  page: number;
  pageSize: (typeof admissionsWorkspacePageSizes)[number];
}

export interface NewStudentWorkspaceQuery extends AdmissionsWorkspaceQuery {
  stage: "all" | (typeof newStudentJourneyStages)[number];
}

export interface ReturningStudentWorkspaceQuery extends AdmissionsWorkspaceQuery {
  status: ReturningStudentWorkspaceStatus;
}

export interface StaffNewStudentAdmissionsOperation extends StaffNewStudentAdmissionsWorkItem {
  applicantName: string;
  needsStaffAttention: boolean;
  isReadyToProgress: boolean;
  isAwaitingApplicant: boolean;
  leadingAttentionIndicator?: string;
}

export interface StaffReturningStudentAdmissionsOperation {
  participantId: string;
  cycleId: string;
  studentId: string;
  personId?: string;
  membershipState: "included" | "removed";
  inclusionBasis: "status_group" | "individual";
  studentReference: string;
  firstName: string;
  lastName: string;
  studentName: string;
  snapshotProgramme: string;
  snapshotStatus: string;
  snapshotAwardedCredits: number;
  snapshotEmail?: string;
  currentProgramme: string;
  currentStatus: string;
  currentAwardedCredits: number;
  currentEmail?: string;
  portalIdentityEmail?: string;
  hasEligibilityChange: boolean;
  needsAdditionalStudyConfirmation: boolean;
  blockingReason?: string;
  cyclePhase: "setup" | "collecting_responses" | "review_confirmation" | "complete";
  targetTermId: string;
  targetTermName: string;
  targetTermStartsOn: string;
  latestContactDeliveryStatus?: string;
  latestContactRecipientEmail?: string;
  latestContactAttemptedAt?: string;
  contactAttemptCount: number;
  contactState: "not_contacted" | "queued" | "sent" | "failed";
  responseState: "awaiting_response" | "removed";
  needsStaffAttention: boolean;
  primaryNextAction: string;
}

const querySchema = z.object({
  q: z.string().trim().max(100).catch(""),
  attention: z.enum(admissionsAttentionFilters).catch("all"),
  page: z.coerce.number().int().positive().catch(1),
  page_size: z.coerce
    .number()
    .pipe(z.union([z.literal(25), z.literal(50), z.literal(100)]))
    .catch(50)
});

function queryValue(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

export function parseNewStudentWorkspaceQuery(
  searchParams: Record<string, string | string[] | undefined>
): NewStudentWorkspaceQuery {
  const common = querySchema.parse({
    q: queryValue(searchParams, "q"),
    attention: queryValue(searchParams, "attention"),
    page: queryValue(searchParams, "page"),
    page_size: queryValue(searchParams, "page_size")
  });
  const stage = z.union([z.literal("all"), z.enum(newStudentJourneyStages)]).catch("all").parse(queryValue(searchParams, "stage"));
  return {
    search: common.q,
    attention: common.attention,
    page: common.page,
    pageSize: common.page_size,
    stage
  };
}

export function parseReturningStudentWorkspaceQuery(
  searchParams: Record<string, string | string[] | undefined>
): ReturningStudentWorkspaceQuery {
  const common = querySchema.parse({
    q: queryValue(searchParams, "q"),
    attention: queryValue(searchParams, "attention"),
    page: queryValue(searchParams, "page"),
    page_size: queryValue(searchParams, "page_size")
  });
  const status = z.enum(returningStudentWorkspaceStatuses).catch("all").parse(queryValue(searchParams, "status"));
  return {
    search: common.q,
    attention: common.attention,
    page: common.page,
    pageSize: common.page_size,
    status
  };
}

export function parseAdmissionsBatchResultsQuery(
  searchParams: Record<string, string | string[] | undefined>
) {
  const page = z.coerce.number().int().positive().catch(1).parse(queryValue(searchParams, "page"));
  const status = z.enum(admissionsBatchStatuses).catch("all").parse(queryValue(searchParams, "status"));
  return { page, pageSize: 50 as const, status };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function mapStaffNewStudentAdmissionsOperation(
  row: Record<string, unknown>
): StaffNewStudentAdmissionsOperation {
  return {
    ...mapStaffNewStudentAdmissionsWorkItem(row),
    applicantName: String(row.applicant_name),
    needsStaffAttention: Boolean(row.needs_staff_attention),
    isReadyToProgress: Boolean(row.is_ready_to_progress),
    isAwaitingApplicant: Boolean(row.is_awaiting_applicant),
    leadingAttentionIndicator: optionalString(row.leading_attention_indicator)
  };
}

export function mapStaffReturningStudentAdmissionsOperation(
  row: Record<string, unknown>
): StaffReturningStudentAdmissionsOperation {
  const membershipState = row.membership_state === "removed" ? "removed" : "included";
  const cyclePhase = String(row.cycle_phase) as StaffReturningStudentAdmissionsOperation["cyclePhase"];
  const validCyclePhases = ["setup", "collecting_responses", "review_confirmation", "complete"];
  if (!validCyclePhases.includes(cyclePhase)) {
    throw new Error(`Unknown returning-student cycle phase: ${cyclePhase}`);
  }

  return {
    participantId: String(row.participant_id),
    cycleId: String(row.cycle_id),
    studentId: String(row.student_id),
    personId: optionalString(row.person_id),
    membershipState,
    inclusionBasis: row.inclusion_basis === "individual" ? "individual" : "status_group",
    studentReference: String(row.student_reference),
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    studentName: String(row.student_name),
    snapshotProgramme: String(row.snapshot_programme),
    snapshotStatus: String(row.snapshot_status),
    snapshotAwardedCredits: Number(row.snapshot_awarded_credits),
    snapshotEmail: optionalString(row.snapshot_email),
    currentProgramme: String(row.current_programme),
    currentStatus: String(row.current_status),
    currentAwardedCredits: Number(row.current_awarded_credits),
    currentEmail: optionalString(row.current_email),
    portalIdentityEmail: optionalString(row.portal_identity_email),
    hasEligibilityChange: Boolean(row.has_eligibility_change),
    needsAdditionalStudyConfirmation: Boolean(row.needs_additional_study_confirmation),
    blockingReason: optionalString(row.blocking_reason),
    cyclePhase,
    targetTermId: String(row.target_term_id),
    targetTermName: String(row.target_term_name),
    targetTermStartsOn: String(row.target_term_starts_on),
    latestContactDeliveryStatus: optionalString(row.latest_contact_delivery_status),
    latestContactRecipientEmail: optionalString(row.latest_contact_recipient_email),
    latestContactAttemptedAt: optionalString(row.latest_contact_attempted_at),
    contactAttemptCount: Number(row.contact_attempt_count),
    contactState: String(row.contact_state) as StaffReturningStudentAdmissionsOperation["contactState"],
    responseState: String(row.response_state) as StaffReturningStudentAdmissionsOperation["responseState"],
    needsStaffAttention: Boolean(row.needs_staff_attention),
    primaryNextAction: String(row.primary_next_action)
  };
}

export function plainLanguageAdmissionsLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
