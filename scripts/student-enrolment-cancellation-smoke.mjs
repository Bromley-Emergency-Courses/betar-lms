import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

if (!process.argv[2]) throw new Error("Pass private synthetic administrator/teacher credentials JSON.");
validateLocalProjectConfig(readFileSync("dev/assessment/supabase/config.toml", "utf8"));
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", localContainer], { encoding: "utf8" }).trim(), "true");
const settings = validateLocalSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", "dev/assessment", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
const credentials = JSON.parse(readFileSync(process.argv[2], "utf8"));
const service = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const admin = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
const teacher = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
assert.equal((await admin.auth.signInWithPassword({ email: credentials.adminEmail, password: credentials.password })).error, null);
assert.equal((await teacher.auth.signInWithPassword({ email: credentials.teacherEmail, password: credentials.password })).error, null);
const activeTerm = await service.from("terms").select("id").eq("status", "active").single();
assert.equal(activeTerm.error, null, "Use the existing synthetic active term; do not change shared term status.");
const fixtureId = randomUUID(); const studentId = randomUUID(); const termId = activeTerm.data.id; const moduleId = randomUUID(); const offeringId = randomUUID();
const title = `Mistaken enrolment ${fixtureId.slice(0, 8)}`;
const windowId = randomUUID();
const artifacts = `.context/student-cancellation-review/${fixtureId}`;
mkdirSync(artifacts, { recursive: true });
async function insert(table, records) { const result = await service.from(table).insert(records); assert.equal(result.error, null); }
async function workspace(student = studentId) { const result = await admin.rpc("read_student_enrolments", { student_key: student }); assert.equal(result.error, null); return result.data; }
async function createStudent(student = studentId) { await insert("students", { id: student, temporary_id: `CAN-${student}`, first_name: "Cancellation", last_name: `Review ${fixtureId.slice(0, 8)}`, email: `${student}@example.test`, programme: "pgcert", status: "active", admission_stage: "accepted" }); }
async function cancellation(row, student = studentId, client = admin) { return client.rpc("execute_assessment_command", { command: { type: "CancelMistakenEnrolment", enrolment_id: row.id, student_id: student, expected_token: row.token, confirmed: true, reason: "Synthetic mistaken enrolment correction" }, expected_revision: row.revision }); }
async function history(enrolmentId) { const result = await admin.from("enrolment_assessment_history").select("id,revision").eq("enrolment_id", enrolmentId).order("revision"); assert.equal(result.error, null); return result.data; }
async function capacity() { const result = await admin.rpc("module_preference_window_offering_capacity", { p_window_ids: [windowId] }); assert.equal(result.error, null); return result.data[0]; }
await createStudent();
await insert("course_modules", { id: moduleId, code: `CAN-${fixtureId}`, title, mode: "online", credits: 10 });
assert.equal((await admin.rpc("save_module_assessment_plan", { input: { module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, reason: "Synthetic reviewed plan" }, expected_plan_id: null })).error, null);
await insert("module_offerings", { id: offeringId, module_id: moduleId, term_id: termId, price_pence: 10000, capacity: 10 });
await insert("module_preference_windows", { id: windowId, term_id: termId, title: `Synthetic capacity ${fixtureId}`, opens_at: "2025-01-01T00:00:00Z", closes_at: "2025-02-01T00:00:00Z" });
await insert("module_preference_window_offerings", { window_id: windowId, offering_id: offeringId });
const base = "http://127.0.0.1:3100"; const path = `/students/${studentId}?tab=modules`;
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
page.setDefaultTimeout(15000); const errors = []; const checks = [];
page.on("pageerror", error => errors.push(error.message));
const screenshot = name => page.screenshot({ path: `${artifacts}/${name}.png`, style: "nextjs-portal { visibility: hidden; }" });
async function login(target, email) {
  await target.goto(`${base}/login?next=${encodeURIComponent(path)}`);
  await target.getByLabel("Email", { exact: true }).fill(email); await target.getByLabel("Password", { exact: true }).fill(credentials.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click(); await target.waitForURL(`${base}${path}`);
}
async function open() {
  await page.getByRole("button", { name: "Manage enrolment", exact: true }).click();
  return page.getByRole("dialog", { name: "Manage enrolment", exact: true });
}
async function save(editor) {
  await editor.getByLabel("Reason", { exact: true }).fill("Synthetic mistaken enrolment correction");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click(); await editor.waitFor({ state: "detached" });
}
try {
  await login(page, credentials.adminEmail);
  await page.getByRole("button", { name: "Add enrolment", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "Add enrolment", exact: true });
  await editor.getByRole("combobox", { name: "Teaching offering / cohort", exact: true }).selectOption(offeringId); await save(editor);
  let row = (await workspace()).enrolments[0]; const enrolmentId = row.id;
  assert.equal((await capacity()).already_enrolled_count, 1);
  assert.ok((await history(enrolmentId)).length > 0);
  assert.equal((await admin.rpc("execute_assessment_command", { command: { type: "SetAssessmentOverride", enrolment_id: enrolmentId, kind: "status", value: "In progress", reason: "Synthetic override to resolve" }, expected_revision: row.revision })).error, null);
  await page.reload(); editor = await open();
  assert.equal(await editor.locator('option[value="remove"]').count(), 0);
  await editor.getByRole("combobox", { name: "Action", exact: true }).selectOption("cancel");
  await editor.getByText("Outcome: In progress — Synthetic override to resolve", { exact: true }).waitFor();
  assert.equal(await editor.getByRole("button", { name: "Save changes", exact: true }).isDisabled(), true);
  await editor.getByText(/To resolve: close this dialog/).waitFor();
  await screenshot("active-decision-blocker");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: `View results for ${title}`, exact: true }).click();
  const details = page.getByRole("dialog", { name: title, exact: true });
  await details.getByRole("button", { name: "Exceptional decision", exact: true }).click();
  const decision = page.getByRole("dialog", { name: "Exceptional decision", exact: true });
  await decision.getByRole("combobox", { name: "Decision", exact: true }).selectOption("status");
  await decision.getByRole("combobox", { name: "Action", exact: true }).selectOption("clear");
  await save(decision); await details.getByRole("button", { name: "Close result details", exact: true }).click();
  row = (await workspace()).enrolments[0];
  assert.deepEqual(row.cancellationReasons, []);
  const decisions = await admin.from("enrolment_assessment_overrides").select("id,value").eq("enrolment_id", enrolmentId);
  assert.equal(decisions.error, null); assert.equal(decisions.data.length, 2);
  checks.push("Active override blocks cancellation with its exact value/reason and instructions; Restore automatic calculation resolves it through the real UI without deleting decision history");
  editor = await open(); await editor.getByRole("combobox", { name: "Action", exact: true }).selectOption("abandon"); await save(editor);
  const retainedHistory = await history(enrolmentId);
  editor = await open(); await editor.getByRole("combobox", { name: "Action", exact: true }).selectOption("cancel");
  assert.equal(await editor.getByText("Cancellation requires separate review.", { exact: true }).count(), 0);
  await editor.getByRole("checkbox", { name: /I confirm/ }).check();
  await editor.getByLabel("Reason", { exact: true }).fill("Added the wrong module while testing enrolment");
  await screenshot("cancellation-confirmation");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(await editor.getByLabel("Reason", { exact: true }).inputValue(), "Added the wrong module while testing enrolment");
  await save(editor); await page.reload(); await page.getByRole("button", { name: "Manage enrolment", exact: true }).waitFor();
  assert.equal(await page.getByText(title, { exact: true }).count(), 0);
  row = (await workspace()).enrolments[0]; assert.ok(row.cancellation); assert.equal(row.assessment, null);
  assert.deepEqual(await history(enrolmentId), retainedHistory);
  assert.equal((await admin.from("active_module_enrolments").select("id").eq("id", enrolmentId)).data.length, 0);
  assert.equal((await admin.from("assessment_outcomes").select("enrolment_id").eq("enrolment_id", enrolmentId)).data.length, 0);
  assert.equal((await admin.from("audit_events").select("id").eq("entity_id", enrolmentId).eq("action", "enrolment.added_in_error")).data.length, 1);
  assert.ok(!(await workspace()).offerings.some(offering => offering.id === offeringId));
  assert.equal((await capacity()).already_enrolled_count, 0);
  assert.equal((await capacity()).remaining_places, 10);
  const credits = await admin.rpc("formally_awarded_credits", { p_student_id: studentId }); assert.equal(credits.error, null); assert.equal(credits.data, 0);
  checks.push("Actual Add enrolment → abandon → added-in-error cancellation survives reload; all original history remains and normal module/assessment views exclude it");
  checks.push("Legacy admissions capacity releases the mistaken place and formally awarded credits remain zero");

  editor = await open(); assert.equal(await editor.locator(`option[value="${enrolmentId}"]`).count(), 0);
  await editor.getByRole("checkbox", { name: "Show cancelled enrolments", exact: true }).check();
  await editor.getByRole("combobox", { name: "Module enrolment", exact: true }).selectOption(enrolmentId);
  await editor.getByText("Added in error — cancelled", { exact: true }).waitFor();
  assert.equal(await editor.getByRole("button", { name: "Save changes", exact: true }).isDisabled(), true);
  await screenshot("cancelled-audit");
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok((await editor.boundingBox()).width <= 390);
  await screenshot("cancelled-mobile");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  checks.push("Explicit Show cancelled enrolments reveals read-only reason, actor and date on desktop/mobile; dirty-draft confirmation retains input");

  assert.match((await cancellation(row, studentId, teacher)).error?.message ?? "", /administrator/);
  assert.match((await cancellation(row)).error?.message ?? "", /already cancelled/);
  assert.ok((await admin.from("enrolment_cancellations").insert({ enrolment_id: enrolmentId })).error);
  assert.ok((await admin.from("active_module_enrolments").insert({ student_id: studentId, offering_id: offeringId })).error);
  assert.ok((await service.from("enrolments").delete().eq("id", enrolmentId)).error);
  assert.ok((await service.from("enrolments").update({ credits_awarded: 10 }).eq("id", enrolmentId)).error);
  const teacherPage = await browser.newPage(); await login(teacherPage, credentials.teacherEmail);
  assert.equal(await teacherPage.getByRole("button", { name: "Manage enrolment", exact: true }).count(), 0); await teacherPage.close();
  checks.push("Teacher RPC/UI and direct write bypasses are denied; cancellation cannot erase or rewrite the retained enrolment");

  for (const index of [0, 1, 2]) {
    const raceStudent = randomUUID(); await createStudent(raceStudent);
    const raceEnrolment = randomUUID(); await insert("enrolments", { id: raceEnrolment, student_id: raceStudent, offering_id: offeringId });
    const current = (await workspace(raceStudent)).enrolments[0];
    const results = await Promise.all([
      cancellation(current, raceStudent),
      admin.rpc("execute_assessment_command", { command: { type: "AddManualAttempt", enrolment_id: raceEnrolment, component: "theory", sitting_date: "2025-06-01", items: [{ kind: "mcq", score: 30 }], reason: `Concurrent evidence ${index}` }, expected_revision: current.revision })
    ]);
    assert.ok(results.some(result => !result.error)); assert.ok(results.some(result => result.error));
    const final = (await workspace(raceStudent)).enrolments[0];
    const attempts = await admin.from("module_assessment_attempts").select("id").eq("enrolment_id", raceEnrolment); assert.equal(attempts.error, null);
    assert.equal(final.cancellation ? attempts.data.length : final.assessment.components.theory.attempt_count, final.cancellation ? 0 : 1);
  }
  checks.push("Three real concurrent cancellation-versus-score races cannot cancel an enrolment containing a result");

  const protectedStudent = randomUUID(); const protectedEnrolment = randomUUID(); await createStudent(protectedStudent);
  await insert("enrolments", { id: protectedEnrolment, student_id: protectedStudent, offering_id: offeringId });
  let protectedRow = (await workspace(protectedStudent)).enrolments[0];
  assert.equal((await admin.rpc("execute_assessment_command", { command: { type: "AddManualAttempt", enrolment_id: protectedEnrolment, component: "theory", sitting_date: "2025-06-01", items: [{ kind: "mcq", score: 30 }], reason: "Protected failed result" }, expected_revision: protectedRow.revision })).error, null);
  protectedRow = (await workspace(protectedStudent)).enrolments[0];
  assert.match((await cancellation(protectedRow, protectedStudent)).error?.message ?? "", /Cancellation blocked/);
  await page.goto(`${base}/students/${protectedStudent}?tab=modules`);
  editor = await open(); await editor.getByRole("combobox", { name: "Action", exact: true }).selectOption("cancel");
  await editor.getByText("Cancellation requires separate review.", { exact: true }).waitFor();
  assert.equal(await editor.getByRole("button", { name: "Save changes", exact: true }).isDisabled(), true);
  await screenshot("protected-result-mobile"); await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  checks.push("A failed result blocks cancellation in both the database and mobile editor; its score remains visible");
  assert.deepEqual(errors, []);
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ checks, errors, studentId, enrolmentId, protectedStudent, mode: "shadow" }, null, 2));
  writeFileSync(".context/student-cancellation-review/latest.json", JSON.stringify({ artifacts, url: `${base}${path}` }, null, 2));
  process.stdout.write(`${checks.length} cancellation browser/database groups passed. Review: ${base}${path}\nEvidence: ${artifacts}\n`);
} catch (error) { await screenshot("failure").catch(() => {}); process.stderr.write(`Synthetic fixture retained: ${artifacts}\n`); throw error; }
finally { await browser.close(); await admin.auth.signOut({ scope: "local" }); await teacher.auth.signOut({ scope: "local" }); }
