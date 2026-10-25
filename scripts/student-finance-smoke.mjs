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
const fixtureId = randomUUID(); const studentId = `69000000${randomUUID().slice(8)}`; const otherStudentId = `69000000${randomUUID().slice(8)}`;
const termId = randomUUID(); const secondTermId = randomUUID(); const moduleId = randomUUID(); const offeringId = randomUUID(); const enrolmentId = randomUUID();
const artifacts = `.context/student-finance-review/${fixtureId}`; mkdirSync(artifacts, { recursive: true });
async function insert(table, values) { assert.equal((await service.from(table).insert(values)).error, null); }
async function rows() { const result = await admin.from("finance_records").select("*").eq("student_id", studentId); assert.equal(result.error, null); return result.data; }
async function snapshot() { const result = await admin.rpc("read_student_finance_workspace", { student_key: studentId }); assert.equal(result.error, null); return result.data; }
async function evaluation() { const result = await admin.rpc("read_enrolment_assessment", { enrolment_key: enrolmentId }); assert.equal(result.error, null); return result.data; }
for (const id of [studentId, otherStudentId]) await insert("students", { id, temporary_id: `FIN-${id}`, first_name: "Finance", last_name: `Review ${id.slice(-8)}`, email: `${id}@example.test`, programme: "pgcert", status: "active", admission_stage: "accepted" });
await insert("terms", [{ id: termId, name: `Finance review ${fixtureId.slice(0, 8)}`, starts_on: "2025-01-01", ends_on: "2025-05-31", status: "closed" }, { id: secondTermId, name: `Finance later ${fixtureId.slice(0, 8)}`, starts_on: "2025-09-01", ends_on: "2025-12-31", status: "closed" }]);
await insert("course_modules", { id: moduleId, code: `FIN-${moduleId}`, title: "Finance review module", mode: "online", credits: 10 });
assert.equal((await admin.rpc("save_module_assessment_plan", { input: { module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, reason: "Synthetic finance review" }, expected_plan_id: null })).error, null);
await insert("module_offerings", { id: offeringId, module_id: moduleId, term_id: termId, price_pence: 123456, capacity: 10 });
await insert("enrolments", { id: enrolmentId, student_id: studentId, offering_id: offeringId });
const beforeAssessment = await evaluation();
const base = "http://127.0.0.1:3100"; const path = `/students/${studentId}?tab=finance&term=${termId}`;
writeFileSync(`${artifacts}/fixture.json`, JSON.stringify({ fixtureId, studentId, otherStudentId, termId, secondTermId, enrolmentId, offeringId, url: `${base}${path}`, synthetic: true }, null, 2));
const browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" }); const page = await context.newPage();
page.setDefaultTimeout(15000); const checks = []; const errors = []; page.on("pageerror", error => errors.push(error.message));
const screenshot = name => page.screenshot({ path: `${artifacts}/${name}.png`, style: "nextjs-portal { visibility: hidden; }" });
async function login(target, email) {
  await target.goto(`${base}/login?next=${encodeURIComponent(path)}`); await target.getByLabel("Email", { exact: true }).fill(email); await target.getByLabel("Password", { exact: true }).fill(credentials.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click(); await target.waitForURL(`${base}${path}`);
}
async function open(create = false) {
  await page.getByRole("button", { name: create ? "Add finance record" : `Edit finance for Finance review ${fixtureId.slice(0, 8)}`, exact: true }).click();
  const editor = page.getByRole("dialog", { name: create ? "Add finance record" : "Edit finance record", exact: true }); await editor.waitFor(); return editor;
}
async function save(editor) { await editor.getByRole("button", { name: "Save finance record", exact: true }).click(); await editor.waitFor({ state: "detached" }); }
async function discard(editor) { await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await editor.getByRole("button", { name: "Discard changes", exact: true }).click(); await editor.waitFor({ state: "detached" }); }
try {
  await login(page, credentials.adminEmail);
  let editor = await open(true);
  assert.equal(await editor.getByRole("combobox", { name: "Term", exact: true }).inputValue(), termId);
  assert.equal(await editor.getByLabel("Expected amount (GBP)", { exact: true }).inputValue(), "1234.56");
  assert.equal(await editor.getByRole("combobox", { name: "Term", exact: true }).locator(`option[value="${secondTermId}"]`).count(), 0);
  await editor.getByLabel("Notes", { exact: true }).fill("Expected fees reviewed; invoice and payment not yet recorded."); await screenshot("finance-create-editor"); await save(editor);
  let record = (await rows())[0]; assert.equal(record.expected_amount_pence, 123456); assert.equal(record.invoice_amount_pence, null); assert.equal(record.paid_amount_pence, null);
  await page.reload(); await page.getByRole("region", { name: "Student finance", exact: true }).getByText("£1,234.56", { exact: true }).waitFor();
  assert.match(await page.getByRole("region", { name: "Student finance", exact: true }).innerText(), /Not recorded/);
  await page.getByText("Incomplete", { exact: true }).waitFor(); assert.equal(new URL(page.url()).searchParams.get("term"), termId);
  checks.push("Missing enrolled-term creation persists exact expected fees, unknown amounts and context after reload; unrelated terms excluded");

  editor = await open(); await editor.getByLabel("Invoice amount (GBP)", { exact: true }).fill("1234.56"); await editor.getByLabel("Paid amount (GBP)", { exact: true }).fill("0");
  await editor.getByRole("combobox", { name: "Invoice status", exact: true }).selectOption("sent"); await editor.getByRole("combobox", { name: "Payment status", exact: true }).selectOption("outstanding");
  await editor.getByLabel("Notes", { exact: true }).fill("Invoice recorded externally; £0 received so far."); await screenshot("finance-edit-editor"); await save(editor); await page.reload();
  record = (await rows())[0]; assert.equal(record.paid_amount_pence, 0); assert.equal(record.invoice_amount_pence, 123456); assert.equal(record.invoice_status, "sent"); assert.equal(record.payment_status, "outstanding");
  await screenshot("finance-records"); checks.push("Invoice/payment statuses and exact zero persist separately from blank amounts; totals refresh immediately");

  editor = await open(); await editor.getByLabel("Paid amount (GBP)", { exact: true }).fill("100.001"); await editor.getByRole("button", { name: "Save finance record", exact: true }).click();
  assert.equal(await editor.getByLabel("Paid amount (GBP)", { exact: true }).inputValue(), "100.001"); assert.equal((await rows())[0].paid_amount_pence, 0);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await editor.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(await editor.getByLabel("Paid amount (GBP)", { exact: true }).inputValue(), "100.001"); await discard(editor);
  checks.push("Invalid precision never writes; Cancel offers Keep editing/Discard and retains the draft");

  editor = await open(); await editor.getByLabel("Notes", { exact: true }).fill("Unsaved profile draft");
  const specialist = await page.context().newPage();
  specialist.on("pageerror", error => errors.push(error.message));
  let releaseScripts;
  const scriptsReady = new Promise(resolve => { releaseScripts = resolve; });
  await specialist.route("**/_next/static/**/*.js*", async route => { await scriptsReady; await route.continue(); });
  await specialist.goto(`${base}/finance?mode=edit&student=${studentId}&term=${termId}`, { waitUntil: "commit" });
  const specialistRow = specialist.locator("tr").filter({ has: specialist.locator(`input[name="finance_record_id"][value="${record.id}"]`) }).first();
  const specialistNotes = specialistRow.locator('textarea[name="notes"]');
  try {
    await specialistNotes.waitFor({ state: "visible" });
    assert.equal(await specialistNotes.isDisabled(), true, "Specialist editing must wait for hydration to preserve replacement text");
  } finally { releaseScripts(); }
  await specialistNotes.fill("Specialist finance update");
  assert.equal(await specialistNotes.inputValue(), "Specialist finance update");
  await specialist.screenshot({ path: `${artifacts}/specialist-notes-replacement.png`, style: "nextjs-portal { visibility: hidden; }" });
  await specialistNotes.fill(""); assert.equal(await specialistNotes.inputValue(), "");
  await specialistNotes.fill("Specialist finance update"); await specialistRow.getByRole("button", { name: "Save", exact: true }).click();
  await specialist.waitForURL(`${base}/finance?mode=edit&student=${studentId}&term=${termId}`);
  await specialist.getByRole("link", { name: "Return to student finance", exact: true }).waitFor();
  await page.bringToFront(); await editor.getByRole("button", { name: "Save finance record", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "changed, moved or was deleted" }).waitFor();
  assert.equal(await editor.getByLabel("Notes", { exact: true }).inputValue(), "Unsaved profile draft"); assert.equal((await rows())[0].notes, "Specialist finance update");
  await discard(editor); editor = await open(); assert.equal(await editor.getByLabel("Notes", { exact: true }).inputValue(), "Specialist finance update"); await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await specialist.reload();
  await specialistNotes.fill("Fresh-page replacement check");
  assert.equal(await specialistNotes.inputValue(), "Fresh-page replacement check");
  await specialist.close(); checks.push("Slow-loading specialist editor protects pre-hydration fields and replaces/clears notes exactly; shared records and student/term navigation reject stale profile saves and reopen fresh data");

  editor = await open(); await editor.getByLabel("Notes", { exact: true }).fill("Must not follow reassignment");
  assert.equal((await admin.from("finance_records").update({ student_id: otherStudentId }).eq("id", record.id)).error, null);
  await editor.getByRole("button", { name: "Save finance record", exact: true }).click(); await editor.getByRole("alert").filter({ hasText: "changed, moved or was deleted" }).waitFor(); await discard(editor);
  assert.equal((await rows()).length, 0);
  assert.equal((await admin.from("finance_records").update({ student_id: studentId }).eq("id", record.id)).error, null); await page.reload();
  checks.push("Student ownership remains fixed; specialist reassignment invalidates the old profile draft");

  await page.setViewportSize({ width: 390, height: 844 }); editor = await open();
  await editor.getByLabel("Paid amount (GBP)", { exact: true }).fill("12.34"); await editor.getByLabel("Notes", { exact: true }).fill("Payment recorded externally; review remaining balance."); await screenshot("finance-mobile-editor"); await save(editor);
  assert.equal((await rows())[0].paid_amount_pence, 1234); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.reload(); await page.getByRole("region", { name: "Student finance", exact: true }).getByText("£12.34", { exact: true }).waitFor();
  checks.push("Mobile finance editor saves exact pence without page overflow and survives reload");

  const teacherPage = await browser.newPage(); await login(teacherPage, credentials.teacherEmail);
  assert.equal(await teacherPage.getByRole("button", { name: "Add finance record", exact: true }).count(), 0);
  assert.equal(await teacherPage.getByRole("navigation", { name: "Student sections" }).getByRole("button", { name: "Finance", exact: true }).count(), 0);
  const teacherPayload = await teacherPage.content(); assert.ok(!teacherPayload.includes("Payment recorded externally; review remaining balance."));
  assert.match((await teacher.rpc("read_student_finance_workspace", { student_key: studentId })).error.message, /administrator/);
  const current = (await snapshot()).records[0]; const command = { id: current.id, student_id: studentId, term_id: termId, expected_version: current.version, term_token: null, expected_amount_pence: 123456, invoice_amount_pence: null, paid_amount_pence: null, invoice_status: "not_requested", payment_status: "not_due", notes: null };
  assert.match((await teacher.rpc("save_student_finance", { command })).error.message, /administrator/);
  const anonymous = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } }); assert.ok((await anonymous.rpc("read_student_finance_workspace", { student_key: studentId })).error);
  await teacherPage.close(); checks.push("Teacher payload omits finance data and controls; direct teacher and anonymous RPC access is denied");

  assert.deepEqual(await evaluation(), beforeAssessment);
  const audits = await admin.from("audit_events").select("action,metadata").eq("entity_id", record.id).in("action", ["create_student_finance", "update_student_finance"]); assert.equal(audits.error, null);
  assert.equal(audits.data.length, 3); assert.ok(audits.data.some(row => row.metadata.after.paid_amount_pence === 0));
  assert.deepEqual(errors, []); checks.push("Creation and successful edits retain before/after audit evidence; assessment outcome and attempt history remain unchanged");
  const racingCommand = { ...command, invoice_amount_pence: current.invoice_amount_pence, paid_amount_pence: current.paid_amount_pence, invoice_status: current.invoice_status, payment_status: current.payment_status, notes: current.notes };
  const races = await Promise.all([admin.rpc("save_student_finance", { command: racingCommand }), admin.rpc("save_student_finance", { command: racingCommand })]);
  assert.equal(races.filter(result => result.error === null).length, 1);
  assert.match(races.find(result => result.error)?.error.message, /changed, moved or was deleted/);
  assert.equal((await admin.from("audit_events").select("id", { count: "exact" }).eq("entity_id", record.id).in("action", ["create_student_finance", "update_student_finance"])).count, 4);
  checks.push("Two concurrent Docker saves against one frozen version yield exactly one success and one audit, never lost updates");
  await page.setViewportSize({ width: 1440, height: 1000 }); await screenshot("finance-records-final");
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ checks, errors, url: `${base}${path}`, synthetic: true }, null, 2));
  writeFileSync(".context/student-finance-review/latest.json", JSON.stringify({ artifacts, url: `${base}${path}`, checks: checks.length }, null, 2));
  console.log(JSON.stringify({ artifacts, url: `${base}${path}`, checks: checks.length, errors }, null, 2));
} catch (error) { await screenshot("failure"); throw error; }
finally { await browser.close(); }
