import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

process.umask(0o077);
assert(process.argv[2], "Pass the private synthetic login JSON");
validateLocalProjectConfig(readFileSync("dev/assessment/supabase/config.toml", "utf8"));
const settings = validateLocalSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", "dev/assessment", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
const credentials = JSON.parse(readFileSync(process.argv[2], "utf8"));
const admin = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
const service = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
assert.equal((await admin.auth.signInWithPassword({ email: credentials.adminEmail, password: credentials.password })).error, null);
assert.equal((await admin.from("assessment_rollout").select("mode").single()).data?.mode, "shadow");
const studentId = randomUUID();
const termId = randomUUID();
const artifacts = `.context/historical-score-edits/${studentId}`;
mkdirSync(artifacts, { recursive: true });
const base = "http://127.0.0.1:3100";
async function insert(table, row) { const result = await service.from(table).insert(row); assert.equal(result.error, null, result.error?.message); }
await insert("students", { id: studentId, temporary_id: `HIST-EDIT-${studentId}`, first_name: "Synthetic", last_name: "Historical edits", email: `${studentId}@example.test`, programme: "pgcert", status: "completed" });
await insert("terms", { id: termId, name: `Historical edit test ${studentId.slice(0, 8)}`, starts_on: "2024-01-01", ends_on: "2024-05-31", status: "closed" });
const modules = [];
for (const mode of ["practical", "online"]) {
  const courseModule = { id: randomUUID(), offering: randomUUID(), enrolment: randomUUID(), title: `Synthetic historical ${mode} ${studentId.slice(0, 8)}`, mode };
  await insert("course_modules", { id: courseModule.id, code: `HIST-${courseModule.id}`, title: courseModule.title, mode, credits: 10 });
  const plan = await admin.rpc("save_module_assessment_plan", { input: { module_id: courseModule.id, theory_scheme: "mcq", theory_pass_mark: 50, practical_pass_mark: mode === "practical" ? 50 : null, physics_weighting: mode === "practical", reason: "Synthetic historical editor browser fixture" }, expected_plan_id: null });
  assert.equal(plan.error, null, plan.error?.message);
  await insert("module_offerings", { id: courseModule.offering, module_id: courseModule.id, term_id: termId, price_pence: 0, capacity: 10, attendance_days_required_first_practical: 2, attendance_days_required_subsequent_practical: 2, presentation_required: true });
  await insert("enrolments", { id: courseModule.enrolment, student_id: studentId, offering_id: courseModule.offering, status: mode === "practical" ? "completed" : "failed", credits_awarded: mode === "practical" ? 10 : 0 });
  if (mode === "practical") for (const component of ["theory", "practical"]) await insert("exam_results", { id: randomUUID(), student_id: studentId, offering_id: courseModule.offering, component_type: component, source_system: "manual", source_attempt_id: randomUUID(), score: 70, pass_mark: 50, passed: true, resit_required: false, taken_on: "2024-05-01" });
  modules.push(courseModule);
}
const sql = query => execFileSync("docker", ["exec", "-i", localContainer, "psql", "-XqAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
sql(`INSERT INTO assessment_historical_outcomes(enrolment_id,recorded_status,recorded_credits) SELECT id,status::text,credits_awarded FROM enrolments WHERE id IN (${modules.map(module => `'${module.enrolment}'`).join(",")});`);
const original = sql(`SELECT jsonb_agg(to_jsonb(result) ORDER BY id) FROM exam_results result WHERE student_id='${studentId}';`);
writeFileSync(`${artifacts}/fixture.json`, JSON.stringify({ synthetic: true, studentId, modules, url: `${base}/students/${studentId}?tab=modules` }, null, 2));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
page.setDefaultTimeout(30000);
async function evaluate(module) { const result = await admin.rpc("read_enrolment_assessment", { enrolment_key: module.enrolment }); assert.equal(result.error, null); return result.data; }
async function open(module) {
  await page.goto(`${base}/students/${studentId}?tab=modules`);
  await page.getByRole("button", { name: `View results for ${module.title}`, exact: true }).click();
  return page.getByRole("dialog", { name: module.title, exact: true });
}
async function save(editor) {
  await editor.getByLabel("Reason / evidence reference", { exact: true }).fill("Synthetic browser test: documented historical score amendment");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editor.waitFor({ state: "detached" });
}
try {
  const path = `/students/${studentId}?tab=modules`;
  await page.goto(`${base}/login?next=${encodeURIComponent(path)}`);
  await page.getByLabel("Email", { exact: true }).fill(credentials.adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${base}${path}`);
  const practical = modules[0];
  let details = await open(practical);
  await details.getByRole("listitem").filter({ has: page.locator("strong").filter({ hasText: /^Theory · Recorded attempt/ }) }).getByRole("button", { name: "Correct this result" }).click();
  let editor = page.getByRole("dialog", { name: "Correct historical result", exact: true });
  await editor.getByLabel("Component score (%)", { exact: true }).fill("30");
  await save(editor);
  assert.equal((await evaluate(practical)).effective_status, "Fail");
  assert.equal((await evaluate(practical)).awarded_credits, 10);
  details = await open(practical);
  await details.getByRole("button", { name: "Record Theory resit", exact: true }).click();
  editor = page.getByRole("dialog", { name: "Record historical enrolment resit", exact: true });
  await editor.getByLabel("Sitting date", { exact: true }).fill("2024-06-01");
  await editor.getByLabel("MCQ score (%)", { exact: true }).fill("80");
  await editor.getByLabel("Physics / equipment score (%)", { exact: true }).fill("60");
  await save(editor);
  const passed = await evaluate(practical);
  assert.equal(passed.effective_status, "Pass"); assert.equal(passed.awarded_credits, 10);
  assert.equal(passed.components.theory.score, 70); assert.equal(passed.components.theory.attempt_count, 2);
  assert.deepEqual(passed.effective_indicators, []);
  details = await open(practical);
  assert.match(await details.innerText(), /30%.*Failed/);
  assert.match(await details.innerText(), /70%.*Passed/);
  await details.getByText("Score amendment history (1)", { exact: true }).first().click();
  await details.screenshot({ path: `${artifacts}/retained-history.png` });
  const online = modules[1];
  details = await open(online);
  await details.getByRole("button", { name: "Add missing Theory result", exact: true }).click();
  editor = page.getByRole("dialog", { name: "Add missing historical result", exact: true });
  await editor.getByLabel("Sitting date", { exact: true }).fill("2024-05-01");
  await editor.getByLabel("Component score (%)", { exact: true }).fill("75");
  await save(editor);
  assert.equal((await evaluate(online)).effective_status, "Pass");
  assert.equal((await evaluate(online)).awarded_credits, 10);
  assert.equal(sql(`SELECT jsonb_agg(to_jsonb(result) ORDER BY id) FROM exam_results result WHERE student_id='${studentId}';`), original);
  assert.deepEqual(errors, []);
  const result = { passed: true, synthetic: true, productionAccess: false, originalScoresUnchanged: true, correctedScore: true, retainedFailedAttempt: true, weightedResit: true, missingResult: true, historicalTeachingIgnored: true, existingCreditsRetained: true, artifacts };
  writeFileSync(`${artifacts}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); await admin.auth.signOut({ scope: "local" }); }
