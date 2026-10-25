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
const teacherLogin = await teacher.auth.signInWithPassword({ email: credentials.teacherEmail, password: credentials.password }); assert.equal(teacherLogin.error, null);
const fixtureId = randomUUID(); const studentId = `69000000${randomUUID().slice(8)}`; let termId = randomUUID();
const artifacts = `.context/student-teaching-review/${fixtureId}`; mkdirSync(artifacts, { recursive: true });
async function insert(table, values) { assert.equal((await service.from(table).insert(values)).error, null); }
async function evaluate(enrolmentId) { const result = await admin.rpc("read_enrolment_assessment", { enrolment_key: enrolmentId }); assert.equal(result.error, null); return result.data; }
async function options(client = admin) { const result = await client.rpc("read_student_teaching_options", { student_key: studentId }); assert.equal(result.error, null); return result.data; }
async function rows(table) { const result = await admin.from(table).select("*").eq("student_id", studentId); assert.equal(result.error, null); return result.data; }
const activeTerms = await admin.from("terms").select("id,starts_on,ends_on").eq("status", "active").order("starts_on", { ascending: false }).limit(1);
assert.equal(activeTerms.error, null);
const dayAfter = (date, days) => new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
const activeTerm = activeTerms.data[0];
if (activeTerm) termId = activeTerm.id;
const startsOn = activeTerm?.starts_on ?? "2025-01-01";
const endsOn = activeTerm?.ends_on ?? dayAfter(startsOn, 150);
assert.ok(endsOn < new Date().toISOString().slice(0, 10), "This synthetic completed-term fixture needs a past active-term date; do not alter existing terms to force the test.");
const evidenceDates = [60, 61, 62, 63, 64].map(days => dayAfter(startsOn, days));
await insert("students", { id: studentId, temporary_id: `TEACH-${studentId}`, first_name: "Teaching", last_name: `Review ${fixtureId.slice(0, 8)}`, email: `${studentId}@example.test`, programme: "pgcert", status: "active", admission_stage: "accepted" });
if (!activeTerm) await insert("terms", { id: termId, name: `Teaching review ${fixtureId.slice(0, 8)}`, starts_on: startsOn, ends_on: endsOn, status: "active" });
const enrolmentIds = []; const offeringIds = []; const definitionIds = [];
for (const index of [0, 1]) {
  const moduleId = randomUUID(); const offeringId = randomUUID(); const enrolmentId = randomUUID(); const definitionId = randomUUID();
  await insert("course_modules", { id: moduleId, code: `TEACH-${moduleId}`, title: `Teaching review practical ${index ? "B" : "A"}`, mode: "practical", credits: 10 });
  assert.equal((await admin.rpc("save_module_assessment_plan", { input: { module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, practical_pass_mark: 50, reason: "Synthetic teaching review" }, expected_plan_id: null })).error, null);
  await insert("module_offerings", { id: offeringId, module_id: moduleId, term_id: termId, price_pence: 0, capacity: 10, presentation_required: true });
  await insert("enrolments", { id: enrolmentId, student_id: studentId, offering_id: offeringId, attendance_days_required_override: 0 });
  await insert("assessment_definitions", { id: definitionId, module_id: moduleId, name: `Observed skill ${index ? "B" : "A"}`, domains: [{ id: "image", label: "Image quality" }, { id: "interpret", label: "Interpretation" }], score_min: 0, score_max: 5, active: true });
  for (const component of ["theory", "practical"]) assert.equal((await admin.rpc("execute_assessment_command", { command: { type: "AddManualAttempt", enrolment_id: enrolmentId, component, sitting_date: dayAfter(endsOn, 1), ...(component === "theory" ? { items: [{ kind: "mcq", score: 70 }] } : { score: 70 }), reason: "Synthetic passing exams" }, expected_revision: (await evaluate(enrolmentId)).revision })).error, null);
  enrolmentIds.push(enrolmentId); offeringIds.push(offeringId); definitionIds.push(definitionId);
}
assert.equal((await admin.rpc("execute_assessment_command", { command: { type: "SetAssessmentOverride", enrolment_id: enrolmentIds[0], kind: "credits", value: 5, reason: "Independent synthetic decision" }, expected_revision: (await evaluate(enrolmentIds[0])).revision })).error, null);
const base = "http://127.0.0.1:3100"; const path = `/students/${studentId}?tab=teaching&term=${termId}`;
writeFileSync(`${artifacts}/fixture.json`, JSON.stringify({ fixtureId, studentId, termId, enrolmentIds, offeringIds, definitionIds, url: `${base}${path}`, synthetic: true }, null, 2));
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
page.setDefaultTimeout(15000); const errors = []; const checks = []; page.on("pageerror", error => errors.push(error.message));
const screenshot = name => page.screenshot({ path: `${artifacts}/${name}.png`, style: "nextjs-portal { visibility: hidden; }" });
async function login(target, email) {
  await target.goto(`${base}/login?next=${encodeURIComponent(path)}`); await target.getByLabel("Email", { exact: true }).fill(email); await target.getByLabel("Password", { exact: true }).fill(credentials.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click(); await target.waitForURL(`${base}${path}`);
}
async function open(kind, target = page) {
  await target.getByRole("button", { name: `Add ${kind}`, exact: true }).click(); const editor = target.getByRole("dialog", { name: `Add ${kind}`, exact: true });
  await editor.getByRole("combobox", { name: "Teaching offering / cohort", exact: true }).selectOption(offeringIds[0]); return editor;
}
async function save(editor) { await editor.getByRole("button", { name: "Save record", exact: true }).click(); await editor.waitFor({ state: "detached" }); }
async function discard(editor) { await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await editor.getByRole("button", { name: "Discard changes", exact: true }).click(); await editor.waitFor({ state: "detached" }); }
try {
  await login(page, credentials.adminEmail);
  let editor = await open("observation");
  await editor.getByLabel("Date", { exact: true }).fill(evidenceDates[0]); await editor.getByLabel("Observation details", { exact: true }).fill("Observed a systematic scan; arrange follow-up practice.");
  await editor.getByRole("combobox", { name: "Concern level", exact: true }).selectOption("support_needed");
  await screenshot("observation-editor"); await save(editor);
  await page.reload(); await page.getByText("Observed a systematic scan; arrange follow-up practice.", { exact: true }).waitFor();
  assert.equal((await rows("encounter_logs"))[0].concern_level, "support_needed");
  assert.equal((await evaluate(enrolmentIds[0])).components.theory.attempt_count, 1);
  assert.equal(new URL(page.url()).searchParams.get("term"), termId);
  checks.push("Observation, concern, date and author persist in the structured timeline after reload without creating an exam attempt");

  editor = await open("formative assessment");
  const definitionSelect = editor.getByRole("combobox", { name: "Formative assessment definition", exact: true });
  assert.equal(await definitionSelect.locator(`option[value="${definitionIds[1]}"]`).count(), 0);
  await definitionSelect.selectOption(definitionIds[0]);
  await editor.getByLabel("Date", { exact: true }).fill(evidenceDates[1]); await editor.getByLabel("Overall score (0–5)", { exact: true }).fill("0");
  await editor.getByLabel("Comments", { exact: true }).fill("Formative zero retained, not an exam failure.");
  await editor.getByRole("button", { name: "Save record", exact: true }).click(); await editor.getByRole("alert").filter({ hasText: "Select at least one assessed item" }).waitFor();
  assert.equal(await editor.getByLabel("Overall score (0–5)", { exact: true }).inputValue(), "0");
  await editor.getByRole("checkbox", { name: "Image quality", exact: true }).check(); await screenshot("formative-editor"); await save(editor);
  const formative = (await rows("assessment_attempts"))[0]; assert.equal(formative.overall_score, 0); assert.deepEqual(formative.assessed_item_ids, ["image"]);
  await page.reload(); const formativeCard = page.getByRole("article").filter({ hasText: "Formative zero retained" }); await formativeCard.waitFor();
  assert.match(await formativeCard.innerText(), /Overall score\s*0/); assert.match(await formativeCard.innerText(), /Image quality/);
  checks.push("Module-scoped formative definitions retain selected items, configured numeric scale and zero score; validation errors retain inputs");

  editor = await open("formative assessment"); await editor.getByRole("combobox", { name: "Formative assessment definition", exact: true }).selectOption(definitionIds[0]);
  await editor.getByRole("checkbox", { name: "Interpretation", exact: true }).check(); await editor.getByLabel("Overall score (0–5)", { exact: true }).fill("3");
  await editor.getByLabel("Comments", { exact: true }).fill("Keep this stale draft");
  assert.equal((await admin.from("assessment_definitions").update({ name: "Observed skill A reviewed" }).eq("id", definitionIds[0])).error, null);
  await editor.getByRole("button", { name: "Save record", exact: true }).click(); await editor.getByRole("alert").filter({ hasText: "configuration changed" }).waitFor();
  assert.equal(await editor.getByLabel("Comments", { exact: true }).inputValue(), "Keep this stale draft");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await editor.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(await editor.getByRole("checkbox", { name: "Interpretation", exact: true }).isChecked(), true); await discard(editor);
  assert.equal((await rows("assessment_attempts")).length, 1);
  editor = await open("observation"); await editor.getByLabel("Observation details", { exact: true }).fill("Unsaved after enrolment change");
  assert.equal((await admin.from("enrolments").update({ attendance_days_required_override: 1 }).eq("id", enrolmentIds[0])).error, null);
  await editor.getByRole("button", { name: "Save record", exact: true }).click(); await editor.getByRole("alert").filter({ hasText: "details changed" }).waitFor(); await discard(editor);
  assert.equal((await admin.from("enrolments").update({ attendance_days_required_override: 0 }).eq("id", enrolmentIds[0])).error, null);
  checks.push("Configuration and enrolment changes reject stale teaching drafts; Keep editing and Discard preserve or abandon inputs without partial writes");

  const peerBefore = await evaluate(enrolmentIds[1]);
  editor = await open("presentation"); await editor.getByLabel("Date", { exact: true }).fill(evidenceDates[2]);
  await editor.getByRole("combobox", { name: "Presentation type", exact: true }).selectOption("journal_club"); await editor.getByLabel("Duration (minutes)", { exact: true }).fill("20");
  const scores = editor.locator('select[name]:not([name="presentationType"])');
  assert.equal(await scores.count(), 10); for (const select of await scores.all()) await select.selectOption("4");
  await editor.getByLabel("Comments", { exact: true }).fill("Clear presentation with critical reflection."); await screenshot("presentation-editor"); await save(editor);
  const presentation = (await rows("presentation_scores"))[0]; assert.equal(presentation.total_score, 40); assert.equal(presentation.duration_minutes, 20); assert.equal(presentation.presentation_type, "journal_club"); assert.equal(Object.keys(presentation.scores).length, 10);
  assert.equal((await evaluate(enrolmentIds[0])).effective_status, "Pass"); assert.equal((await evaluate(enrolmentIds[0])).awarded_credits, 5);
  assert.equal((await evaluate(enrolmentIds[1])).presentation_pending, true); assert.ok((await evaluate(enrolmentIds[1])).revision > peerBefore.revision);
  await page.reload(); const presentationCard = page.getByRole("article").filter({ hasText: "Clear presentation with critical reflection." }); await presentationCard.waitFor();
  assert.match(await presentationCard.innerText(), /Material is accurate and up to date/); assert.match(await presentationCard.innerText(), /Total score\s*40/);
  const texts = await page.getByRole("article").allTextContents(); assert.match(texts[0], /Presentation/); assert.match(texts[1], /Formative assessment/); assert.match(texts[2], /Observation/);
  await screenshot("teaching-timeline");
  checks.push("Presentation rubric total is calculated, all ten scores and metadata remain visible, module compliance recalculates without satisfying another module or changing exam results/overrides");

  const teacherPage = await browser.newPage({ viewport: { width: 390, height: 844 } }); teacherPage.on("pageerror", error => errors.push(error.message));
  await login(teacherPage, credentials.teacherEmail); editor = await open("observation", teacherPage);
  await editor.getByLabel("Date", { exact: true }).fill(evidenceDates[3]); await editor.getByLabel("Observation details", { exact: true }).fill("Teacher follow-up recorded on mobile.");
  assert.ok((await editor.boundingBox()).width <= 390);
  await teacherPage.screenshot({ path: `${artifacts}/mobile-teacher-editor.png`, style: "nextjs-portal { visibility: hidden; }" }); await save(editor);
  await teacherPage.reload(); await teacherPage.getByText("Teacher follow-up recorded on mobile.", { exact: true }).waitFor();
  assert.equal((await rows("encounter_logs")).find(row => row.summary === "Teacher follow-up recorded on mobile.").staff_user_id, teacherLogin.data.user.id);
  assert.equal(await teacherPage.getByRole("option", { name: "Finance", exact: true }).count(), 0);
  assert.equal((await options(teacher)).offerings.length, 2);
  await teacherPage.close(); checks.push("Teachers can create teaching evidence on mobile with server-owned authorship, preserved reloads and no finance access");

  const current = await options(); const input = { id: randomUUID(), kind: "observation", student_id: studentId, offering_id: offeringIds[0], offering_token: current.offerings.find(row => row.id === offeringIds[0]).token, occurred_on: evidenceDates[4], summary: "Guarded retry probe", concern_level: "none" };
  assert.ok((await teacher.rpc("create_student_teaching_record", { command: { ...input, staff_user_id: teacherLogin.data.user.id } })).error);
  assert.equal((await teacher.rpc("create_student_teaching_record", { command: input })).error, null);
  const after = await options(); input.offering_token = after.offerings.find(row => row.id === offeringIds[0]).token;
  assert.match((await teacher.rpc("create_student_teaching_record", { command: input })).error?.message ?? "", /already saved/);
  const anonymous = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
  assert.ok((await anonymous.rpc("create_student_teaching_record", { command: input })).error);
  checks.push("Callable mutations reject author spoofing, repeated record identifiers and anonymous requests; no duplicate teaching evidence is added");

  const specialistLink = page.getByRole("link", { name: "Open teaching workspace", exact: true }); assert.equal(await specialistLink.getAttribute("href"), `/staff?studentId=${studentId}`);
  await specialistLink.click(); await page.waitForURL(`${base}/staff?studentId=${studentId}`); await page.getByText("Teacher follow-up recorded on mobile.", { exact: true }).waitFor();
  await page.goto(`${base}${path}`); await page.getByText("Guarded retry probe", { exact: true }).waitFor();
  const attempts = await admin.from("assessment_attempt_history").select("id,score").in("enrolment_id", enrolmentIds); assert.equal(attempts.error, null); assert.equal(attempts.data.length, 4); assert.ok(attempts.data.every(row => row.score === 70));
  const audit = await admin.from("audit_events").select("metadata").eq("action", "teaching.record_created").eq("metadata->>student_id", studentId); assert.equal(audit.error, null); assert.equal(audit.data.length, 5);
  checks.push("Specialist teaching workspace sees the same records; all five saves are audited and original summative attempts remain unchanged");
  assert.equal((await admin.from("students").update({ status: "withdrawn" }).eq("id", studentId)).error, null);
  try {
    await page.reload(); await page.getByText("Teacher follow-up recorded on mobile.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Add observation", exact: true }).click(); editor = page.getByRole("dialog", { name: "Add observation", exact: true });
    await editor.getByText(/Teaching records require an active student enrolled in the current active teaching term/).waitFor();
    assert.equal(await editor.getByRole("button", { name: "Save record", exact: true }).isDisabled(), true);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.match((await teacher.rpc("create_student_teaching_record", { command: { ...input, id: randomUUID() } })).error?.message ?? "", /active student/);
  } finally { assert.equal((await admin.from("students").update({ status: "active" }).eq("id", studentId)).error, null); }
  const historicalTerm = randomUUID(); const historicalOffering = randomUUID();
  await insert("terms", { id: historicalTerm, name: `Historic teaching review ${fixtureId.slice(0, 8)}`, starts_on: "2024-01-01", ends_on: "2024-05-31", status: "closed" });
  await insert("module_offerings", { id: historicalOffering, module_id: current.offerings.find(row => row.id === offeringIds[0]).moduleId, term_id: historicalTerm, price_pence: 0, capacity: 10 });
  await insert("enrolments", { student_id: studentId, offering_id: historicalOffering, attendance_days_required_override: 0 });
  assert.ok(!(await options()).offerings.some(offering => offering.id === historicalOffering));
  assert.match((await teacher.rpc("create_student_teaching_record", { command: { ...input, id: randomUUID(), offering_id: historicalOffering } })).error?.message ?? "", /current active teaching term/);
  await page.reload(); await page.getByText("Teacher follow-up recorded on mobile.", { exact: true }).waitFor();
  checks.push("Inactive students and historical teaching terms keep readable evidence but cannot record new entries; database checks enforce the existing Staff workflow scope");
  assert.deepEqual(errors, []);
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ checks, errors, mode: "shadow", studentId }, null, 2));
  writeFileSync(".context/student-teaching-review/latest.json", JSON.stringify({ artifacts, url: `${base}${path}` }, null, 2));
  process.stdout.write(`${checks.length} teaching browser groups passed. Review: ${base}${path}\nEvidence: ${artifacts}\n`);
} catch (error) { await screenshot("failure").catch(() => {}); process.stderr.write(`Synthetic fixture retained: ${artifacts}\n`); throw error; }
finally { await browser.close(); await admin.auth.signOut({ scope: "local" }); await teacher.auth.signOut({ scope: "local" }); }
