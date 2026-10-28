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
assert.equal(await fetch(`${base}/login`).then(() => true, () => false), false, "Port 3102 is occupied; refusing to replace an app");
const fixtureId = randomUUID();
const artifacts = `.context/current-activation-review/${fixtureId}`;
mkdirSync(artifacts, { recursive: true });
function sql(query) {
  return execFileSync("docker", ["exec", "-i", liveContainer, "psql", "-XqAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function evidenceSnapshot(database = "postgres") {
  return execFileSync("docker", ["exec", "-i", liveContainer, "sh", "-c", 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql "$@"', "sh", "-wXqAt", "-U", database === "postgres" ? "postgres" : "supabase_admin", "-d", database, "-v", "ON_ERROR_STOP=1"], {
    input: `select md5(jsonb_build_object(
      'activation',(select to_jsonb(record) from assessment_current_activations record where enrolment_id='${enrolmentId}'),
      'baseline',(select to_jsonb(record) from assessment_historical_outcomes record where enrolment_id='${enrolmentId}'),
      'enrolment',(select to_jsonb(record) from enrolments record where id='${enrolmentId}'),
      'history',(select jsonb_agg(to_jsonb(record) order by revision) from enrolment_assessment_history record where enrolment_id='${enrolmentId}'),
      'attempts',(select jsonb_agg(to_jsonb(record) order by id) from module_assessment_attempts record where enrolment_id='${enrolmentId}'),
      'revisions',(select jsonb_agg(to_jsonb(record) order by id) from module_assessment_attempt_revisions record where attempt_id in (select id from module_assessment_attempts where enrolment_id='${enrolmentId}')),
      'items',(select jsonb_agg(to_jsonb(record) order by id) from module_assessment_items record where revision_id in (select id from module_assessment_attempt_revisions where attempt_id in (select id from module_assessment_attempts where enrolment_id='${enrolmentId}'))),
      'decisions',(select jsonb_agg(to_jsonb(record) order by id) from enrolment_assessment_overrides record where enrolment_id='${enrolmentId}'),
      'audit',(select jsonb_agg(to_jsonb(record) order by id) from audit_events record where entity_id='${enrolmentId}')
    )::text);`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]
  }).trim();
}
assert.equal(sql("select to_regprocedure('public.activate_current_assessments(uuid[],jsonb,text,boolean)') is not null"), "t", "Migrate the isolated stack first");
const service = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const admin = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
const teacher = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
const password = randomBytes(24).toString("base64url");
const adminEmail = `activation-admin-${fixtureId}@example.test`;
const teacherEmail = `activation-teacher-${fixtureId}@example.test`;
for (const [email, role, client] of [[adminEmail, "admin", admin], [teacherEmail, "teacher", teacher]]) {
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(created.error, null);
  assert.equal((await service.from("staff_profiles").upsert({ id: created.data.user.id, full_name: `Synthetic activation ${role}`, role, active: true })).error, null);
  assert.equal((await client.auth.signInWithPassword({ email, password })).error, null);
}
async function insert(table, row) { const result = await service.from(table).insert(row); assert.equal(result.error, null, result.error?.message); }
async function rpc(name, input) { const result = await admin.rpc(name, input); assert.equal(result.error, null, result.error?.message); return result.data; }
const studentId = randomUUID();
const existingTerm = sql("select id from terms where status='active'");
const termId = existingTerm || randomUUID();
const moduleId = randomUUID();
const offeringId = randomUUID();
const enrolmentId = randomUUID();
const today = sql("select current_date::text");
const start = sql("select (current_date-30)::text");
const end = sql("select (current_date+30)::text");
await insert("students", { id: studentId, temporary_id: `ACT-${fixtureId}`, first_name: "Synthetic", last_name: "Activation review", email: `${fixtureId}@example.test`, programme: "pgcert", status: "active" });
if (existingTerm) assert.equal(sql(`select current_date between starts_on and ends_on from terms where id='${termId}'`), "t", "Existing synthetic active term is not current; leave it unchanged and review the local fixture");
else await insert("terms", { id: termId, name: `Activation ${fixtureId}`, starts_on: start, ends_on: end, status: "active" });
await insert("course_modules", { id: moduleId, code: `ACT-${fixtureId}`, title: "Synthetic activated module", mode: "online", credits: 10 });
await rpc("save_module_assessment_plan", { input: { module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, reason: "Synthetic activation plan" }, expected_plan_id: null });
await insert("module_offerings", { id: offeringId, module_id: moduleId, term_id: termId, price_pence: 0, capacity: 10 });
await insert("enrolments", { id: enrolmentId, student_id: studentId, offering_id: offeringId, credits_awarded: 10 });
sql(`begin; update enrolments set assessment_plan_id=null where id='${enrolmentId}';
  insert into assessment_historical_outcomes(enrolment_id,recorded_status,recorded_credits,capture_reference)
    values('${enrolmentId}','planned',10,'Synthetic activation rehearsal only'); commit;`);
const original = sql(`select jsonb_build_object('student',student_id,'offering',offering_id,'status',status,'credits',credits_awarded,'mark',final_mark,'grade',grade) from enrolments where id='${enrolmentId}'`);
const baseline = sql(`select to_jsonb(record) from assessment_historical_outcomes record where enrolment_id='${enrolmentId}'`);
const scope = { enrolment_keys: [enrolmentId] };
const reviewed = await rpc("preview_current_assessment_activation", scope);
assert.equal(reviewed.enrolments[0].after.effective_status, "In progress");
assert.equal(reviewed.enrolments[0].after.awarded_credits, 10);
assert.match((await teacher.rpc("preview_current_assessment_activation", scope)).error?.message ?? "", /administrator/i);
assert.match((await teacher.rpc("activate_current_assessments", { ...scope, reviewed_preview: reviewed, change_reason: "Must reject teaching role", confirmed: true })).error?.message ?? "", /administrator/i);
const concurrent = await Promise.all([0, 1].map(() => admin.rpc("activate_current_assessments", { ...scope, reviewed_preview: reviewed, change_reason: "Synthetic concurrent activation", confirmed: true })));
assert.equal(concurrent.filter(result => !result.error).length, 1);
assert.match(concurrent.find(result => result.error).error.message, /already activated|changed/);
assert.equal(sql(`select count(*) from assessment_current_activations where enrolment_id='${enrolmentId}'`), "1");
const evaluate = () => rpc("read_enrolment_assessment", { enrolment_key: enrolmentId });
assert.equal((await evaluate()).historical, undefined);

const descriptor = openSync(`${artifacts}/app.log`, "a", 0o600);
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3102"], {
  env: { ...liveAppEnvironment(settings, "shadow", true, process.env), STAFF_COMPANION_ENABLED: "true", STAFF_COMPANION_TEACHING_ENABLED: "true" },
  detached: true, stdio: ["ignore", descriptor, descriptor]
});
let browser;
const errors = [];
try {
  let ready = false;
  for (let retry = 0; retry < 90; retry++) {
    if (server.exitCode !== null) throw new Error("Synthetic app exited; inspect its local log");
    ready = await fetch(`${base}/login`).then(response => response.ok, () => false);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(ready, true);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  async function login(target, email) {
    await target.goto(`${base}/login?next=${encodeURIComponent(`/students/${studentId}?tab=modules`)}`);
    await target.getByLabel("Email", { exact: true }).fill(email);
    await target.getByLabel("Password", { exact: true }).fill(password);
    await target.getByRole("button", { name: "Sign in", exact: true }).click();
    await target.waitForURL(url => url.pathname === `/students/${studentId}`);
  }
  async function open() {
    await page.goto(`${base}/students/${studentId}?tab=modules`);
    await page.getByRole("button", { name: "View results for Synthetic activated module", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Synthetic activated module", exact: true });
    await details.getByText("Current assessment workflow activated", { exact: true }).waitFor();
    return details;
  }
  async function save(editor) {
    await editor.getByLabel("Reason", { exact: true }).fill("Synthetic activation browser proof");
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await editor.waitFor({ state: "detached" });
  }
  async function score(value) {
    const details = await open();
    await details.getByRole("button", { name: /^Record (result|resit)$/ }).click();
    const editor = page.getByRole("dialog", { name: /^Record (result|resit)$/ });
    await editor.getByLabel("MCQ score (%)", { exact: true }).fill(String(value));
    await editor.getByLabel("Sitting date", { exact: true }).fill(today);
    await save(editor);
  }
  await login(page, adminEmail);
  await score(30);
  assert.equal((await evaluate()).effective_status, "Fail");
  assert.equal((await evaluate()).awarded_credits, 10);
  let details = await open();
  await details.getByRole("button", { name: "Arrange resit", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "Arrange resit", exact: true });
  await editor.getByLabel("When is the resit arranged?", { exact: true }).fill("Next teaching term, synthetic sitting");
  await save(editor);
  assert.ok((await evaluate()).effective_indicators.includes("theory:Resit scheduled"));
  await score(75);
  assert.equal((await evaluate()).effective_status, "Pass");
  details = await open();
  await details.getByRole("button", { name: "Result history (2 new-workflow attempts)", exact: true }).click();
  assert.match(await details.innerText(), /30%/);
  assert.match(await details.innerText(), /75%/);
  await page.screenshot({ path: `${artifacts}/retained-attempts.png`, fullPage: true });
  const correction = details.getByRole("button", { name: "Correct result", exact: true }).last();
  await correction.click();
  editor = page.getByRole("dialog", { name: "Correct result", exact: true });
  await editor.getByLabel("MCQ score (%)", { exact: true }).fill("20");
  await save(editor);
  assert.equal((await evaluate()).effective_status, "Fail");
  assert.equal((await evaluate()).awarded_credits, 10);
  for (const clear of [false, true]) {
    details = await open();
    await details.getByRole("button", { name: "Exceptional decision", exact: true }).click();
    editor = page.getByRole("dialog", { name: "Exceptional decision", exact: true });
    await editor.getByRole("combobox", { name: "Decision", exact: true }).selectOption("credits");
    if (clear) {
      await editor.getByRole("option", { name: "Restore preserved credit award", exact: true }).waitFor({ state: "attached" });
      await editor.getByRole("combobox", { name: "Action", exact: true }).selectOption("clear");
    } else await editor.getByLabel("Awarded credits", { exact: true }).fill("0");
    await save(editor);
    assert.equal((await evaluate()).awarded_credits, clear ? 10 : 0);
  }
  details = await open();
  await details.getByText("Decision history (2)", { exact: true }).click();
  assert.match(await details.innerText(), /Restored preserved credit award/);
  const exported = await page.request.get(`${base}/api/exports/assessments?report=outcomes`);
  assert.equal(exported.status(), 200);
  assert.match(await exported.text(), /Activated current enrolment — original preserved/);
  const teacherPage = await browser.newPage();
  await login(teacherPage, teacherEmail);
  await teacherPage.getByRole("button", { name: "View results for Synthetic activated module", exact: true }).click();
  assert.equal(await teacherPage.getByRole("button", { name: "Exceptional decision", exact: true }).count(), 0);
  assert.equal(await teacherPage.getByRole("button", { name: "Record resit", exact: true }).count(), 0);
  assert.doesNotMatch(await teacherPage.locator("body").innerText(), /Synthetic concurrent activation|Synthetic activation browser proof/);
  assert.equal(sql(`select jsonb_build_object('student',student_id,'offering',offering_id,'status',status,'credits',credits_awarded,'mark',final_mark,'grade',grade) from enrolments where id='${enrolmentId}'`), original);
  assert.equal(sql(`select to_jsonb(record) from assessment_historical_outcomes record where enrolment_id='${enrolmentId}'`), baseline);
  assert.deepEqual(errors, []);
  const beforeRecovery = evidenceSnapshot();
  const backup = execFileSync("docker", ["exec", liveContainer, "pg_dump", "-U", "postgres", "-d", "postgres", "--no-owner", "--no-privileges"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  writeFileSync(`${artifacts}/synthetic-backup.sql`, backup, { mode: 0o600 });
  const restoredDatabase = `activation_restore_${fixtureId.replaceAll("-", "")}`;
  execFileSync("docker", ["exec", liveContainer, "createdb", "-U", "postgres", restoredDatabase], { stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("docker", ["exec", "-i", liveContainer, "sh", "-c", 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql "$@"', "sh", "-wXq", "-U", "supabase_admin", "-d", restoredDatabase, "-v", "ON_ERROR_STOP=1"], { input: backup, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  assert.equal(evidenceSnapshot(restoredDatabase), beforeRecovery, "Recovery changed activation, original evidence, attempts, decisions or audit");
  writeFileSync(`${artifacts}/result.json`, JSON.stringify({ synthetic: true, productionAccess: false, fixtureId, enrolmentId, concurrency: "one accepted, one rejected", browser: "Fail / scheduled resit / Pass / correction / credit override and restore / history / teacher read-only", originalFields: "unchanged", historicalBaseline: "unchanged", recovery: "activation, baseline, attempts, revisions, items, decisions and audit identical", restoredDatabase }, null, 2));
  process.stdout.write(`Synthetic current activation rehearsal passed: ${artifacts}\n`);
} finally {
  await browser?.close();
  if (server.exitCode === null) { const stopped = once(server, "exit"); process.kill(-server.pid, "SIGTERM"); await stopped; }
  closeSync(descriptor);
  await admin.auth.signOut();
  await teacher.auth.signOut();
}
