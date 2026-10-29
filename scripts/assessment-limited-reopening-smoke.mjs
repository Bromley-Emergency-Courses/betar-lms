import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { liveAppEnvironment, liveContainer, liveWorkdir, validateLiveProject, validateLiveSettings } from "./assessment-live-config.mjs";

validateLiveProject(readFileSync(`${liveWorkdir}/supabase/config.toml`, "utf8"));
const settings = validateLiveSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", liveWorkdir, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
const base = "http://127.0.0.1:3102";
assert.equal(await fetch(`${base}/login`).then(() => true, () => false), false, "Port 3102 is occupied");
function sql(statement) {
  return execFileSync("docker", ["exec", "-i", liveContainer, "psql", "-XqAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
assert.equal(sql("select writes_paused from assessment_operational_controls"), "f", "Migrate the disposable synthetic stack and leave it unpaused first");
const fixture = randomUUID();
const artifacts = `.context/teaching-reopening-review/${fixture}`;
mkdirSync(artifacts, { recursive: true, mode: 0o700 });
const service = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const admin = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
const password = randomBytes(24).toString("base64url");
const email = `teaching-pause-${fixture}@example.test`;
const adminEmail = `pause-admin-${fixture}@example.test`;
for (const [address, role] of [[email, "teacher"], [adminEmail, "admin"]]) {
  const created = await service.auth.admin.createUser({ email: address, password, email_confirm: true });
  assert.equal(created.error, null);
  assert.equal((await service.from("staff_profiles").upsert({ id: created.data.user.id, full_name: `Synthetic pause ${role}`, role, active: true })).error, null);
}
assert.equal((await admin.auth.signInWithPassword({ email: adminEmail, password })).error, null);
async function insert(table, value) { const result = await service.from(table).insert(value); assert.equal(result.error, null, result.error?.message); }
const student = randomUUID(), moduleId = randomUUID(), offering = randomUUID(), enrolment = randomUUID();
const term = sql("select id from terms where status='active'");
assert.match(term, /^[a-f0-9-]{36}$/);
assert.equal(sql(`select current_date between starts_on and ends_on from terms where id='${term}'`), "t");
const today = sql("select current_date::text");
await insert("students", { id: student, temporary_id: `PAUSE-${fixture}`, first_name: "Synthetic", last_name: "Teaching pause", email, programme: "pgcert", status: "active" });
await insert("course_modules", { id: moduleId, code: `PAUSE-${fixture}`, title: "Synthetic teaching module", mode: "practical", credits: 10 });
await insert("module_offerings", { id: offering, module_id: moduleId, term_id: term, price_pence: 0, capacity: 10, presentation_required: true });
await insert("enrolments", { id: enrolment, student_id: student, offering_id: offering, credits_awarded: 10 });
sql(`insert into assessment_historical_outcomes(enrolment_id,recorded_status,recorded_credits,capture_reference) values('${enrolment}','planned',10,'Synthetic paused teaching rehearsal');`);
const original = sql(`select jsonb_build_object('status',status,'credits',credits_awarded,'mark',final_mark,'grade',grade,'plan',assessment_plan_id) from enrolments where id='${enrolment}'`);
const descriptor = openSync(`${artifacts}/app.log`, "a", 0o600);
let server, browser;
const errors = [];
try {
  sql("update assessment_operational_controls set writes_paused=true where singleton");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3102"], {
    env: { ...liveAppEnvironment(settings, "shadow", true, process.env), STAFF_COMPANION_ENABLED: "true", STAFF_COMPANION_TEACHING_ENABLED: "true", ASSESSMENT_OPERATIONS_PAUSED: "true" },
    detached: true, stdio: ["ignore", descriptor, descriptor]
  });
  let ready = false;
  for (let retry = 0; retry < 90; retry++) {
    ready = await fetch(`${base}/login`).then(response => response.ok, () => false);
    if (ready) break;
    assert.equal(server.exitCode, null);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(ready);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(25000);
  page.on("pageerror", error => errors.push(error.message));
  const path = `/staff?studentId=${student}&term=${term}`;
  await page.goto(`${base}/login?next=${encodeURIComponent(path)}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/staff");
  await page.getByText("Teaching is open:", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Add encounter", exact: true }).click();
  let editor = page.getByRole("dialog");
  await editor.getByLabel("Date", { exact: true }).fill(today);
  await editor.getByLabel("Observation details", { exact: true }).fill("Synthetic observation while exam operations are paused.");
  await editor.getByRole("button", { name: "Save record", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(sql(`select count(*) from encounter_logs where student_id='${student}'`), "1");
  await page.reload();
  await page.getByRole("button", { name: "Presentation scoring", exact: true }).click();
  editor = page.getByRole("dialog");
  await editor.getByLabel("Date", { exact: true }).fill(today);
  await editor.getByRole("combobox", { name: "Presentation type", exact: true }).selectOption("journal_club");
  await editor.getByLabel("Duration (minutes)", { exact: true }).fill("20");
  const scores = editor.locator('select[name]:not([name="presentationType"])');
  assert.equal(await scores.count(), 10);
  for (const select of await scores.all()) await select.selectOption("4");
  await editor.getByLabel("Comments", { exact: true }).fill("Synthetic presentation while exam operations are paused.");
  await editor.getByRole("button", { name: "Save record", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(sql(`select total_score from presentation_scores where student_id='${student}'`), "40");
  await page.reload();
  await page.screenshot({ path: `${artifacts}/teaching-open.png`, fullPage: true });
  const legacy = await admin.from("enrolments").update({ credits_awarded: 0 }).eq("id", enrolment);
  assert.match(legacy.error?.message ?? "", /temporarily paused/);
  const result = await admin.from("exam_results").insert({ student_id: student, offering_id: offering, component_type: "theory", source_system: "manual", source_attempt_id: fixture, score: 10, pass_mark: 50, passed: false, taken_on: today });
  assert.match(result.error?.message ?? "", /temporarily paused/);
  const decision = await admin.rpc("execute_assessment_command", { command: { type: "SetAssessmentOverride", enrolment_id: enrolment, kind: "credits", value: 0, reason: "Synthetic rejection" }, expected_revision: Number(sql(`select assessment_revision from enrolments where id='${enrolment}'`)) });
  assert.match(decision.error?.message ?? "", /temporarily paused/);
  assert.equal(sql(`select jsonb_build_object('status',status,'credits',credits_awarded,'mark',final_mark,'grade',grade,'plan',assessment_plan_id) from enrolments where id='${enrolment}'`), original);
  assert.equal(sql(`select count(*) from module_assessment_attempts where enrolment_id='${enrolment}'`), "0");
  assert.deepEqual(errors, []);
  writeFileSync(`${artifacts}/result.json`, JSON.stringify({ passed: true, syntheticOnly: true, observations: 1, presentationScore: 40, deniedLegacyExamWrite: true, deniedCreditEdit: true, deniedDecisionRpc: true, originalAcademicFieldsUnchanged: true, errors }, null, 2));
  console.log(`Teaching-only browser and real API checks passed: ${artifacts}`);
} catch (error) {
  writeFileSync(`${artifacts}/failure.json`, JSON.stringify({ message: error.message, errors }, null, 2));
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { process.kill(-server.pid, "SIGTERM"); await once(server, "exit"); }
  closeSync(descriptor);
  sql("update assessment_operational_controls set writes_paused=false where singleton");
  await admin.auth.signOut({ scope: "local" });
}
