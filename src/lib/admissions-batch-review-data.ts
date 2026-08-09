import "server-only";

import {
  evaluateAdmissionsEmailSafety,
  getAdmissionsEmailConfig,
  type AdmissionsEmailTestRecordMatch
} from "@/lib/admissions-email";
import {
  admissionsBatchReviewRequestSchema,
  newStudentBatchEligibility,
  type AdmissionsBatchPreview,
  type AdmissionsBatchReviewRequest,
  type AdmissionsBatchReviewedTarget
} from "@/lib/admissions-batch-review";
import { mapStaffNewStudentAdmissionsOperation } from "@/lib/admissions-workspace";
import { createSupabaseServerClient } from "@/lib/supabase";

function safeSearchPattern(value: string): string {
  return value.toLowerCase().replace(/[%,_()]/g, " ").replace(/\s+/g, " ").trim();
}

function emailSafetyReason(reason: string): string {
  const reasons: Record<string, string> = {
    master_disabled: "Email delivery is disabled.",
    recipient_not_allowlisted: "Recipient is not on the pilot allowlist.",
    missing_related_record: "The enquiry does not yet have the person identity required for pilot delivery.",
    related_record_not_marked_fake: "The related applicant is not marked as a fake pilot record."
  };
  return reasons[reason] ?? "Recipient is not eligible under the current email safety mode.";
}

export async function resolveAdmissionsBatchPreview(input: unknown): Promise<AdmissionsBatchPreview> {
  const request = admissionsBatchReviewRequestSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  let operationQuery = supabase.from("staff_new_student_admissions_operations").select("*");

  if (request.scope === "all_matching") {
    if (request.filters.stage !== "all") operationQuery = operationQuery.eq("journey_stage", request.filters.stage);
    if (request.filters.attention === "needs_attention") operationQuery = operationQuery.eq("needs_staff_attention", true);
    if (request.filters.attention === "ready") operationQuery = operationQuery.eq("is_ready_to_progress", true);
    if (request.filters.attention === "waiting") operationQuery = operationQuery.eq("is_awaiting_applicant", true);
    const search = safeSearchPattern(request.filters.search);
    if (search) operationQuery = operationQuery.ilike("search_text", `%${search}%`);
  } else {
    operationQuery = operationQuery.in("admission_lead_id", request.selected_ids);
  }

  const operationResult = await operationQuery
    .order("last_activity_at", { ascending: false })
    .order("admission_lead_id", { ascending: true })
    .limit(501);
  if (operationResult.error) throw new Error(operationResult.error.message);
  if ((operationResult.data ?? []).length > 500) {
    throw new Error("This action matches more than 500 records. Narrow the visible filters before reviewing it.");
  }

  const operations = (operationResult.data ?? []).map((row) => mapStaffNewStudentAdmissionsOperation(row));
  const operationById = new Map(operations.map((operation) => [operation.admissionLeadId, operation]));
  const orderedOperations = request.scope === "all_matching"
    ? operations
    : request.selected_ids.map((id) => operationById.get(id)).filter((item) => Boolean(item));

  const personIds = orderedOperations.flatMap((item) => item?.personId ? [item.personId] : []);
  let testRecords: AdmissionsEmailTestRecordMatch[] = [];
  if (request.action === "invite_application" && personIds.length > 0) {
    const testRecordResult = await supabase
      .from("admissions_email_test_records")
      .select("person_id, admission_lead_id, student_id")
      .in("person_id", personIds)
      .eq("active", true);
    if (testRecordResult.error) throw new Error(testRecordResult.error.message);
    testRecords = (testRecordResult.data ?? []) as AdmissionsEmailTestRecordMatch[];
  }

  const emailConfig = getAdmissionsEmailConfig();
  const targets: AdmissionsBatchReviewedTarget[] = [];
  for (const item of orderedOperations) {
    if (!item) continue;
    const workflowEligibility = newStudentBatchEligibility(request.action, item);
    let exclusionReason = workflowEligibility.eligible ? null : workflowEligibility.reason;

    if (!exclusionReason && request.action === "invite_application") {
      const safety = evaluateAdmissionsEmailSafety({
        mode: emailConfig.mode,
        pilotAllowlist: emailConfig.pilotAllowlist,
        recipient: item.email,
        identity: { personId: item.personId ?? null, admissionLeadId: item.admissionLeadId },
        testRecords
      });
      if (!safety.allowed) exclusionReason = emailSafetyReason(safety.reason);
    }

    targets.push({
      entity_type: "admission_lead",
      entity_id: item.admissionLeadId,
      person_id: item.personId ?? null,
      recipient_email: request.action === "invite_application" ? item.email : null,
      recipient_name: item.applicantName,
      eligible: !exclusionReason,
      exclusion_reason: exclusionReason,
      source_snapshot: {
        admission_lead_id: item.admissionLeadId,
        person_id: item.personId ?? null,
        journey_stage: item.journeyStage,
        source_lead_stage: item.sourceLeadStage,
        application_id: item.applicationId ?? null,
        application_status: item.applicationStatus ?? null,
        recipient_email: request.action === "invite_application" ? item.email : null
      }
    });
  }

  if (request.scope !== "all_matching") {
    for (const missingId of request.selected_ids.filter((id) => !operationById.has(id))) {
      targets.push({
        entity_type: "admission_lead",
        entity_id: missingId,
        eligible: false,
        exclusion_reason: "The selected admissions record no longer exists or is not accessible.",
        source_snapshot: { admission_lead_id: missingId }
      });
    }
  }

  return {
    workspace: "new_students",
    action: request.action,
    scope: request.scope,
    reviewedCount: targets.length,
    eligibleCount: targets.filter((target) => target.eligible).length,
    excludedCount: targets.filter((target) => !target.eligible).length,
    targets
  };
}

export function reviewedFiltersFromBatchRequest(request: AdmissionsBatchReviewRequest) {
  return request.scope === "all_matching" ? request.filters : {};
}
