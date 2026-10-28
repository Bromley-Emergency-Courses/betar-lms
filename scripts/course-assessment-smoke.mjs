import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { studentBrowser } from "./student-browser.mjs";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

if (!process.argv[2]) throw new Error("Pass the private synthetic administrator/teacher credentials JSON.");
validateLocalProjectConfig(readFileSync("dev/assessment/supabase/config.toml", "utf8"));
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", localContainer], { encoding: "utf8" }).trim(), "true");
const settings = validateLocalSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", "dev/assessment", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
const credentials = JSON.parse(readFileSync(process.argv[2], "utf8"));
const service = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const admin = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
assert.equal((await admin.auth.signInWithPassword({ email: credentials.adminEmail, password: credentials.password })).error, null);
const fixtureId = randomUUID();
const moduleId = randomUUID();
const termId = randomUUID();
const sittingTermId = randomUUID();
const offeringId = randomUUID();
const students = [randomUUID(), randomUUID(), randomUUID()];
const enrolments = [randomUUID(), randomUUID(), randomUUID()];
const code = `PLAN-${fixtureId.slice(0, 8)}`;
const artifacts = `.context/course-assessment-review/${fixtureId}`;
mkdirSync(artifacts, { recursive: true });
async function insert(table, rows) { const result = await service.from(table).insert(rows); assert.equal(result.error, null); }
async function rpc(name, input) { const result = await admin.rpc(name, input); assert.equal(result.error, null, result.error?.message); return result.data; }
const evaluate = enrolment => rpc("read_enrolment_assessment", { enrolment_key: enrolment });
async function command(enrolment, input) { return rpc("execute_assessment_command", { command: { enrolment_id: enrolment, reason: "Synthetic Course acceptance", ...input }, expected_revision: (await evaluate(enrolment)).revision }); }
await insert("terms", [{ id: termId, name: `Course teaching ${fixtureId}`, starts_on: "2025-01-01", ends_on: "2025-05-31" }, { id: sittingTermId, name: `Course sitting ${fixtureId}`, starts_on: "2025-09-01", ends_on: "2025-12-31" }]);
await insert("course_modules", { id: moduleId, code, title: `Course plan review ${fixtureId}`, mode: "online", credits: 10 });
const planId = await rpc("save_module_assessment_plan", { input: { module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, reason: "Synthetic initial plan" }, expected_plan_id: null });
await insert("module_offerings", { id: offeringId, module_id: moduleId, term_id: termId, price_pence: 0, capacity: 10 });
await insert("students", students.map((id, index) => ({ id, temporary_id: `PLAN-${id}`, first_name: "Course", last_name: `Review ${index} ${fixtureId.slice(0, 8)}`, email: `${id}@example.test`, programme: "pgcert", status: "active" })));
await insert("enrolments", enrolments.slice(0, 2).map((id, index) => ({ id, student_id: students[index], offering_id: offeringId })));
await command(enrolments[0], { type: "AddManualAttempt", component: "theory", items: [{ kind: "mcq", score: 40 }], sitting_date: "2025-05-20", sitting_term_id: termId });
const browserType = studentBrowser(process.argv[3]);
const browser = await browserType.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(20000);
const errors = [];
const checks = [];
page.on("pageerror", error => errors.push(error.message));
const base = "http://127.0.0.1:3100";
const path = `/course/assessment-plans/${moduleId}?term=${termId}&enrolment=${enrolments[0]}`;
async function login(target, email, next) {
  await target.goto(`${base}/login?next=${encodeURIComponent(next)}`);
  await target.getByLabel("Email", { exact: true }).fill(email);
  await target.getByLabel("Password", { exact: true }).fill(credentials.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click();
  await target.waitForURL(`${base}${next}`);
}
async function preview(plan) {
  await page.getByLabel("Reviewed plan version", { exact: true }).selectOption(plan);
  const response = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/course/assessment-plans/${moduleId}`);
  await page.getByRole("button", { name: "Preview plan impact", exact: true }).click();
  assert.equal(await (await response).finished(), null);
  await page.getByRole("region", { name: "Plan impact preview" }).waitFor();
}
try {
  await login(page, credentials.adminEmail, "/course?mode=edit");
  assert.equal(await page.locator(`#module-title-${moduleId}`).isVisible(), true);
  assert.equal(await page.locator(`#term-name-${termId}`).isVisible(), true);
  assert.equal(await page.locator('[name="offeringTerm"]').count(), 0);
  const offeringGroup = page.locator(".term-groups > details").filter({ has: page.locator("summary strong", { hasText: `Course teaching ${fixtureId}` }) });
  await offeringGroup.locator(":scope > summary").click();
  await offeringGroup.locator(`#offering-capacity-${offeringId}`).fill("12");
  await offeringGroup.locator(":scope > summary").click();
  await offeringGroup.locator(":scope > summary").click();
  assert.equal(await offeringGroup.locator(`#offering-capacity-${offeringId}`).inputValue(), "12");
  const panel = page.locator(`#assessment-plan-${moduleId}`);
  assert.equal(await panel.getByLabel("Theory pass mark", { exact: true }).count(), 0);
  await panel.locator(":scope > summary").click();
  assert.equal(await panel.getByRole("link", { name: "Review rules for existing enrolments" }).isVisible(), false);
  await panel.getByText("Advanced: existing enrolments", { exact: true }).click();
  assert.equal(await panel.getByRole("link", { name: "Review rules for existing enrolments" }).isVisible(), true);
  await panel.getByText("Advanced: existing enrolments", { exact: true }).click();
  await panel.getByLabel("Theory pass mark", { exact: true }).fill("60");
  await panel.locator(":scope > summary").click(); await panel.locator(":scope > summary").click();
  assert.equal(await panel.getByLabel("Theory pass mark", { exact: true }).inputValue(), "60");
  await panel.getByLabel("Review reason", { exact: true }).fill("Synthetic future threshold review");
  await panel.getByRole("button", { name: "Save reviewed plan version", exact: true }).click();
  await panel.locator(":scope > summary").filter({ hasText: "Plan v2" }).waitFor();
  const versions = await admin.from("module_assessment_plans").select("*").eq("module_id", moduleId).order("version");
  assert.equal(versions.error, null); assert.equal(versions.data.length, 2);
  const secondPlan = versions.data[1].id;
  assert.equal((await evaluate(enrolments[0])).plan.id, planId);
  assert.equal((await evaluate(enrolments[1])).plan.id, planId);
  await insert("enrolments", { id: enrolments[2], student_id: students[2], offering_id: offeringId });
  assert.equal((await evaluate(enrolments[2])).plan.id, secondPlan);
  checks.push("Course creates immutable reviewed v2; existing enrolments retain v1 and a new enrolment inherits v2");

  await page.goto(`${base}${path}`);
  await preview(secondPlan);
  await page.getByRole("region", { name: "Plan impact preview" }).getByText(/recorded pass marks do not change/).waitFor();
  await page.getByLabel("Reviewed plan version", { exact: true }).selectOption("");
  assert.equal(await page.getByRole("button", { name: "Apply reviewed plan change", exact: true }).count(), 0);
  await preview(secondPlan);
  await command(enrolments[0], { type: "SetAssessmentOverride", kind: "credits", value: 2 });
  await page.getByLabel("Reason", { exact: true }).fill("Synthetic stale preview must not save");
  await page.getByRole("button", { name: "Apply reviewed plan change", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: /Reload before saving/ }).waitFor();
  assert.equal(await page.getByLabel("Reason", { exact: true }).inputValue(), "Synthetic stale preview must not save");
  assert.equal((await evaluate(enrolments[0])).plan.id, planId);
  checks.push("Changing selection hides the preview; an intervening edit rejects a stale Course migration without overwriting");

  await page.reload(); await preview(secondPlan);
  await page.getByLabel("Reason", { exact: true }).fill("Synthetic reviewed threshold adoption");
  await page.getByRole("button", { name: "Apply reviewed plan change", exact: true }).click();
  await page.getByRole("region", { name: "Selected enrolment" }).getByText("Current plan: v2.", { exact: true }).waitFor();
  const adopted = await evaluate(enrolments[0]);
  assert.equal(adopted.components.theory.pass_mark, 50); assert.equal(adopted.components.theory.score, 40); assert.equal(adopted.awarded_credits, 2);
  assert.equal((await evaluate(enrolments[1])).plan.id, planId);
  const audit = await admin.from("audit_events").select("reason").eq("entity_id", enrolments[0]).eq("action", "assessment.ChangeEnrolmentAssessmentPlan");
  assert.equal(audit.data.length, 1); assert.equal(audit.data[0].reason, "Synthetic reviewed threshold adoption");
  checks.push("Reviewed adoption affects one enrolment only; recorded score/threshold and exceptional credits survive with exactly one audit");

  const incompatible = await rpc("save_module_assessment_plan", { input: { module_id: moduleId, theory_scheme: "coursework_viva", requires_viva: true, theory_pass_mark: 60, reason: "Synthetic incompatible plan preview" }, expected_plan_id: secondPlan });
  await page.reload(); await preview(incompatible);
  await page.getByRole("alert").filter({ hasText: "Cannot apply" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Apply reviewed plan change", exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: `${artifacts}/course-plan-review.png`, fullPage: true });
  checks.push("Incompatible accepted evidence blocks migration with a readable explanation; Course review fits mobile");

  await command(enrolments[0], { type: "ClearAssessmentOverride", kind: "credits" });
  await command(enrolments[0], { type: "AddManualAttempt", component: "theory", items: [{ kind: "mcq", score: 70 }], sitting_date: "2025-10-20", sitting_term_id: sittingTermId });
  const current = await evaluate(enrolments[0]);
  assert.equal(current.components.theory.pass_mark, 60); assert.equal(current.components.theory.attempt_count, 2); assert.equal(current.awarded_credits, 10);
  const reports = {};
  for (const report of ["outcomes", "attempts", "cccu", "reconciliation"]) {
    const response = await page.request.get(`${base}/api/exports/assessments?report=${report}`);
    assert.equal(response.status(), 200); assert.match(response.headers()["content-type"], /text\/csv/);
    const csv = await response.text(); writeFileSync(`${artifacts}/${report}.csv`, csv);
    reports[report] = Papa.parse(csv, { header: true, skipEmptyLines: true }).data;
  }
  const outcome = reports.outcomes.find(row => row["Student ID"] === `PLAN-${students[0]}`);
  assert.equal(outcome["Effective Status"], "Pass"); assert.equal(outcome.Credits, "10"); assert.equal(outcome["Original Cohort"], `Course teaching ${fixtureId}`);
  const attempts = reports.attempts.filter(row => row.Enrolment === enrolments[0]);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts.map(row => [row.Score, row["Pass Mark"]]).sort(), [["40", "50"], ["70", "60"]]);
  const official = reports.cccu.filter(row => row["Student ID"] === `PLAN-${students[0]}`);
  assert.equal(official.length, 2); assert.ok(official.every(row => row["Resit Required"] === "No"));
  assert.equal(official.find(row => row.Score === "70").Term, `Course sitting ${fixtureId}`);
  assert.ok(official.every(row => row["Original Cohort"] === `Course teaching ${fixtureId}`));
  checks.push("Real CSV routes retain the original failure and new threshold, distinguish teaching/sitting terms and resolve current resit risk");

  await page.goto(`${base}/students/${students[0]}?tab=modules`);
  assert.equal(await page.getByText("Change inherited assessment plan", { exact: true }).count(), 0);
  assert.equal(await page.locator('[name="theory_scheme"], [name="theory_pass_mark"], [name="plan_id"]').count(), 0);
  const teacherContext = await browser.newContext();
  const teacherPage = await teacherContext.newPage();
  await login(teacherPage, credentials.teacherEmail, `/students/${students[0]}`);
  await teacherPage.goto(`${base}${path}`);
  assert.equal(await teacherPage.getByLabel("Reviewed plan version", { exact: true }).count(), 0);
  await teacherContext.close();
  checks.push("Student profile contains no plan settings and teacher cannot open Course migration controls");
  assert.deepEqual(errors, []);
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ checks, errors, moduleId, students, enrolments, browser: browserType.name(), browserVersion: browser.version(), synthetic: true }, null, 2));
  writeFileSync(".context/course-assessment-review/latest.json", JSON.stringify({ artifacts, url: `${base}${path}`, checks: checks.length }, null, 2));
  console.log(JSON.stringify({ artifacts, checks: checks.length }, null, 2));
} catch (error) { writeFileSync(`${artifacts}/failure.json`, JSON.stringify({ errors, checks, url: page.url(), summaries: await page.locator("summary").allTextContents(), body: (await page.locator("body").innerText()).slice(0, 2000) }, null, 2)); await page.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {}); console.error(`Fixture retained: ${artifacts}`); throw error; }
finally { await browser.close(); await admin.auth.signOut({ scope: "local" }); }
