import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { studentBrowser } from "./student-browser.mjs";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

if (!process.argv[2]) throw new Error("Pass the private synthetic review credentials JSON.");
validateLocalProjectConfig(readFileSync("dev/assessment/supabase/config.toml", "utf8"));
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", localContainer], { encoding: "utf8" }).trim(), "true");
const settings = validateLocalSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", "dev/assessment", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
const credentials = JSON.parse(readFileSync(process.argv[2], "utf8"));
const service = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const admin = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
assert.equal((await admin.auth.signInWithPassword({ email: credentials.adminEmail, password: credentials.password })).error, null);
const rollout = await admin.from("assessment_rollout").select("mode").single();
assert.equal(rollout.error, null);
assert.equal(rollout.data.mode, "shadow");
const studentId = randomUUID();
const moduleId = randomUUID();
const termId = randomUUID();
const offeringId = randomUUID();
const enrolmentId = randomUUID();
const identifier = `HIST-${studentId}`;
const title = `Historical continuity ${studentId.slice(0, 8)}`;
const artifacts = `.context/historical-assessment-review/${studentId}`;
mkdirSync(artifacts, { recursive: true });
async function insert(table, rows) { const result = await service.from(table).insert(rows); assert.equal(result.error, null, result.error?.message); }
await insert("terms", { id: termId, name: title, starts_on: "2025-01-01", ends_on: "2025-05-31", status: "closed" });
await insert("course_modules", { id: moduleId, code: identifier, title, mode: "online", credits: 10 });
await insert("module_offerings", { id: offeringId, module_id: moduleId, term_id: termId, price_pence: 0, capacity: 10 });
await insert("students", { id: studentId, temporary_id: identifier, first_name: "Historical", last_name: `Review ${studentId.slice(0, 8)}`, email: `${studentId}@example.test`, programme: "pgcert", status: "active" });
await insert("enrolments", { id: enrolmentId, student_id: studentId, offering_id: offeringId, status: "completed", credits_awarded: 10, final_mark: 73, grade: "Merit" });
const failureId = randomUUID();
await insert("exam_results", [
  { id: failureId, student_id: studentId, offering_id: offeringId, component_type: "theory", source_system: "manual", source_attempt_id: randomUUID(), score: 20, pass_mark: 50, passed: false, resit_required: true, taken_on: "2025-03-01" },
  { id: randomUUID(), student_id: studentId, offering_id: offeringId, component_type: "theory", source_system: "manual", source_attempt_id: randomUUID(), score: 75, pass_mark: 50, passed: true, resit_required: false, taken_on: "2025-06-01", attempt_number: 2, is_resit: true, resit_of_result_id: failureId },
  { id: randomUUID(), student_id: studentId, offering_id: offeringId, component_type: "practical", source_system: "manual", source_attempt_id: randomUUID(), score: 42, pass_mark: 50, passed: false, resit_required: true, taken_on: "2025-03-01" }
].map(result => ({ is_resit: false, attempt_number: 1, prior_attempt_missing: false, resit_of_result_id: null, ...result })));
const original = await service.from("exam_results").select("*").eq("student_id", studentId).order("id");
assert.equal(original.error, null);
execFileSync("docker", ["exec", "-i", localContainer, "psql", "-Xq", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
  input: `insert into assessment_historical_outcomes(enrolment_id,recorded_status,recorded_credits,recorded_final_mark,recorded_grade,capture_reference)
    select id,status::text,credits_awarded,final_mark,grade,'Synthetic browser fixture only' from enrolments where id='${enrolmentId}';`,
  encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]
});
const browser = await studentBrowser(process.argv[3]).launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const base = "http://127.0.0.1:3100";
try {
  const path = `/students/${studentId}?tab=modules`;
  await page.goto(`${base}/login?next=${encodeURIComponent(path)}`);
  await page.getByLabel("Email", { exact: true }).fill(credentials.adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${base}${path}`);
  await page.getByText("Historical · completed", { exact: true }).waitFor();
  const row = page.getByRole("row").filter({ hasText: title });
  assert.match(await row.innerText(), /75%/);
  assert.match(await row.innerText(), /42%/);
  await page.getByRole("button", { name: `View results for ${title}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await dialog.getByText("Historical record — preserved as recorded", { exact: true }).waitFor();
  assert.match(await dialog.innerText(), /Recorded credits: 10/);
  assert.match(await dialog.innerText(), /Final mark: 73 · Grade: Merit/);
  assert.match(await dialog.innerText(), /Recorded attempt 1 · 20%/);
  assert.match(await dialog.innerText(), /Recorded attempt 2 · 75%/);
  assert.match(await dialog.innerText(), /Practical · Recorded attempt 1 · 42%/);
  assert.equal(await dialog.getByRole("button", { name: /Correct result|Record resit/ }).count(), 0);
  await dialog.getByRole("button", { name: "Exceptional decision", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Exceptional decision", exact: true });
  await editor.getByRole("combobox", { name: "Outcome", exact: true }).selectOption("Fail");
  await editor.getByRole("textbox", { name: /reason/i }).fill("Synthetic reviewed historical amendment");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await dialog.getByText("Historical · Fail (amended)", { exact: true }).waitFor();
  const amendedExport = await page.request.get(`${base}/api/exports/assessments?report=outcomes`);
  assert.equal(amendedExport.status(), 200);
  const amendedRow = Papa.parse(await amendedExport.text(), { header: true }).data.find(record => record["Student ID"] === identifier);
  assert.equal(amendedRow["Effective Status"], "Fail");
  assert.equal(amendedRow["Original recorded status"], "completed");
  assert.equal(amendedRow.Credits, "10");
  await dialog.getByRole("button", { name: "Exceptional decision", exact: true }).click();
  await editor.getByRole("combobox", { name: "Action", exact: true }).selectOption("clear");
  assert.equal(await editor.getByRole("combobox", { name: "Action", exact: true }).locator("option:checked").textContent(), "Restore historical baseline");
  await editor.getByRole("textbox", { name: /reason/i }).fill("Synthetic restore original historical decision");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await dialog.getByText("Historical · completed", { exact: true }).waitFor();
  await dialog.getByText(/Decision history \(2\)/).click();
  await dialog.getByText("Synthetic reviewed historical amendment", { exact: true }).waitFor();
  await dialog.getByText("Synthetic restore original historical decision", { exact: true }).waitFor();
  await page.screenshot({ path: `${artifacts}/historical.png`, fullPage: true });
  for (const report of ["cccu", "attempts", "outcomes"]) {
    const response = await page.request.get(`${base}/api/exports/assessments?report=${report}`);
    assert.equal(response.status(), 200);
    const parsed = Papa.parse(await response.text(), { header: true }).data;
    const records = parsed.filter(record => report === "attempts" ? record.Enrolment === enrolmentId : record["Student ID"] === identifier);
    assert.equal(records.length, report === "outcomes" ? 1 : 3);
    assert(records.every(record => record["Record basis"].startsWith("Historical record")));
    if (report === "outcomes") { assert.equal(records[0].Credits, "10"); assert.equal(records[0]["Recorded Grade"], "Merit"); }
    else assert.deepEqual(records.map(record => Number(record.Score)).sort((first, second) => first - second), [20, 42, 75]);
  }
  const after = await service.from("exam_results").select("*").eq("student_id", studentId).order("id");
  assert.equal(after.error, null);
  assert.deepEqual(after.data, original.data);
  assert.deepEqual(errors, []);
  writeFileSync(`${artifacts}/result.json`, JSON.stringify({ passed: true, browser: process.argv[3] ?? "chromium", studentId, checks: ["recorded outcome and credits", "failed and resit history", "historical online Practical", "audited historical amendment and baseline restoration", "original scores remain read-only", "effective and original exported separately", "three labelled exports", "unchanged original records", "no browser errors"] }, null, 2));
  console.log(`Historical continuity browser checks passed. Evidence: ${artifacts}`);
} catch (error) {
  await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true });
  writeFileSync(`${artifacts}/failure.txt`, `${String(error)}\n${errors.join("\n")}\n${await page.locator("body").innerText()}`);
  throw error;
} finally { await browser.close(); }
