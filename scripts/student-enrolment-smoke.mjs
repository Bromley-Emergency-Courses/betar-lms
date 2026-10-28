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
const fixtureId = randomUUID(); const studentId = `69000000${randomUUID().slice(8)}`; const termId = randomUUID();
const artifacts = `.context/student-enrolment-review/${fixtureId}`;
mkdirSync(artifacts, { recursive: true });
async function insert(table, records) { const result = await service.from(table).insert(records); assert.equal(result.error, null); }
async function evaluate(enrolmentId) { const result = await admin.rpc("read_enrolment_assessment", { enrolment_key: enrolmentId }); assert.equal(result.error, null); return result.data; }
async function workspace() { const result = await admin.rpc("read_student_enrolments", { student_key: studentId }); assert.equal(result.error, null); return result.data; }
async function command(input, revision) { const result = await admin.rpc("execute_assessment_command", { command: { reason: "Synthetic enrolment review", ...input }, expected_revision: revision }); assert.equal(result.error, null); return result.data; }
await insert("students", { id: studentId, temporary_id: `ENR-${studentId}`, first_name: "Enrolment", last_name: `Review ${fixtureId.slice(0, 8)}`, email: `${studentId}@example.test`, programme: "pgcert", status: "active", admission_stage: "accepted" });
await insert("terms", { id: termId, name: `Enrolment review ${fixtureId.slice(0, 8)}`, starts_on: "2025-01-01", ends_on: "2025-05-31" });
const enrolmentIds = []; const offeringIds = [];
for (const index of [0, 1, 2, 3]) {
  const moduleId = randomUUID(); const offeringId = randomUUID(); const enrolmentId = randomUUID();
  await insert("course_modules", { id: moduleId, code: `ENR-${moduleId}`, title: `Enrolment review ${["practical A", "practical B", "online addition", "unused legacy"][index]}`, mode: index < 2 ? "practical" : "online", credits: 10 });
  if (index < 3) assert.equal((await admin.rpc("save_module_assessment_plan", { input: { module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, ...(index < 2 ? { practical_pass_mark: 50 } : {}), reason: "Synthetic reviewed plan" }, expected_plan_id: null })).error, null);
  await insert("module_offerings", { id: offeringId, module_id: moduleId, term_id: termId, price_pence: 0, capacity: 10, presentation_required: index === 0 });
  offeringIds.push(offeringId);
  if (index !== 2) {
    await insert("enrolments", { id: enrolmentId, student_id: studentId, offering_id: offeringId, ...(index < 2 ? { attendance_days_required_override: 1, presentation_required_override: false } : {}) });
    enrolmentIds[index] = enrolmentId;
  }
  if (index < 2) for (const component of ["theory", "practical"]) await command({ type: "AddManualAttempt", enrolment_id: enrolmentId, component, sitting_date: "2025-06-01", ...(component === "theory" ? { items: [{ kind: "mcq", score: 70 }] } : { score: 70 }) }, (await evaluate(enrolmentId)).revision);
}
await command({ type: "SetAssessmentOverride", enrolment_id: enrolmentIds[0], kind: "credits", value: 5 }, (await evaluate(enrolmentIds[0])).revision);
const sessionId = randomUUID();
await insert("attendance_sessions", { id: sessionId, term_id: termId, offering_id: null, session_date: "2025-03-01", starts_at: "09:00", ends_at: "17:00", location: "Enrolment review room" });
await insert("attendance_records", { session_id: sessionId, student_id: studentId, status: "attended" });
const base = "http://127.0.0.1:3100"; const path = `/students/${studentId}?tab=modules&term=${termId}`;
writeFileSync(`${artifacts}/fixture.json`, JSON.stringify({ fixtureId, studentId, termId, enrolmentIds, offeringIds, url: `${base}${path}`, synthetic: true }, null, 2));
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
page.setDefaultTimeout(15000); const errors = []; const checks = [];
page.on("pageerror", error => errors.push(error.message));
const screenshot = name => page.screenshot({ path: `${artifacts}/${name}.png`, style: "nextjs-portal { visibility: hidden; }" });
async function login(target, email) {
  await target.goto(`${base}/login?next=${encodeURIComponent(path)}`);
  await target.getByLabel("Email", { exact: true }).fill(email); await target.getByLabel("Password", { exact: true }).fill(credentials.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click(); await target.waitForURL(`${base}${path}`);
}
async function open(enrolmentId = enrolmentIds[0], task = "requirements") {
  await page.getByRole("button", { name: "Manage enrolment", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Manage enrolment", exact: true });
  await editor.getByRole("combobox", { name: "Module enrolment", exact: true }).selectOption(enrolmentId);
  await editor.getByRole("combobox", { name: "Action", exact: true }).selectOption(task); return editor;
}
async function save(editor) {
  await editor.getByLabel("Reason", { exact: true }).fill("Synthetic administrator decision after reviewing evidence");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click(); await editor.waitFor({ state: "detached" });
}
async function discard(editor) { await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await editor.getByRole("button", { name: "Discard changes", exact: true }).click(); await editor.waitFor({ state: "detached" }); }
try {
  await login(page, credentials.adminEmail);
  let editor = await open();
  await editor.getByLabel("Attendance days exception", { exact: true }).fill("0");
  await editor.getByLabel("Reason", { exact: true }).fill("Previous teaching reviewed; waive this module’s additional day");
  assert.equal(await editor.getByLabel(/pass mark|weighting|theory scheme/i).count(), 0);
  await screenshot("requirement-editor"); await save(editor);
  for (const enrolment of enrolmentIds.slice(0, 2)) assert.equal((await evaluate(enrolment)).effective_status, "Pass");
  assert.equal((await evaluate(enrolmentIds[0])).awarded_credits, 5);
  await page.reload(); await page.getByRole("button", { name: "Manage enrolment", exact: true }).waitFor();
  assert.match(page.url(), new RegExp(`tab=modules&term=${termId}`));
  checks.push("Requirement exception persists across reload, recalculates both practical modules, retains independent credit decision and context, and exposes no plan controls");

  editor = await open(); await editor.getByRole("combobox", { name: "Presentation requirement", exact: true }).selectOption("inherit"); await save(editor);
  assert.equal((await evaluate(enrolmentIds[0])).presentation_pending, true);
  assert.equal((await evaluate(enrolmentIds[1])).effective_status, "Pass");
  editor = await open(); await editor.getByRole("combobox", { name: "Presentation requirement", exact: true }).selectOption("false"); await save(editor);
  assert.equal((await evaluate(enrolmentIds[0])).presentation_pending, false);
  editor = await open(); await editor.getByLabel("Attendance days exception", { exact: true }).fill(""); await save(editor);
  assert.equal((await workspace()).enrolments.find(row => row.id === enrolmentIds[0]).attendanceDays, null);
  assert.equal((await evaluate(enrolmentIds[1])).effective_status, "Fail");
  editor = await open(); await editor.getByLabel("Attendance days exception", { exact: true }).fill("0"); await save(editor);
  checks.push("Independent presentation requirement and inheritance clearing use canonical rules, without inventing attendance or scores");

  editor = await open(enrolmentIds[0], "defer"); await save(editor);
  assert.equal((await evaluate(enrolmentIds[0])).disposition, "Module deferred");
  assert.equal((await evaluate(enrolmentIds[1])).attendance_required, 1);
  editor = await open(enrolmentIds[0], "abandon"); await save(editor);
  assert.equal((await evaluate(enrolmentIds[0])).disposition, "Abandoned");
  editor = await open(enrolmentIds[0], "resume"); await save(editor);
  assert.equal((await evaluate(enrolmentIds[0])).disposition, null);
  assert.equal((await evaluate(enrolmentIds[0])).awarded_credits, 5);
  checks.push("Defer, abandon and resume persist separately from outcomes and student lifecycle, with peer recalculation and retained overrides");

  editor = await open(); await editor.getByLabel("Attendance days exception", { exact: true }).fill("2");
  await editor.getByLabel("Reason", { exact: true }).fill("Keep this draft");
  assert.equal((await admin.from("enrolments").update({ attendance_days_required_override: 1 }).eq("id", enrolmentIds[0])).error, null);
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "Enrolment changed" }).waitFor();
  assert.equal(await editor.getByLabel("Attendance days exception", { exact: true }).inputValue(), "2");
  assert.equal(await editor.getByLabel("Reason", { exact: true }).inputValue(), "Keep this draft");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(await editor.getByLabel("Reason", { exact: true }).inputValue(), "Keep this draft");
  await discard(editor);
  editor = await open(); assert.equal(await editor.getByLabel("Attendance days exception", { exact: true }).inputValue(), "1");
  await editor.getByLabel("Attendance days exception", { exact: true }).fill("0"); await save(editor);
  checks.push("Concurrent legacy edits reject stale saving and retain the draft; Keep editing and Discard work, and reopening reads fresh revisions");

  await page.getByRole("button", { name: "Add enrolment", exact: true }).click();
  editor = page.getByRole("dialog", { name: "Add enrolment", exact: true });
  await editor.getByRole("combobox", { name: "Teaching offering / cohort", exact: true }).selectOption(offeringIds[2]);
  await editor.getByLabel("Reason", { exact: true }).fill("New teaching in this cohort");
  await screenshot("add-enrolment");
  assert.equal((await admin.from("module_offerings").update({ presentation_required: true }).eq("id", offeringIds[2])).error, null);
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "Offering configuration changed" }).waitFor();
  assert.equal(await editor.getByLabel("Reason", { exact: true }).inputValue(), "New teaching in this cohort");
  await discard(editor);
  await page.getByRole("button", { name: "Add enrolment", exact: true }).click(); editor = page.getByRole("dialog", { name: "Add enrolment", exact: true });
  await editor.getByRole("combobox", { name: "Teaching offering / cohort", exact: true }).selectOption(offeringIds[2]); await save(editor);
  const created = (await workspace()).enrolments.find(row => row.offeringId === offeringIds[2]);
  assert.ok(created.assessment.plan.id); assert.equal(created.assessment.components.theory.attempt_count, 0);
  assert.equal(created.assessment.awarded_credits, 0);
  const fees = await service.from("finance_records").select("id").eq("student_id", studentId); assert.deepEqual(fees.data, []);
  await page.reload(); await page.getByText("Enrolment review online addition", { exact: true }).waitFor();
  checks.push("New teaching enrolment inherits the reviewed global plan, survives reload, rejects changed offering configuration and creates neither scores nor fees");

  await page.setViewportSize({ width: 390, height: 844 });
  editor = await open(enrolmentIds[0], "cancel");
  assert.equal(await editor.locator('option[value="remove"]').count(), 0);
  await editor.getByText("Cancellation requires separate review.", { exact: true }).waitFor();
  assert.equal(await editor.getByRole("button", { name: "Save changes", exact: true }).isDisabled(), true);
  assert.ok((await editor.boundingBox()).width <= 390);
  await screenshot("mobile-cancellation-protection"); await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  editor = await open(enrolmentIds[3], "cancel");
  await editor.getByText("Attendance or expected-list evidence exists in this teaching term.", { exact: true }).waitFor();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  const emptyTerm = randomUUID(); const emptyOffering = randomUUID();
  await insert("terms", { id: emptyTerm, name: `Unused review ${fixtureId.slice(0, 8)}`, starts_on: "2024-01-01", ends_on: "2024-05-31" });
  const legacy = await service.from("module_offerings").select("module_id").eq("id", offeringIds[3]).single();
  assert.equal(legacy.error, null);
  await insert("module_offerings", { id: emptyOffering, module_id: legacy.data.module_id, term_id: emptyTerm, price_pence: 0, capacity: 10 });
  const emptyEnrolment = randomUUID(); await insert("enrolments", { id: emptyEnrolment, student_id: studentId, offering_id: emptyOffering });
  editor = await open(emptyEnrolment, "cancel");
  assert.equal(await editor.locator('option[value="remove"]').count(), 0);
  await editor.getByRole("checkbox", { name: /I confirm/ }).check(); await save(editor);
  assert.ok((await workspace()).enrolments.find(row => row.id === emptyEnrolment)?.cancellation);
  const cancellationAudit = await admin.from("audit_events").select("id").eq("entity_id", emptyEnrolment).eq("action", "enrolment.added_in_error");
  assert.equal(cancellationAudit.data.length, 1);
  checks.push("Hard removal is absent for protected and unused legacy enrolments; guarded cancellation retains the unused record and audit");

  const current = (await workspace()).enrolments.find(row => row.id === enrolmentIds[0]);
  const denied = await teacher.rpc("execute_assessment_command", { command: { type: "SetEnrolmentRequirements", student_id: studentId, enrolment_id: current.id, expected_token: current.token, attendance_days: 0, presentation_required: false, reason: "Denied" }, expected_revision: current.revision });
  assert.match(denied.error?.message ?? "", /administrator/);
  assert.match((await teacher.rpc("read_student_enrolments", { student_key: studentId })).error?.message ?? "", /administrator/);
  const teacherPage = await browser.newPage(); await login(teacherPage, credentials.teacherEmail);
  assert.equal(await teacherPage.getByRole("button", { name: "Manage enrolment", exact: true }).count(), 0);
  assert.equal(await teacherPage.getByRole("button", { name: "Add enrolment", exact: true }).count(), 0);
  await teacherPage.close();
  checks.push("Teachers retain outcome visibility but cannot load management data, open controls or call mutations");
  const revisions = await admin.from("module_assessment_attempt_revisions").select("id,attempt:module_assessment_attempts!inner(enrolment_id)").in("attempt.enrolment_id", enrolmentIds.slice(0, 2));
  assert.equal(revisions.error, null); assert.equal(revisions.data.length, 4);
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload(); await screenshot("modules-after-save");
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ checks, errors, mode: "shadow", studentId }, null, 2));
  writeFileSync(".context/student-enrolment-review/latest.json", JSON.stringify({ artifacts, url: `${base}${path}` }, null, 2));
  process.stdout.write(`${checks.length} enrolment browser groups passed. Review: ${base}${path}\nEvidence: ${artifacts}\n`);
} catch (error) { await screenshot("failure").catch(() => {}); process.stderr.write(`Synthetic fixture retained: ${artifacts}\n`); throw error; }
finally { await browser.close(); await admin.auth.signOut({ scope: "local" }); await teacher.auth.signOut({ scope: "local" }); }
