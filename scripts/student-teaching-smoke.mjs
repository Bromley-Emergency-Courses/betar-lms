import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { studentBrowser } from "./student-browser.mjs";
import { trackPageRequests } from "./student-browser-settle.mjs";
import { interruptNextAction } from "./student-browser-faults.mjs";
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
const companionPath = `${base}/staff?studentId=${studentId}&term=${termId}`;
writeFileSync(`${artifacts}/fixture.json`, JSON.stringify({ fixtureId, studentId, termId, enrolmentIds, offeringIds, definitionIds, url: `${base}${path}`, synthetic: true }, null, 2));
const browser = await studentBrowser(process.argv[4]).launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
page.setDefaultTimeout(15000); const errors = []; const checks = []; const errorDetails = [];
const requestSettlers = new WeakMap();
function observe(target) {
  requestSettlers.set(target, trackPageRequests(target));
  target.on("pageerror", error => {
    errors.push(error.message);
    errorDetails.push({ completedGroups: checks.length, url: target.url(), message: error.message, stack: error.stack });
  });
}
observe(page);
const screenshot = async name => {
  await page.waitForLoadState("networkidle");
  return page.screenshot({ path: `${artifacts}/${name}.png`, caret: "initial", style: "nextjs-portal { visibility: hidden; }" });
};
async function navigate(target, url) {
  await requestSettlers.get(target)();
  if (url) await target.goto(url);
  else await target.reload();
  await target.waitForLoadState("networkidle");
}
async function login(target, email) {
  await target.goto(`${base}/login?next=${encodeURIComponent(path)}`); await target.getByLabel("Email", { exact: true }).fill(email); await target.getByLabel("Password", { exact: true }).fill(credentials.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click(); await target.waitForURL(`${base}${path}`);
}
async function open(kind, target = page, offeringId = offeringIds[0]) {
  await target.getByRole("button", { name: `Add ${kind}`, exact: true }).click(); const editor = target.getByRole("dialog", { name: `Add ${kind}`, exact: true });
  await editor.getByRole("combobox", { name: "Teaching offering / cohort", exact: true }).selectOption(offeringId); return editor;
}
async function save(editor) {
  const target = editor.page();
  const savedText = await editor.locator("textarea").inputValue();
  const [response] = await Promise.all([
    target.waitForResponse(response => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"]) && response.url() === target.url()),
    editor.getByRole("button", { name: "Save record", exact: true }).click(),
  ]);
  assert.equal(response.ok(), true);
  await editor.waitFor({ state: "detached" });
  if (savedText.trim()) await target.getByText(savedText, { exact: true }).waitFor({ state: "attached" });
}
async function discard(editor) { await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await editor.getByRole("button", { name: "Discard changes", exact: true }).click(); await editor.waitFor({ state: "detached" }); }
try {
  await login(page, credentials.adminEmail);
  let editor = await open("observation");
  await editor.getByLabel("Date", { exact: true }).fill(evidenceDates[0]); await editor.getByLabel("Observation details", { exact: true }).fill("Observed a systematic scan; arrange follow-up practice.");
  await editor.getByRole("combobox", { name: "Concern level", exact: true }).selectOption("support_needed");
  await screenshot("observation-editor"); await save(editor);
  await navigate(page); await page.getByText("Observed a systematic scan; arrange follow-up practice.", { exact: true }).waitFor();
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
  await navigate(page); const formativeCard = page.getByRole("article").filter({ hasText: "Formative zero retained" }); await formativeCard.waitFor();
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
  await navigate(page); const presentationCard = page.getByRole("article").filter({ hasText: "Clear presentation with critical reflection." }); await presentationCard.waitFor();
  assert.match(await presentationCard.innerText(), /Material is accurate and up to date/); assert.match(await presentationCard.innerText(), /Recorded total\s*40\/50/);
  const texts = await page.getByRole("article").allTextContents(); assert.match(texts[0], /Presentation/); assert.match(texts[1], /Formative assessment/); assert.match(texts[2], /Observation/);
  await screenshot("teaching-timeline");
  checks.push("Presentation rubric total is calculated, all ten scores and metadata remain visible, module compliance recalculates without satisfying another module or changing exam results/overrides");

  const teacherPage = await browser.newPage({ viewport: { width: 390, height: 844 } }); observe(teacherPage);
  await login(teacherPage, credentials.teacherEmail); editor = await open("observation", teacherPage, offeringIds[1]);
  await editor.getByLabel("Date", { exact: true }).fill(evidenceDates[3]); await editor.getByLabel("Observation details", { exact: true }).fill("Teacher follow-up recorded on mobile.");
  assert.ok((await editor.boundingBox()).width <= 390);
  await teacherPage.waitForLoadState("networkidle");
  await teacherPage.screenshot({ path: `${artifacts}/mobile-teacher-editor.png`, caret: "initial", style: "nextjs-portal { visibility: hidden; }" }); await save(editor);
  await navigate(teacherPage); await teacherPage.getByText("Teacher follow-up recorded on mobile.", { exact: true }).waitFor();
  assert.equal((await rows("encounter_logs")).find(row => row.summary === "Teacher follow-up recorded on mobile.").staff_user_id, teacherLogin.data.user.id);
  assert.equal(await teacherPage.getByRole("option", { name: "Finance", exact: true }).count(), 0);
  assert.deepEqual((await options(teacher)).offerings.map(offering => offering.id), [offeringIds[1]]);
  await requestSettlers.get(teacherPage)(); await teacherPage.close(); checks.push("Teachers can create teaching evidence on mobile with server-owned authorship, preserved reloads and no finance access");

  const current = await options(); const input = { id: randomUUID(), kind: "observation", student_id: studentId, offering_id: offeringIds[1], offering_token: current.offerings.find(row => row.id === offeringIds[1]).token, occurred_on: evidenceDates[4], summary: "Guarded retry probe", concern_level: "none" };
  assert.ok((await teacher.rpc("create_student_teaching_record", { command: { ...input, staff_user_id: teacherLogin.data.user.id } })).error);
  assert.equal((await teacher.rpc("create_student_teaching_record", { command: input })).error, null);
  const after = await options(); input.offering_token = after.offerings.find(row => row.id === offeringIds[1]).token;
  assert.match((await teacher.rpc("create_student_teaching_record", { command: input })).error?.message ?? "", /already saved/);
  const anonymous = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
  assert.ok((await anonymous.rpc("create_student_teaching_record", { command: input })).error);
  checks.push("Callable mutations reject author spoofing, repeated record identifiers and anonymous requests; no duplicate teaching evidence is added");

  const specialistLink = page.getByRole("link", { name: "Open teaching workspace", exact: true }); assert.equal(await specialistLink.getAttribute("href"), `/staff?studentId=${studentId}`);
  await specialistLink.click(); await page.waitForURL(`${base}/staff?studentId=${studentId}`);
  await page.getByText("Teacher follow-up recorded on mobile.", { exact: true }).waitFor({ state: "attached" });
  const followUp = page.locator("details").filter({ hasText: "Teacher follow-up recorded on mobile." });
  if (await followUp.count()) await followUp.locator("summary").click();
  await page.getByText("Teacher follow-up recorded on mobile.", { exact: true }).waitFor();
  await navigate(page, `${base}${path}`); await page.getByText("Guarded retry probe", { exact: true }).waitFor();
  const attempts = await admin.from("assessment_attempt_history").select("id,score").in("enrolment_id", enrolmentIds); assert.equal(attempts.error, null); assert.equal(attempts.data.length, 4); assert.ok(attempts.data.every(row => row.score === 70));
  const audit = await admin.from("audit_events").select("metadata").eq("action", "teaching.record_created").eq("metadata->>student_id", studentId); assert.equal(audit.error, null); assert.equal(audit.data.length, 5);
  checks.push("Specialist teaching workspace sees the same records; all five saves are audited and original summative attempts remain unchanged");
  assert.equal((await admin.from("students").update({ status: "withdrawn" }).eq("id", studentId)).error, null);
  try {
    await navigate(page); await page.getByText("Teacher follow-up recorded on mobile.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Add observation", exact: true }).click(); editor = page.getByRole("dialog", { name: "Add observation", exact: true });
    await editor.getByText(/No eligible enrolments/).waitFor();
    assert.equal(await editor.getByRole("button", { name: "Save record", exact: true }).isDisabled(), true);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.match((await teacher.rpc("create_student_teaching_record", { command: { ...input, id: randomUUID() } })).error?.message ?? "", /active student/);
  } finally { assert.equal((await admin.from("students").update({ status: "active" }).eq("id", studentId)).error, null); }
  const historicalTerm = randomUUID(); const historicalOffering = randomUUID();
  await insert("terms", { id: historicalTerm, name: `Historic teaching review ${fixtureId.slice(0, 8)}`, starts_on: "2024-01-01", ends_on: "2024-05-31", status: "closed" });
  await insert("module_offerings", { id: historicalOffering, module_id: current.offerings.find(row => row.id === offeringIds[1]).moduleId, term_id: historicalTerm, price_pence: 0, capacity: 10 });
  await insert("enrolments", { student_id: studentId, offering_id: historicalOffering, attendance_days_required_override: 0 });
  assert.ok(!(await options()).offerings.some(offering => offering.id === historicalOffering));
  assert.match((await teacher.rpc("create_student_teaching_record", { command: { ...input, id: randomUUID(), offering_id: historicalOffering } })).error?.message ?? "", /current active teaching term/);
  await navigate(page); await page.getByText("Teacher follow-up recorded on mobile.", { exact: true }).waitFor();
  checks.push("Inactive students and historical teaching terms keep readable evidence but cannot record new entries; database checks enforce the existing Staff workflow scope");
  if (process.argv[3] === "--companion") {
    const companion = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    observe(companion);
    await login(companion, credentials.teacherEmail);
    await navigate(companion, companionPath);
    await companion.getByRole("heading", { name: "Module enrolments", exact: true }).waitFor();
    assert.equal(await companion.getByRole("button", { name: "Add encounter", exact: true }).count(), 1);
    assert.equal(await companion.getByRole("article").count(), 3);
    await companion.getByRole("button", { name: "Add encounter", exact: true }).click();
    editor = companion.getByRole("dialog", { name: "Add observation", exact: true });
    assert.equal(await editor.getByRole("combobox", { name: "Teaching offering / cohort", exact: true }).inputValue(), offeringIds[1]);
    await editor.getByLabel("Observation details", { exact: true }).fill("Companion encounter from phone");
    await editor.getByLabel("Concern level", { exact: true }).selectOption("support_needed");
    assert.ok(await editor.getByLabel("Observation details", { exact: true }).evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 16));
    assert.ok((await editor.getByLabel("Concern level", { exact: true }).boundingBox()).height >= 44);
    await companion.waitForLoadState("networkidle");
    await companion.screenshot({ path: `${artifacts}/companion-phone-encounter.png`, caret: "initial", style: "nextjs-portal { visibility: hidden; }" });
    assert.ok((await editor.boundingBox()).width <= 390);
    let verifyFault = await interruptNextAction(companion);
    await editor.getByRole("button", { name: "Save record", exact: true }).click();
    await editor.getByRole("alert").filter({ hasText: "save could not be confirmed" }).waitFor(); await verifyFault();
    assert.equal(await editor.getByLabel("Observation details", { exact: true }).inputValue(), "Companion encounter from phone");
    assert.equal((await rows("encounter_logs")).filter(row => row.summary === "Companion encounter from phone").length, 0);
    verifyFault = await interruptNextAction(companion, { afterResponse: true });
    await editor.getByRole("button", { name: "Save record", exact: true }).click();
    await editor.getByRole("alert").filter({ hasText: "save could not be confirmed" }).waitFor(); await verifyFault();
    assert.equal((await rows("encounter_logs")).filter(row => row.summary === "Companion encounter from phone").length, 1);
    await editor.getByRole("button", { name: "Save record", exact: true }).click();
    await editor.getByRole("alert").filter({ hasText: "Teaching or enrolment details changed" }).waitFor();
    assert.equal(await editor.getByLabel("Observation details", { exact: true }).inputValue(), "Companion encounter from phone");
    await discard(editor);
    await navigate(companion, companionPath);
    await companion.getByText("Companion encounter from phone", { exact: true }).waitFor({ state: "attached" });
    assert.equal((await rows("encounter_logs")).filter(row => row.summary === "Companion encounter from phone").length, 1);
    checks.push("Dropped encounter requests preserve drafts; lost committed responses invalidate the old enrolment snapshot and reopening shows one saved timeline record");
    const savedEncounter = (await rows("encounter_logs")).find(row => row.summary === "Companion encounter from phone");
    assert.equal(savedEncounter.staff_user_id, teacherLogin.data.user.id);
    assert.equal(savedEncounter.offering_id, offeringIds[1]);
    assert.equal(savedEncounter.concern_level, "support_needed");
    await companion.getByRole("button", { name: "Add formative score", exact: true }).click();
    editor = companion.getByRole("dialog", { name: "Add formative assessment", exact: true });
    await editor.getByRole("combobox", { name: "Formative assessment definition", exact: true }).selectOption(definitionIds[1]);
    await editor.getByLabel("Overall score (0–5)", { exact: true }).fill("0");
    await editor.getByLabel("Comments", { exact: true }).fill("Companion formative zero");
    await editor.getByRole("button", { name: "Save record", exact: true }).click();
    await editor.getByRole("alert").filter({ hasText: "Select at least one assessed item" }).waitFor();
    assert.equal(await editor.getByLabel("Overall score (0–5)", { exact: true }).inputValue(), "0");
    await editor.getByRole("checkbox", { name: "Image quality", exact: true }).check();
    await save(editor);
    assert.equal((await rows("assessment_attempts")).find(row => row.comments === "Companion formative zero").overall_score, 0);
    await companion.getByRole("button", { name: "Add encounter", exact: true }).click();
    editor = companion.getByRole("dialog", { name: "Add observation", exact: true });
    await editor.getByLabel("Observation details", { exact: true }).fill("Preserve ineligible draft");
    const moduleId = current.offerings.find(row => row.id === offeringIds[1]).moduleId;
    assert.equal((await admin.from("course_modules").update({ active: false }).eq("id", moduleId)).error, null);
    try {
      await editor.getByRole("button", { name: "Save record", exact: true }).click();
      await editor.getByRole("alert").filter({ hasText: "active student" }).waitFor();
      assert.equal(await editor.getByLabel("Observation details", { exact: true }).inputValue(), "Preserve ineligible draft");
      assert.equal((await rows("encounter_logs")).some(row => row.summary === "Preserve ineligible draft"), false);
      await discard(editor);
      await navigate(companion);
      assert.equal(await companion.getByRole("button", { name: "Add encounter", exact: true }).count(), 0);
    } finally { assert.equal((await admin.from("course_modules").update({ active: true }).eq("id", moduleId)).error, null); }
    await navigate(companion, `${base}${path}`);
    await companion.getByText("Companion encounter from phone", { exact: true }).waitFor();
    await companion.getByText("Companion formative zero", { exact: true }).waitFor();
    const direct = await teacher.from("encounter_logs").insert({ student_id: studentId, offering_id: offeringIds[1], staff_user_id: teacherLogin.data.user.id, occurred_on: evidenceDates[4], summary: "Forbidden direct write", concern_level: "none" });
    assert.ok(direct.error);
    await navigate(companion, `${base}/staff?view=legacy&studentId=${studentId}&offeringId=${offeringIds[1]}`);
    const legacyForm = companion.locator("form").filter({ has: companion.getByRole("heading", { name: "Encounter Log", exact: true }) });
    await companion.waitForFunction(() => document.querySelector('form:has(#encounter-summary) input[name="command_id"]')?.value);
    for (const summary of ["Legacy guarded encounter one", "Legacy guarded encounter two"]) {
      const previousId = await legacyForm.locator('[name="command_id"]').inputValue();
      assert.match(previousId, /^[a-f0-9-]{36}$/);
      await legacyForm.getByLabel("Summary", { exact: true }).fill(summary);
      await legacyForm.getByRole("button", { name: "Save log", exact: true }).click();
      await companion.waitForFunction(previous => {
        const input = document.querySelector('form:has(#encounter-summary) input[name="command_id"]');
        return input && input.value && input.value !== previous;
      }, previousId);
      assert.equal((await rows("encounter_logs")).filter(row => row.summary === summary).length, 1);
    }
    await navigate(companion, companionPath); await companion.setViewportSize({ width: 820, height: 1180 });
    await companion.getByRole("heading", { name: "Module enrolments", exact: true }).waitFor();
    await companion.waitForLoadState("networkidle");
    await companion.screenshot({ path: `${artifacts}/companion-tablet-profile.png`, caret: "initial", style: "nextjs-portal { visibility: hidden; }" });
    assert.ok(await companion.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.equal((await evaluate(enrolmentIds[0])).effective_status, "Pass");
    assert.equal((await evaluate(enrolmentIds[1])).components.theory.score, 70);
    await requestSettlers.get(companion)(); await companion.close();
    checks.push("Companion phone/tablet entry reuses the main dialog/store, preserves invalid and stale drafts, blocks passed/history/inactive targets, retains formative zero and session authorship, and appears in the main profile without changing exam scores");
    checks.push("Legacy forms save through guarded RPCs with renewed per-form command identities; direct authenticated teaching-table writes are denied");
  }
  const scoring = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" }); observe(scoring);
  await login(scoring, credentials.teacherEmail); await navigate(scoring, companionPath);
  assert.equal(await scoring.getByRole("button", { name: "Edit your score", exact: true }).count(), 0);
  const passedModule = scoring.getByRole("article").filter({ hasText: "Teaching review practical A" });
  assert.equal(await passedModule.getByRole("button", { name: "Add encounter", exact: true }).count(), 0);
  await passedModule.getByRole("button", { name: "Presentation scoring", exact: true }).click();
  editor = scoring.getByRole("dialog", { name: "Add presentation", exact: true });
  assert.equal(await editor.getByLabel("Date", { exact: true }).getAttribute("readonly"), "");
  assert.equal(await editor.getByLabel("Duration (minutes)", { exact: true }).count(), 0);
  for (const select of await editor.locator("select[name]").all()) await select.selectOption("4");
  await editor.getByLabel("Time penalty (points)", { exact: true }).fill("3");
  await editor.getByRole("button", { name: "Increase time penalty", exact: true }).click();
  assert.equal(await editor.getByLabel("Time penalty (points)", { exact: true }).inputValue(), "4");
  await editor.getByRole("button", { name: "Decrease time penalty", exact: true }).click();
  assert.ok((await editor.getByRole("button", { name: "Increase time penalty", exact: true }).boundingBox()).height >= 44);
  await editor.getByLabel("Comments", { exact: true }).fill("Second assessor with a manual time penalty");
  await scoring.screenshot({ path: `${artifacts}/presentation-phone-penalty.png`, style: "nextjs-portal { visibility: hidden; }" });
  const verifyScoreFault = await interruptNextAction(scoring, { afterResponse: true });
  await editor.getByRole("button", { name: "Save record", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "save could not be confirmed" }).waitFor(); await verifyScoreFault();
  assert.equal((await rows("presentation_scores")).filter(row => row.offering_id === offeringIds[0]).length, 2);
  await editor.getByRole("button", { name: "Save record", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "Edit your existing submission instead" }).waitFor();
  assert.equal(await editor.getByLabel("Time penalty (points)", { exact: true }).inputValue(), "3");
  assert.equal(await editor.getByLabel("Comments", { exact: true }).inputValue(), "Second assessor with a manual time penalty");
  await discard(editor);
  checks.push("A lost presentation-score acknowledgement directs its author to edit on retry without duplicating the score or event");
  let submitted = (await rows("presentation_scores")).filter(row => row.offering_id === offeringIds[0]);
  assert.equal(submitted.length, 2); assert.equal(new Set(submitted.map(row => row.event_id)).size, 1);
  const own = submitted.find(row => row.staff_user_id === teacherLogin.data.user.id); assert.equal(own.total_score, 37); assert.equal(own.time_penalty, 3);
  await navigate(scoring, `${base}${path}`);
  await scoring.getByRole("button", { name: "Edit your score", exact: true }).click();
  editor = scoring.getByRole("dialog", { name: "Edit your presentation", exact: true });
  assert.equal(await editor.getByLabel("Time penalty (points)", { exact: true }).inputValue(), "3");
  await editor.getByLabel("Comments", { exact: true }).fill("Updated only my submission");
  await editor.getByLabel("Time penalty (points)", { exact: true }).fill("40");
  const verifyEditFault = await interruptNextAction(scoring, { afterResponse: true });
  await editor.getByRole("button", { name: "Save record", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "save could not be confirmed" }).waitFor(); await verifyEditFault();
  const committedScore = (await rows("presentation_scores")).find(row => row.id === own.id);
  assert.equal(committedScore.total_score, 0); assert.equal(committedScore.comments, "Updated only my submission");
  await editor.getByRole("button", { name: "Save record", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "changed or was already saved" }).waitFor();
  assert.equal(await editor.getByLabel("Comments", { exact: true }).inputValue(), "Updated only my submission");
  assert.deepEqual((await rows("presentation_scores")).find(row => row.id === own.id), committedScore);
  await discard(editor);
  checks.push("An author edit with a lost acknowledgement preserves the committed score; retry keeps the draft and cannot create another revision");
  submitted = (await rows("presentation_scores")).filter(row => row.offering_id === offeringIds[0]);
  assert.equal(submitted.find(row => row.id === own.id).total_score, 0);
  assert.equal(submitted.find(row => row.id === presentation.id).total_score, 40);
  await navigate(scoring, companionPath);
  const ownRecord = scoring.locator("details").filter({ hasText: "Updated only my submission" }); await ownRecord.locator("summary").click();
  assert.match(await ownRecord.innerText(), /Recorded total\s*0\/50/);
  await scoring.setViewportSize({ width: 820, height: 1180 });
  await ownRecord.getByRole("button", { name: "Edit your score", exact: true }).click();
  editor = scoring.getByRole("dialog", { name: "Edit your presentation", exact: true });
  await editor.getByLabel("Comments", { exact: true }).fill("Preserve concurrent edit draft");
  const existingOption = (await options(teacher)).presentations.find(option => option.id === offeringIds[0]);
  const editCommand = { kind: "presentation", id: own.id, student_id: studentId, offering_id: offeringIds[0], offering_token: existingOption.token, expected_revision: existingOption.ownScore.revision, scores: existingOption.ownScore.scores, time_penalty: 0, comments: "Concurrent winning edit" };
  assert.ok((await admin.rpc("edit_student_presentation_score", { command: editCommand })).error);
  const edits = await Promise.all([teacher.rpc("edit_student_presentation_score", { command: editCommand }), teacher.rpc("edit_student_presentation_score", { command: editCommand })]);
  assert.equal(edits.filter(result => !result.error).length, 1);
  await editor.getByRole("button", { name: "Save record", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "changed or was already saved" }).waitFor();
  assert.equal(await editor.getByLabel("Comments", { exact: true }).inputValue(), "Preserve concurrent edit draft");
  await scoring.screenshot({ path: `${artifacts}/presentation-tablet-stale.png`, style: "nextjs-portal { visibility: hidden; }" });
  await discard(editor);
  const firstOptions = await options();
  const firstInput = { kind: "presentation", id: randomUUID(), student_id: studentId, offering_id: offeringIds[1], offering_token: firstOptions.presentations.find(option => option.id === offeringIds[1]).token, occurred_on: evidenceDates[2], presentation_type: "case_presentation", duration_minutes: 15, scores: presentation.scores, time_penalty: 2, comments: "Same-day second module" };
  const firstAttempts = await Promise.all([admin.rpc("create_student_teaching_record", { command: firstInput }), teacher.rpc("create_student_teaching_record", { command: { ...firstInput, id: randomUUID() } })]);
  assert.equal(firstAttempts.filter(result => !result.error).length, 1);
  const secondClient = firstAttempts[0].error ? admin : teacher;
  const nextOption = (await options(secondClient)).presentations.find(option => option.id === offeringIds[1]);
  const secondInput = { ...firstInput, id: randomUUID(), offering_token: nextOption.token };
  assert.equal((await secondClient.rpc("create_student_teaching_record", { command: secondInput })).error, null);
  const duplicates = await Promise.all([secondClient.rpc("create_student_teaching_record", { command: secondInput }), secondClient.rpc("create_student_teaching_record", { command: { ...secondInput, id: randomUUID() } })]);
  assert.ok(duplicates.every(result => !result.error && result.data.status === "duplicate"));
  const allPresentations = await rows("presentation_scores");
  assert.equal(allPresentations.length, 4); assert.equal(new Set(allPresentations.map(row => row.event_id)).size, 2); assert.ok(allPresentations.every(row => row.occurred_on === evidenceDates[2]));
  await navigate(scoring, companionPath);
  assert.equal(await scoring.getByRole("button", { name: "Add encounter", exact: true }).count(), 0);
  assert.equal(await scoring.getByRole("button", { name: "Edit your score", exact: true, includeHidden: true }).count(), 2);
  await requestSettlers.get(scoring)(); await scoring.close();
  checks.push("Passed existing presentations accept a second assessor; touch penalty and own-score editing round-trip in both profiles, retaining other authors and zero totals");
  checks.push("Real PostgreSQL concurrent first assessors, duplicate retries and concurrent author edits serialize safely; stale UI drafts survive; two modules on the same date remain distinct");
  await requestSettlers.get(page)();
  assert.deepEqual(errors, []);
  if (process.argv[3] === "--companion") writeFileSync(".context/student-teaching-review/companion-latest.json", JSON.stringify({ artifacts, url: companionPath }, null, 2));
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ checks, errors, browser: browser.browserType().name(), mode: "shadow", studentId }, null, 2));
  writeFileSync(".context/student-teaching-review/latest.json", JSON.stringify({ artifacts, url: `${base}${path}` }, null, 2));
  process.stdout.write(`${checks.length} teaching browser groups passed. Review: ${base}${path}\nEvidence: ${artifacts}\n`);
} catch (error) { writeFileSync(`${artifacts}/failure.json`, JSON.stringify({ checks, errors, errorDetails }, null, 2)); await screenshot("failure").catch(() => {}); process.stderr.write(`Synthetic fixture retained: ${artifacts}\n`); throw error; }
finally { await browser.close(); await admin.auth.signOut({ scope: "local" }); await teacher.auth.signOut({ scope: "local" }); }
