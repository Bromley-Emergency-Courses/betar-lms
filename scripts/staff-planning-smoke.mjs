import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { studentBrowser } from "./student-browser.mjs";
import { trackPageRequests } from "./student-browser-settle.mjs";
import { interruptNextAction } from "./student-browser-faults.mjs";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

validateLocalProjectConfig(readFileSync("dev/assessment/supabase/config.toml", "utf8"));
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", localContainer], { encoding: "utf8" }).trim(), "true");
const settings = validateLocalSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", "dev/assessment", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
const credentials = JSON.parse(readFileSync(process.argv[2], "utf8"));
const client = key => createClient(settings.API_URL, key, { auth: { persistSession: false } });
const service = client(settings.SERVICE_ROLE_KEY), admin = client(settings.ANON_KEY), teacher = client(settings.ANON_KEY);
assert.equal((await admin.auth.signInWithPassword({ email: credentials.adminEmail, password: credentials.password })).error, null);
assert.equal((await teacher.auth.signInWithPassword({ email: credentials.teacherEmail, password: credentials.password })).error, null);
const activeTerm = await admin.from("terms").select("id").eq("status", "active").single();
assert.equal(activeTerm.error, null);
const studentId = randomUUID(), termId = activeTerm.data.id, fixtureId = randomUUID();
const artifacts = `.context/staff-planning-review/${fixtureId}`; mkdirSync(artifacts, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const date = offset => new Date(new Date(`${today}T12:00:00Z`).getTime() + offset * 86400000).toISOString().slice(0, 10);
async function insert(table, values) { assert.equal((await service.from(table).insert(values)).error, null); }
await insert("students", { id: studentId, temporary_id: `PLAN-${fixtureId}`, first_name: "Planning", last_name: fixtureId.slice(0, 8), email: `${fixtureId}@example.test`, programme: "pgcert", status: "active", admission_stage: "accepted" });
const offeringIds = [], enrolmentIds = [], moduleIds = [], codes = [];
for (const index of [0, 1]) {
  const moduleId = randomUUID(), offeringId = randomUUID(), enrolmentId = randomUUID();
  const code = `PLAN-${fixtureId.slice(0, 8)}-${index}`;
  await insert("course_modules", { id: moduleId, code, title: `Planning module ${index + 1}`, mode: "practical", credits: 10 });
  assert.equal((await admin.rpc("save_module_assessment_plan", { input: { module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, practical_pass_mark: 50, reason: "Synthetic planning fixture" }, expected_plan_id: null })).error, null);
  await insert("module_offerings", { id: offeringId, module_id: moduleId, term_id: termId, price_pence: 0, capacity: 20, presentation_required: true });
  await insert("enrolments", { id: enrolmentId, student_id: studentId, offering_id: offeringId, attendance_days_required_override: 2 });
  moduleIds.push(moduleId); offeringIds.push(offeringId); enrolmentIds.push(enrolmentId); codes.push(code);
}
const sessions = [randomUUID(), randomUUID(), randomUUID()];
for (const [index, id] of sessions.entries()) await insert("attendance_sessions", { id, term_id: termId, session_date: date(7 + index), starts_at: "09:00", ends_at: "17:00", location: "Synthetic teaching room" });
const options = async () => { const result = await teacher.rpc("read_student_teaching_plans", { student_key: studentId }); assert.equal(result.error, null); return result.data; };
const command = async extra => ({ studentId, offeringId: offeringIds[0], token: (await options()).token, kind: "attendance", sessionId: sessions[0], fromSessionId: null, expected: true, ...extra });
const base = "http://127.0.0.1:3100", path = `/staff?studentId=${studentId}&term=${termId}`;
writeFileSync(`${artifacts}/fixture.json`, JSON.stringify({ studentId, termId, offeringIds, enrolmentIds, moduleIds, sessions, url: base + path, synthetic: true }, null, 2));
const browser = await studentBrowser(process.argv[3]).launch(); const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
page.setDefaultTimeout(15000); const errors = [], checks = []; page.on("pageerror", error => errors.push(error.message)); const settle = trackPageRequests(page);
async function navigate(url) { await settle(); await page.goto(url); await page.getByRole("heading", { name: "Module enrolments", exact: true }).waitFor(); }
async function open(index = 0) {
  await page.getByRole("article").filter({ hasText: `Planning module ${index + 1}` }).getByRole("button", { name: "Plan teaching dates", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Plan teaching dates", exact: true }); await editor.getByLabel("Plan type", { exact: true }).waitFor(); return editor;
}
async function save(editor) { await editor.getByRole("button", { name: "Save plan", exact: true }).click(); await editor.waitFor({ state: "detached" }); await settle(); }
async function plan(kind, sessionId, index = 0) { const editor = await open(index); await editor.getByLabel("Plan type", { exact: true }).selectOption(kind); await editor.getByLabel("Teaching date", { exact: true }).selectOption(sessionId); await save(editor); }
try {
  await page.goto(`${base}/login?next=${encodeURIComponent(path)}`); await page.getByLabel("Email", { exact: true }).fill(credentials.teacherEmail); await page.getByLabel("Password", { exact: true }).fill(credentials.password); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await page.waitForURL(base + path);
  let editor = await open(); await editor.getByLabel("Teaching date", { exact: true }).selectOption(sessions[0]);
  assert.ok((await editor.getByLabel("Teaching date", { exact: true }).boundingBox()).height >= 44);
  await page.screenshot({ path: `${artifacts}/phone-plan.png`, style: "nextjs-portal { visibility: hidden; }" });
  let verifyFault = await interruptNextAction(page);
  await editor.getByRole("button", { name: "Save plan", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "Save could not be confirmed" }).waitFor(); await verifyFault();
  assert.equal(await editor.getByLabel("Teaching date", { exact: true }).inputValue(), sessions[0]);
  assert.equal((await options()).sessions.find(session => session.id === sessions[0]).expected, false);
  verifyFault = await interruptNextAction(page, { afterResponse: true });
  await editor.getByRole("button", { name: "Save plan", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "Save could not be confirmed" }).waitFor(); await verifyFault();
  const committedPlan = await options(); assert.equal(committedPlan.sessions.find(session => session.id === sessions[0]).expected, true);
  await editor.getByRole("button", { name: "Save plan", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "changed" }).waitFor();
  assert.equal(await editor.getByLabel("Teaching date", { exact: true }).inputValue(), sessions[0]);
  assert.equal((await options()).token, committedPlan.token);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
  editor = await open(); await editor.getByLabel("Action", { exact: true }).selectOption("move");
  assert.equal(await editor.getByLabel("Move from", { exact: true }).locator(`option[value="${sessions[0]}"]`).count(), 1);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  checks.push("Dropped plan requests keep drafts without writes; lost acknowledgements preserve one committed plan and stale retry cannot overwrite it");
  await plan("presentation", sessions[0]); await plan("presentation", sessions[0], 1);
  let current = await options(); assert.equal(current.offerings.filter(offering => offering.plannedSessionId === sessions[0]).length, 2); assert.equal(current.sessions.filter(session => session.expected).length, 1);
  assert.equal((await teacher.from("attendance_records").select("id").eq("student_id", studentId)).data.length, 0);
  assert.equal((await teacher.from("presentation_scores").select("id").eq("student_id", studentId)).data.length, 0);
  checks.push("Teacher plans term attendance and two same-day module presentations without completed evidence");
  await settle(); await page.goto(`${base}/staff?mode=term&term=${termId}&q=${fixtureId.slice(0, 8)}`);
  const matrix = page.getByRole("region", { name: "Term attendance and presentation register", exact: true });
  assert.ok((await page.locator('select[name="term"]').boundingBox()).height >= 44);
  for (const code of codes) await matrix.getByText(`${code} · Presentation planned`, { exact: true }).waitFor();
  await matrix.getByText(`${codes[0]} · Presentation planned`, { exact: true }).scrollIntoViewIfNeeded();
  await page.setViewportSize({ width: 1180, height: 820 }); await page.screenshot({ path: `${artifacts}/tablet-term-plans.png`, style: "nextjs-portal { visibility: hidden; }" });
  await navigate(base + path);
  editor = await open(); await editor.getByLabel("Action", { exact: true }).selectOption("move"); await editor.getByLabel("Move from", { exact: true }).selectOption(sessions[0]); await editor.getByLabel("Teaching date", { exact: true }).selectOption(sessions[1]); await save(editor);
  current = await options(); assert.equal(current.sessions.find(session => session.id === sessions[0]).expected, false); assert.equal(current.offerings.filter(offering => offering.plannedSessionId === sessions[0]).length, 2);
  await plan("presentation", sessions[2]);
  editor = await open(); await editor.getByLabel("Plan type", { exact: true }).selectOption("presentation"); await editor.getByLabel("Action", { exact: true }).selectOption("cancel"); await save(editor);
  current = await options(); assert.equal(current.offerings.find(offering => offering.id === offeringIds[0]).plannedSessionId, null); assert.equal(current.offerings.find(offering => offering.id === offeringIds[1]).plannedSessionId, sessions[0]); assert.equal(current.sessions.find(session => session.id === sessions[1]).expected, true);
  checks.push("Attendance moves and presentation move/cancel preserve independent plans; matrix labels both modules");
  editor = await open(); await editor.getByLabel("Teaching date", { exact: true }).selectOption(sessions[2]);
  assert.equal((await admin.from("attendance_sessions").update({ location: "Changed by calendar administrator" }).eq("id", sessions[2])).error, null);
  await editor.getByRole("button", { name: "Save plan", exact: true }).click(); await editor.getByRole("alert").filter({ hasText: "calendar changed" }).waitFor(); assert.equal(await editor.getByLabel("Teaching date", { exact: true }).inputValue(), sessions[2]);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await editor.getByRole("button", { name: "Keep editing", exact: true }).click(); await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
  const pending = await command({ sessionId: sessions[2] });
  const concurrent = await Promise.all([teacher.rpc("save_student_teaching_plan", { command: pending }), teacher.rpc("save_student_teaching_plan", { command: pending })]); assert.equal(concurrent.filter(result => !result.error).length, 1);
  assert.ok((await teacher.from("presentation_plans").update({ session_id: sessions[2] }).eq("enrolment_id", enrolmentIds[1])).error);
  assert.ok((await teacher.from("attendance_sessions").update({ location: "Forbidden" }).eq("id", sessions[2])).error || (await admin.from("attendance_sessions").select("location").eq("id", sessions[2]).single()).data.location === "Changed by calendar administrator");
  const prior = await command({ kind: "presentation" });
  assert.equal((await admin.from("course_modules").update({ active: false }).eq("id", moduleIds[0])).error, null);
  try {
    assert.ok((await teacher.rpc("save_student_teaching_plan", { command: prior })).error);
    await navigate(base + path); assert.equal(await page.getByRole("article").filter({ hasText: "Planning module 1" }).getByRole("button", { name: "Plan teaching dates", exact: true }).count(), 0);
  } finally { assert.equal((await admin.from("course_modules").update({ active: true }).eq("id", moduleIds[0])).error, null); }
  checks.push("Calendar changes preserve stale drafts; concurrent retries save once; direct teacher mutations and inactive modules are blocked");
  await settle(); await page.goto(`${base}/students/${studentId}?tab=attendance&term=${termId}`); await page.getByRole("heading", { name: "Attendance", exact: true }).waitFor();
  await settle(); assert.deepEqual(errors, []);
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ checks, errors, browser: browser.browserType().name(), synthetic: true }, null, 2));
  writeFileSync(".context/staff-planning-review/latest.json", JSON.stringify({ artifacts, url: base + path }, null, 2));
  console.log(`${checks.length} planning browser groups passed. ${artifacts}`);
} catch (error) { await page.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {}); writeFileSync(`${artifacts}/failure.json`, JSON.stringify({ checks, errors, error: String(error) }, null, 2)); throw error; }
finally { await browser.close(); await admin.auth.signOut({ scope: "local" }); await teacher.auth.signOut({ scope: "local" }); }
