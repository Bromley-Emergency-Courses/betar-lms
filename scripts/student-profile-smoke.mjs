import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { studentBrowser } from "./student-browser.mjs";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

if (!process.argv[2]) throw new Error("Pass the private synthetic administrator/teacher credentials JSON.");
const browserType = studentBrowser(process.argv[3]);
const browserName = browserType.name();
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
const otherId = `69000000${randomUUID().slice(8)}`;
const termId = randomUUID();
const moduleId = randomUUID();
const offeringId = randomUUID();
const enrolmentId = randomUUID();
const artifacts = `.context/student-profile-review/${fixtureId}`;
mkdirSync(artifacts, { recursive: true });
async function insert(table, records) { const result = await service.from(table).insert(records); assert.equal(result.error, null); }
await insert("students", [
  { id: studentId, temporary_id: `PROFILE-${fixtureId}`, first_name: "Profile", last_name: `Review ${fixtureId.slice(0, 8)}`, email: `${fixtureId}@example.test`, programme: "pgcert", status: "active", admission_stage: "accepted" },
  { id: otherId, temporary_id: `DUPLICATE-${fixtureId}`, first_name: "Other", last_name: "Synthetic student", email: `${otherId}@example.test`, programme: "pgcert", status: "active", admission_stage: "accepted" }
]);
await insert("terms", { id: termId, name: `Profile review ${fixtureId.slice(0, 8)}`, starts_on: "2025-01-01", ends_on: "2025-05-31" });
await insert("course_modules", { id: moduleId, code: `PROFILE-${fixtureId}`, title: "Profile review module", mode: "online", credits: 10 });
assert.equal((await admin.rpc("save_module_assessment_plan", { input: { module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, reason: "Synthetic profile review" }, expected_plan_id: null })).error, null);
await insert("module_offerings", { id: offeringId, module_id: moduleId, term_id: termId, price_pence: 0, capacity: 10 });
await insert("enrolments", { id: enrolmentId, student_id: studentId, offering_id: offeringId });
async function assessment() { const result = await admin.rpc("read_enrolment_assessment", { enrolment_key: enrolmentId }); assert.equal(result.error, null); return result.data; }
assert.equal((await admin.rpc("execute_assessment_command", { command: { type: "AddManualAttempt", enrolment_id: enrolmentId, component: "theory", sitting_date: "2025-06-01", items: [{ kind: "mcq", score: 70 }], reason: "Synthetic profile review" }, expected_revision: (await assessment()).revision })).error, null);
const originalAssessment = await assessment();
async function student() { const result = await admin.from("students").select("*").eq("id", studentId).single(); assert.equal(result.error, null); return result.data; }
const originalStudent = await student();
const base = "http://127.0.0.1:3100";
const path = `/students/${studentId}?tab=modules&term=${termId}&returnTo=${encodeURIComponent("/students?query=Profile")}`;
writeFileSync(`${artifacts}/fixture.json`, JSON.stringify({ studentId, otherId, termId, moduleId, offeringId, enrolmentId, url: `${base}${path}`, synthetic: true }, null, 2));
const browser = await browserType.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
page.setDefaultTimeout(15000);
const checks = [];
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const screenshot = name => page.screenshot({ path: `${artifacts}/${name}.png`, style: "nextjs-portal { visibility: hidden; }" });
async function login(target, email, next) {
  await target.goto(`${base}/login?next=${encodeURIComponent(next)}`);
  await target.getByLabel("Email", { exact: true }).fill(email);
  await target.getByLabel("Password", { exact: true }).fill(credentials.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click();
  await target.waitForURL(`${base}${next}`);
}
async function open() {
  await page.evaluate(() => window.scrollTo(0, 0));
  const trigger = page.locator('[class*="identity"]').getByRole("button", { name: "Edit student details", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  return page.getByRole("dialog", { name: "Edit student details", exact: true });
}
async function discard(editor) {
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
  await editor.waitFor({ state: "detached" });
}
try {
  await login(page, credentials.adminEmail, path);
  let editor = await open();
  assert.equal(await editor.getByLabel("First name", { exact: true }).inputValue(), "Profile");
  await editor.getByLabel("First name", { exact: true }).fill("Unsaved name");
  await page.keyboard.press("Escape");
  await editor.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(await editor.getByLabel("First name", { exact: true }).inputValue(), "Unsaved name");
  await discard(editor);
  assert.deepEqual(await student(), originalStudent);
  assert.equal(await page.locator('[class*="identity"]').getByRole("button", { name: "Edit student details", exact: true }).evaluate(button => button === document.activeElement), true);
  checks.push("Grouped profile editor preserves original fields; Escape/Keep editing/Discard preserves records and restores focus");

  editor = await open();
  const expected = { first_name: "Updated", last_name: `Profile ${fixtureId.slice(0, 8)} Montgomery-Wellington de la Cruz-Synthetic`, temporary_id: `EDITED-${fixtureId}`, cccu_student_id: `CCCU-${"W".repeat(24)}-${fixtureId}`, email: `updated-${fixtureId}@example.test`, phone: "+44 1234 567890", programme: "microcredential", start_term_id: termId, status: "interrupted", admission_stage: "cccu_registration_pending", notes: "Synthetic profile editing review" };
  for (const [field, value] of Object.entries(expected)) {
    const control = editor.locator(`[name="${field}"]`);
    if (await control.evaluate(element => element.tagName === "SELECT")) await control.selectOption(value);
    else await control.fill(value);
  }
  await editor.evaluate(element => { element.scrollTop = 0; });
  await screenshot("desktop-profile-editor");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  await page.getByRole("heading", { name: `${expected.first_name} ${expected.last_name}`, exact: true }).waitFor();
  const saved = await student();
  for (const [field, value] of Object.entries(expected)) assert.equal(saved[field], value);
  assert.equal(saved.profile_revision, 1);
  assert.deepEqual(await assessment(), originalAssessment);
  assert.equal(page.url(), `${base}${path}`);
  await page.reload();
  await page.getByRole("heading", { name: `${expected.first_name} ${expected.last_name}`, exact: true }).waitFor();
  const audit = await admin.from("audit_events").select("metadata").eq("entity_id", studentId).eq("action", "update_student_details");
  assert.equal(audit.error, null); assert.equal(audit.data.length, 1);
  assert.equal(audit.data[0].metadata.before.first_name, "Profile");
  assert.equal(audit.data[0].metadata.after.first_name, "Updated");
  checks.push("Every identity/contact/programme/lifecycle/admissions field persists across reload, preserves navigation context and audits the save without altering module results");

  editor = await open();
  await editor.getByLabel("Temporary ID", { exact: true }).fill(`DUPLICATE-${fixtureId}`);
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "identifier is already in use" }).waitFor();
  assert.equal(await editor.getByLabel("Temporary ID", { exact: true }).inputValue(), `DUPLICATE-${fixtureId}`);
  assert.deepEqual(await student(), saved);
  await discard(editor);
  checks.push("Duplicate-identifier failures retain the draft and leave the saved student unchanged");

  editor = await open();
  await editor.getByLabel("Notes", { exact: true }).fill("Stale local draft");
  assert.equal((await admin.from("students").update({ notes: "Concurrent legacy edit" }).eq("id", studentId)).error, null);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "Student details changed" }).waitFor();
  assert.equal(await editor.getByLabel("Notes", { exact: true }).inputValue(), "Stale local draft");
  assert.equal((await student()).notes, "Concurrent legacy edit");
  await discard(editor);
  editor = await open();
  assert.equal(await editor.getByLabel("Notes", { exact: true }).inputValue(), "Concurrent legacy edit");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  checks.push("An edit from another writer rejects the frozen revision; focus refresh never replaces dirty inputs and reopening loads the newer record");

  await page.getByRole("link", { name: "Students directory", exact: true }).click();
  await page.waitForURL(`${base}/students?query=Profile`);
  const directoryUrl = page.url();
  await page.locator(`a[href^="/students/${studentId}?"]`).click();
  await page.waitForURL(url => url.pathname === `/students/${studentId}`);
  const backTestUrl = page.url();
  editor = await open();
  await editor.getByLabel("Notes", { exact: true }).fill("Back navigation draft");
  await page.evaluate(() => window.history.back());
  await editor.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(page.url(), backTestUrl);
  assert.equal(await editor.getByLabel("Notes", { exact: true }).inputValue(), "Back navigation draft");
  const unloadWarning = page.waitForEvent("dialog");
  const reload = page.evaluate(() => window.location.reload());
  const warning = await unloadWarning;
  assert.equal(warning.type(), "beforeunload");
  await warning.dismiss();
  await reload;
  assert.equal(await editor.getByLabel("Notes", { exact: true }).inputValue(), "Back navigation draft");
  await page.evaluate(() => window.history.back());
  await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
  await page.waitForURL(directoryUrl);
  assert.equal((await student()).notes, "Concurrent legacy edit");
  checks.push(`In-app Browser Back offers Keep editing/Discard; reloading uses the browser-owned unload warning and cancelling preserves the draft in ${browserName}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}${path}`);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const compact = page.locator('[class*="compactIdentity"]');
  await page.waitForFunction(() => document.querySelector('[class*="compactIdentity"]')?.getAttribute("aria-hidden") === "false");
  await compact.getByText("Student actions", { exact: true }).click();
  await compact.getByRole("button", { name: "Edit student details", exact: true }).click();
  editor = page.getByRole("dialog", { name: "Edit student details", exact: true });
  assert.equal(await editor.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await screenshot("mobile-profile-editor");
  for (const field of ["phone", "cccu_student_id", "notes"]) await editor.locator(`[name="${field}"]`).fill("");
  await editor.getByRole("combobox", { name: "Start term", exact: true }).selectOption("");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  const cleared = await student();
  for (const field of ["phone", "cccu_student_id", "notes", "start_term_id"]) assert.equal(cleared[field], null);
  assert.deepEqual(await assessment(), originalAssessment);
  checks.push("Mobile pinned actions with a long student name open the same editor without overflow; optional fields can be cleared and saved");

  const denied = await teacher.rpc("save_student_profile", { student_key: studentId, expected_revision: cleared.profile_revision, details: expected });
  assert.match(denied.error?.message ?? "", /administrator/);
  assert.deepEqual(await student(), cleared);
  const teacherPage = await browser.newPage();
  await login(teacherPage, credentials.teacherEmail, path);
  assert.equal(await teacherPage.getByRole("button", { name: "Edit student details", exact: true }).count(), 0);
  await teacherPage.close();
  checks.push("Teachers cannot see the editor or mutate student details through the public RPC");
  assert.deepEqual(errors, []);
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ browser: browserName, browserVersion: browser.version(), checks, errors, studentId, mode: "shadow" }, null, 2));
  writeFileSync(".context/student-profile-review/latest.json", JSON.stringify({ artifacts, url: `${base}${path}` }, null, 2));
  process.stdout.write(`${checks.length} profile browser groups passed. Review: ${base}${path}\nEvidence: ${artifacts}\n`);
} catch (error) {
  await screenshot("failure").catch(() => {});
  writeFileSync(`${artifacts}/failure-dialogs.json`, JSON.stringify(await page.locator("dialog").evaluateAll(dialogs => dialogs.map(dialog => ({ open: dialog.open, labelledBy: dialog.getAttribute("aria-labelledby"), title: dialog.querySelector("h2")?.outerHTML, notes: dialog.querySelector('textarea[name="notes"]')?.outerHTML }))), null, 2));
  process.stderr.write(`Synthetic fixture retained: ${artifacts}\n`);
  throw error;
} finally {
  await browser.close();
  await admin.auth.signOut({ scope: "local" });
  await teacher.auth.signOut({ scope: "local" });
}
