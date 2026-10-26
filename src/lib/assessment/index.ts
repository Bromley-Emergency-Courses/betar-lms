import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase";
import { assessmentWorkflowEnabled, assessmentWorkflowMode } from "./feature";
import type { AssessmentAttemptEvent, AssessmentDecision, AssessmentPlanPreview, AssessmentSourceEvidence } from "./types";
import type { EnrolmentWorkspace } from "../student-enrolment";
import type { AssessmentCommand, AssessmentChangeSummary, AssessmentEvaluation, AssessmentIngestionSummary, AssessmentSourceInput, AssessmentOutcome, AssessmentAttempt, AssessmentSource, AssessmentPlan, AssessmentRevision } from "./types";

async function assessmentClient() {
  if (!assessmentWorkflowEnabled()) throw new Error("The assessment workflow is disabled.");
  const client = await createSupabaseServerClient();
  if (assessmentWorkflowMode() === "live") {
    const { data, error } = await client.from("assessment_rollout").select("mode").single();
    if (error || data?.mode !== "live") throw new Error("Assessment cutover requires the database reconciliation and sign-off gate.");
  }
  return client;
}

export async function executeAssessmentCommand(command: AssessmentCommand, expectedRevision: number): Promise<AssessmentChangeSummary> {
  const client = await assessmentClient();
  const { data, error } = await client.rpc("execute_assessment_command", { command, expected_revision: expectedRevision });
  if (error) throw new Error(error.message);
  return data;
}

export async function readStudentEnrolments(studentId: string): Promise<EnrolmentWorkspace> {
  const client = await assessmentClient();
  const { data, error } = await client.rpc("read_student_enrolments", { student_key: studentId });
  if (error) throw new Error(error.message);
  return data;
}

export async function ingestAssessmentSource(batch: AssessmentSourceInput[]): Promise<AssessmentIngestionSummary> {
  const client = await assessmentClient();
  const summary: AssessmentIngestionSummary = { created: 0, unchanged: 0, source_updated: 0, auto_matched: 0, unmatched: 0, rejected: 0, errors: [] };
  for (let offset = 0; offset < batch.length; offset += 500) {
    const { data, error } = await client.rpc("ingest_assessment_source", { batch: batch.slice(offset, offset + 500) });
    if (error) throw new Error(error.message);
    for (const key of ["created", "unchanged", "source_updated", "auto_matched", "unmatched", "rejected"] as const) summary[key] += data[key];
    summary.errors.push(...data.errors);
  }
  return summary;
}

export async function readEnrolmentAssessment(enrolmentId: string, asOf?: string): Promise<AssessmentEvaluation | null> {
  const client = await assessmentClient();
  const { data, error } = await client.rpc("read_enrolment_assessment", { enrolment_key: enrolmentId, as_of: asOf ?? null });
  if (error) throw new Error(error.message);
  return data;
}

export async function saveModuleAssessmentPlan(plan: Omit<AssessmentPlan, "id" | "version" | "mode"> & { reason: string }, expectedPlanId: string | null): Promise<string> {
  const client = await assessmentClient();
  const { data, error } = await client.rpc("save_module_assessment_plan", { input: plan, expected_plan_id: expectedPlanId });
  if (error) throw new Error(error.message);
  return data;
}

export async function previewEnrolmentAssessmentPlan(enrolmentId: string, planId: string): Promise<AssessmentPlanPreview> {
  const client = await assessmentClient();
  const { data, error } = await client.rpc("preview_enrolment_assessment_plan", { enrolment_key: enrolmentId, plan_key: planId });
  if (error) throw new Error(error.message);
  return data;
}

export async function readAssessmentTable<Row>(table: "assessment_outcomes" | "assessment_attempt_history" | "assessment_import_reconciliation" | "module_assessment_plans" | "module_assessment_attempt_revisions" | "module_assessment_arrangements" | "enrolment_assessment_history" | "audit_events" | "assessment_backfill_candidates" | "assessment_shadow_comparison" | "module_assessment_source_versions" | "assessment_revision_history", filter?: { column: string; value: string }): Promise<Row[]> {
  const client = await assessmentClient();
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    const orderColumn = table === "assessment_outcomes" || table === "assessment_shadow_comparison" ? "enrolment_id" : table === "assessment_backfill_candidates" ? "legacy_result_id" : "id";
    let query = client.from(table).select("*").order(orderColumn).range(offset, offset + 499);
    if (filter) query = query.eq(filter.column, filter.value);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...(data as Row[]));
    if (data.length < 500) return rows;
  }
}

export async function backfillAssessmentResults(approvals: Array<{legacy_result_id:string;legacy_hash:string}>, reason: string) {
  const client = await assessmentClient();
  const {data,error} = await client.rpc("backfill_assessment_results",{approvals,change_reason:reason});
  if (error) throw new Error(error.message);
  return data as {imported:number;already_backfilled:number};
}

export async function setAssessmentRollout(mode: "shadow" | "live", evidence: Record<string,string>, reason: string) {
  const client = await createSupabaseServerClient();
  const {error} = await client.rpc("set_assessment_rollout",{requested_mode:mode,evidence,change_reason:reason});
  if (error) throw new Error(error.message);
}

export async function readAssessmentWorkspace(studentId?: string) {
  const [outcomes, attempts, sources, plans] = await Promise.all([
    readAssessmentTable<AssessmentOutcome>("assessment_outcomes", studentId ? { column: "student_id", value: studentId } : undefined),
    readAssessmentTable<AssessmentAttempt>("assessment_attempt_history"),
    readAssessmentTable<AssessmentSource>("assessment_import_reconciliation"),
    readAssessmentTable<AssessmentPlan>("module_assessment_plans")
  ]);
  return { outcomes, attempts, sources, plans };
}

export type AssessmentSummary = Pick<AssessmentOutcome, "enrolment_id" | "student_id" | "student_name" | "student_identifier" | "module_code" | "module_title" | "original_cohort" | "assessment">;

export async function readAssessmentSummaries(enrolmentIds: string[]): Promise<AssessmentSummary[]> {
  if (!enrolmentIds.length) return [];
  const client = await assessmentClient();
  const rows: AssessmentSummary[] = [];
  const identifiers = [...new Set(enrolmentIds)];
  for (let offset = 0; offset < identifiers.length; offset += 50) {
    const { data, error } = await client.from("assessment_outcomes")
      .select("enrolment_id,student_id,student_name,student_identifier,module_code,module_title,original_cohort,assessment")
      .in("enrolment_id", identifiers.slice(offset, offset + 50)).order("enrolment_id");
    if (error) throw new Error(error.message);
    rows.push(...data as AssessmentSummary[]);
  }
  return rows;
}

export async function readAssessmentRecords(studentId?: string) {
  const outcomes = await readAssessmentTable<AssessmentOutcome>("assessment_outcomes", studentId ? { column: "student_id", value: studentId } : undefined);
  const client = await assessmentClient();

  async function scopedRows<Row>(table: string, columns: string, column: string, ids: string[]): Promise<Row[]> {
    const rows: Row[] = [];
    for (let batch = 0; batch < ids.length; batch += 50) {
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from(table).select(columns).in(column, ids.slice(batch, batch + 50)).order("id").range(offset, offset + 499);
        if (error) throw new Error(error.message);
        rows.push(...data as Row[]);
        if (data.length < 500) break;
      }
    }
    return rows;
  }

  const attempts = await scopedRows<AssessmentAttempt>("assessment_attempt_history", "id,enrolment_id,component,ordinal,sequence,previous_result_unavailable,origin,source_id,active,revision,revision_id,score,pass_mark,passed,sitting_date,sitting_term,sitting_term_id,is_current,reason,items", "enrolment_id", outcomes.map(outcome => outcome.enrolment_id));
  const revisions = await scopedRows<AssessmentRevision>("assessment_revision_history", "id,attempt_id,revision,score,pass_mark,passed,sitting_date,reason,created_at,source_version_id,items", "attempt_id", attempts.map(attempt => attempt.id));
  const sourceIds = [...new Set(attempts.flatMap(attempt => attempt.source_id ? [attempt.source_id] : []))];
  const sources = await scopedRows<Omit<AssessmentSourceEvidence, "versions">>("module_assessment_source_results", "id,revision,state,source_system,source_key,conflict", "id", sourceIds);
  const sourceVersions = await scopedRows<{ id: string; source_id: string; revision: number; observed_at: string; payload: AssessmentSourceInput }>("module_assessment_source_versions", "id,source_id,revision,observed_at,payload", "source_id", sourceIds);
  const sourceEvidence: AssessmentSourceEvidence[] = sources.map(source => ({ ...source, versions: sourceVersions.filter(version => version.source_id === source.id).sort((first, second) => first.revision - second.revision).map(version => ({
    id: version.id, revision: version.revision, observed_at: version.observed_at, student_identifier: version.payload.student_identifier,
    component: version.payload.component, sitting_date: version.payload.sitting_date, score: version.payload.score ?? null, pass_mark: version.payload.pass_mark ?? null,
    items: (version.payload.items ?? []).map(item => ({ kind: item.kind, score: item.score }))
  })) }));
  const { data: terms, error: termError } = await client.from("terms").select("id,name").order("starts_on", { ascending: false });
  if (termError) throw new Error(termError.message);
  const decisions = await scopedRows<Omit<AssessmentDecision, "actor_name">>("enrolment_assessment_overrides", "id,enrolment_id,kind,indicator,value,reason,created_at,event_order,actor_id", "enrolment_id", outcomes.map(outcome => outcome.enrolment_id));
  const lifecycle = await scopedRows<Omit<AssessmentAttemptEvent, "actor_name">>("assessment_attempt_events", "id,attempt_id,attempt_revision_id,kind,category,exclusion_id,source_version_id,reason,created_at,event_order,actor_id", "enrolment_id", outcomes.map(outcome => outcome.enrolment_id));
  const actors = await scopedRows<{ id: string; full_name: string }>("staff_profiles", "id,full_name", "id", [...new Set([...decisions, ...lifecycle].map(event => event.actor_id))]);
  const actorName = (actorId: string) => actors.find(actor => actor.id === actorId)?.full_name ?? "Administrator";
  return { outcomes, attempts: attempts.map(attempt => ({ ...attempt, lifecycle: lifecycle.filter(event => event.attempt_id === attempt.id).sort((first, second) => second.event_order - first.event_order).map(event => ({ ...event, actor_name: actorName(event.actor_id) })) })), revisions, sourceEvidence, terms: terms as Array<{ id: string; name: string }>, decisions: decisions.map(decision => ({ ...decision, actor_name: actorName(decision.actor_id) })) };
}
