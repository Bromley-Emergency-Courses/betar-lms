import "server-only";

import { getAdmissionsEmailConfig } from "@/lib/admissions-email";
import {
  mapStaffNewStudentAdmissionsOperation,
  mapStaffReturningStudentAdmissionsOperation,
  type NewStudentWorkspaceQuery,
  type ReturningStudentWorkspaceQuery,
  type StaffNewStudentAdmissionsOperation,
  type StaffReturningStudentAdmissionsOperation
} from "@/lib/admissions-workspace";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

export interface AdmissionsWorkspacePage<T> {
  items: T[];
  total: number;
}

export interface AdmissionsOverviewData {
  newStudents: {
    active: number;
    attention: number;
    ready: number;
    waiting: number;
    stages: Record<string, number>;
  };
  returningStudents: {
    cycleId?: string;
    targetTermName?: string;
    phase?: string;
    participants: number;
    attention: number;
    contacted: number;
    waiting: number;
  };
  exceptions: {
    newStudentInconsistencies: number;
    returningStudentBlockers: number;
    failedBatches: Array<{ id: string; action: string; failedCount: number; workspace: string }>;
  };
  email: {
    enabled: boolean;
    mode: "disabled" | "pilot" | "live";
    missing: string[];
  };
}

export interface AdmissionsBatchDetail {
  id: string;
  workspace: string;
  action: string;
  scope: string;
  status: string;
  reviewedCount: number;
  reviewedFilters: Record<string, unknown>;
  templateKey?: string;
  renderedSubject?: string;
  retryOfBatchId?: string;
  rootBatchId?: string;
  queuedCount: number;
  runningCount: number;
  succeededCount: number;
  failedCount: number;
  excludedCount: number;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastProgressAt: string;
}

export interface AdmissionsBatchTargetResult {
  id: string;
  ordinal: number;
  entityType: string;
  entityId: string;
  recipientEmail?: string;
  recipientName?: string;
  status: string;
  exclusionReason?: string;
  failureReason?: string;
  sourceSnapshot: Record<string, unknown>;
  attemptCount: number;
  correspondenceStatus?: string;
  providerMessageId?: string;
  completedAt?: string;
}

function safeSearchPattern(value: string): string {
  return value
    .toLowerCase()
    .replace(/[%,_()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function emptyOverview(): AdmissionsOverviewData {
  const emailConfig = getAdmissionsEmailConfig();
  return {
    newStudents: { active: 0, attention: 0, ready: 0, waiting: 0, stages: {} },
    returningStudents: { participants: 0, attention: 0, contacted: 0, waiting: 0 },
    exceptions: { newStudentInconsistencies: 0, returningStudentBlockers: 0, failedBatches: [] },
    email: { enabled: emailConfig.enabled, mode: emailConfig.mode, missing: emailConfig.missing }
  };
}

export async function getAdmissionsOverviewData(): Promise<AdmissionsOverviewData> {
  if (!isSupabaseConfigured()) {
    return emptyOverview();
  }

  const supabase = await createSupabaseServerClient();
  const [newResult, returningResult, failedBatchResult] = await Promise.all([
    supabase
      .from("staff_new_student_admissions_operations")
      .select("journey_stage, needs_staff_attention, is_ready_to_progress, is_awaiting_applicant, has_data_inconsistency"),
    supabase
      .from("staff_returning_student_admissions_operations")
      .select("cycle_id, target_term_name, cycle_phase, membership_state, needs_staff_attention, blocking_reason, contact_state, response_state"),
    supabase
      .from("admissions_operational_batches")
      .select("id, action, failed_count, workspace")
      .gt("failed_count", 0)
      .order("last_progress_at", { ascending: false })
      .limit(5)
  ]);

  if (newResult.error) throw new Error(newResult.error.message);
  if (returningResult.error) throw new Error(returningResult.error.message);
  if (failedBatchResult.error) throw new Error(failedBatchResult.error.message);

  const newRows = newResult.data ?? [];
  const returningRows = returningResult.data ?? [];
  const stages: Record<string, number> = {};
  for (const row of newRows) {
    const stage = String(row.journey_stage);
    stages[stage] = (stages[stage] ?? 0) + 1;
  }
  const includedReturningRows = returningRows.filter((row) => row.membership_state === "included");
  const firstReturning = includedReturningRows[0] ?? returningRows[0];
  const emailConfig = getAdmissionsEmailConfig();

  return {
    newStudents: {
      active: newRows.filter((row) => !["complete", "closed"].includes(String(row.journey_stage))).length,
      attention: newRows.filter((row) => row.needs_staff_attention).length,
      ready: newRows.filter((row) => row.is_ready_to_progress).length,
      waiting: newRows.filter((row) => row.is_awaiting_applicant).length,
      stages
    },
    returningStudents: {
      cycleId: firstReturning ? String(firstReturning.cycle_id) : undefined,
      targetTermName: firstReturning ? String(firstReturning.target_term_name) : undefined,
      phase: firstReturning ? String(firstReturning.cycle_phase) : undefined,
      participants: includedReturningRows.length,
      attention: includedReturningRows.filter((row) => row.needs_staff_attention).length,
      contacted: includedReturningRows.filter((row) => row.contact_state === "sent").length,
      waiting: includedReturningRows.filter((row) => row.response_state === "awaiting_response").length
    },
    exceptions: {
      newStudentInconsistencies: newRows.filter((row) => row.has_data_inconsistency).length,
      returningStudentBlockers: includedReturningRows.filter((row) => Boolean(row.blocking_reason)).length,
      failedBatches: (failedBatchResult.data ?? []).map((row) => ({
        id: String(row.id),
        action: String(row.action),
        failedCount: Number(row.failed_count),
        workspace: String(row.workspace)
      }))
    },
    email: { enabled: emailConfig.enabled, mode: emailConfig.mode, missing: emailConfig.missing }
  };
}

export async function getNewStudentWorkspacePage(
  query: NewStudentWorkspaceQuery
): Promise<AdmissionsWorkspacePage<StaffNewStudentAdmissionsOperation>> {
  if (!isSupabaseConfigured()) return { items: [], total: 0 };

  const supabase = await createSupabaseServerClient();
  const offset = (query.page - 1) * query.pageSize;
  let request = supabase
    .from("staff_new_student_admissions_operations")
    .select("*", { count: "exact" })
    .order("last_activity_at", { ascending: false })
    .order("admission_lead_id", { ascending: true })
    .range(offset, offset + query.pageSize - 1);

  if (query.stage !== "all") request = request.eq("journey_stage", query.stage);
  if (query.attention === "needs_attention") request = request.eq("needs_staff_attention", true);
  if (query.attention === "ready") request = request.eq("is_ready_to_progress", true);
  if (query.attention === "waiting") request = request.eq("is_awaiting_applicant", true);
  const search = safeSearchPattern(query.search);
  if (search) request = request.ilike("search_text", `%${search}%`);

  const { data, error, count } = await request;
  if (error) throw new Error(error.message);
  return { items: (data ?? []).map((row) => mapStaffNewStudentAdmissionsOperation(row)), total: count ?? 0 };
}

export async function getReturningStudentWorkspacePage(
  query: ReturningStudentWorkspaceQuery
): Promise<AdmissionsWorkspacePage<StaffReturningStudentAdmissionsOperation>> {
  if (!isSupabaseConfigured()) return { items: [], total: 0 };

  const supabase = await createSupabaseServerClient();
  const offset = (query.page - 1) * query.pageSize;
  let request = supabase
    .from("staff_returning_student_admissions_operations")
    .select("*", { count: "exact" })
    .order("needs_staff_attention", { ascending: false })
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .range(offset, offset + query.pageSize - 1);

  if (query.status === "removed") request = request.eq("membership_state", "removed");
  else if (query.status !== "all") request = request.eq("current_status", query.status).eq("membership_state", "included");
  if (query.attention === "needs_attention") request = request.eq("needs_staff_attention", true);
  if (query.attention === "ready") {
    request = request.in("primary_next_action", ["contact_student", "resolve_eligibility_blocker", "resolve_no_response"]);
  }
  if (query.attention === "waiting") request = request.eq("primary_next_action", "await_response");
  const search = safeSearchPattern(query.search);
  if (search) request = request.ilike("search_text", `%${search}%`);

  const { data, error, count } = await request;
  if (error) throw new Error(error.message);
  return { items: (data ?? []).map((row) => mapStaffReturningStudentAdmissionsOperation(row)), total: count ?? 0 };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function getAdmissionsBatchDetail(
  batchId: string,
  query: { page: number; pageSize: number; status: string }
): Promise<{ batch: AdmissionsBatchDetail | null; targets: AdmissionsBatchTargetResult[]; total: number }> {
  if (!isSupabaseConfigured()) return { batch: null, targets: [], total: 0 };

  const supabase = await createSupabaseServerClient();
  const offset = (query.page - 1) * query.pageSize;
  let targetRequest = supabase
    .from("admissions_operational_batch_targets")
    .select("*", { count: "exact" })
    .eq("batch_id", batchId)
    .order("ordinal", { ascending: true })
    .range(offset, offset + query.pageSize - 1);
  if (query.status !== "all") targetRequest = targetRequest.eq("status", query.status);

  const [batchResult, targetResult] = await Promise.all([
    supabase.from("admissions_operational_batches").select("*").eq("id", batchId).maybeSingle(),
    targetRequest
  ]);
  if (batchResult.error) throw new Error(batchResult.error.message);
  if (targetResult.error) throw new Error(targetResult.error.message);
  if (!batchResult.data) return { batch: null, targets: [], total: 0 };

  const targetIds = (targetResult.data ?? []).map((target) => String(target.id));
  const correspondenceResult = targetIds.length > 0
    ? await supabase
        .from("correspondence_logs")
        .select("operational_batch_target_id, delivery_status, provider_message_id, created_at")
        .in("operational_batch_target_id", targetIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (correspondenceResult.error) throw new Error(correspondenceResult.error.message);
  const correspondenceByTarget = new Map<string, Record<string, unknown>>();
  for (const correspondence of correspondenceResult.data ?? []) {
    const targetId = String(correspondence.operational_batch_target_id);
    if (!correspondenceByTarget.has(targetId)) correspondenceByTarget.set(targetId, correspondence);
  }

  const batchRow = batchResult.data;
  return {
    batch: {
      id: String(batchRow.id),
      workspace: String(batchRow.workspace),
      action: String(batchRow.action),
      scope: String(batchRow.scope),
      status: String(batchRow.status),
      reviewedCount: Number(batchRow.reviewed_count),
      reviewedFilters: record(batchRow.reviewed_filters),
      templateKey: optionalString(batchRow.correspondence_template_key),
      renderedSubject: optionalString(batchRow.rendered_subject),
      retryOfBatchId: optionalString(batchRow.retry_of_batch_id),
      rootBatchId: optionalString(batchRow.root_batch_id),
      queuedCount: Number(batchRow.queued_count),
      runningCount: Number(batchRow.running_count),
      succeededCount: Number(batchRow.succeeded_count),
      failedCount: Number(batchRow.failed_count),
      excludedCount: Number(batchRow.excluded_count),
      queuedAt: String(batchRow.queued_at),
      startedAt: optionalString(batchRow.started_at),
      completedAt: optionalString(batchRow.completed_at),
      lastProgressAt: String(batchRow.last_progress_at)
    },
    targets: (targetResult.data ?? []).map((target) => {
      const correspondence = correspondenceByTarget.get(String(target.id));
      return {
        id: String(target.id),
        ordinal: Number(target.ordinal),
        entityType: String(target.entity_type),
        entityId: String(target.entity_id),
        recipientEmail: optionalString(target.recipient_email),
        recipientName: optionalString(target.recipient_name),
        status: String(target.status),
        exclusionReason: optionalString(target.exclusion_reason),
        failureReason: optionalString(target.failure_reason),
        sourceSnapshot: record(target.source_snapshot),
        attemptCount: Number(target.attempt_count),
        correspondenceStatus: optionalString(correspondence?.delivery_status),
        providerMessageId: optionalString(correspondence?.provider_message_id),
        completedAt: optionalString(target.completed_at)
      };
    }),
    total: targetResult.count ?? 0
  };
}
