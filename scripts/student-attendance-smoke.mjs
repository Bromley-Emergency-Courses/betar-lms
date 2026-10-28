import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

if (!process.argv[2]) throw new Error("Pass the private synthetic administrator/teacher credentials JSON.");
validateLocalProjectConfig(readFileSync("dev/assessment/supabase/config.toml", "utf8"));
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", localContainer], { encoding: "utf8" }).trim(), "true");
const settings = validateLocalSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", "dev/assessment", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
const credentials = JSON.parse(readFileSync(process.argv[2], "utf8"));
const service = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const admin = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
const teacher = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
assert.equal((await admin.auth.signInWithPassword({ email: credentials.adminEmail, password: credentials.password })).error, null);
assert.equal((await teacher.auth.signInWithPassword({ email: credentials.teacherEmail, password: credentials.password })).error, null);
const fixtureId = randomUUID();
const studentId = `69000000${randomUUID().slice(8)}`;
const otherStudentId = `69000000${randomUUID().slice(8)}`;
const termId = randomUUID();
const artifacts = `.context/student-attendance-review/${fixtureId}`;
mkdirSync(artifacts, { recursive: true });
async function insert(table, records) { const result = await service.from(table).insert(records); assert.equal(result.error, null); }
await insert("students", [studentId, otherStudentId].map((id, index) => ({ id, temporary_id: `ATT-${id}`, first_name: index ? "Other" : "Attendance", last_name: `Review ${fixtureId.slice(0, 8)}`, email: `${id}@example.test`, programme: "pgcert", status: "active", admission_stage: "accepted" })));
await insert("terms", { id: termId, name: `Attendance review ${fixtureId.slice(0, 8)}`, starts_on: "2025-01-01", ends_on: "2025-05-31" });
const enrolmentIds = [];
const moduleNames = ["Attendance review practical A", "Attendance review practical B"];
async function evaluation(enrolmentId) { const result = await admin.rpc("read_enrolment_assessment", { enrolment_key: enrolmentId }); assert.equal(result.error, null); return result.data; }
for (const [index, title] of moduleNames.entries()) {
  const moduleId = randomUUID(); const offeringId = randomUUID(); const enrolmentId = randomUUID();
  await insert("course_modules", { id: moduleId, code: `ATT-${moduleId}`, title, mode: "practical", credits: 10 });
  assert.equal((await admin.rpc("save_module_assessment_plan", { input: { module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, practical_pass_mark: 50, reason: "Synthetic attendance review" }, expected_plan_id: null })).error, null);
  await insert("module_offerings", { id: offeringId, module_id: moduleId, term_id: termId, price_pence: 0, capacity: 10, presentation_required: false });
  await insert("enrolments", { id: enrolmentId, student_id: studentId, offering_id: offeringId, attendance_days_required_override: 1, presentation_required_override: false });
  if (!index) await insert("enrolments", { student_id: otherStudentId, offering_id: offeringId, attendance_days_required_override: 1, presentation_required_override: false });
  enrolmentIds.push(enrolmentId);
  for (const component of ["theory", "practical"]) {
    assert.equal((await admin.rpc("execute_assessment_command", { command: { type: "AddManualAttempt", enrolment_id: enrolmentId, component, sitting_date: "2025-06-01", ...(component === "theory" ? { items: [{ kind: "mcq", score: 70 }] } : { score: 70 }), reason: "Synthetic passing exams" }, expected_revision: (await evaluation(enrolmentId)).revision })).error, null);
  }
}
assert.equal((await admin.rpc("execute_assessment_command", { command: { type: "SetAssessmentOverride", enrolment_id: enrolmentIds[0], kind: "credits", value: 5, reason: "Independent synthetic credit decision" }, expected_revision: (await evaluation(enrolmentIds[0])).revision })).error, null);
async function attendance(student = studentId) { const result = await admin.rpc("read_student_attendance", { student_key: student }); assert.equal(result.error, null); return result.data; }
const base = "http://127.0.0.1:3100";
const path = (student = studentId) => `/students/${student}?tab=attendance&term=${termId}`;
writeFileSync(`${artifacts}/fixture.json`, JSON.stringify({ fixtureId, studentId, otherStudentId, termId, enrolmentIds, url: `${base}${path()}`, synthetic: true }, null, 2));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
page.setDefaultTimeout(15000);
const errors = []; const checks = [];
page.on("pageerror", error => errors.push(error.message));
const screenshot = name => page.screenshot({ path: `${artifacts}/${name}.png`, style: "nextjs-portal { visibility: hidden; }" });
async function login(target, email, next) {
  await target.goto(`${base}/login?next=${encodeURIComponent(next)}`);
  await target.getByLabel("Email", { exact: true }).fill(email); await target.getByLabel("Password", { exact: true }).fill(credentials.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click(); await target.waitForURL(`${base}${next}`);
}
async function save(editor) {
  await editor.getByLabel("Reason", { exact: true }).fill("Synthetic review of register evidence");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click(); await editor.waitFor({ state: "detached" });
}
async function openAttendance(date) {
  await page.getByRole("button", { name: `Edit attendance for ${date} at 09:00`, exact: true }).click();
  return page.getByRole("dialog", { name: "Edit attendance", exact: true });
}
async function discard(editor) {
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.getByRole("button", { name: "Discard changes", exact: true }).click(); await editor.waitFor({ state: "detached" });
}
async function fillSession(date) {
  await page.getByRole("button", { name: "Add session to this term", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add session to this term", exact: true });
  await editor.getByLabel("Date", { exact: true }).fill(date);
  await editor.getByLabel("Location", { exact: true }).fill("Synthetic teaching room");
  return editor;
}
try {
  await login(page, credentials.adminEmail, path());
  let editor = await fillSession("2025-03-01");
  await editor.getByLabel("Reason", { exact: true }).fill("Agreed shared date");
  await screenshot("shared-session-editor");
  await save(editor);
  assert.equal((await attendance()).length, 1);
  assert.equal((await attendance())[0].status, "not_recorded");
  await page.goto(`${base}${path(otherStudentId)}`);
  await page.getByRole("button", { name: "Edit attendance for 2025-03-01 at 09:00", exact: true }).waitFor();
  assert.equal((await attendance(otherStudentId))[0].status, "not_recorded");
  editor = await fillSession("2025-03-02"); await save(editor);
  await page.goto(`${base}${path()}`);
  await page.getByRole("button", { name: "Edit attendance for 2025-03-02 at 09:00", exact: true }).waitFor();
  assert.equal((await attendance()).every(row => row.status === "not_recorded" && !row.expected), true);
  assert.equal((await attendance(otherStudentId)).every(row => row.status === "not_recorded" && !row.expected), true);
  await page.getByRole("link", { name: "Open term register", exact: true }).click();
  await page.waitForURL(`${base}/attendance?mode=edit&term=${termId}`);
  assert.equal(await page.locator('input[value="Synthetic teaching room"]').count(), 2);
  await page.goto(`${base}${path()}`);
  checks.push("Shared sessions created from either student's profile appear in both profiles and the selected term register without marking anyone expected or attending");

  editor = await fillSession("2025-03-01");
  await editor.getByLabel("Reason", { exact: true }).fill("Duplicate check");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "already exists" }).waitFor();
  assert.equal((await attendance()).length, 2); await discard(editor);
  checks.push("Duplicate shared sessions fail without adding records or losing the draft");

  editor = await openAttendance("2025-03-01");
  await editor.getByRole("combobox", { name: "Attendance status", exact: true }).selectOption("expected"); await save(editor);
  assert.equal((await attendance()).find(row => row.date === "2025-03-01").hasRecord, false);
  assert.equal((await evaluation(enrolmentIds[0])).attendance_actual, 0);
  editor = await openAttendance("2025-03-01");
  await editor.getByRole("combobox", { name: "Attendance status", exact: true }).selectOption("attended");
  await editor.getByLabel("Attendance note", { exact: true }).fill("Paper register checked"); await save(editor);
  assert.equal((await evaluation(enrolmentIds[0])).attendance_actual, 1);
  editor = await openAttendance("2025-03-02");
  await editor.getByRole("combobox", { name: "Attendance status", exact: true }).selectOption("attended"); await save(editor);
  for (const enrolment of enrolmentIds) assert.equal((await evaluation(enrolment)).effective_status, "Pass");
  assert.equal((await evaluation(enrolmentIds[0])).awarded_credits, 5);
  assert.equal((await evaluation(enrolmentIds[1])).awarded_credits, 10);
  assert.equal((await attendance(otherStudentId)).every(row => row.status === "not_recorded"), true);
  assert.equal(page.url(), `${base}${path()}`);
  await page.reload(); await page.getByRole("heading", { name: "Attendance", exact: true }).waitFor();
  await screenshot("saved-attendance");
  await page.goto(`${base}/assessments?student=${studentId}`);
  for (const name of moduleNames) assert.ok((await page.locator("tr").filter({ has: page.getByRole("button", { name: new RegExp(`View results for ${name}`) }) }).innerText()).includes("Passed"));
  await page.goto(`${base}${path()}`);
  checks.push("Expected is not attendance; two recorded days update both Practical modules and the shared assessment register while preserving independent credits, exam scores and the other student");

  editor = await openAttendance("2025-03-01");
  await editor.getByLabel("Attendance note", { exact: true }).fill("Unsaved local note");
  await page.keyboard.press("Escape"); await editor.getByRole("button", { name: "Keep editing", exact: true }).click();
  const firstSession = (await attendance()).find(row => row.date === "2025-03-01");
  assert.equal((await admin.from("attendance_records").update({ status: "partial", checked_in_at: "2025-03-01T09:00:00Z", checked_out_at: "2025-03-01T12:00:00Z" }).eq("session_id", firstSession.id).eq("student_id", studentId)).error, null);
  await editor.getByLabel("Reason", { exact: true }).fill("Review stale record");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "Attendance changed" }).waitFor();
  assert.equal(await editor.getByLabel("Attendance note", { exact: true }).inputValue(), "Unsaved local note");
  await discard(editor); await page.reload();
  editor = await openAttendance("2025-03-01");
  assert.ok((await editor.innerText()).includes("Reception evidence"));
  await editor.getByRole("combobox", { name: "Attendance status", exact: true }).selectOption("attended");
  await editor.getByLabel("Reason", { exact: true }).fill("Register confirms full attendance");
  await screenshot("attendance-editor"); await save(editor);
  assert.equal((await attendance()).find(row => row.id === firstSession.id).checkedInAt, "2025-03-01T09:00:00+00:00");
  assert.equal((await evaluation(enrolmentIds[0])).effective_status, "Pass");
  checks.push("Reception-style edits invalidate old drafts; errors retain notes and corrections preserve original check-in/out evidence");

  editor = await openAttendance("2025-03-01");
  await editor.getByLabel("Attendance note", { exact: true }).fill("Draft before room change");
  assert.equal((await admin.from("attendance_sessions").update({ location: "Updated synthetic room" }).eq("id", firstSession.id)).error, null);
  await editor.getByLabel("Reason", { exact: true }).fill("Stale session check");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "Session details changed" }).waitFor(); await discard(editor); await page.reload();
  checks.push("Shared session changes invalidate an open attendance draft instead of silently saving against different session details");

  await page.setViewportSize({ width: 390, height: 844 });
  editor = await openAttendance("2025-03-01");
  await editor.getByRole("combobox", { name: "Attendance status", exact: true }).selectOption("expected");
  await editor.getByRole("checkbox").check();
  assert.equal(await editor.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  await screenshot("mobile-attendance-editor"); await save(editor);
  for (const enrolment of enrolmentIds) assert.equal((await evaluation(enrolment)).effective_status, "Fail");
  assert.equal((await evaluation(enrolmentIds[0])).awarded_credits, 5);
  editor = await openAttendance("2025-03-01");
  await editor.getByRole("combobox", { name: "Attendance status", exact: true }).selectOption("not_recorded"); await save(editor);
  assert.equal((await attendance()).find(row => row.id === firstSession.id).status, "not_recorded");
  editor = await openAttendance("2025-03-01");
  await editor.getByRole("combobox", { name: "Attendance status", exact: true }).selectOption("attended"); await save(editor);
  const audit = await admin.from("audit_events").select("metadata,reason").eq("action", "save_student_attendance").eq("entity_id", studentId);
  assert.equal(audit.error, null);
  assert.ok(audit.data.some(event => event.metadata.before?.checked_in_at && event.metadata.after === null && event.reason));
  assert.equal((await evaluation(enrolmentIds[0])).effective_status, "Pass");
  checks.push("Mobile clearing requires explicit confirmation, retains old timestamps in the audit, recalculates all affected modules and distinguishes Expected from Not recorded");

  const latest = (await attendance())[0];
  const denied = await teacher.rpc("save_student_attendance", { command: { studentId, sessionId: latest.id, expectedRevision: latest.revision, expectedSessionRevision: latest.sessionRevision, status: "missed", expected: true, note: null, reason: "Unauthorized", confirmClear: false } });
  assert.match(denied.error?.message ?? "", /administrator/);
  const teacherPage = await browser.newPage(); await login(teacherPage, credentials.teacherEmail, path());
  assert.equal(await teacherPage.getByRole("button", { name: /Edit attendance/ }).count(), 0);
  assert.equal(await teacherPage.getByRole("button", { name: "Add session to this term", exact: true }).count(), 0);
  await teacherPage.close();
  checks.push("Teachers can read attendance but cannot open either editor or call the attendance mutation");
  assert.deepEqual(errors, []);
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ checks, errors, mode: "shadow", studentId }, null, 2));
  writeFileSync(".context/student-attendance-review/latest.json", JSON.stringify({ artifacts, url: `${base}${path()}` }, null, 2));
  process.stdout.write(`${checks.length} attendance browser groups passed. Review: ${base}${path()}\nEvidence: ${artifacts}\n`);
} catch (error) {
  await screenshot("failure").catch(() => {}); process.stderr.write(`Synthetic fixture retained: ${artifacts}\n`); throw error;
} finally { await browser.close(); await admin.auth.signOut({ scope: "local" }); await teacher.auth.signOut({ scope: "local" }); }
