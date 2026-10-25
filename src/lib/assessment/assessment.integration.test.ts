import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AssessmentEvaluation, AssessmentIngestionSummary } from "./types";
import type { WorkspaceAttendance } from "../student-workspace";
import type { EnrolmentWorkspace } from "../student-enrolment";
import type { TeachingOptions } from "../student-teaching";
import type { FinanceSnapshot } from "../student-finance";
import { presentationRubricCriteria } from "../presentation-rubric";

const adminId = randomUUID();
const teacherId = randomUUID();
let db: PGlite;
let studentId: string;
let moduleId: string;
let termId: string;
let offeringId: string;
let enrolmentId: string;
let planId: string;

async function scalar<Value>(sql: string, parameters: unknown[] = []): Promise<Value> {
  const result = await db.query<{ value: Value }>(sql, parameters);
  return result.rows[0]?.value;
}
async function evaluate() { return scalar<AssessmentEvaluation>("select public.read_enrolment_assessment($1) value", [enrolmentId]); }
async function command(input: Record<string, unknown>, revision?: number) {
  return scalar<{ assessment: AssessmentEvaluation; pass_reversed: boolean }>("select public.execute_assessment_command($1::jsonb,$2) value", [JSON.stringify({ enrolment_id: enrolmentId, reason: "Reviewed fixture evidence", ...input }), revision ?? (await evaluate()).revision]);
}
async function plan(input: Record<string, unknown> = {}) {
  planId = await scalar<string>("select public.save_module_assessment_plan($1::jsonb,$2) value", [JSON.stringify({ module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, reason: "Reviewed plan", ...input }), planId ?? null]);
  return planId;
}
async function adopt() {
  const preview = await scalar("select public.preview_enrolment_assessment_plan($1,$2) value", [enrolmentId, planId]);
  return command({ type: "ChangeEnrolmentAssessmentPlan", plan_id: planId, preview });
}
function score(value: number, component = "theory") {
  return { type: "AddManualAttempt", component, sitting_date: "2025-06-15", sitting_term_id: termId, items: component === "theory" ? [{ kind: "mcq", score: value }] : [], score: value };
}
function source(key = randomUUID(), value = 70) {
  return { source_system: "Portal", source_key: key, student_identifier: studentId, module_id: moduleId, component: "theory", score: value,
    sitting_date: "2025-06-15", sitting_term_id: termId, items: [{ kind: "mcq", score: value }], raw_payload: { score: value }, reason: "Reviewed import" };
}
async function ingest(input: unknown[]) { return scalar<AssessmentIngestionSummary>("select public.ingest_assessment_source($1::jsonb) value", [JSON.stringify(input)]); }
async function sourceCommand(type: string, sourceKey: string, extra: Record<string, unknown> = {}) {
  const row = await scalar<{ id: string; revision: number }>("select jsonb_build_object('id',id,'revision',revision) value from public.module_assessment_source_results where source_key=$1", [sourceKey]);
  return command({ type, source_id: row.id, expected_source_revision: row.revision, ...extra });
}
async function lifecycleCommand(type: "ExcludeAttempt" | "RestoreAttempt", attemptId: string, extra: Record<string, unknown> = {}) {
  const sourceRow = await scalar<{ revision: number; version: string }>("select jsonb_build_object('revision',source.revision,'version',(select id from module_assessment_source_versions where source_id=source.id order by revision desc limit 1)) value from module_assessment_source_results source join module_assessment_attempts attempt on attempt.source_id=source.id where attempt.id=$1", [attemptId]);
  const exclusionId = await scalar<string>("select id value from assessment_attempt_events where attempt_id=$1 order by event_order desc limit 1", [attemptId]);
  return command({ type, attempt_id: attemptId, ...(sourceRow ? { expected_source_revision: sourceRow.revision } : {}),
    ...(type === "ExcludeAttempt" ? { category: "invalid" } : { exclusion_id: exclusionId, ...(sourceRow ? { reviewed_source_version_id: sourceRow.version } : {}) }), ...extra });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;`);
  for (const file of ["0001_betar_lms_schema", "0003_formative_assessment_workflow", "0005_term_attendance_sessions", "0010_attendance_admin_note", "0012_enrolment_resit_completion_requirements", "0013_exam_result_attempt_metadata"]) {
    await db.exec(readFileSync(`supabase/migrations/${file}.sql`, "utf8").replace('create extension if not exists "pgcrypto";', ""));
  }
  await db.exec("alter table public.audit_events add column reason text;");
  for (const file of ["0049_assessment_foundation", "0050_assessment_evaluation", "0051_assessment_commands", "0052_assessment_ingestion_projections", "0053_assessment_reconciliation_rollout", "0054_assessment_completion_changes", "0055_assessment_manual_revision_guards", "0056_assessment_imported_corrections", "0057_assessment_attempt_lifecycle", "0058_assessment_manual_matching_disabled", "0059_student_profile_editor", "0060_student_attendance_workspace", "0061_student_enrolment_workspace", "0062_student_teaching_workspace", "0063_student_teaching_active_scope"]) {
    try { await db.exec(readFileSync(`supabase/migrations/${file}.sql`, "utf8")); }
    catch (error) { throw new Error(`${file}: ${(error as Error).message} at ${(error as { position?: string }).position}`); }
  }
  await db.exec(readFileSync("supabase/migrations/0064_student_finance_workspace.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0067_enrolment_added_in_error.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0069_active_enrolment_view_permissions.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0070_enrolment_evidence_retention.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0071_resolve_cancellation_decision_blockers.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0072_assessment_rollout_safe_update.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0073_assessment_source_reversions.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0074_assessment_teaching_carryover.sql", "utf8"));
  await db.exec(`grant usage on schema public, auth to authenticated; grant select on all tables in schema public to authenticated;
    insert into auth.users values ('${adminId}'),('${teacherId}');
    insert into public.staff_profiles(id,full_name,role) values ('${adminId}','Admin','admin'),('${teacherId}','Teacher','teacher');`);
}, 30000);

beforeEach(async () => {
  await db.query("select set_config('test.actor',$1,false)", [adminId]);
  studentId = randomUUID(); moduleId = randomUUID(); termId = randomUUID(); offeringId = randomUUID(); enrolmentId = randomUUID(); planId = "";
  await db.query("insert into public.students(id,temporary_id,first_name,last_name,email,programme,status) values($1::uuid,$1::text,'Test','Student','student@example.test','pgcert','active')", [studentId]);
  await db.query("insert into public.terms(id,name,starts_on,ends_on) values($1::uuid,$1::text,'2025-01-01','2025-05-31')", [termId]);
  await db.query("insert into public.course_modules(id,code,title,mode) values($1::uuid,$1::text,'Test module','online')", [moduleId]);
  await db.query("insert into public.module_offerings(id,module_id,term_id,price_pence,capacity) values($1,$2,$3,0,20)", [offeringId,moduleId,termId]);
  planId = await scalar<string>("select public.save_module_assessment_plan($1::jsonb,null) value", [JSON.stringify({ module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, reason: "Reviewed plan" })]);
  await db.query("insert into public.enrolments(id,student_id,offering_id) values($1,$2,$3)", [enrolmentId,studentId,offeringId]);
});
afterAll(async () => { await db?.close(); });

describe("release review regressions", () => {
  it("records a source score reversion as a new revision instead of retaining a later pass", async () => {
    const failed = source(undefined, 30);
    const passed = { ...failed, score: 70, items: [{ kind: "mcq", score: 70 }], raw_payload: { score: 70 } };
    await ingest([failed]);
    await ingest([passed]);
    expect((await evaluate()).effective_status).toBe("Pass");
    expect((await ingest([failed])).source_updated).toBe(1);
    expect(await evaluate()).toMatchObject({ effective_status: "Fail", awarded_credits: 0 });
    expect((await evaluate()).components.theory).toMatchObject({ score: 30, revision: 3, attempt_count: 1 });
    expect(await scalar<number>("select count(*)::int value from module_assessment_source_versions where source_id=(select id from module_assessment_source_results where source_key=$1)", [failed.source_key])).toBe(3);
    expect((await ingest([failed])).unchanged).toBe(1);
    expect((await evaluate()).components.theory.revision).toBe(3);
  });

  it.each(["manual replacement", "void", "unmatch"])("preserves %s decisions across source reversions", async decision => {
    const original = source();
    await ingest([original]);
    const attemptId = (await evaluate()).components.theory.id!;
    if (decision === "manual replacement") {
      await sourceCommand("CorrectImportedAttempt", original.source_key, { attempt_id: attemptId, items: [{ kind: "mcq", score: 40 }] });
    } else {
      await lifecycleCommand("ExcludeAttempt", attemptId, { category: decision === "void" ? "invalid" : "incorrect_ownership" });
    }
    await ingest([{ ...original, score: 90, items: [{ kind: "mcq", score: 90 }] }]);
    expect((await ingest([original])).source_updated).toBe(1);
    expect((await ingest([original])).unchanged).toBe(1);
    expect(await scalar<number>("select count(*)::int value from module_assessment_source_versions where source_id=(select id from module_assessment_source_results where source_key=$1)", [original.source_key])).toBe(3);
    const result = (await evaluate()).components.theory;
    if (decision === "manual replacement") expect(result).toMatchObject({ id: attemptId, origin: "Manual", score: 40, attempt_count: 1 });
    else expect(result.id).toBeNull();
  });

  it.each(["Fail", "Module deferred", "Abandoned"])("carries prior teaching evidence from a new-workflow %s despite legacy planned status", async status => {
    await db.query("update course_modules set mode='practical' where id=$1", [moduleId]);
    await plan({ practical_pass_mark: 50 }); await adopt();
    await db.query("update enrolments set attendance_days_required_override=1,presentation_required_override=true where id=$1", [enrolmentId]);
    const session = randomUUID();
    await db.query("insert into attendance_sessions(id,term_id,session_date,starts_at,ends_at,location) values($1,$2,'2025-03-01','09:00','17:00','Room')", [session,termId]);
    await db.query("insert into attendance_records(session_id,student_id,status) values($1,$2,'attended')", [session,studentId]);
    await db.query("insert into presentation_scores(student_id,offering_id,staff_user_id,occurred_on,total_score) values($1,$2,$3,'2025-03-01',70)", [studentId,offeringId,adminId]);
    await command(score(30));
    if (status !== "Fail") await command({ type: "SetEnrolmentDisposition", disposition: status });
    expect((await evaluate()).effective_status).toBe(status);
    expect(await scalar("select status::text value from enrolments where id=$1", [enrolmentId])).toBe("planned");
    const repeatTerm = randomUUID();
    const repeatOffering = randomUUID();
    const repeatEnrolment = randomUUID();
    await db.query("insert into terms(id,name,starts_on,ends_on) values($1::uuid,$1::text,'2025-09-01','2025-11-30')", [repeatTerm]);
    await db.query("insert into module_offerings(id,module_id,term_id,price_pence,capacity) values($1,$2,$3,0,20)", [repeatOffering,moduleId,repeatTerm]);
    await db.query("insert into enrolments(id,student_id,offering_id,attendance_days_required_override,presentation_required_override) values($1,$2,$3,1,true)", [repeatEnrolment,studentId,repeatOffering]);
    const repeated = await scalar<AssessmentEvaluation>("select read_enrolment_assessment($1) value", [repeatEnrolment]);
    expect(repeated).toMatchObject({ attendance_actual: 1, presentation_pending: false });
    expect(repeated.effective_indicators).not.toContain("Attendance non-compliance");
    expect(repeated.effective_indicators).not.toContain("Presentation incomplete");
    expect(repeated.components.theory.id).toBeNull();
    await command({ type: "SetAssessmentOverride", kind: "status", value: "Pass" });
    const revoked = await scalar<AssessmentEvaluation>("select read_enrolment_assessment($1) value", [repeatEnrolment]);
    expect(revoked).toMatchObject({ attendance_actual: 0, presentation_pending: true });
    expect(revoked.revision).toBeGreaterThan(repeated.revision);
    expect(await scalar("select assessment_projection->'attendance_actual' value from enrolments where id=$1", [repeatEnrolment])).toBe(0);
    await expect(command({ ...score(70), enrolment_id: repeatEnrolment }, repeated.revision)).rejects.toThrow("changed");
    await command({ type: "ClearAssessmentOverride", kind: "status" });
    const restored = await scalar<AssessmentEvaluation>("select read_enrolment_assessment($1) value", [repeatEnrolment]);
    expect(restored).toMatchObject({ attendance_actual: 1, presentation_pending: false });
    expect(restored.revision).toBeGreaterThan(revoked.revision);
    expect(await scalar("select projection->'attendance_actual' value from enrolment_assessment_history where enrolment_id=$1 and revision=$2", [repeatEnrolment, revoked.revision])).toBe(0);
    for (const component of ["theory", "practical"]) {
      const current = await scalar<AssessmentEvaluation>("select read_enrolment_assessment($1) value", [repeatEnrolment]);
      await command({ ...score(70, component), enrolment_id: repeatEnrolment, sitting_term_id: repeatTerm, sitting_date: "2025-11-15" }, current.revision);
    }
    expect(await scalar<AssessmentEvaluation>("select read_enrolment_assessment($1) value", [repeatEnrolment])).toMatchObject({ effective_status: "Pass", awarded_credits: 10 });
    expect((await evaluate()).components.theory.score).toBe(30);
    await db.query("update enrolments set status='failed',assessment_plan_id=null where id=$1", [enrolmentId]);
    expect(await scalar<AssessmentEvaluation>("select read_enrolment_assessment($1) value", [repeatEnrolment])).toMatchObject({ attendance_actual: 1, presentation_pending: false });
    await db.query("update enrolments set assessment_plan_id=$2 where id=$1", [enrolmentId, planId]);
  });
});

async function financeSnapshot() { return scalar<FinanceSnapshot>("select read_student_finance_workspace($1) value", [studentId]); }
async function financeInput() {
  return { id: randomUUID(), student_id: studentId, term_id: termId, expected_version: null, term_token: (await financeSnapshot()).terms[0].token,
    expected_amount_pence: 12345, invoice_amount_pence: null, paid_amount_pence: 0, invoice_status: "not_requested", payment_status: "not_due", notes: "Reviewed fees" };
}
async function saveFinance(input: unknown) { return scalar<string>("select save_student_finance($1::jsonb) value", [JSON.stringify(input)]); }
describe("student finance workspace", () => {
  it("creates an enrolled term record with exact amounts and preserves assessment results", async () => {
    const before = await evaluate(); const input = await financeInput();
    await saveFinance(input);
    const snapshot = await financeSnapshot();
    expect(snapshot.terms).toEqual([]); expect(snapshot.records[0]).toMatchObject({ expected_amount_pence: 12345, invoice_amount_pence: null, paid_amount_pence: 0 });
    expect(await scalar<string>("select actor_user_id value from audit_events where entity_id=$1", [input.id])).toBe(adminId);
    expect(await evaluate()).toEqual(before);
    await expect(saveFinance(input)).rejects.toThrow("already exists");
    expect(await scalar<number>("select count(*)::int value from finance_records where student_id=$1", [studentId])).toBe(1);
  });
  it("edits orphaned historical records without reassignment or clearing purchase order references", async () => {
    const input = await financeInput(); await saveFinance(input);
    const otherTerm = randomUUID(); await db.query("insert into terms(id,name,starts_on,ends_on) values($1,'Historical finance','2024-01-01','2024-05-01')", [otherTerm]);
    await db.query("update finance_records set term_id=$2,purchase_order_reference='PO-retained' where id=$1", [input.id,otherTerm]);
    const version = (await financeSnapshot()).records[0].version;
    await saveFinance({ ...input, term_id: otherTerm, expected_version: version, term_token: null, invoice_amount_pence: 0, paid_amount_pence: null, payment_status: "outstanding", notes: "Updated" });
    expect((await financeSnapshot()).records[0]).toMatchObject({ invoice_amount_pence: 0, paid_amount_pence: null, notes: "Updated" });
    expect(await scalar<string>("select purchase_order_reference value from finance_records where id=$1", [input.id])).toBe("PO-retained");
    await expect(saveFinance({ ...input, expected_version: (await financeSnapshot()).records[0].version, term_token: null })).rejects.toThrow("changed, moved or was deleted");
  });
  it.each(["edit", "move", "delete", "restore"])("rejects a draft after specialist %s without overwriting", async change => {
    const input = await financeInput(); await saveFinance(input); const version = (await financeSnapshot()).records[0].version;
    if (change === "edit") await db.query("update finance_records set notes='Specialist update',workspace_version=$2 where id=$1", [input.id, version]);
    if (change === "move") await db.query("update finance_records set student_id=$2 where id=$1", [input.id, (await scalar<string>("select id value from students where id<>$1 limit 1", [studentId]))]);
    if (change === "delete" || change === "restore") await db.query("delete from finance_records where id=$1", [input.id]);
    if (change === "restore") await db.query("insert into finance_records(id,student_id,term_id,expected_amount_pence,workspace_version) values($1,$2,$3,12345,$4)", [input.id,studentId,termId,version]);
    await expect(saveFinance({ ...input, term_token: null, expected_version: version })).rejects.toThrow("changed, moved or was deleted");
  });
  it("rejects changed prices, unenrolled terms and fabricated ownership", async () => {
    const input = await financeInput(); await db.query("update module_offerings set price_pence=45678 where id=$1", [offeringId]);
    await expect(saveFinance(input)).rejects.toThrow("offering prices changed");
    expect((await financeSnapshot()).terms[0].suggestedAmountPence).toBe(45678);
    await expect(saveFinance({ ...input, term_id: randomUUID() })).rejects.toThrow("enrolled terms");
    await saveFinance(await financeInput());
    const record = (await financeSnapshot()).records[0];
    await expect(saveFinance({ ...input, id: record.id, expected_version: record.version, term_token: null, student_id: randomUUID() })).rejects.toThrow("Student not found");
  });
  it.each([{ expected_amount_pence: null }, { expected_amount_pence: -1 }, { paid_amount_pence: 1.5 }, { paid_amount_pence: "1" }, { invoice_amount_pence: 2147483648 }, { actor_user_id: adminId }, { invoice_status: "paid" }, { notes: false }])("validates direct RPC fields %j", async extra => {
    await expect(saveFinance({ ...await financeInput(), ...extra })).rejects.toThrow(); expect((await financeSnapshot()).records).toEqual([]);
  });
  it("rolls back creation and updates when mandatory audit fails", async () => {
    const input = await financeInput(); await saveFinance(input); const original = (await financeSnapshot()).records[0];
    await db.exec("create function fail_finance_audit() returns trigger language plpgsql as $$ begin raise exception 'Audit unavailable'; end; $$; create trigger fail_finance_audit before insert on audit_events for each row execute function fail_finance_audit();");
    try {
      await expect(saveFinance({ ...input, expected_version: original.version, term_token: null, notes: "Must roll back" })).rejects.toThrow("Audit unavailable");
      expect((await financeSnapshot()).records[0]).toEqual(original);
      await db.query("delete from finance_records where id=$1", [input.id]);
      await expect(saveFinance(input)).rejects.toThrow("Audit unavailable"); expect((await financeSnapshot()).records).toEqual([]);
    } finally { await db.exec("drop trigger fail_finance_audit on audit_events; drop function fail_finance_audit();"); }
  });
  it("denies teacher, reception, inactive administrator and anonymous reads/writes and keeps helpers private", async () => {
    const input = await financeInput();
    try {
      for (const actor of [teacherId, "", adminId]) {
        if (actor === adminId) await db.query("update staff_profiles set active=false where id=$1", [adminId]);
        await db.query("select set_config('test.actor',$1,false)", [actor]); await expect(financeSnapshot()).rejects.toThrow("administrator"); await expect(saveFinance(input)).rejects.toThrow("administrator");
      }
      await db.query("update staff_profiles set role='reception' where id=$1", [teacherId]); await db.query("select set_config('test.actor',$1,false)", [teacherId]);
      await expect(financeSnapshot()).rejects.toThrow("administrator"); await expect(saveFinance(input)).rejects.toThrow("administrator");
      await db.exec("set role authenticated"); await expect(scalar("select student_finance_term_token($1,$2) value", [studentId,termId])).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role"); await db.query("update staff_profiles set active=true where id=$1", [adminId]); await db.query("update staff_profiles set role='teacher' where id=$1", [teacherId]); await db.query("select set_config('test.actor',$1,false)", [adminId]); }
  });
});

async function attendanceRows(student = studentId) {
  return scalar<WorkspaceAttendance[]>("select public.read_student_attendance($1) value", [student]);
}
async function sharedSession(extra: Record<string, unknown> = {}) {
  return scalar<string>("select public.create_student_term_session($1::jsonb) value", [JSON.stringify({ studentId, sessionId: randomUUID(), termId, date: "2025-03-01", startsAt: "09:00", endsAt: "17:00", location: "Teaching room", reason: "Reviewed term schedule", ...extra })]);
}
async function markAttendance(sessionId: string, status = "attended", extra: Record<string, unknown> = {}) {
  const snapshot = (await attendanceRows()).find(row => row.id === sessionId)!;
  return scalar("select public.save_student_attendance($1::jsonb) value", [JSON.stringify({ studentId, sessionId, expectedRevision: snapshot.revision, expectedSessionRevision: snapshot.sessionRevision, status, expected: false, note: "Reviewed register", reason: "Evidence checked", confirmClear: false, ...extra })]);
}

describe("student attendance and shared term sessions", () => {
  it("preserves reception check-in permissions while denying workspace commands and private revision writes", async () => {
    const sessionId = await sharedSession();
    await markAttendance(sessionId, "expected");
    const original = (await attendanceRows())[0];
    const receptionId = randomUUID();
    await db.query("insert into auth.users(id) values($1)", [receptionId]);
    await db.query("insert into staff_profiles(id,full_name,role) values($1,'Reception','reception')", [receptionId]);
    await db.exec("grant insert,update on attendance_records to authenticated");
    await db.query("select set_config('test.actor',$1,false)", [receptionId]);
    await db.exec("set role authenticated");
    try {
      await db.query("insert into attendance_records(session_id,student_id,status,checked_in_at) values($1,$2,'attended','2025-03-01T09:00:00Z')", [sessionId,studentId]);
      await expect(attendanceRows()).rejects.toThrow("teaching staff");
      await expect(sharedSession()).rejects.toThrow("administrator");
      await expect(scalar("select save_student_attendance('{}') value")).rejects.toThrow("administrator");
      await expect(db.query("update attendance_workspace_versions set revision=0 where session_id=$1", [sessionId])).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role"); await db.query("select set_config('test.actor',$1,false)", [adminId]); }
    expect((await attendanceRows())[0]).toMatchObject({ status: "attended", expected: true });
    await expect(markAttendance(sessionId, "missed", { expectedRevision: original.revision })).rejects.toThrow("Attendance changed");
  });
  it("creates one shared session visible to both enrolled students without expecting or attending anyone", async () => {
    const otherStudent = randomUUID();
    await db.query("insert into students(id,temporary_id,first_name,last_name,email,programme) values($1::uuid,$1::text,'Other','Student','other@example.test','pgcert')", [otherStudent]);
    await db.query("insert into enrolments(student_id,offering_id) values($1,$2)", [otherStudent,offeringId]);
    const sessionId = await sharedSession();
    expect((await attendanceRows())[0]).toMatchObject({ id: sessionId, status: "not_recorded", expected: false, revision: 0, sessionRevision: 0, canEdit: true });
    expect((await attendanceRows(otherStudent))[0]).toMatchObject({ id: sessionId, status: "not_recorded" });
    expect(await scalar<number>("select count(*)::int value from expected_attendance where session_id=$1", [sessionId])).toBe(0);
    expect(await scalar<number>("select count(*)::int value from attendance_records where session_id=$1", [sessionId])).toBe(0);
    await expect(sharedSession()).rejects.toThrow("already exists");
    await expect(sharedSession({ sessionId, date: "2025-04-01" })).rejects.toThrow("already exists");
    await expect(sharedSession({ termId: randomUUID() })).rejects.toThrow("Term no longer exists");
  });
  it("keeps expectations, actual attendance and Not recorded distinct with reasoned clearing", async () => {
    const sessionId = await sharedSession();
    await markAttendance(sessionId, "expected");
    expect((await attendanceRows())[0]).toMatchObject({ status: "expected", expected: true, hasRecord: false });
    await markAttendance(sessionId, "attended", { expected: true });
    expect((await attendanceRows())[0]).toMatchObject({ status: "attended", expected: true, note: "Reviewed register", hasRecord: true });
    await expect(markAttendance(sessionId, "not_recorded")).rejects.toThrow("Confirm clearing");
    await markAttendance(sessionId, "not_recorded", { confirmClear: true });
    expect((await attendanceRows())[0]).toMatchObject({ status: "not_recorded", expected: false, hasRecord: false });
    expect(await scalar<number>("select count(*)::int value from audit_events where entity_id=$1 and action='save_student_attendance'", [studentId])).toBe(3);
    expect(await scalar<string>("select metadata->'before'->>'admin_note' value from audit_events where entity_id=$1 and action='save_student_attendance' and metadata->'after'='null'::jsonb and metadata->'before' is distinct from 'null'::jsonb", [studentId])).toBe("Reviewed register");
  });
  it("preserves reception timestamps on corrections and rejects reception/expectation/session changes against an old draft", async () => {
    const sessionId = await sharedSession();
    await markAttendance(sessionId);
    const old = (await attendanceRows())[0];
    await db.query("update attendance_records set checked_in_at='2025-03-01T09:00:00Z',checked_out_at='2025-03-01T12:00:00Z',status='partial' where session_id=$1", [sessionId]);
    await expect(markAttendance(sessionId, "attended", { expectedRevision: old.revision })).rejects.toThrow("Attendance changed");
    await markAttendance(sessionId, "attended", { note: "Paper register confirms full day" });
    expect((await attendanceRows())[0]).toMatchObject({ status: "attended", checkedInAt: "2025-03-01T09:00:00+00:00", checkedOutAt: "2025-03-01T12:00:00+00:00" });
    const snapshot = (await attendanceRows())[0];
    await db.query("insert into expected_attendance(session_id,student_id) values($1,$2)", [sessionId,studentId]);
    await db.query("delete from expected_attendance where session_id=$1", [sessionId]);
    await expect(markAttendance(sessionId, "missed", { expectedRevision: snapshot.revision })).rejects.toThrow("Attendance changed");
    await db.query("update attendance_sessions set location='Changed room' where id=$1", [sessionId]);
    await expect(markAttendance(sessionId, "missed", { expectedSessionRevision: snapshot.sessionRevision })).rejects.toThrow("Session details changed");
    await expect(markAttendance(sessionId, "missed", { checkedInAt: null })).rejects.toThrow("Invalid attendance command");
  });
  it("detects intervening record creation/deletion without invalidating another student's revision", async () => {
    const sessionId = await sharedSession();
    const initial = (await attendanceRows())[0];
    await markAttendance(sessionId);
    await db.query("delete from attendance_records where session_id=$1", [sessionId]);
    await expect(markAttendance(sessionId, "attended", { expectedRevision: initial.revision })).rejects.toThrow("Attendance changed");
    const otherStudent = randomUUID();
    await db.query("insert into students(id,temporary_id,first_name,last_name,email,programme) values($1::uuid,$1::text,'Other','Student','other@example.test','pgcert')", [otherStudent]);
    const before = (await attendanceRows())[0];
    await db.query("insert into attendance_records(session_id,student_id,status) values($1,$2,'attended')", [sessionId,otherStudent]);
    expect((await attendanceRows())[0].revision).toBe(before.revision);
    await markAttendance(sessionId, "attended", { expectedRevision: before.revision });
  });
  it("rejects unauthorized writes, out-of-term attendance and non-participating session creation", async () => {
    const sessionId = await sharedSession();
    await expect(markAttendance(sessionId, "attended", { studentId: randomUUID() })).rejects.toThrow("enrolled terms");
    await command({ type: "SetEnrolmentDisposition", disposition: "Module deferred" });
    await expect(sharedSession({ date: "2025-04-01" })).rejects.toThrow("participating");
    await db.query("select set_config('test.actor',$1,false)", [teacherId]);
    expect((await attendanceRows()).length).toBe(1);
    await expect(markAttendance(sessionId)).rejects.toThrow("administrator");
    await expect(sharedSession()).rejects.toThrow("administrator");
    await db.query("select set_config('test.actor','',false)");
    await expect(attendanceRows()).rejects.toThrow("teaching staff");
    await expect(sharedSession()).rejects.toThrow("administrator");
  });
  it("rolls back all attendance/expectation/version changes when the final audit fails", async () => {
    const sessionId = await sharedSession();
    await markAttendance(sessionId);
    const before = await attendanceRows();
    await db.exec("create function fail_attendance_audit() returns trigger language plpgsql as $$ begin raise exception 'Audit unavailable'; end; $$; create trigger fail_attendance_audit before insert on audit_events for each row execute function fail_attendance_audit();");
    try {
      await expect(markAttendance(sessionId, "expected", { confirmClear: true })).rejects.toThrow("Audit unavailable");
      await expect(sharedSession({ date: "2025-04-01" })).rejects.toThrow("Audit unavailable");
    } finally { await db.exec("drop trigger fail_attendance_audit on audit_events; drop function fail_attendance_audit();"); }
    expect(await attendanceRows()).toEqual(before);
  });
  it("recalculates every affected Practical enrolment without changing exam evidence or independent credit decisions", async () => {
    await db.query("update course_modules set mode='practical' where id=$1", [moduleId]);
    await plan({ practical_pass_mark: 50 }); await adopt();
    await db.query("update enrolments set attendance_days_required_override=1,presentation_required_override=false where id=$1", [enrolmentId]);
    const secondModule = randomUUID(); const secondOffering = randomUUID(); const secondEnrolment = randomUUID();
    await db.query("insert into course_modules(id,code,title,mode) values($1::uuid,$1::text,'Second practical','practical')", [secondModule]);
    await scalar("select save_module_assessment_plan($1,null) value", [JSON.stringify({ module_id: secondModule, theory_scheme: "mcq", theory_pass_mark: 50, practical_pass_mark: 50, reason: "Reviewed" })]);
    await db.query("insert into module_offerings(id,module_id,term_id,price_pence,capacity) values($1,$2,$3,0,10)", [secondOffering,secondModule,termId]);
    await db.query("insert into enrolments(id,student_id,offering_id,attendance_days_required_override,presentation_required_override) values($1,$2,$3,1,false)", [secondEnrolment,studentId,secondOffering]);
    for (const target of [enrolmentId, secondEnrolment]) {
      for (const component of ["theory", "practical"]) {
        const projection = await scalar<AssessmentEvaluation>("select read_enrolment_assessment($1) value", [target]);
        await command({ ...score(70, component), enrolment_id: target }, projection.revision);
      }
    }
    await command({ type: "SetAssessmentOverride", kind: "credits", value: 5 });
    const firstSession = await sharedSession(); const secondSession = await sharedSession({ date: "2025-03-02" });
    await markAttendance(firstSession); await markAttendance(secondSession);
    expect((await evaluate()).effective_status).toBe("Pass");
    expect(await scalar<string>("select read_enrolment_assessment($1)->>'effective_status' value", [secondEnrolment])).toBe("Pass");
    await markAttendance(secondSession, "missed");
    expect((await evaluate()).effective_status).toBe("Fail");
    expect((await evaluate()).awarded_credits).toBe(5);
    expect(await scalar<string>("select read_enrolment_assessment($1)->>'effective_status' value", [secondEnrolment])).toBe("Fail");
    expect(await scalar<number>("select count(*)::int value from module_assessment_attempt_revisions where attempt_id in (select id from module_assessment_attempts where enrolment_id in ($1,$2))", [enrolmentId,secondEnrolment])).toBe(4);
  });
});

async function enrolmentWorkspace() {
  return scalar<EnrolmentWorkspace>("select read_student_enrolments($1) value", [studentId]);
}
async function manageEnrolment(input: Record<string, unknown> = {}) {
  const row = (await enrolmentWorkspace()).enrolments.find(candidate => candidate.id === enrolmentId)!;
  return command({ type: "SetEnrolmentRequirements", student_id: studentId, expected_token: row.token, attendance_days: 0, presentation_required: false, ...input }, row.revision);
}

describe("mistaken enrolment cancellation", () => {
  async function cancelInput() {
    const row = (await enrolmentWorkspace()).enrolments.find(candidate => candidate.id === enrolmentId)!;
    return { input: { type: "CancelMistakenEnrolment", student_id: studentId, expected_token: row.token, confirmed: true }, revision: row.revision };
  }
  async function cancel() { const { input, revision } = await cancelInput(); return command(input, revision); }
  async function recordedCount(table: string) { return scalar<number>(`select count(*)::int value from ${table} where enrolment_id=$1`, [enrolmentId]); }

  it("cancels unused enrolments even after abandonment, preserving all calculated and decision history", async () => {
    await command({ type: "SetEnrolmentDisposition", disposition: "Abandoned" });
    const history = await recordedCount("enrolment_assessment_history");
    expect(history).toBeGreaterThan(0);
    await cancel();
    expect(await evaluate()).toBeNull();
    expect(await recordedCount("enrolment_assessment_history")).toBe(history);
    expect(await recordedCount("enrolment_disposition_events")).toBe(1);
    expect(await recordedCount("enrolment_cancellations")).toBe(1);
    expect(await scalar<number>("select count(*)::int value from enrolments where id=$1", [enrolmentId])).toBe(1);
    expect(await scalar<number>("select count(*)::int value from active_module_enrolments where id=$1", [enrolmentId])).toBe(0);
    expect(await scalar<number>("select count(*)::int value from assessment_outcomes where enrolment_id=$1", [enrolmentId])).toBe(0);
    expect(await scalar<number>("select count(*)::int value from audit_events where entity_id=$1 and action='enrolment.added_in_error'", [enrolmentId])).toBe(1);
    const workspace = await enrolmentWorkspace();
    expect(workspace.enrolments[0].cancellation).toMatchObject({ reason: "Reviewed fixture evidence", actorName: "Admin" });
    expect(workspace.offerings.some(row => row.id === offeringId)).toBe(false);
    expect(await scalar("select read_enrolment_assessment($1,now()) value", [enrolmentId])).toMatchObject({ disposition: "Abandoned" });
    expect((await financeSnapshot()).terms).toEqual([]);
    await expect(cancel()).rejects.toThrow("already cancelled");
    await expect(command({ type: "ClearEnrolmentDisposition" }, 0)).rejects.toThrow("read-only");
    await expect(db.query("update enrolments set credits_awarded=10 where id=$1", [enrolmentId])).rejects.toThrow("read-only");
    await expect(db.query("delete from enrolments where id=$1", [enrolmentId])).rejects.toThrow("read-only");
    await expect(db.query("delete from enrolment_cancellations where enrolment_id=$1", [enrolmentId])).rejects.toThrow();
    await expect(db.query("insert into enrolments(student_id,offering_id) values($1,$2)", [studentId,offeringId])).rejects.toThrow();
  });
  it.each(["attempt", "voided attempt", "arrangement", "override", "observation", "finance", "attendance", "expected", "legacy outcome"])("blocks cancellation with %s evidence", async kind => {
    if (kind === "attempt" || kind === "voided attempt") {
      await command(score(30));
      if (kind === "voided attempt") await lifecycleCommand("ExcludeAttempt", (await evaluate()).components.theory.id!);
    }
    if (kind === "arrangement") await command({ type: "DeferAssessment", component: "theory", note: "Genuine postponement" });
    if (kind.includes("override")) {
      await command({ type: "SetAssessmentOverride", kind: "credits", value: 0 });
    }
    if (kind === "observation") await db.query("insert into encounter_logs(student_id,offering_id,staff_user_id,occurred_on,summary) values($1,$2,$3,'2025-02-01','Observed')", [studentId,offeringId,adminId]);
    if (kind === "finance") await db.query("insert into finance_records(student_id,term_id,expected_amount_pence) values($1,$2,0)", [studentId,termId]);
    if (kind === "attendance" || kind === "expected") {
      const session = randomUUID();
      await db.query("insert into attendance_sessions(id,term_id,session_date,starts_at,ends_at,location) values($1,$2,'2025-02-01','09:00','17:00','Room')", [session,termId]);
      if (kind === "attendance") await db.query("insert into attendance_records(session_id,student_id,status) values($1,$2,'attended')", [session,studentId]);
      else await db.query("insert into expected_attendance(session_id,student_id) values($1,$2)", [session,studentId]);
    }
    if (kind === "legacy outcome") await db.query("update enrolments set status='completed',credits_awarded=10 where id=$1", [enrolmentId]);
    expect((await enrolmentWorkspace()).enrolments[0].cancellationReasons.length).toBeGreaterThan(0);
    await expect(cancel()).rejects.toThrow("Cancellation blocked");
    expect(await recordedCount("enrolment_cancellations")).toBe(0);
  });
  it.each([
    { kind: "status", value: "In progress" },
    { kind: "credits", value: 0 },
    { kind: "indicator", indicator: "Attendance non-compliance", value: false }
  ])("requires explicit clearing of a non-awarding $kind decision before cancellation", async decision => {
    await command({ type: "SetAssessmentOverride", ...decision });
    await expect(cancel()).rejects.toThrow("Cancellation blocked");
    const { value: unusedValue, ...identity } = decision;
    void unusedValue;
    await command({ type: "ClearAssessmentOverride", ...identity });
    const history = await recordedCount("enrolment_assessment_history");
    await cancel();
    expect(await recordedCount("enrolment_assessment_overrides")).toBe(2);
    expect(await recordedCount("enrolment_evidence_retention")).toBe(1);
    expect(await recordedCount("enrolment_assessment_history")).toBe(history);
  });
  it("requires clearing every active decision, not only the outcome", async () => {
    await command({ type: "SetAssessmentOverride", kind: "status", value: "In progress" });
    await command({ type: "SetAssessmentOverride", kind: "credits", value: 0 });
    await command({ type: "ClearAssessmentOverride", kind: "status" });
    await expect(cancel()).rejects.toThrow("Cancellation blocked");
    await command({ type: "ClearAssessmentOverride", kind: "credits" });
    await cancel();
  });
  it("does not allow clearing a credit award to bypass historical award protection", async () => {
    await command({ type: "SetAssessmentOverride", kind: "credits", value: 5 });
    await command({ type: "ClearAssessmentOverride", kind: "credits" });
    expect((await evaluate()).awarded_credits).toBe(0);
    await expect(cancel()).rejects.toThrow("Cancellation blocked");
    expect(await recordedCount("enrolment_cancellations")).toBe(0);
  });
  it("rechecks new evidence even when an earlier cancellation snapshot was clear", async () => {
    const { input, revision } = await cancelInput();
    await db.query("insert into finance_records(student_id,term_id,expected_amount_pence) values($1,$2,0)", [studentId,termId]);
    await expect(command(input, revision)).rejects.toThrow("Finance records");
  });
  it("retains the cancellation restriction after audited finance is deleted", async () => {
    const input = await financeInput(); await saveFinance(input);
    await db.query("delete from finance_records where id=$1", [input.id]);
    await expect(cancel()).rejects.toThrow("Historical teaching, attendance or finance");
  });
  it("retains the cancellation restriction after an expected attendance entry is cleared", async () => {
    const session = randomUUID();
    await db.query("insert into attendance_sessions(id,term_id,session_date,starts_at,ends_at,location) values($1,$2,'2025-02-01','09:00','17:00','Room')", [session,termId]);
    await db.query("insert into expected_attendance(session_id,student_id) values($1,$2)", [session,studentId]);
    await db.query("delete from expected_attendance where session_id=$1", [session]);
    await expect(cancel()).rejects.toThrow("Historical teaching, attendance or finance");
  });
  it("uses active-view row security without granting mutations", async () => {
    await db.exec("set role authenticated");
    try {
      expect(await scalar<number>("select count(*)::int value from active_module_enrolments where id=$1", [enrolmentId])).toBe(1);
      await expect(db.query("delete from active_module_enrolments where id=$1", [enrolmentId])).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role"); }
    await cancel();
    await db.exec("set role authenticated");
    try { expect(await scalar<number>("select count(*)::int value from active_module_enrolments where id=$1", [enrolmentId])).toBe(0); }
    finally { await db.exec("reset role"); }
  });
  it("blocks cancellation after legacy teaching evidence is removed", async () => {
    await db.query("insert into encounter_logs(student_id,offering_id,staff_user_id,occurred_on,summary) values($1,$2,$3,'2025-02-01','Observed')", [studentId,offeringId,adminId]);
    await db.query("delete from encounter_logs where student_id=$1", [studentId]);
    await expect(cancel()).rejects.toThrow("Cancellation blocked");
    expect(await recordedCount("enrolment_evidence_retention")).toBe(1);
    await expect(db.query("delete from enrolment_evidence_retention where enrolment_id=$1", [enrolmentId])).rejects.toThrow("immutable");
  });
  it("blocks cancellation even after the entire shared attendance session is deleted", async () => {
    const session = randomUUID();
    await db.query("insert into attendance_sessions(id,term_id,session_date,starts_at,ends_at,location) values($1,$2,'2025-02-01','09:00','17:00','Room')", [session,termId]);
    await db.query("insert into expected_attendance(session_id,student_id) values($1,$2)", [session,studentId]);
    await db.query("delete from attendance_sessions where id=$1", [session]);
    await expect(cancel()).rejects.toThrow("Cancellation blocked");
    expect(await recordedCount("enrolment_evidence_retention")).toBe(1);
  });
  it("rejects stale revisions, wrong ownership, missing confirmation and extra fields", async () => {
    const { input, revision } = await cancelInput();
    for (const change of [{ confirmed: false }, { reason: " " }, { reason: 123 }, { actor_id: adminId }, { student_id: randomUUID() }]) {
      await expect(command({ ...input, ...change }, revision)).rejects.toThrow();
    }
    await db.query("update enrolments set attendance_days_required_override=2 where id=$1", [enrolmentId]);
    await expect(command(input, revision)).rejects.toThrow("changed");
    expect(await recordedCount("enrolment_cancellations")).toBe(0);
  });
  it("rolls back cancellation if its audit cannot be written", async () => {
    await db.exec("create function fail_cancellation_audit() returns trigger language plpgsql as $$ begin if new.action='enrolment.added_in_error' then raise exception 'Audit unavailable'; end if; return new; end; $$; create trigger fail_cancellation_audit before insert on audit_events for each row execute function fail_cancellation_audit();");
    try { await expect(cancel()).rejects.toThrow("Audit unavailable"); }
    finally { await db.exec("drop trigger fail_cancellation_audit on audit_events; drop function fail_cancellation_audit();"); }
    expect(await recordedCount("enrolment_cancellations")).toBe(0);
    expect(await evaluate()).not.toBeNull();
  });
  it("denies teachers and direct cancellation-table writes", async () => {
    const { input, revision } = await cancelInput();
    await db.query("select set_config('test.actor',$1,false)", [teacherId]);
    await expect(command(input, revision)).rejects.toThrow("administrator");
    await db.exec("set role authenticated");
    try {
      await expect(db.query("insert into enrolment_cancellations(enrolment_id,actor_id,reason,before_record) values($1,$2,'Bypass','{}')", [enrolmentId,teacherId])).rejects.toThrow();
      await expect(db.query("select execute_assessment_command_v5($1,0)", [JSON.stringify(input)])).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role"); }
  });
  it("excludes cancelled enrolments from import matching and blocks later evidence", async () => {
    await cancel();
    const imported = await ingest([source()]);
    expect(imported).toMatchObject({ auto_matched: 0, unmatched: 1, rejected: 0 });
    expect(await recordedCount("module_assessment_attempts")).toBe(0);
    await expect(command(score(70), 0)).rejects.toThrow("read-only");
    await expect(db.query("insert into encounter_logs(student_id,offering_id,staff_user_id,occurred_on,summary) values($1,$2,$3,'2025-02-01','Late')", [studentId,offeringId,adminId])).rejects.toThrow("cancelled");
    await expect(db.query("insert into finance_records(student_id,term_id,expected_amount_pence) values($1,$2,0)", [studentId,termId])).rejects.toThrow("cancelled");
    const session = randomUUID();
    await db.query("insert into attendance_sessions(id,term_id,session_date,starts_at,ends_at,location) values($1,$2,'2025-02-01','09:00','17:00','Room')", [session,termId]);
    await expect(db.query("insert into expected_attendance(session_id,student_id) values($1,$2)", [session,studentId])).rejects.toThrow("cancelled");
    expect(await scalar("select read_student_attendance($1) value", [studentId])).toEqual([]);
  });
  it("recalculates other practical modules and preserves the cancelled snapshot", async () => {
    await db.query("update course_modules set mode='practical' where id=$1", [moduleId]);
    await plan({ practical_pass_mark: 50 }); await adopt();
    await manageEnrolment({ attendance_days: 2 });
    const peerModule = randomUUID(); const peerOffering = randomUUID(); const peer = randomUUID();
    await db.query("insert into course_modules(id,code,title,mode) values($1::uuid,$1::text,'Peer','practical')", [peerModule]);
    await scalar("select save_module_assessment_plan($1,null) value", [JSON.stringify({ module_id: peerModule, theory_scheme: "mcq", theory_pass_mark: 50, practical_pass_mark: 50, reason: "Reviewed" })]);
    await db.query("insert into module_offerings(id,module_id,term_id,price_pence,capacity) values($1,$2,$3,100,10)", [peerOffering,peerModule,termId]);
    await db.query("insert into enrolments(id,student_id,offering_id,attendance_days_required_override) values($1,$2,$3,1)", [peer,studentId,peerOffering]);
    const projection = () => scalar<AssessmentEvaluation>("select assessment_projection value from enrolments where id=$1", [peer]);
    expect((await projection()).attendance_required).toBe(3);
    await cancel();
    expect((await projection()).attendance_required).toBe(1);
    expect((await financeSnapshot()).terms[0].suggestedAmountPence).toBe(100);
    const history = await recordedCount("enrolment_assessment_history");
    await db.query("update module_offerings set presentation_required=true where id=$1", [offeringId]);
    expect(await recordedCount("enrolment_assessment_history")).toBe(history);
    const session = randomUUID();
    await db.query("insert into attendance_sessions(id,term_id,session_date,starts_at,ends_at,location) values($1,$2,'2025-02-01','09:00','17:00','Room')", [session,termId]);
    await db.query("insert into attendance_records(session_id,student_id,status) values($1,$2,'attended')", [session,studentId]);
    expect((await projection()).attendance_actual).toBe(1);
    expect(await recordedCount("enrolment_assessment_history")).toBe(history);
  });
});

describe("student enrolment workspace", () => {
  it("creates a teaching enrolment with the current reviewed plan, no scores or automatic attendance, and rejects retries", async () => {
    const newStudent = randomUUID();
    await db.query("insert into students(id,temporary_id,first_name,last_name,email,programme) values($1::uuid,$1::text,'New','Student','new@example.test','pgcert')", [newStudent]);
    const workspace = await scalar<EnrolmentWorkspace>("select read_student_enrolments($1) value", [newStudent]);
    const offering = workspace.offerings.find(row => row.id === offeringId)!;
    const newEnrolment = randomUUID();
    const input = { type: "CreateModuleEnrolment", enrolment_id: newEnrolment, student_id: newStudent, offering_id: offeringId, offering_token: offering.token, attendance_days: null, presentation_required: null };
    const result = await command(input, 0);
    expect(result.assessment.plan.id).toBe(planId);
    expect(result.assessment.awarded_credits).toBe(0);
    expect(result.assessment.components.theory.attempt_count).toBe(0);
    expect(await scalar<number>("select count(*)::int value from expected_attendance where student_id=$1", [newStudent])).toBe(0);
    await expect(command(input, 0)).rejects.toThrow("already exists");
    await expect(command({ ...input, enrolment_id: randomUUID() }, 0)).rejects.toThrow("already exists");
  });
  it("rejects creation against unreviewed or changed offering configuration", async () => {
    const offering = (await enrolmentWorkspace()).enrolments[0].offering;
    const input = { type: "CreateModuleEnrolment", enrolment_id: randomUUID(), student_id: studentId, offering_id: offeringId, offering_token: offering.token, attendance_days: null, presentation_required: null };
    await db.query("update module_offerings set presentation_required=true where id=$1", [offeringId]);
    await expect(command(input, 0)).rejects.toThrow("configuration changed");
    await db.query("update course_modules set assessment_plan_id=null where id=$1", [moduleId]);
    try { await expect(command(input, 0)).rejects.toThrow("Review the module assessment plan"); }
    finally { await db.query("update course_modules set assessment_plan_id=$1 where id=$2", [planId,moduleId]); }
  });
  it("supports reasoned requirement changes and clearing in database live mode without reopening legacy outcome fields", async () => {
    await db.query("update course_modules set mode='practical' where id=$1", [moduleId]);
    await plan({ practical_pass_mark: 50 }); await adopt();
    await db.query("update module_offerings set presentation_required=true where id=$1", [offeringId]);
    await command(score(70)); await command(score(75, "practical"));
    await command({ type: "SetAssessmentOverride", kind: "credits", value: 5 });
    await db.exec("update assessment_rollout set mode='live'");
    try {
      expect((await evaluate()).effective_status).toBe("Fail");
      const passed = await manageEnrolment();
      expect(passed.assessment).toMatchObject({ effective_status: "Pass", attendance_required: 0, presentation_pending: false, awarded_credits: 5 });
      expect(passed.assessment.plan.id).toBe(planId);
      const restored = await manageEnrolment({ attendance_days: null, presentation_required: null });
      expect(restored.assessment).toMatchObject({ effective_status: "Fail", attendance_required: 3, presentation_pending: true, awarded_credits: 5 });
      expect(restored.pass_reversed).toBe(true);
      expect(await scalar<number>("select count(*)::int value from module_assessment_attempt_revisions where attempt_id in (select id from module_assessment_attempts where enrolment_id=$1)", [enrolmentId])).toBe(2);
      await expect(db.query("update enrolments set status='completed' where id=$1", [enrolmentId])).rejects.toThrow("read-only");
    } finally { await db.exec("update assessment_rollout set mode='shadow'"); }
  });
  it("recalculates peer modules for requirements and defer/abandon/resume without clearing overrides", async () => {
    await db.query("update course_modules set mode='practical' where id=$1", [moduleId]);
    await plan({ practical_pass_mark: 50 }); await adopt();
    await manageEnrolment({ attendance_days: 1 });
    const secondModule = randomUUID(); const secondOffering = randomUUID(); const secondEnrolment = randomUUID();
    await db.query("insert into course_modules(id,code,title,mode) values($1::uuid,$1::text,'Peer practical','practical')", [secondModule]);
    await scalar("select save_module_assessment_plan($1,null) value", [JSON.stringify({ module_id: secondModule, theory_scheme: "mcq", theory_pass_mark: 50, practical_pass_mark: 50, reason: "Reviewed" })]);
    await db.query("insert into module_offerings(id,module_id,term_id,price_pence,capacity) values($1,$2,$3,0,10)", [secondOffering,secondModule,termId]);
    await db.query("insert into enrolments(id,student_id,offering_id,attendance_days_required_override) values($1,$2,$3,1)", [secondEnrolment,studentId,secondOffering]);
    const projection = () => scalar<AssessmentEvaluation>("select assessment_projection value from enrolments where id=$1", [secondEnrolment]);
    expect((await projection()).attendance_required).toBe(2);
    await manageEnrolment({ attendance_days: 0 });
    expect((await projection()).attendance_required).toBe(1);
    await manageEnrolment({ attendance_days: 2 });
    const revision = (await projection()).revision;
    await command({ type: "SetEnrolmentDisposition", disposition: "Module deferred" });
    expect((await projection()).attendance_required).toBe(1);
    expect((await projection()).revision).toBeGreaterThan(revision);
    await command({ type: "SetEnrolmentDisposition", disposition: "Abandoned" });
    expect((await evaluate()).disposition).toBe("Abandoned");
    await command({ type: "ClearEnrolmentDisposition" });
    expect((await projection()).attendance_required).toBe(3);
    await expect(command({ type: "ClearEnrolmentDisposition" })).rejects.toThrow("no module participation");
  });
  it("preserves stale drafts against legacy requirement writes, configuration changes and wrong ownership", async () => {
    const row = (await enrolmentWorkspace()).enrolments[0];
    const input = { type: "SetEnrolmentRequirements", student_id: studentId, expected_token: row.token, attendance_days: 0, presentation_required: false };
    await db.query("update enrolments set attendance_days_required_override=4 where id=$1", [enrolmentId]);
    await expect(command(input, row.revision)).rejects.toThrow("Enrolment changed");
    const updated = (await enrolmentWorkspace()).enrolments[0];
    await expect(command({ ...input, expected_token: updated.token, student_id: randomUUID() }, updated.revision)).rejects.toThrow("does not belong");
    await db.query("update module_offerings set presentation_required=true where id=$1", [offeringId]);
    await expect(command({ ...input, expected_token: updated.token }, updated.revision)).rejects.toThrow("Enrolment changed");
  });
  it.each([{ attendance_days: -1 }, { attendance_days: 1.5 }, { attendance_days: "0" }, { presentation_required: "false" }, { pass_mark: 1 }, { assessment_plan_id: randomUUID() }, { status: "Pass" }, { reason: " " }])("rejects invalid fields rather than accepting global plans or legacy outcomes: %j", async fields => {
    await expect(manageEnrolment(fields)).rejects.toThrow();
  });
  it("blocks removal based on calculated history even without a visible score", async () => {
    const row = (await enrolmentWorkspace()).enrolments[0];
    expect(row.removalReasons).toContain("Calculated assessment history is retained, even when no exam score has been entered.");
    await expect(command({ type: "RemoveModuleEnrolment", student_id: studentId, expected_token: row.token, confirmed: true }, row.revision)).rejects.toThrow("Cannot remove");
    expect((await evaluate()).components.theory.attempt_count).toBe(0);
  });
  it("removes only confirmed genuinely unused legacy enrolments with atomic audit", async () => {
    const legacyModule = randomUUID(); const legacyOffering = randomUUID(); const legacyEnrolment = randomUUID();
    await db.query("insert into course_modules(id,code,title,mode) values($1::uuid,$1::text,'Legacy','online')", [legacyModule]);
    await db.query("insert into module_offerings(id,module_id,term_id,price_pence,capacity) values($1,$2,$3,0,10)", [legacyOffering,legacyModule,termId]);
    await db.query("insert into enrolments(id,student_id,offering_id) values($1,$2,$3)", [legacyEnrolment,studentId,legacyOffering]);
    const row = (await enrolmentWorkspace()).enrolments.find(candidate => candidate.id === legacyEnrolment)!;
    expect(row.removalReasons).toEqual([]);
    const input = { type: "RemoveModuleEnrolment", enrolment_id: legacyEnrolment, student_id: studentId, expected_token: row.token, confirmed: true };
    await expect(command({ ...input, confirmed: false }, row.revision)).rejects.toThrow("Confirm removal");
    await db.exec("create function fail_removal_audit() returns trigger language plpgsql as $$ begin raise exception 'Audit unavailable'; end; $$; create trigger fail_removal_audit before insert on audit_events for each row execute function fail_removal_audit();");
    try { await expect(command(input, row.revision)).rejects.toThrow("Audit unavailable"); }
    finally { await db.exec("drop trigger fail_removal_audit on audit_events; drop function fail_removal_audit();"); }
    expect(await scalar<number>("select count(*)::int value from enrolments where id=$1", [legacyEnrolment])).toBe(1);
    await command(input, row.revision);
    expect(await scalar<number>("select count(*)::int value from enrolments where id=$1", [legacyEnrolment])).toBe(0);
    expect(await scalar<number>("select count(*)::int value from audit_events where entity_id=$1 and action='assessment.RemoveModuleEnrolment'", [legacyEnrolment])).toBe(1);
    await db.query("delete from module_offerings where id=$1", [legacyOffering]);
    await db.query("delete from course_modules where id=$1", [legacyModule]);
  });
  it("rolls back requirement changes, peer recalculations and creation when auditing fails", async () => {
    const before = await enrolmentWorkspace();
    const newStudent = randomUUID(); const newEnrolment = randomUUID();
    await db.query("insert into students(id,temporary_id,first_name,last_name,email,programme) values($1::uuid,$1::text,'Rollback','Student','rollback@example.test','pgcert')", [newStudent]);
    await db.exec("create function fail_enrolment_audit() returns trigger language plpgsql as $$ begin raise exception 'Audit unavailable'; end; $$; create trigger fail_enrolment_audit before insert on audit_events for each row execute function fail_enrolment_audit();");
    try {
      await expect(manageEnrolment()).rejects.toThrow("Audit unavailable");
      await expect(command({ type: "SetEnrolmentDisposition", disposition: "Abandoned" })).rejects.toThrow("Audit unavailable");
      await expect(command({ type: "CreateModuleEnrolment", enrolment_id: newEnrolment, student_id: newStudent, offering_id: offeringId, offering_token: before.enrolments[0].offering.token, attendance_days: null, presentation_required: null }, 0)).rejects.toThrow("Audit unavailable");
    } finally { await db.exec("drop trigger fail_enrolment_audit on audit_events; drop function fail_enrolment_audit();"); }
    expect(await enrolmentWorkspace()).toEqual(before);
    expect(await scalar<number>("select count(*)::int value from enrolments where id=$1", [newEnrolment])).toBe(0);
  });
  it("denies teachers, anonymous actors, inactive administrators and direct helper access", async () => {
    const row = (await enrolmentWorkspace()).enrolments[0];
    for (const actor of [teacherId, ""]) {
      await db.query("select set_config('test.actor',$1,false)", [actor]);
      await expect(enrolmentWorkspace()).rejects.toThrow("administrator");
      await expect(command({ type: "SetEnrolmentRequirements", student_id: studentId, expected_token: row.token, attendance_days: 0, presentation_required: false }, row.revision)).rejects.toThrow("administrator");
      await expect(command({ type: "RemoveModuleEnrolment", student_id: studentId, expected_token: row.token, confirmed: true }, row.revision)).rejects.toThrow("administrator");
      await expect(command({ type: "CreateModuleEnrolment", student_id: studentId, offering_id: offeringId, offering_token: row.offering.token, attendance_days: null, presentation_required: null }, 0)).rejects.toThrow("administrator");
    }
    await db.query("select set_config('test.actor',$1,false)", [adminId]);
    await db.query("update staff_profiles set active=false where id=$1", [adminId]);
    try { await expect(enrolmentWorkspace()).rejects.toThrow("administrator"); }
    finally { await db.query("update staff_profiles set active=true where id=$1", [adminId]); }
    expect(await scalar<boolean>("select has_function_privilege('authenticated','student_enrolment_removal_reasons(uuid)','execute') value")).toBe(false);
    expect(await scalar<boolean>("select has_function_privilege('authenticated','execute_assessment_command_v4(jsonb,integer)','execute') value")).toBe(false);
  });
});

async function teachingOptions() { return scalar<TeachingOptions>("select read_student_teaching_options($1) value", [studentId]); }
async function teachingInput(kind = "observation", extra: Record<string, unknown> = {}) {
  const options = await teachingOptions(); const offering = options.offerings.find(row => row.id === offeringId)!;
  return { id: randomUUID(), student_id: studentId, offering_id: offeringId, offering_token: offering.token, occurred_on: "2025-03-01", kind,
    ...(kind === "observation" ? { summary: "Observed scan", concern_level: "watch" } : kind === "presentation" ? { presentation_type: "case_presentation", duration_minutes: 20, scores: Object.fromEntries(presentationRubricCriteria.map(criterion => [criterion.id, 4])), comments: "Reviewed presentation" } : {}), ...extra };
}
async function saveTeaching(input: Record<string, unknown>) { return scalar<{ id: string; kind: string }>("select create_student_teaching_record($1) value", [JSON.stringify(input)]); }
async function teachingDefinition() {
  const definitionId = randomUUID();
  await db.query("insert into assessment_definitions(id,module_id,name,domains,score_min,score_max) values($1,$2,'Observed skill',$3,0,5)", [definitionId,moduleId,JSON.stringify([{ id: "image", label: "Image quality" }, { id: "interpret", label: "Interpretation" }])]);
  return (await teachingOptions()).definitions.find(row => row.id === definitionId)!;
}

describe("student teaching workspace", () => {
  beforeEach(async () => {
    await db.exec("update terms set status='draft' where status='active'");
    await db.query("update terms set status='active' where id=$1", [termId]);
  });
  it("scopes options to enrolled offerings and active module definitions without finance data", async () => {
    const definition = await teachingDefinition();
    const options = await teachingOptions();
    expect(options.offerings.map(row => row.id)).toEqual([offeringId]);
    expect(options.definitions.map(row => row.id)).toEqual([definition.id]);
    expect(options.offerings[0]).not.toHaveProperty("price_pence");
    await db.query("update assessment_definitions set active=false where id=$1", [definition.id]);
    expect((await teachingOptions()).definitions).toEqual([]);
  });
  it("allows teachers to record observations with server-owned authorship and atomic audit", async () => {
    const input = await teachingInput();
    await db.query("select set_config('test.actor',$1,false)", [teacherId]);
    const saved = await saveTeaching(input);
    expect(await scalar("select jsonb_build_object('author',staff_user_id,'concern',concern_level,'summary',summary) value from encounter_logs where id=$1", [saved.id])).toEqual({ author: teacherId, concern: "watch", summary: "Observed scan" });
    expect(await scalar("select metadata->'record'->>'staff_user_id' value from audit_events where entity_id=$1", [saved.id])).toBe(teacherId);
    expect((await evaluate()).components.theory.attempt_count).toBe(0);
    expect((await evaluate()).calculated_status).toBe("In progress");
  });
  it("records formative items and a zero overall score without creating a summative attempt", async () => {
    const definition = await teachingDefinition();
    const input = await teachingInput("formative", { definition_id: definition.id, definition_token: definition.token, assessed_item_ids: ["image"], overall_score: 0, comments: "Zero is recorded evidence" });
    const saved = await saveTeaching(input);
    expect(await scalar("select jsonb_build_object('score',overall_score,'items',assessed_item_ids,'scores',scores) value from assessment_attempts where id=$1", [saved.id])).toEqual({ score: 0, items: ["image"], scores: {} });
    expect((await evaluate()).components.theory.attempt_count).toBe(0);
    expect(await scalar("select metadata->'definition'->>'name' value from audit_events where entity_id=$1", [saved.id])).toBe("Observed skill");
  });
  it("uses all rubric criteria, calculates the total and resolves presentation compliance without altering scores or credits overrides", async () => {
    await db.query("update course_modules set mode='practical' where id=$1", [moduleId]);
    await plan({ practical_pass_mark: 50 }); await adopt();
    await db.query("update enrolments set attendance_days_required_override=0,presentation_required_override=true where id=$1", [enrolmentId]);
    await command(score(70)); await command(score(75,"practical"));
    await command({ type: "SetAssessmentOverride", kind: "credits", value: 5 });
    expect((await evaluate()).presentation_pending).toBe(true);
    const saved = await saveTeaching(await teachingInput("presentation"));
    expect(await scalar("select total_score value from presentation_scores where id=$1", [saved.id])).toBe(40);
    expect((await evaluate())).toMatchObject({ presentation_pending: false, effective_status: "Pass", awarded_credits: 5 });
    expect((await evaluate()).components.theory).toMatchObject({ score: 70, attempt_count: 1 });
    expect((await evaluate()).components.practical).toMatchObject({ score: 75, attempt_count: 1 });
  });
  it("rejects stale enrolment and definition snapshots without writing partial records", async () => {
    const definition = await teachingDefinition();
    const input = await teachingInput("formative", { definition_id: definition.id, definition_token: definition.token, assessed_item_ids: ["image"], overall_score: 3, comments: null });
    await db.query("update assessment_definitions set name='Changed scale' where id=$1", [definition.id]);
    await expect(saveTeaching(input)).rejects.toThrow("configuration changed");
    const observation = await teachingInput();
    await db.query("update module_offerings set presentation_required=true where id=$1", [offeringId]);
    await expect(saveTeaching(observation)).rejects.toThrow("details changed");
    expect(await scalar<number>("select count(*)::int value from assessment_attempts where student_id=$1", [studentId])).toBe(0);
  });
  it.each([{ assessed_item_ids: [] }, { assessed_item_ids: ["other"] }, { assessed_item_ids: ["image","image"] }, { overall_score: 6 }, { overall_score: 1.5 }, { staff_user_id: teacherId }])("validates formative fields: %j", async extra => {
    const definition = await teachingDefinition();
    await expect(saveTeaching(await teachingInput("formative", { definition_id: definition.id, definition_token: definition.token, assessed_item_ids: ["image"], overall_score: 3, comments: null, ...extra }))).rejects.toThrow();
  });
  it("rejects a definition from another module even when the client supplies its correct snapshot", async () => {
    const definition = await teachingDefinition(); const otherModule = randomUUID();
    await db.query("insert into course_modules(id,code,title,mode) values($1::uuid,$1::text,'Other','online')", [otherModule]);
    await db.query("update assessment_definitions set module_id=$1 where id=$2", [otherModule,definition.id]);
    const token = await scalar<string>("select md5(to_jsonb(definition)::text) value from assessment_definitions definition where id=$1", [definition.id]);
    await expect(saveTeaching(await teachingInput("formative", { definition_id: definition.id, definition_token: token, assessed_item_ids: ["image"], overall_score: 3, comments: null }))).rejects.toThrow("for this module");
    await db.query("update assessment_definitions set module_id=$1 where id=$2", [moduleId,definition.id]);
    await db.query("delete from course_modules where id=$1", [otherModule]);
  });
  it.each([{ scores: {} }, { duration_minutes: 0 }, { presentation_type: "exam" }, { total_score: 50 }, { scores: Object.fromEntries(presentationRubricCriteria.map(criterion => [criterion.id, 6])) }])("rejects incomplete, forged or invalid presentation evidence: %j", async extra => {
    await expect(saveTeaching(await teachingInput("presentation", extra))).rejects.toThrow();
  });
  it("rejects spoofed authors, empty observations, non-enrolled offerings and repeat identifiers", async () => {
    await expect(saveTeaching(await teachingInput("observation", { staff_user_id: teacherId }))).rejects.toThrow("Invalid teaching record fields");
    await expect(saveTeaching(await teachingInput("observation", { summary: " " }))).rejects.toThrow("observation details");
    await expect(saveTeaching(await teachingInput("observation", { offering_id: randomUUID() }))).rejects.toThrow("current active teaching term");
    const input = await teachingInput(); await saveTeaching(input);
    const latest = await teachingInput("observation", { id: input.id });
    await expect(saveTeaching(latest)).rejects.toThrow("already saved");
    expect(await scalar<number>("select count(*)::int value from encounter_logs where student_id=$1", [studentId])).toBe(1);
  });
  it("rolls back teaching evidence, recalculation and audit together", async () => {
    const before = await evaluate(); const input = await teachingInput("presentation");
    await db.exec("create function fail_teaching_audit() returns trigger language plpgsql as $$ begin raise exception 'Audit unavailable'; end; $$; create trigger fail_teaching_audit before insert on audit_events for each row execute function fail_teaching_audit();");
    try { await expect(saveTeaching(input)).rejects.toThrow("Audit unavailable"); }
    finally { await db.exec("drop trigger fail_teaching_audit on audit_events; drop function fail_teaching_audit();"); }
    expect(await evaluate()).toEqual(before);
    expect(await scalar<number>("select count(*)::int value from presentation_scores where student_id=$1", [studentId])).toBe(0);
  });
  it("rejects reception, anonymous and inactive teachers, and keeps helpers private", async () => {
    const input = await teachingInput();
    await db.query("update staff_profiles set role='reception' where id=$1", [teacherId]);
    try {
      for (const actor of [teacherId, ""]) {
        await db.query("select set_config('test.actor',$1,false)", [actor]);
        await expect(teachingOptions()).rejects.toThrow("Active teaching staff");
        await expect(saveTeaching(input)).rejects.toThrow("Active teaching staff");
      }
      await db.query("update staff_profiles set role='teacher',active=false where id=$1", [teacherId]);
      await db.query("select set_config('test.actor',$1,false)", [teacherId]);
      await expect(saveTeaching(input)).rejects.toThrow("Active teaching staff");
    } finally { await db.query("update staff_profiles set role='teacher',active=true where id=$1", [teacherId]); await db.query("select set_config('test.actor',$1,false)", [adminId]); }
    expect(await scalar<boolean>("select has_function_privilege('authenticated','student_teaching_offering(uuid,uuid)','execute') value")).toBe(false);
    expect(await scalar<boolean>("select has_function_privilege('authenticated','create_student_teaching_record_v1(jsonb)','execute') value")).toBe(false);
  });
  it("preserves active-student/current-term teaching scope and rejects lifecycle changes while a draft is open", async () => {
    const input = await teachingInput();
    await db.query("update students set status='withdrawn' where id=$1", [studentId]);
    expect((await teachingOptions()).offerings).toEqual([]);
    await expect(saveTeaching(input)).rejects.toThrow("active student");
    await db.query("update students set status='active' where id=$1", [studentId]);
    await db.query("update terms set status='closed' where id=$1", [termId]);
    expect((await teachingOptions()).offerings).toEqual([]);
    await expect(saveTeaching(input)).rejects.toThrow("current active teaching term");
    await db.query("update terms set status='active' where id=$1", [termId]);
    await expect(saveTeaching(await teachingInput("observation", { occurred_on: "infinity" }))).rejects.toThrow("calendar date");
  });
});

describe("assessment PostgreSQL commands and evaluator", () => {
  it.each(["MatchSourceResult", "UnmatchSourceResult", "ReplaceSourceResult", "VoidSourceResult", "RestoreSourceResult"])("blocks %s even for administrators without mutating accepted evidence", async type => {
    const input = source(); await ingest([input]);
    const before = await evaluate();
    const sourceBefore = await scalar("select to_jsonb(source) value from module_assessment_source_results source where source_key=$1", [input.source_key]);
    const auditCount = await scalar<number>("select count(*)::int value from audit_events where entity_id=$1", [enrolmentId]);
    await expect(sourceCommand(type, input.source_key, { identity_override_reason: "Reviewed identity", items: [{ kind: "mcq", score: 40 }] })).rejects.toThrow("disabled");
    expect(await evaluate()).toEqual(before);
    expect(await scalar("select to_jsonb(source) value from module_assessment_source_results source where source_key=$1", [input.source_key])).toEqual(sourceBefore);
    expect(await scalar<number>("select count(*)::int value from audit_events where entity_id=$1", [enrolmentId])).toBe(auditCount);
  });
  it("does not expose previous command entry points to API roles", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const version of ["v1", "v2", "v3"]) {
        expect(await scalar<boolean>("select has_function_privilege($1,$2,'execute') value", [role, `public.execute_assessment_command_${version}(jsonb,integer)`])).toBe(false);
      }
    }
    await db.exec("set role authenticated");
    try {
      await expect(db.query("select public.execute_assessment_command_v3('{}',0)")).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role"); }
  });
  it("excludes and restores a Manual result without deleting or inventing an attempt", async () => {
    const initial = await command(score(70));
    const attemptId = initial.assessment.components.theory.id;
    const excluded = await command({ type: "ExcludeAttempt", attempt_id: attemptId, category: "invalid" });
    expect(excluded.assessment.components.theory.attempt_count).toBe(0);
    expect(excluded.assessment.awarded_credits).toBe(0);
    expect(excluded.pass_reversed).toBe(true);
    const exclusionId = await scalar<string>("select id value from assessment_attempt_events where attempt_id=$1 and kind='exclude'", [attemptId]);
    const restored = await command({ type: "RestoreAttempt", attempt_id: attemptId, exclusion_id: exclusionId });
    expect(restored.assessment.components.theory).toMatchObject({ id: attemptId, score: 70, attempt_count: 1, sequence: 1, revision: 1 });
    expect(restored.assessment.awarded_credits).toBe(10);
    expect(await scalar<number>("select count(*)::int value from assessment_attempt_history where enrolment_id=$1", [enrolmentId])).toBe(1);
  });
  it.each(["invalid", "incorrect_ownership"])("excludes imported %s evidence and restores only the reviewed original score", async category => {
    const imported = source(); await ingest([imported]);
    const original = await evaluate();
    const attemptId = original.components.theory.id!;
    await lifecycleCommand("ExcludeAttempt", attemptId, { category });
    expect(await scalar<string>("select state value from module_assessment_source_results where source_key=$1", [imported.source_key])).toBe(category === "invalid" ? "Voided" : "Unmatched");
    await ingest([{ ...imported, score: 95, items: [{ kind: "mcq", score: 95 }] }]);
    expect((await evaluate()).components.theory.attempt_count).toBe(0);
    await expect(lifecycleCommand("RestoreAttempt", attemptId, { reviewed_source_version_id: null })).rejects.toThrow("latest source evidence");
    await expect(sourceCommand("MatchSourceResult", imported.source_key)).rejects.toThrow("disabled");
    await expect(sourceCommand("RestoreSourceResult", imported.source_key)).rejects.toThrow("disabled");
    const restored = await lifecycleCommand("RestoreAttempt", attemptId);
    expect(restored.assessment.components.theory).toMatchObject({ id: attemptId, score: 70, revision: 1, sequence: 1, attempt_count: 1 });
    expect(await scalar<string>("select state value from module_assessment_source_results where source_key=$1", [imported.source_key])).toBe("Matched");
    await ingest([{ ...imported, score: 20, items: [{ kind: "mcq", score: 20 }] }]);
    expect((await evaluate()).components.theory.score).toBe(70);
  });
  it("restores a Manual replacement without reviving the incorrect imported score or clearing credit decisions", async () => {
    const imported = source(); await ingest([imported]);
    const attemptId = (await evaluate()).components.theory.id!;
    await sourceCommand("CorrectImportedAttempt", imported.source_key, { attempt_id: attemptId, items: [{ kind: "mcq", score: 40 }] });
    await command({ type: "SetAssessmentOverride", kind: "credits", value: 7 });
    const excluded = await lifecycleCommand("ExcludeAttempt", attemptId);
    expect(excluded.assessment.awarded_credits).toBe(7);
    const restored = await lifecycleCommand("RestoreAttempt", attemptId);
    expect(restored.assessment.components.theory).toMatchObject({ score: 40, origin: "Manual", revision: 2, attempt_count: 1 });
    expect(restored.assessment.awarded_credits).toBe(7);
    expect(await scalar<string>("select state value from module_assessment_source_results where source_key=$1", [imported.source_key])).toBe("Replaced manually");
  });
  it("guards stale, unauthorized, repeated and cross-enrolment lifecycle requests", async () => {
    const imported = source(); await ingest([imported]);
    const initial = await evaluate();
    const attemptId = initial.components.theory.id!;
    await expect(lifecycleCommand("ExcludeAttempt", attemptId, { expected_source_revision: -1 })).rejects.toThrow("Source changed");
    await expect(lifecycleCommand("ExcludeAttempt", attemptId, { enrolment_id: randomUUID() })).rejects.toThrow("not owned");
    await expect(lifecycleCommand("ExcludeAttempt", attemptId, { score: 90 })).rejects.toThrow("cannot edit");
    await expect(lifecycleCommand("ExcludeAttempt", attemptId, { reason: " " })).rejects.toThrow("reason");
    await expect(command({ type: "ExcludeAttempt", attempt_id: attemptId, category: "invalid", expected_source_revision: 1 }, initial.revision - 1)).rejects.toThrow("Assessment changed");
    await db.query("select set_config('test.actor',$1,false)", [teacherId]);
    await expect(lifecycleCommand("ExcludeAttempt", attemptId)).rejects.toThrow("administrator");
    await db.query("select set_config('test.actor',$1,false)", [adminId]);
    expect(await evaluate()).toEqual(initial);
    await lifecycleCommand("ExcludeAttempt", attemptId);
    await expect(lifecycleCommand("ExcludeAttempt", attemptId)).rejects.toThrow("already excluded");
    await expect(lifecycleCommand("RestoreAttempt", attemptId, { exclusion_id: randomUUID() })).rejects.toThrow("current exclusion");
    await db.exec("set role authenticated");
    try {
      await expect(db.query("select public.execute_assessment_command_v2('{}'::jsonb,0)")).rejects.toThrow("permission denied");
      await expect(db.query("delete from assessment_attempt_events where attempt_id=$1", [attemptId])).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role"); }
  });
  it("blocks restoration with later attempts, incompatible plans or changed carried evidence", async () => {
    await plan({ physics_weighting: true }); await adopt();
    const initial = await command({ ...score(30), items: [{ kind: "mcq", score: 0 }, { kind: "physics", score: 60 }] });
    const firstId = initial.assessment.components.theory.id!;
    const carriedId = await scalar<string>("select item.id value from module_assessment_items item join assessment_current_revisions revision on revision.id=item.revision_id where revision.attempt_id=$1 and item.kind='physics'", [firstId]);
    const resit = await command({ ...score(70), items: [{ kind: "mcq", score: 80 }, { kind: "physics", carried_from_item_id: carriedId }] });
    const resitId = resit.assessment.components.theory.id!;
    await expect(lifecycleCommand("ExcludeAttempt", firstId)).rejects.toThrow("later active attempt");
    await lifecycleCommand("ExcludeAttempt", resitId);
    await command({ ...score(30), type: "CorrectManualAttempt", attempt_id: firstId, items: [{ kind: "mcq", score: 0 }, { kind: "physics", score: 60 }] });
    await expect(lifecycleCommand("RestoreAttempt", resitId)).rejects.toThrow("Carried evidence");
    await lifecycleCommand("ExcludeAttempt", firstId);
    await plan({ physics_weighting: false }); await adopt();
    await expect(lifecycleCommand("RestoreAttempt", resitId)).rejects.toThrow("incompatible");
    await command(score(60));
    await expect(lifecycleCommand("RestoreAttempt", firstId)).rejects.toThrow("later active attempt");
  });
  it("blocks restoration after source identity conflict or an intervening earlier pass", async () => {
    const imported = source(undefined, 30); await ingest([imported]);
    const firstId = (await evaluate()).components.theory.id!;
    const resit = await command(score(70));
    await lifecycleCommand("ExcludeAttempt", resit.assessment.components.theory.id!);
    await sourceCommand("CorrectImportedAttempt", imported.source_key, { attempt_id: firstId, items: [{ kind: "mcq", score: 65 }] });
    await expect(lifecycleCommand("RestoreAttempt", resit.assessment.components.theory.id!)).rejects.toThrow("earlier accepted result conflicts");
    await lifecycleCommand("ExcludeAttempt", firstId);
    await ingest([{ ...imported, student_identifier: "different student" }]);
    await expect(lifecycleCommand("RestoreAttempt", firstId)).rejects.toThrow("unresolved conflict");
  });
  it.each(["ExcludeAttempt", "RestoreAttempt"] as const)("rolls back %s and its lifecycle event if the final audit fails", async operation => {
    const imported = source(); await ingest([imported]);
    const attemptId = (await evaluate()).components.theory.id!;
    if (operation === "RestoreAttempt") await lifecycleCommand("ExcludeAttempt", attemptId);
    const before = await evaluate();
    await db.exec(`create function public.test_reject_exclusion_audit() returns trigger language plpgsql as $$ begin
      if new.action = 'assessment.${operation}' then raise exception 'Simulated exclusion audit failure'; end if; return new; end $$;
      create trigger test_exclusion_failure before insert on public.audit_events for each row execute function public.test_reject_exclusion_audit();`);
    try { await expect(lifecycleCommand(operation, attemptId)).rejects.toThrow("Simulated exclusion audit failure"); }
    finally { await db.exec("drop trigger test_exclusion_failure on public.audit_events; drop function public.test_reject_exclusion_audit();"); }
    expect(await evaluate()).toEqual(before);
    expect(await scalar<number>("select count(*)::int value from assessment_attempt_events where enrolment_id=$1", [enrolmentId])).toBe(operation === "RestoreAttempt" ? 1 : 0);
    expect(await scalar<string>("select state value from module_assessment_source_results where source_key=$1", [imported.source_key])).toBe(operation === "RestoreAttempt" ? "Voided" : "Matched");
  });
  it("atomically corrects an imported result on the same sitting without an intermediate pass reversal", async () => {
    const imported = { ...source(), pass_mark: 45 };
    await ingest([imported]);
    const before = await evaluate();
    const result = await sourceCommand("CorrectImportedAttempt", imported.source_key, { attempt_id: before.components.theory.id, items: [{ kind: "mcq", score: 65 }] });
    expect(result.pass_reversed).toBe(false);
    expect(result.assessment).toMatchObject({ revision: before.revision + 1, effective_status: "Pass", awarded_credits: 10 });
    expect(result.assessment.components.theory).toMatchObject({ id: before.components.theory.id, score: 65, pass_mark: 45, origin: "Manual", attempt_count: 1, sequence: 1, revision: 2 });
    expect(await scalar<string>("select state value from module_assessment_source_results where source_key=$1", [imported.source_key])).toBe("Replaced manually");
    expect(await scalar<number>("select count(*)::int value from assessment_revision_history where attempt_id=$1", [before.components.theory.id])).toBe(2);
    expect(await scalar<number>("select (payload->>'score')::float8 value from module_assessment_source_versions where source_id=(select id from module_assessment_source_results where source_key=$1)", [imported.source_key])).toBe(70);
  });
  it("leaves an imported result fully accepted when correction validation or revision checks fail", async () => {
    const imported = source();
    await ingest([imported]);
    const before = await evaluate();
    const sourceRow = await scalar<{ id: string; revision: number }>("select jsonb_build_object('id',id,'revision',revision) value from module_assessment_source_results where source_key=$1", [imported.source_key]);
    const correction = { type: "CorrectImportedAttempt", attempt_id: before.components.theory.id, source_id: sourceRow.id, expected_source_revision: sourceRow.revision, items: [{ kind: "mcq", score: 40 }] };
    await expect(command({ ...correction, items: [] })).rejects.toThrow("missing");
    await expect(command({ ...correction, expected_source_revision: sourceRow.revision - 1 })).rejects.toThrow("Source changed");
    await expect(command(correction, before.revision - 1)).rejects.toThrow("Assessment changed");
    for (const injection of [{ pass_mark: 10 }, { sitting_date: "2025-06-16" }, { component: "practical" }, { identity_override_reason: "move" }]) {
      await expect(command({ ...correction, ...injection })).rejects.toThrow("cannot change");
    }
    await expect(command({ ...correction, attempt_id: randomUUID() })).rejects.toThrow("owned by this enrolment");
    expect(await evaluate()).toEqual(before);
    expect(await scalar<string>("select state value from module_assessment_source_results where id=$1", [sourceRow.id])).toBe("Matched");
    expect(await scalar<number>("select revision value from module_assessment_source_results where id=$1", [sourceRow.id])).toBe(sourceRow.revision);
    expect(await scalar<number>("select count(*)::int value from assessment_revision_history where attempt_id=$1", [before.components.theory.id])).toBe(1);
    await db.query("select set_config('test.actor',$1,false)", [teacherId]);
    await expect(command(correction, before.revision)).rejects.toThrow("administrator");
    await db.exec("set role authenticated");
    try {
      await expect(db.query("select public.execute_assessment_command_v1('{}'::jsonb,0)")).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role"); }
  });
  it.each([[30, 70, false], [70, 30, true]] as const)("corrects an imported %i to %i with only the net pass reversal %s and protects the replacement", async (originalScore, correctedScore, reversed) => {
    const imported = source(undefined, originalScore);
    await ingest([imported]);
    await command({ type: "SetAssessmentOverride", kind: "credits", value: 7 });
    const original = await evaluate();
    const result = await sourceCommand("CorrectImportedAttempt", imported.source_key, { attempt_id: original.components.theory.id, items: [{ kind: "mcq", score: correctedScore }] });
    expect(result.pass_reversed).toBe(reversed);
    expect(result.assessment.awarded_credits).toBe(7);
    expect(result.assessment.components.theory).toMatchObject({ id: original.components.theory.id, score: correctedScore, attempt_count: 1, revision: 2 });
    const audit = await scalar<{ before: AssessmentEvaluation; after: AssessmentEvaluation }>("select metadata value from audit_events where entity_id=$1 and action='assessment.CorrectImportedAttempt'", [enrolmentId]);
    expect(audit.before.components.theory.score).toBe(originalScore);
    expect(audit.after.components.theory.score).toBe(correctedScore);
    expect(audit.after.pass_reversed).toBe(reversed);
    await ingest([{ ...imported, score: 90, items: [{ kind: "mcq", score: 90 }] }]);
    expect((await evaluate()).components.theory).toMatchObject({ score: correctedScore, revision: 2 });
    expect(await scalar<number>("select count(*)::int value from module_assessment_source_versions where source_id=(select id from module_assessment_source_results where source_key=$1)", [imported.source_key])).toBe(2);
    const manualCorrection = await command({ ...score(60), type: "CorrectManualAttempt", attempt_id: original.components.theory.id });
    expect(manualCorrection.assessment.components.theory).toMatchObject({ score: 60, attempt_count: 1, revision: 3 });
  });
  it("rolls back the imported correction if the final audit write fails", async () => {
    const imported = source();
    await ingest([imported]);
    const before = await evaluate();
    await db.exec(`create function public.test_reject_correction_audit() returns trigger language plpgsql as $$ begin
      if new.action = 'assessment.CorrectImportedAttempt' then raise exception 'Simulated final write failure'; end if; return new; end $$;
      create trigger test_correction_failure before insert on public.audit_events for each row execute function public.test_reject_correction_audit();`);
    try {
      await expect(sourceCommand("CorrectImportedAttempt", imported.source_key, { attempt_id: before.components.theory.id, items: [{ kind: "mcq", score: 40 }] })).rejects.toThrow("Simulated final write failure");
    } finally { await db.exec("drop trigger test_correction_failure on public.audit_events; drop function public.test_reject_correction_audit();"); }
    expect(await evaluate()).toEqual(before);
    expect(await scalar<string>("select state value from module_assessment_source_results where source_key=$1", [imported.source_key])).toBe("Matched");
    expect(await scalar<number>("select count(*)::int value from assessment_revision_history where attempt_id=$1", [before.components.theory.id])).toBe(1);
  });
  it("rejects imported correction with a later attempt or unresolved source conflict", async () => {
    const imported = source(undefined, 30);
    await ingest([imported]);
    const first = await evaluate();
    await command(score(65));
    const before = await evaluate();
    await expect(sourceCommand("CorrectImportedAttempt", imported.source_key, { attempt_id: first.components.theory.id, items: [{ kind: "mcq", score: 70 }] })).rejects.toThrow("later attempt");
    expect(await evaluate()).toEqual(before);
    await ingest([{ ...imported, student_identifier: "Changed external identity" }]);
    await expect(sourceCommand("CorrectImportedAttempt", imported.source_key, { attempt_id: first.components.theory.id, items: [{ kind: "mcq", score: 70 }] })).rejects.toThrow("unresolved conflict");
    expect(await evaluate()).toEqual(before);
  });
  it("uses the inherited weighted Theory plan for imported corrections", async () => {
    await plan({ physics_weighting: true }); await adopt();
    const imported = { ...source(undefined, 40), items: [{ kind: "mcq", score: 20 }, { kind: "physics", score: 60 }] };
    await ingest([imported]);
    const original = await evaluate();
    const result = await sourceCommand("CorrectImportedAttempt", imported.source_key, { attempt_id: original.components.theory.id, items: [{ kind: "mcq", score: 80 }, { kind: "physics", score: 60 }] });
    expect(result.assessment.components.theory).toMatchObject({ id: original.components.theory.id, score: 70, passed: true, attempt_count: 1 });
  });
  it("corrects imported Practical scores without changing the Theory attempt", async () => {
    await db.query("update course_modules set mode='practical' where id=$1", [moduleId]);
    await plan({ practical_pass_mark: 50 }); await adopt();
    const theory = await command(score(70));
    const imported = { ...source(undefined, 30), source_system: "Practical CSV", component: "practical", items: [] };
    await ingest([imported]);
    const original = await evaluate();
    const result = await sourceCommand("CorrectImportedAttempt", imported.source_key, { attempt_id: original.components.practical?.id, items: [], score: 65 });
    expect(result.assessment.components.practical).toMatchObject({ id: original.components.practical?.id, score: 65, passed: true, attempt_count: 1 });
    expect(result.assessment.components.theory).toEqual(theory.assessment.components.theory);
  });
  it("uses inherited pass marks for new Manual attempts and rejects staff-supplied regrading", async () => {
    await expect(command({ ...score(45), pass_mark: 40 })).rejects.toThrow("Pass marks");
    expect((await evaluate()).components.theory.attempt_count).toBe(0);
    const saved = await command(score(45));
    expect(saved.assessment.components.theory.pass_mark).toBe(50);
    expect(saved.assessment.components.theory.passed).toBe(false);
    await expect(command({ ...score(45), type: "CorrectManualAttempt", attempt_id: saved.assessment.components.theory.id, pass_mark: 40 })).rejects.toThrow("Pass marks");
    expect((await evaluate()).components.theory.revision).toBe(1);
  });
  it("preserves the original threshold after a course-plan change and retains the same sitting on correction", async () => {
    const initial = await command(score(40));
    await plan({ theory_pass_mark: 60 });
    await adopt();
    const corrected = await command({ ...score(55), type: "CorrectManualAttempt", attempt_id: initial.assessment.components.theory.id });
    expect(corrected.assessment.components.theory).toMatchObject({ score: 55, pass_mark: 50, passed: true, attempt_count: 1, sequence: 1, revision: 2 });
    await expect(command({ ...score(55), type: "CorrectManualAttempt", attempt_id: initial.assessment.components.theory.id, sitting_date: "2025-06-16" })).rejects.toThrow("original sitting");
    expect((await evaluate()).components.theory.revision).toBe(2);
  });
  it("rejects earlier Manual corrections with dependent later attempts without changing either result", async () => {
    const initial = await command(score(30));
    await command(score(65));
    await expect(command({ ...score(70), type: "CorrectManualAttempt", attempt_id: initial.assessment.components.theory.id })).rejects.toThrow("later attempt");
    expect((await evaluate()).components.theory).toMatchObject({ score: 65, attempt_count: 2, sequence: 2 });
    expect(await scalar<number>("select count(*)::int value from assessment_revision_history where attempt_id=$1", [initial.assessment.components.theory.id])).toBe(1);
  });
  it("keeps source-supplied thresholds as imported evidence and protects the internal revision function", async () => {
    await ingest([{ ...source(undefined, 45), pass_mark: 40 }]);
    expect((await evaluate()).components.theory).toMatchObject({ score: 45, pass_mark: 40, passed: true });
    await db.exec("set role authenticated");
    try {
      await expect(db.query("select public.assessment_write_revision_v1($1,'{}'::jsonb,'bypass',null)", [randomUUID()])).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role"); }
  });
  it.each([
    {theory_scheme:"mcq",physics_weighting:false},
    {theory_scheme:"mcq",physics_weighting:true},
    {theory_scheme:"coursework_viva",requires_coursework:true},
    {theory_scheme:"coursework_viva",requires_viva:true},
    {theory_scheme:"coursework_viva",requires_coursework:true,requires_viva:true}
  ])("accepts each valid Theory plan: %j", async configuration => {
    await plan(configuration);
    await adopt();
    expect((await evaluate()).plan.theory_scheme).toBe(configuration.theory_scheme);
  });
  it.each([
    {theory_scheme:"mcq",requires_viva:true},
    {theory_scheme:"mcq",requires_coursework:true},
    {theory_scheme:"coursework_viva"},
    {theory_scheme:"coursework_viva",requires_viva:true,physics_weighting:true},
    {theory_pass_mark:-1}, {theory_pass_mark:101}, {practical_pass_mark:50}
  ])("rejects invalid plan: %j", async configuration => {
    await expect(plan(configuration)).rejects.toThrow();
  });
  it("inherits reviewed immutable plans and rejects invalid plan combinations", async () => {
    expect((await evaluate()).plan.id).toBe(planId);
    await expect(plan({ theory_scheme: "coursework_viva" })).rejects.toThrow();
    await expect(plan({ requires_coursework: true })).rejects.toThrow();
    await expect(plan({ practical_pass_mark: 50 })).rejects.toThrow();
    await plan({ theory_scheme: "coursework_viva", requires_coursework: true });
    expect((await evaluate()).plan.id).not.toBe(planId);
    await expect(db.query("update module_assessment_plans set theory_pass_mark=40 where id=$1",[planId])).rejects.toThrow("immutable");
  });
  it("uses MCQ and weighted physics, with pass/fail only on combined Theory", async () => {
    await plan({ physics_weighting: true }); await adopt();
    const result = await command({ ...score(20), items: [{kind:"mcq",score:20},{kind:"physics",score:90}] });
    expect(result.assessment.components.theory.score).toBe(55);
    expect(result.assessment.effective_status).toBe("Pass");
    expect(result.assessment.awarded_credits).toBe(10);
    await expect(command(score(90))).rejects.toThrow("passed component");
  });
  it("requires supplied Coursework/Viva Theory without calculating supporting scores", async () => {
    await plan({ theory_scheme:"coursework_viva",requires_coursework:true,requires_viva:true }); await adopt();
    await expect(command({...score(70), score:undefined,items:[{kind:"coursework",score:80},{kind:"viva",score:90}]})).rejects.toThrow();
    const result = await command({...score(45),items:[{kind:"coursework",score:80},{kind:"viva",score:90}]});
    expect(result.assessment.components.theory.score).toBe(45);
    expect(result.assessment.effective_status).toBe("Fail");
    const itemId = await scalar<string>("select item.id value from module_assessment_items item join module_assessment_attempt_revisions revision on revision.id=item.revision_id join module_assessment_attempts attempt on attempt.id=revision.attempt_id where attempt.enrolment_id=$1 and item.kind='coursework'",[enrolmentId]);
    const resit = await command({...score(65),items:[{kind:"coursework",carried_from_item_id:itemId},{kind:"viva",score:30}]});
    expect(resit.assessment.components.theory.sequence).toBe(2);
    expect(resit.assessment.effective_status).toBe("Pass");
  });
  it("rejects implicit or invalid carry-forward and missing required items", async () => {
    await plan({physics_weighting:true}); await adopt();
    await expect(command(score(40))).rejects.toThrow("missing");
    await expect(command({...score(40),items:[{kind:"mcq",score:40},{kind:"physics",carried_from_item_id:randomUUID()}]})).rejects.toThrow("earlier attempt");
  });
  it("corrects the same attempt, uses latest valid result, and warns on pass reversal", async () => {
    const initial = await command(score(70));
    const corrected = await command({...score(20),type:"CorrectManualAttempt",attempt_id:initial.assessment.components.theory.id});
    expect(corrected.pass_reversed).toBe(true);
    expect(corrected.assessment.awarded_credits).toBe(0);
    expect(corrected.assessment.components.theory.sequence).toBe(1);
    const second = await command(score(10));
    expect(second.assessment.components.theory.score).toBe(10);
    expect(second.assessment.components.theory.attempt_count).toBe(2);
    expect(await scalar<number>("select count(*)::int value from module_assessment_attempt_revisions where attempt_id=$1",[initial.assessment.components.theory.id])).toBe(2);
  });
  it("schedules, cancels and completes resits without creating teaching enrolments", async () => {
    await command(score(30));
    await expect(command({type:"ScheduleResit",component:"theory",note:" "})).rejects.toThrow("note");
    let result = await command({type:"ScheduleResit",component:"theory",note:"Arranged for next month"});
    expect(result.assessment.effective_indicators).toEqual(["theory:Resit scheduled"]);
    await expect(command({type:"DeferAssessment",component:"theory",note:"Postponed"})).rejects.toThrow("active arrangement");
    result = await command({type:"CancelResit",component:"theory"});
    expect(result.assessment.effective_indicators).toEqual(["theory:Resit required"]);
    await command({type:"ScheduleResit",component:"theory",note:"Next month"});
    result = await command(score(40));
    expect(result.assessment.components.theory.arrangement_state).toBe("completed");
    expect(result.assessment.effective_indicators).toEqual(["theory:Resit required"]);
    result = await command(score(70));
    expect(result.assessment.effective_indicators).toEqual([]);
    expect(result.assessment.effective_status).toBe("Pass");
  });
  it("records missing predecessor without inventing a sequence", async () => {
    const result = await command({...score(30),previous_result_unavailable:"Paper resit record, previous mark unavailable"});
    expect(result.assessment.components.theory.sequence).toBeNull();
    expect((await command(score(70))).assessment.components.theory.sequence).toBeNull();
  });
  it("retains unmatched imported resits for reconciliation without enabling manual matching",async()=>{
    const input={...source(),known_resit:true};
    expect((await ingest([input])).unmatched).toBe(1);
    expect((await evaluate()).components.theory.id).toBeNull();
    await expect(sourceCommand("MatchSourceResult",input.source_key)).rejects.toThrow("disabled");
    await expect(sourceCommand("MatchSourceResult",input.source_key,{previous_result_unavailable:"Reviewed archive confirms a resit; original mark unavailable"})).rejects.toThrow("disabled");
    expect((await evaluate()).components.theory.id).toBeNull();
    expect(await scalar<string>("select state value from module_assessment_source_results where source_key=$1", [input.source_key])).toBe("Unmatched");
  });
  it("defers an assessment without an attempt and gives dispositions precedence", async () => {
    let result = await command({type:"DeferAssessment",component:"theory",note:"Awaiting examiner"});
    expect(result.assessment.effective_status).toBe("Assessment deferred");
    expect(result.assessment.components.theory.attempt_count).toBe(0);
    await command({type:"ClearAssessmentDeferral",component:"theory"});
    await command(score(30));
    result = await command({type:"SetEnrolmentDisposition",disposition:"Module deferred"});
    expect(result.assessment.effective_status).toBe("Module deferred");
    result = await command({type:"ClearEnrolmentDisposition"});
    expect(result.assessment.effective_status).toBe("Fail");
  });
  it("keeps overrides while facts change and calculates exceptional credits separately", async () => {
    await command({type:"SetAssessmentOverride",kind:"status",value:"Pass"});
    const result = await command(score(20));
    expect(result.assessment.calculated_status).toBe("Fail");
    expect(result.assessment.effective_status).toBe("Pass");
    expect(result.assessment.awarded_credits).toBe(10);
    expect(result.assessment.calculated_credits).toBe(0);
    await command({type:"SetAssessmentOverride",kind:"credits",value:5});
    expect((await evaluate()).awarded_credits).toBe(5);
    await command({type:"ClearAssessmentOverride",kind:"status"});
    expect((await evaluate()).effective_status).toBe("Fail");
    expect((await evaluate()).awarded_credits).toBe(5);
    await command({type:"ClearAssessmentOverride",kind:"credits"});
    expect((await evaluate()).awarded_credits).toBe(0);
  });
  it("rejects stale revisions atomically including concurrent next-attempt requests", async () => {
    const revision = (await evaluate()).revision;
    const results = await Promise.allSettled([command(score(20),revision),command(score(30),revision)]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(result=>result.status==="rejected")).toHaveLength(1);
    expect((await evaluate()).components.theory.attempt_count).toBe(1);
    await expect(command({...score(40),reason:" "})).rejects.toThrow("reason");
  });
  it("restricts commands to active admins and makes teacher projections read-only", async () => {
    await db.query("select set_config('test.actor',$1,false)",[teacherId]);
    expect((await evaluate()).plan.id).toBe(planId);
    await expect(command(score(70))).rejects.toThrow("administrator");
    await db.exec("set role authenticated");
    try {
      await expect(db.query("insert into module_assessment_source_results(source_system,source_key,student_identifier,component) values('Portal','forged','x','theory')")).rejects.toThrow();
      await expect(db.query("select public.assessment_evaluate($1)",[enrolmentId])).rejects.toThrow("permission denied");
      expect((await evaluate()).plan.id).toBe(planId);
    } finally { await db.exec("reset role"); }
  });
  it("imports idempotently, revises changed sources, and preserves ownership exclusions", async () => {
    const input = source();
    expect((await ingest([input])).auto_matched).toBe(1);
    expect((await ingest([input])).unchanged).toBe(1);
    const changed = {...input,score:30,items:[{kind:"mcq",score:30}]};
    expect((await ingest([changed])).source_updated).toBe(1);
    expect((await evaluate()).components.theory.revision).toBe(2);
    expect((await evaluate()).effective_status).toBe("Fail");
    expect((await ingest([input])).source_updated).toBe(1);
    expect((await evaluate()).components.theory.score).toBe(70);
    await lifecycleCommand("ExcludeAttempt", (await evaluate()).components.theory.id!, { category: "incorrect_ownership" });
    expect((await ingest([{...changed,score:90,items:[{kind:"mcq",score:90}]}])).auto_matched).toBe(0);
    expect((await evaluate()).components.theory.id).toBeNull();
  });
  it("reverses a pass on ownership exclusion and restores the same sitting", async () => {
    const input = source(); await ingest([input]);
    const attemptId = (await evaluate()).components.theory.id!;
    const result = await lifecycleCommand("ExcludeAttempt", attemptId, { category: "incorrect_ownership" });
    expect(result.pass_reversed).toBe(true);
    expect(result.assessment.awarded_credits).toBe(0);
    await lifecycleCommand("RestoreAttempt", attemptId);
    expect((await evaluate()).components.theory.sequence).toBe(1);
  });
  it("replaces an incorrect import on the same attempt and never refreshes over Manual evidence", async () => {
    const input = source(); await ingest([input]);
    const original = (await evaluate()).components.theory.id;
    await expect(command({...score(30),type:"CorrectManualAttempt",attempt_id:original})).rejects.toThrow("Imported results");
    await sourceCommand("CorrectImportedAttempt",input.source_key,{attempt_id:original,items:[{kind:"mcq",score:40}]});
    await ingest([{...input,score:95,items:[{kind:"mcq",score:95}]}]);
    const result = await evaluate();
    expect(result.components.theory.id).toBe(original);
    expect(result.components.theory.origin).toBe("Manual");
    expect(result.components.theory.score).toBe(40);
  });
  it("retains invalid-result exclusions across refresh and restores only the accepted original", async () => {
    const input=source(); await ingest([input]);
    const attemptId = (await evaluate()).components.theory.id!;
    await lifecycleCommand("ExcludeAttempt", attemptId);
    await ingest([{...input,score:90,items:[{kind:"mcq",score:90}]}]);
    expect(await scalar<string>("select state value from module_assessment_source_results where source_key=$1",[input.source_key])).toBe("Voided");
    await expect(sourceCommand("RestoreSourceResult",input.source_key)).rejects.toThrow("disabled");
    await lifecycleCommand("RestoreAttempt", attemptId);
    expect((await evaluate()).components.theory).toMatchObject({ id: attemptId, score: 70 });
  });
  it("retains ambiguous rows and refuses silent improvement attempts", async () => {
    const input=source(); await ingest([input]);
    expect((await ingest([source()])).unmatched).toBe(1);
    expect((await evaluate()).components.theory.attempt_count).toBe(1);
    const otherTerm=randomUUID(); const otherOffering=randomUUID();
    await db.query("insert into terms(id,name,starts_on,ends_on) values($1::uuid,$1::text,'2024-01-01','2024-05-31')",[otherTerm]);
    await db.query("insert into module_offerings(id,module_id,term_id,price_pence,capacity) values($1,$2,$3,0,10)",[otherOffering,moduleId,otherTerm]);
    await db.query("insert into enrolments(student_id,offering_id) values($1,$2)",[studentId,otherOffering]);
    expect((await ingest([source()])).unmatched).toBe(1);
  });
  it("keeps cross-student evidence unmatched even when an identity override is supplied", async () => {
    const input={...source(),student_identifier:"different-student"}; await ingest([input]);
    await expect(sourceCommand("MatchSourceResult",input.source_key)).rejects.toThrow("disabled");
    await expect(sourceCommand("MatchSourceResult",input.source_key,{identity_override_reason:"Verified original identity transcription error"})).rejects.toThrow("disabled");
    await ingest([{...input,score:20,items:[{kind:"mcq",score:20}]}]);
    expect((await evaluate()).components.theory.id).toBeNull();
    expect(await scalar<string>("select state value from module_assessment_source_results where source_key=$1", [input.source_key])).toBe("Unmatched");
  });
  it("keeps attendance and presentation pending until term end and retains passed Theory", async () => {
    await db.query("update course_modules set mode='practical' where id=$1",[moduleId]);
    await plan({practical_pass_mark:50}); await adopt();
    await db.query("update module_offerings set presentation_required=true where id=$1",[offeringId]);
    await command(score(80)); await command(score(30,"practical"));
    expect((await evaluate()).effective_indicators).toEqual(["practical:Resit required","Attendance non-compliance","Presentation incomplete"]);
    await command(score(70,"practical"));
    const pending=await scalar<AssessmentEvaluation>("select public.assessment_evaluate($1,'2025-03-01') value",[enrolmentId]);
    expect(pending.calculated_status).toBe("In progress");
    expect(pending.calculated_indicators).toEqual([]);
    expect(pending.components.theory.attempt_count).toBe(1);
    for (const date of ["2025-02-01","2025-02-02","2025-02-03"]) {
      const sessionId=randomUUID();
      await db.query("insert into attendance_sessions(id,term_id,session_date,starts_at,ends_at,location) values($1,$2,$3,'09:00','17:00','Local')",[sessionId,termId,date]);
      await db.query("insert into attendance_records(session_id,student_id,status) values($1,$2,'attended')",[sessionId,studentId]);
    }
    await db.query("insert into presentation_scores(student_id,offering_id,staff_user_id,occurred_on,total_score) values($1,$2,$3,'2025-03-01',70)",[studentId,offeringId,adminId]);
    expect((await evaluate()).effective_status).toBe("Pass");
    expect(await scalar<number>("select count(*)::int value from enrolment_assessment_history where enrolment_id=$1",[enrolmentId])).toBeGreaterThan(4);
  });
  it("returns historical projections and keeps audit records for each command", async () => {
    await command(score(70));
    const history=await scalar<AssessmentEvaluation>("select public.read_enrolment_assessment($1,now()) value",[enrolmentId]);
    expect(history.effective_status).toBe("Pass");
    expect(await scalar<number>("select count(*)::int value from audit_events where entity_id=$1",[enrolmentId])).toBe(1);
  });
  it("retains inherited Practical attendance requirements after module mode changes",async()=>{
    await db.query("update course_modules set mode='practical' where id=$1",[moduleId]);
    await plan({practical_pass_mark:50}); await adopt();
    expect((await evaluate()).attendance_required).toBe(3);
    await db.query("update course_modules set mode='online' where id=$1",[moduleId]);
    expect((await evaluate()).plan.mode).toBe("practical");
    expect((await evaluate()).attendance_required).toBe(3);
    expect((await evaluate()).calculated_indicators).toContain("Attendance non-compliance");
  });
  it("rejects retroactive attempt ordering and incompatible plan changes", async () => {
    await command(score(30));
    await expect(command({...score(20),sitting_date:"2025-01-01"})).rejects.toThrow("Historical sitting");
    await plan({theory_scheme:"coursework_viva",requires_viva:true});
    await expect(adopt()).rejects.toThrow("incompatible");
    expect((await evaluate()).plan.theory_scheme).toBe("mcq");
  });
  it("retains changed source evidence, rejects malformed rows independently, and detects replacement agreement", async () => {
    const input=source();
    const summary=await ingest([input,{...source(),items:[{kind:"mcq",score:"not a number"}]}]);
    expect(summary.created).toBe(1); expect(summary.rejected).toBe(1);
    await sourceCommand("CorrectImportedAttempt",input.source_key,{attempt_id:(await evaluate()).components.theory.id,items:[{kind:"mcq",score:40}]});
    expect(await scalar<boolean>("select replacement_agrees value from assessment_import_reconciliation where source_key=$1",[input.source_key])).toBe(false);
    await ingest([{...input,score:40,items:[{kind:"mcq",score:40}]}]);
    expect(await scalar<boolean>("select replacement_agrees value from assessment_import_reconciliation where source_key=$1",[input.source_key])).toBe(true);
    expect(await scalar<number>("select count(*)::int value from module_assessment_source_versions version join module_assessment_source_results source on source.id=version.source_id where source.source_key=$1",[input.source_key])).toBe(2);
  });
  it.each(["deferred","resit","did_not_complete"])("requires review before backfilling legacy %s", async status => {
    await db.query("update enrolments set status=$1::enrolment_status where id=$2",[status,enrolmentId]);
    await db.query("insert into exam_results(student_id,offering_id,component_type,source_system,source_attempt_id,score,pass_mark,passed,resit_required,taken_on) values($1,$2,'theory','theory_portal',$3,70,50,true,false,'2025-06-15')",[studentId,offeringId,randomUUID()]);
    expect(await scalar<string>("select review_reason value from assessment_backfill_candidates where enrolment_id=$1",[enrolmentId])).toBe("legacy_status_requires_review");
  });
  it("backfills reviewed legacy rows idempotently while preserving original marks", async () => {
    await db.query("update enrolments set final_mark=91,grade='Historic' where id=$1",[enrolmentId]);
    await db.query("insert into exam_results(student_id,offering_id,component_type,source_system,source_attempt_id,score,pass_mark,passed,resit_required,taken_on) values($1,$2,'theory','theory_portal',$3,70,50,true,false,'2025-06-15')",[studentId,offeringId,randomUUID()]);
    const approvals=await scalar("select jsonb_agg(jsonb_build_object('legacy_result_id',legacy_result_id,'legacy_hash',legacy_hash)) value from assessment_backfill_candidates where enrolment_id=$1",[enrolmentId]);
    expect(await scalar("select public.backfill_assessment_results($1,'Reviewed migration') value",[JSON.stringify(approvals)])).toEqual({imported:1,already_backfilled:0});
    expect(await scalar("select public.backfill_assessment_results($1,'Reviewed retry') value",[JSON.stringify(approvals)])).toEqual({imported:0,already_backfilled:1});
    expect((await evaluate()).components.theory.score).toBe(70);
    expect(await scalar<number>("select final_mark::int value from enrolments where id=$1",[enrolmentId])).toBe(91);
    expect(await scalar<number>("select count(*)::int value from exam_results where student_id=$1",[studentId])).toBe(1);
  });
  it("requires sign-offs and blocks legacy writes at cutover, with reversible rollback", async () => {
    await expect(scalar("select public.set_assessment_rollout('live','{}','Cutover') value")).rejects.toThrow("sign-off");
    await scalar("select public.set_assessment_rollout('live',$1,'Synthetic sign-offs') value",[JSON.stringify({reconciliation_review:"review",sanitized_rehearsal:"fixture",pilot_signoff:"cohort",backup_restore:"backup",module_plans_review:"review"})]);
    try {
      await expect(db.query("update enrolments set credits_awarded=10 where id=$1",[enrolmentId])).rejects.toThrow("read-only");
      await expect(db.query("insert into exam_results(student_id,offering_id,component_type,source_system,source_attempt_id,score,pass_mark,passed,resit_required,taken_on) values($1,$2,'theory','theory_portal',$3,70,50,true,false,'2025-06-15')",[studentId,offeringId,randomUUID()])).rejects.toThrow("read-only");
    } finally { await scalar("select public.set_assessment_rollout('shadow','{}','Rollback') value"); }
    expect((await evaluate()).plan.id).toBe(planId);
  });
});
