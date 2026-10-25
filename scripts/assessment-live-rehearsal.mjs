import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { chromium } from "playwright";
import { liveAppEnvironment, liveContainer, liveWorkdir, validateLiveProject, validateLiveSettings } from "./assessment-live-config.mjs";

validateLiveProject(readFileSync(`${liveWorkdir}/supabase/config.toml`, "utf8"));
assert.equal(realpathSync(`${liveWorkdir}/supabase/migrations`), realpathSync("supabase/migrations"));
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", liveContainer], { encoding: "utf8" }).trim(), "true");
const settings = validateLiveSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", liveWorkdir, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
const base = "http://127.0.0.1:3102";
const existing = await fetch(`${base}/login`).then(() => true, () => false);
assert.equal(existing, false, "Port 3102 is already occupied; refusing to replace another app");
const fixtureId = randomUUID(); const artifacts = `.context/assessment-live-review/${fixtureId}`; mkdirSync(artifacts, { recursive: true });
const service = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const adminEmail = `live-${fixtureId}@example.test`; const password = randomBytes(24).toString("base64url");
const user = await service.auth.admin.createUser({ email: adminEmail, password, email_confirm: true }); assert.equal(user.error, null);
assert.equal((await service.from("staff_profiles").upsert({ id: user.data.user.id, full_name: "Synthetic Live Rehearsal Admin", role: "admin", active: true })).error, null);
const admin = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
assert.equal((await admin.auth.signInWithPassword({ email: adminEmail, password })).error, null);
writeFileSync(`${artifacts}/login.json`, JSON.stringify({ adminEmail, password }), { mode: 0o600 });
const studentId = randomUUID(); const termId = randomUUID(); const sittingTermId = randomUUID(); const moduleId = randomUUID(); const offeringId = randomUUID(); const enrolmentId = randomUUID(); const legacyId = randomUUID();
async function insert(table, row) { const result = await service.from(table).insert(row); assert.equal(result.error, null, result.error?.message); }
async function rpc(name, input) { const result = await admin.rpc(name, input); assert.equal(result.error, null, result.error?.message); return result.data; }
const evaluate = () => rpc("read_enrolment_assessment", { enrolment_key: enrolmentId });
async function command(input) { return rpc("execute_assessment_command", { command: { enrolment_id: enrolmentId, reason: "Synthetic live rehearsal", ...input }, expected_revision: (await evaluate()).revision }); }
await rpc("set_assessment_rollout", { requested_mode: "shadow", evidence: {}, change_reason: "Start a new synthetic-only rehearsal" });
await insert("students", { id: studentId, temporary_id: `LIVE-${fixtureId}`, first_name: "Live", last_name: `Rehearsal ${fixtureId.slice(0, 8)}`, email: `${studentId}@example.test`, programme: "pgcert", status: "active" });
await insert("terms", [{ id: termId, name: `Live teaching ${fixtureId}`, starts_on: "2025-01-01", ends_on: "2025-05-31" }, { id: sittingTermId, name: `Live sitting ${fixtureId}`, starts_on: "2025-09-01", ends_on: "2025-12-31" }]);
await insert("course_modules", { id: moduleId, code: `LIVE-${fixtureId}`, title: "Synthetic live module", mode: "online", credits: 10 });
await rpc("save_module_assessment_plan", { input: { module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, reason: "Synthetic reviewed module" }, expected_plan_id: null });
await insert("module_offerings", { id: offeringId, module_id: moduleId, term_id: termId, price_pence: 10000, capacity: 10 });
await insert("enrolments", { id: enrolmentId, student_id: studentId, offering_id: offeringId, status: "failed" });
await insert("exam_results", { id: legacyId, student_id: studentId, offering_id: offeringId, component_type: "theory", source_system: "theory_portal", source_attempt_id: `live-${fixtureId}`, score: 30, pass_mark: 50, passed: false, resit_required: true, taken_on: "2025-05-20", attempt_number: 1, is_resit: false, prior_attempt_missing: false });
const candidate = await admin.from("assessment_backfill_candidates").select("legacy_result_id,legacy_hash,review_reason").eq("legacy_result_id", legacyId).single(); assert.equal(candidate.error, null); assert.equal(candidate.data.review_reason, null);
await rpc("backfill_assessment_results", { approvals: [{ legacy_result_id: legacyId, legacy_hash: candidate.data.legacy_hash }], change_reason: "Synthetic eligible source review" });
await command({ type: "AddManualAttempt", component: "theory", items: [{ kind: "mcq", score: 70 }], sitting_date: "2025-10-01", sitting_term_id: sittingTermId });
const legacyBefore = await admin.from("exam_results").select("*").eq("id", legacyId).single(); assert.equal(legacyBefore.error, null);
const checks = []; let server; let logDescriptor; let context; const errors = [];
const browser = await chromium.launch();
async function stopApp() {
  if (context) { await context.close(); context = null; }
  if (server) { const closed = once(server, "exit"); process.kill(-server.pid, "SIGTERM"); await closed; server = null; closeSync(logDescriptor); }
}
async function startApp(mode, workspace = true) {
  await stopApp(); logDescriptor = openSync(`${artifacts}/app-${mode}-${workspace}.log`, "a", 0o600);
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3102"], { env: liveAppEnvironment(settings, mode, workspace, process.env), detached: true, stdio: ["ignore", logDescriptor, logDescriptor] });
  let ready = false;
  for (let retry = 0; retry < 90; retry++) {
    if (server.exitCode !== null) throw new Error("Rehearsal app exited; inspect its private log");
    ready = await fetch(`${base}/login`).then(response => response.ok, () => false);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(ready, true, "Rehearsal app did not become ready");
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(20000); page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/login?next=${encodeURIComponent(`/students/${studentId}?tab=modules`)}`);
  await page.getByLabel("Email", { exact: true }).fill(adminEmail); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(url => url.pathname === `/students/${studentId}`); return page;
}
async function official(page) {
  const response = await page.request.get(`${base}/api/exports/cccu-exam-results`); assert.equal(response.status(), 200);
  return Papa.parse(await response.text(), { header: true, skipEmptyLines: true }).data.filter(row => row["Student ID"] === `LIVE-${fixtureId}`);
}
async function details(page) { await page.getByRole("button", { name: "View results for Synthetic live module", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Synthetic live module", exact: true }); await dialog.waitFor(); return dialog; }
try {
  let page = await startApp("off");
  assert.equal(await page.getByRole("navigation", { name: "Student sections", exact: true }).count(), 0);
  assert.deepEqual((await official(page)).map(row => row.Score), ["30"]);
  checks.push("Off mode uses legacy profile and official export even when the workspace flag is true");
  page = await startApp("shadow"); await page.getByRole("navigation", { name: "Student sections", exact: true }).waitFor();
  assert.deepEqual((await official(page)).map(row => row.Score), ["30"]);
  const shadow = await page.request.get(`${base}/api/exports/assessments?report=outcomes`); assert.equal(shadow.status(), 200); assert.match(await shadow.text(), /Pass/);
  checks.push("Shadow workspace previews additive passing results while the official CCCU export stays legacy-authoritative");
  await stopApp();
  const denied = await admin.rpc("set_assessment_rollout", { requested_mode: "live", evidence: {}, change_reason: "Synthetic missing evidence must fail" }); assert.match(denied.error?.message ?? "", /Missing rollout sign-off/);
  await rpc("set_assessment_rollout", { requested_mode: "live", evidence: Object.fromEntries(["reconciliation_review", "sanitized_rehearsal", "pilot_signoff", "backup_restore", "module_plans_review"].map(gate => [gate, `SYNTHETIC ONLY: ${fixtureId}; not production sign-off`])), change_reason: "Authorized isolated synthetic cutover rehearsal" });
  page = await startApp("live", false); assert.equal(await page.getByRole("navigation", { name: "Student sections", exact: true }).count(), 0);
  assert.deepEqual((await official(page)).map(row => row.Score).sort(), ["30", "70"]);
  checks.push("Database rejects missing sign-off; live projections work independently of the integrated workspace flag");
  page = await startApp("live"); await page.getByRole("navigation", { name: "Student sections", exact: true }).waitFor();
  const liveRows = await official(page); assert.equal(liveRows.length, 2); assert.ok(liveRows.every(row => row["Resit Required"] === "No"));
  assert.equal(liveRows.find(row => row.Score === "70").Term, `Live sitting ${fixtureId}`);
  assert.equal((await evaluate()).awarded_credits, 10);
  const legacyWrite = await admin.from("exam_results").update({ score: 99 }).eq("id", legacyId); assert.match(legacyWrite.error?.message ?? "", /read-only/);
  checks.push("Live official export retains failure/resit history and separate sitting term, awards ten credits and blocks legacy writes");
  let dialog = await details(page); await dialog.getByRole("button", { name: "Correct result", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "Correct result", exact: true }); await editor.getByLabel("MCQ score (%)", { exact: true }).fill("40"); await editor.getByLabel("Reason", { exact: true }).fill("Synthetic live pass reversal");
  const response = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/students/${studentId}`);
  const refresh = page.waitForResponse(response => response.request().method() === "GET" && response.request().headers().rsc === "1" && new URL(response.url()).pathname === `/students/${studentId}`);
  await editor.getByRole("button", { name: "Save changes", exact: true }).click(); await editor.waitFor({ state: "detached" }); assert.equal(await (await response).finished(), null); assert.equal(await (await refresh).finished(), null);
  assert.equal((await evaluate()).awarded_credits, 0); assert.equal((await evaluate()).components.theory.attempt_count, 2);
  assert.equal((await official(page)).find(row => row.Score === "40")["Resit Required"], "Yes");
  await command({ type: "AddManualAttempt", component: "theory", items: [{ kind: "mcq", score: 80 }], sitting_date: "2025-11-01", sitting_term_id: sittingTermId });
  await page.reload(); dialog = await details(page); await dialog.getByRole("button", { name: /Result history/ }).click();
  await page.screenshot({ path: `${artifacts}/live-result-history.png` });
  assert.equal((await evaluate()).components.theory.attempt_count, 3); assert.equal((await evaluate()).awarded_credits, 10);
  checks.push("A browser correction reverses Pass/credits without creating a resit; a later live-only resit restores Pass with all three attempts retained");
  await stopApp(); await rpc("set_assessment_rollout", { requested_mode: "shadow", evidence: {}, change_reason: "Synthetic rollback; preserve live-only evidence" });
  page = await startApp("shadow"); assert.deepEqual((await official(page)).map(row => row.Score), ["30"]); assert.equal((await evaluate()).components.theory.score, 80);
  const legacyAfter = await admin.from("exam_results").select("*").eq("id", legacyId).single(); assert.equal(legacyAfter.error, null); assert.deepEqual(legacyAfter.data, legacyBefore.data);
  checks.push("Rollback returns official output to the unchanged legacy failure while preserving live-only result, correction and audit evidence for reconciliation");
  assert.deepEqual(errors, []);
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ checks, errors, studentId, enrolmentId, api: settings.API_URL, modeAfter: "shadow", synthetic: true }, null, 2));
  writeFileSync(".context/assessment-live-review/latest.json", JSON.stringify({ artifacts, checks: checks.length }, null, 2));
  console.log(JSON.stringify({ artifacts, checks: checks.length }, null, 2));
} catch (error) {
  writeFileSync(`${artifacts}/failure.json`, JSON.stringify({ checks, errors, error: error.message, studentId, enrolmentId }, null, 2));
  await context?.pages()[0]?.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await stopApp();
  const restored = await admin.rpc("set_assessment_rollout", { requested_mode: "shadow", evidence: {}, change_reason: "Synthetic rehearsal cleanup; retain all evidence" });
  await browser.close(); await admin.auth.signOut({ scope: "local" }); assert.equal(restored.error, null);
}
