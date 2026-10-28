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
const client = key => createClient(settings.API_URL, key, { auth: { persistSession: false } });
const service = client(settings.SERVICE_ROLE_KEY);
const admin = client(settings.ANON_KEY);
const teacher = client(settings.ANON_KEY);
const reception = client(settings.ANON_KEY);
const adminLogin = await admin.auth.signInWithPassword({ email: credentials.adminEmail, password: credentials.password });
const teacherLogin = await teacher.auth.signInWithPassword({ email: credentials.teacherEmail, password: credentials.password });
assert.equal(adminLogin.error, null); assert.equal(teacherLogin.error, null);
const fixtureId = randomUUID(); const token = fixtureId.slice(0, 8);
const artifacts = `.context/student-journey-review/${fixtureId}`;
mkdirSync(artifacts, { recursive: true });
const base = "http://127.0.0.1:3100";
const today = new Date().toISOString().slice(0, 10);
const checks = []; const errors = []; const errorDetails = [];
const moduleId = randomUUID(); const offeringId = randomUUID(); const laterTermId = randomUUID();
const moduleTitle = `Connected practical ${token}`;
const location = `Synthetic journey room ${token}`;
let studentId; let peerId; let enrolmentId; let receptionId; let sessionId;
const receptionEmail = `journey-reception-${fixtureId}@example.test`;
const receptionPassword = `${randomUUID()}Aa1!`;
const terms = await admin.from("terms").select("id,name,starts_on,ends_on").eq("status", "active").single();
assert.equal(terms.error, null, "An existing synthetic active term is required; never change term status for this test.");
const term = terms.data;
assert.ok(term.ends_on < today, "The existing synthetic term must have ended to exercise final compliance failures.");
const sessionTimes = await admin.from("attendance_sessions").select("starts_at").eq("session_date", today);
assert.equal(sessionTimes.error, null);
const usedTimes = new Set(sessionTimes.data.map(row => row.starts_at.slice(0, 5)));
const startsAt = Array.from({ length: 600 }, (_, index) => `${String(8 + Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}`).find(time => !usedTimes.has(time));
assert.ok(startsAt, "No unused synthetic reception session slot is available today.");
const browser = await browserType.launch();
async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => {
    errors.push(error.message);
    errorDetails.push({ completedGroups: checks.length, url: page.url(), message: error.message, stack: error.stack });
  });
  return page;
}
const page = await newPage(); const teacherPage = await newPage(); const receptionPage = await newPage();
async function insert(table, values) { const result = await service.from(table).insert(values); assert.equal(result.error, null); }
async function rpc(name, args, actor = admin) { const result = await actor.rpc(name, args); assert.equal(result.error, null); return result.data; }
const evaluate = () => rpc("read_enrolment_assessment", { enrolment_key: enrolmentId });
const path = (tab, student = studentId) => `/students/${student}?tab=${tab}&term=${term.id}`;
async function login(target, email, password, next) {
  await target.goto(`${base}/login?next=${encodeURIComponent(next)}`);
  await target.getByLabel("Email", { exact: true }).fill(email);
  await target.getByLabel("Password", { exact: true }).fill(password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click();
  await target.waitForURL(`${base}${next}`);
}
async function save(editor, button = "Save changes") {
  const reason = editor.getByLabel("Reason", { exact: true });
  if (await reason.count()) await reason.fill("Synthetic connected workflow acceptance");
  const target = editor.page();
  const pathname = new URL(target.url()).pathname;
  const response = target.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === pathname);
  const refresh = target.waitForResponse(response => response.request().method() === "GET" && response.request().headers().rsc === "1" && new URL(response.url()).pathname === pathname);
  await editor.getByRole("button", { name: button, exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(await (await response).finished(), null);
  assert.equal(await (await refresh).finished(), null);
}
async function createStudent(firstName) {
  await page.goto(`${base}/students?q=${token}`);
  await page.getByRole("button", { name: "Add student / prospect", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add student or prospect", exact: true });
  await editor.getByLabel("First name", { exact: true }).fill(firstName);
  await editor.getByLabel("Last name", { exact: true }).fill(`Journey ${token}`);
  await editor.getByLabel("Email", { exact: true }).fill(`${firstName.toLowerCase()}-${fixtureId}@example.test`);
  await editor.getByRole("combobox", { name: "Student status", exact: true }).selectOption("active");
  await editor.getByRole("combobox", { name: "Admission stage", exact: true }).selectOption("accepted");
  await editor.getByRole("combobox", { name: "Start term", exact: true }).selectOption(term.id);
  await editor.getByRole("button", { name: "Create student", exact: true }).click();
  await page.waitForURL(url => /^\/students\/[0-9a-f-]{36}$/.test(url.pathname));
  await page.getByRole("heading", { name: `${firstName} Journey ${token}`, exact: true, level: 1 }).waitFor();
  return new URL(page.url()).pathname.split("/").at(-1);
}
async function enrol(student) {
  await page.goto(`${base}${path("modules", student)}`);
  await page.getByRole("button", { name: "Add enrolment", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add enrolment", exact: true });
  await editor.getByRole("combobox", { name: "Teaching offering / cohort", exact: true }).selectOption(offeringId);
  await save(editor);
  const result = await admin.from("active_module_enrolments").select("id,assessment_plan_id").eq("student_id", student).eq("offering_id", offeringId).single();
  assert.equal(result.error, null); assert.ok(result.data.assessment_plan_id); return result.data.id;
}
async function attendance(student = studentId) { return rpc("read_student_attendance", { student_key: student }); }
async function editAttendance() {
  await page.getByRole("button", { name: `Edit attendance for ${today} at ${startsAt}`, exact: true }).click();
  return page.getByRole("dialog", { name: "Edit attendance", exact: true });
}
async function screenshot(name, target = page) {
  await target.screenshot({ path: `${artifacts}/${name}.png`, style: "nextjs-portal { visibility: hidden; }" });
}
async function details(target = page) {
  await target.getByRole("button", { name: new RegExp(`^View results for ${moduleTitle}(?: —|$)`) }).click();
  return target.getByRole("dialog", { name: moduleTitle, exact: true });
}
async function recordScore(component, score, resit = false) {
  await page.goto(`${base}${path("modules")}`);
  const result = await details();
  const tile = result.locator("section").filter({ has: page.getByRole("heading", { name: component, exact: true }) });
  await tile.getByRole("button", { name: resit ? "Record resit" : "Record result", exact: true }).click();
  const editor = page.getByRole("dialog", { name: resit ? "Record resit" : "Record result", exact: true });
  await editor.getByLabel(component === "Theory" ? "MCQ score (%)" : "Practical score (%)", { exact: true }).fill(String(score));
  await editor.getByLabel("Sitting date", { exact: true }).fill(resit ? today : term.ends_on);
  await editor.getByRole("combobox", { name: "Sitting term", exact: true }).selectOption(resit ? laterTermId : term.id);
  await save(editor);
}
async function verifyHistory(target = page) {
  const result = await details(target);
  await result.getByRole("button", { name: "Result history (3)", exact: true }).click();
  const history = result.getByRole("region", { name: "Result history", exact: true });
  assert.equal(await history.locator("ol > li").count(), 3);
  for (const text of ["30% · Failed", "70% · Passed", "80% · Passed"]) assert.ok((await history.innerText()).includes(text), text);
  await result.getByRole("button", { name: "Close result details", exact: true }).click();
}
try {
  await insert("terms", { id: laterTermId, name: `Journey later sitting ${token}`, starts_on: new Date(new Date(`${term.ends_on}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10), ends_on: today, status: "closed" });
  await insert("course_modules", { id: moduleId, code: `JOURNEY-${fixtureId}`, title: moduleTitle, mode: "practical", credits: 10 });
  await rpc("save_module_assessment_plan", { input: { module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, practical_pass_mark: 50, reason: "Synthetic connected workflow course configuration" }, expected_plan_id: null });
  await insert("module_offerings", { id: offeringId, module_id: moduleId, term_id: term.id, price_pence: 123456, capacity: 10, attendance_days_required_first_practical: 1, attendance_days_required_subsequent_practical: 1, presentation_required: true });
  const createdReception = await service.auth.admin.createUser({ email: receptionEmail, password: receptionPassword, email_confirm: true });
  assert.equal(createdReception.error, null); receptionId = createdReception.data.user.id;
  await service.from("staff_profiles").upsert({ id: receptionId, full_name: `Synthetic journey reception ${token}`, role: "reception", active: true }).then(result => assert.equal(result.error, null));
  assert.equal((await reception.auth.signInWithPassword({ email: receptionEmail, password: receptionPassword })).error, null);
  await login(page, credentials.adminEmail, credentials.password, "/students");
  studentId = await createStudent("Connected"); peerId = await createStudent("Peer");
  enrolmentId = await enrol(studentId); const peerEnrolmentId = await enrol(peerId);
  assert.equal((await evaluate()).components.theory.attempt_count, 0);
  const initialFinance = await admin.from("finance_records").select("id").in("student_id", [studentId, peerId]);
  assert.equal(initialFinance.error, null); assert.equal(initialFinance.data.length, 0);
  writeFileSync(`${artifacts}/fixture.json`, JSON.stringify({ fixtureId, studentId, peerId, enrolmentId, peerEnrolmentId, moduleId, offeringId, termId: term.id, laterTermId, receptionId, synthetic: true }, null, 2));
  checks.push("Two students are created and enrolled through the UI with inherited plans and no implicit scores or finance records");

  await page.goto(`${base}${path("attendance")}`);
  await page.getByRole("button", { name: "Add session to this term", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "Add session to this term", exact: true });
  await editor.getByLabel("Date", { exact: true }).fill(today);
  await editor.getByLabel("Start time", { exact: true }).fill(startsAt);
  await editor.getByLabel("End time", { exact: true }).fill("20:00");
  await editor.getByLabel("Location", { exact: true }).fill(location); await save(editor);
  const session = (await attendance()).find(row => row.location === location); assert.ok(session); sessionId = session.id;
  assert.equal((await attendance(peerId)).find(row => row.id === sessionId).status, "not_recorded");
  editor = await editAttendance(); await editor.getByRole("combobox", { name: "Attendance status", exact: true }).selectOption("expected"); await save(editor);
  editor = await editAttendance();
  await editor.getByRole("combobox", { name: "Attendance status", exact: true }).selectOption("attended");
  await editor.getByLabel("Attendance note", { exact: true }).fill("Draft held while reception checks in");
  await editor.getByLabel("Reason", { exact: true }).fill("Synthetic concurrent attendance draft");
  await login(receptionPage, receptionEmail, receptionPassword, "/reception");
  await receptionPage.getByRole("heading", { name: "BETAR Check-in", exact: true }).waitFor();
  const sessionSelector = receptionPage.getByRole("button", { name: session.startsAt, exact: true });
  if (await sessionSelector.count()) await sessionSelector.click();
  await receptionPage.getByText(location, { exact: true }).waitFor();
  const studentButton = receptionPage.getByRole("button").filter({ hasText: `Connected Journey ${token}` });
  await studentButton.click(); await studentButton.getByText("Check out", { exact: true }).waitFor();
  await page.bringToFront(); await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "changed" }).waitFor();
  assert.equal(await editor.getByLabel("Attendance note", { exact: true }).inputValue(), "Draft held while reception checks in");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  const discardedRefresh = page.waitForResponse(response => response.request().method() === "GET" && response.request().headers().rsc === "1" && new URL(response.url()).pathname === `/students/${studentId}`);
  await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(await (await discardedRefresh).finished(), null);
  await receptionPage.bringToFront(); await studentButton.click(); await studentButton.getByText("Complete", { exact: true }).waitFor();
  const checkedOut = (await attendance()).find(row => row.id === sessionId);
  assert.equal(checkedOut.status, "partial"); assert.ok(checkedOut.checkedInAt); assert.ok(checkedOut.checkedOutAt);
  assert.equal((await attendance(peerId)).find(row => row.id === sessionId).status, "not_recorded");
  await screenshot("reception-complete", receptionPage);
  await page.reload(); editor = await editAttendance();
  await editor.getByRole("combobox", { name: "Attendance status", exact: true }).selectOption("attended");
  await editor.getByLabel("Attendance note", { exact: true }).fill("Synthetic paper register correction; retain reception timestamps"); await save(editor);
  const corrected = (await attendance()).find(row => row.id === sessionId);
  assert.equal(corrected.checkedInAt, checkedOut.checkedInAt); assert.equal(corrected.checkedOutAt, checkedOut.checkedOutAt);
  assert.equal((await evaluate()).attendance_actual, 1);
  checks.push("Reception check-in/out rejects a stale administrator draft; early checkout stays partial, reasoned correction retains timestamps and the peer is unchanged");

  await recordScore("Theory", 30); await recordScore("Practical", 80);
  let assessment = await evaluate();
  assert.equal(assessment.effective_status, "Fail"); assert.equal(assessment.awarded_credits, 0);
  assert.equal(assessment.presentation_pending, true); assert.equal(assessment.components.practical.score, 80);
  await login(teacherPage, credentials.teacherEmail, credentials.password, path("teaching"));
  await teacherPage.setViewportSize({ width: 390, height: 844 });
  await teacherPage.getByRole("button", { name: "Add presentation", exact: true }).click();
  editor = teacherPage.getByRole("dialog", { name: "Add presentation", exact: true });
  await editor.getByRole("combobox", { name: "Teaching offering / cohort", exact: true }).selectOption(offeringId);
  await editor.getByLabel("Date", { exact: true }).fill(term.ends_on);
  await editor.getByLabel("Duration (minutes)", { exact: true }).fill("20");
  const rubric = editor.locator('select[name]:not([name="presentationType"])');
  assert.equal(await rubric.count(), 10); for (const score of await rubric.all()) await score.selectOption("4");
  await editor.getByLabel("Comments", { exact: true }).fill(`Teacher presentation evidence ${token}`);
  await screenshot("teacher-mobile-presentation", teacherPage); await save(editor, "Save record");
  await teacherPage.reload(); await teacherPage.getByText(`Teacher presentation evidence ${token}`, { exact: true }).waitFor();
  const presentation = await admin.from("presentation_scores").select("total_score,staff_user_id").eq("student_id", studentId).single();
  assert.equal(presentation.error, null); assert.equal(presentation.data.total_score, 40); assert.equal(presentation.data.staff_user_id, teacherLogin.data.user.id);
  assessment = await evaluate(); assert.equal(assessment.presentation_pending, false); assert.equal(assessment.effective_status, "Fail");
  assert.equal(assessment.components.theory.attempt_count, 1); assert.equal(assessment.components.practical.attempt_count, 1);
  await page.goto(`${base}/staff?studentId=${studentId}`); await page.getByText(`Teacher presentation evidence ${token}`, { exact: true }).waitFor();
  checks.push("A teacher records a mobile presentation with server-owned authorship; specialist teaching shares it and compliance improves without clearing an exam failure");

  await page.goto(`${base}/assessments?student=${studentId}`);
  await page.getByRole("combobox", { name: "Teaching term", exact: true }).selectOption({ label: term.name });
  await page.getByRole("combobox", { name: "Outcome", exact: true }).selectOption("Fail");
  await page.getByRole("button", { name: new RegExp(`^View results for ${moduleTitle}(?: —|$)`) }).waitFor();
  let resultDetails = await details();
  await resultDetails.getByRole("button", { name: "Arrange resit", exact: true }).click();
  editor = page.getByRole("dialog", { name: "Arrange resit", exact: true });
  await editor.getByLabel("When is the resit arranged?", { exact: true }).fill(`Synthetic later sitting ${today}`); await save(editor);
  assert.equal((await evaluate()).components.theory.attempt_count, 1);
  await recordScore("Theory", 70, true);
  assessment = await evaluate();
  assert.equal(assessment.effective_status, "Pass"); assert.equal(assessment.awarded_credits, 10);
  assert.equal(assessment.components.theory.attempt_count, 2); assert.equal(assessment.components.practical.attempt_count, 1);
  assert.equal(assessment.components.practical.score, 80); assert.notEqual(assessment.components.theory.arrangement_state, "active");
  const attempts = await admin.from("assessment_attempt_history").select("component,score,sitting_term_id,enrolment_id").eq("enrolment_id", enrolmentId);
  assert.equal(attempts.error, null); assert.equal(attempts.data.length, 3);
  assert.equal(attempts.data.find(attempt => attempt.component === "theory" && attempt.score === 70).sitting_term_id, laterTermId);
  const enrolments = await admin.from("active_module_enrolments").select("id").eq("student_id", studentId);
  assert.equal(enrolments.error, null); assert.equal(enrolments.data.length, 1);
  await page.reload(); await verifyHistory();
  await screenshot("passed-student-history");
  checks.push("Cross-student queue schedules a later-term resit; passing it retains the failed attempt and passed Practical result, awards ten credits and creates no second enrolment");

  await page.goto(`${base}/assessments?student=${studentId}`);
  await page.getByRole("combobox", { name: "Teaching term", exact: true }).selectOption({ label: term.name });
  await page.getByRole("combobox", { name: "Outcome", exact: true }).selectOption("Fail");
  assert.equal(await page.getByRole("button", { name: /View results for/ }).count(), 0);
  await page.getByRole("combobox", { name: "Outcome", exact: true }).selectOption("Pass"); await verifyHistory();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "View results", exact: true }).count(), 1);
  await page.getByText(`Teaching term: ${term.name}`, { exact: true }).waitFor();
  await screenshot("passed-assessment-board");
  assert.equal(await page.getByRole("combobox", { name: "Teaching term", exact: true }).getByRole("option", { name: `Journey later sitting ${token}`, exact: true }).count(), 0);
  await page.goto(`${base}/students?q=${token}&risk=none`);
  const directoryStudent = page.getByRole("link").filter({ hasText: `Connected Journey ${token}` });
  await directoryStudent.waitFor();
  assert.match(await directoryStudent.locator("xpath=ancestor::tr").innerText(), /10 \/ 60/);
  const peerAssessment = await rpc("read_enrolment_assessment", { enrolment_key: peerEnrolmentId });
  assert.equal(peerAssessment.components.theory.attempt_count, 0); assert.equal(peerAssessment.presentation_pending, true); assert.equal(peerAssessment.attendance_actual, 0);
  checks.push("Profile, assessment table/board and directory agree after reload: resolved failure leaves current risk but history remains in the original teaching term; peer facts stay independent");

  const beforeFinance = await evaluate(); const financeNote = `Private finance evidence ${fixtureId}`;
  await page.goto(`${base}${path("finance")}`);
  await page.getByRole("button", { name: "Add finance record", exact: true }).click();
  editor = page.getByRole("dialog", { name: "Add finance record", exact: true });
  assert.equal(await editor.getByLabel("Expected amount (GBP)", { exact: true }).inputValue(), "1234.56");
  await editor.getByLabel("Invoice amount (GBP)", { exact: true }).fill("1234.56");
  await editor.getByLabel("Paid amount (GBP)", { exact: true }).fill("12.34");
  await editor.getByRole("combobox", { name: "Invoice status", exact: true }).selectOption("sent");
  await editor.getByRole("combobox", { name: "Payment status", exact: true }).selectOption("outstanding");
  await editor.getByLabel("Notes", { exact: true }).fill(financeNote); await save(editor, "Save finance record");
  await page.reload(); await page.getByText(financeNote, { exact: true }).waitFor();
  await page.getByRole("link", { name: "Open finance workspace", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/finance" && url.searchParams.get("student") === studentId && url.searchParams.get("term") === term.id);
  await page.getByText(financeNote, { exact: true }).waitFor();
  await page.getByRole("link", { name: "Return to student finance", exact: true }).click();
  await page.getByRole("region", { name: "Student finance", exact: true }).getByText("£12.34", { exact: true }).waitFor();
  assert.deepEqual(await evaluate(), beforeFinance);
  checks.push("Finance shares the student's original teaching term with the specialist editor, preserves exact amounts and leaves the assessment result untouched");

  await teacherPage.goto(`${base}${path("modules")}`); await verifyHistory(teacherPage);
  resultDetails = await details(teacherPage);
  assert.equal(await resultDetails.getByRole("button", { name: "Exceptional decision", exact: true }).count(), 0);
  assert.equal(await resultDetails.getByRole("button", { name: /^(Correct result|Record result|Record resit)$/ }).count(), 0);
  await teacherPage.goto(`${base}${path("finance")}`);
  await teacherPage.getByRole("heading", { name: "Modules at a glance", exact: true }).waitFor();
  assert.equal((await teacherPage.content()).includes(financeNote), false);
  assert.match((await teacher.rpc("read_student_finance_workspace", { student_key: studentId })).error?.message ?? "", /administrator/i);
  const override = { type: "SetAssessmentOverride", enrolment_id: enrolmentId, kind: "credits", value: 99, reason: "Synthetic forbidden role probe" };
  assert.ok((await teacher.rpc("execute_assessment_command", { command: override, expected_revision: (await evaluate()).revision })).error);
  for (const target of [path("modules"), path("finance"), "/assessments", "/staff", "/finance"]) {
    await receptionPage.goto(`${base}${target}`); await receptionPage.waitForURL(`${base}/reception`);
    assert.equal((await receptionPage.content()).includes(financeNote), false);
  }
  assert.match((await reception.rpc("read_student_finance_workspace", { student_key: studentId })).error?.message ?? "", /administrator/i);
  assert.match((await reception.rpc("read_student_teaching_options", { student_key: studentId })).error?.message ?? "", /teaching staff/i);
  assert.ok((await reception.rpc("execute_assessment_command", { command: override, expected_revision: (await evaluate()).revision })).error);
  assert.equal((await evaluate()).awarded_credits, 10); assert.equal((await evaluate()).overrides.length, 0);
  checks.push("Teacher reads full results but cannot alter them or see finance; reception stays kiosk-only and direct privileged commands are denied");

  await page.goto(`${base}${path("modules")}`);
  await page.getByRole("button", { name: "Manage enrolment", exact: true }).click();
  editor = page.getByRole("dialog", { name: "Manage enrolment", exact: true });
  await editor.getByRole("combobox", { name: "Module enrolment", exact: true }).selectOption(enrolmentId);
  await editor.getByRole("combobox", { name: "Action", exact: true }).selectOption("cancel");
  assert.equal(await editor.getByRole("button", { name: "Save changes", exact: true }).isDisabled(), true);
  for (const blocker of [/assessment/i, /attendance/i, /finance/i]) assert.match(await editor.innerText(), blocker);
  assert.equal(await editor.getByRole("option", { name: /Remove unused/ }).count(), 0);
  await screenshot("evidenced-cancellation-blocked");
  const cancelledRefresh = page.waitForResponse(response => response.request().method() === "GET" && response.request().headers().rsc === "1" && new URL(response.url()).pathname === `/students/${studentId}`);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(await (await cancelledRefresh).finished(), null);
  const audits = await admin.from("audit_events").select("action,actor_user_id").or(`entity_id.eq.${studentId},entity_id.eq.${enrolmentId},metadata->>student_id.eq.${studentId}`);
  assert.equal(audits.error, null);
  assert.ok(audits.data.some(event => event.action === "create_workspace_student" && event.actor_user_id === adminLogin.data.user.id));
  assert.ok(audits.data.some(event => event.action === "teaching.record_created" && event.actor_user_id === teacherLogin.data.user.id));
  await page.goto(`${base}${path("overview")}`);
  const progress = page.getByRole("button").filter({ hasText: "Module progress" });
  await progress.waitFor();
  assert.match(await progress.innerText(), /1\s*\/\s*1 passed/); assert.match(await progress.innerText(), /10 credits awarded/);
  assert.match(await page.getByRole("button").filter({ hasText: "Attendance records" }).innerText(), /1\s*attended/);
  assert.match(await page.getByRole("button").filter({ hasText: "Recorded balance" }).innerText(), /£1,222\.22/);
  await screenshot("connected-overview");
  checks.push("The evidenced enrolment cannot be cancelled or hard-deleted; administrator and teacher actions retain their own audit authors");

  assert.deepEqual(errors, []);
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ browser: browserName, browserVersion: browser.version(), checks, errors, url: `${base}${path("modules")}`, synthetic: true }, null, 2));
  writeFileSync(".context/student-journey-review/latest.json", JSON.stringify({ artifacts, url: `${base}${path("modules")}`, checks: checks.length }, null, 2));
  console.log(JSON.stringify({ artifacts, url: `${base}${path("modules")}`, checks: checks.length, errors }, null, 2));
} catch (error) {
  writeFileSync(`${artifacts}/failure.json`, JSON.stringify({ completedChecks: checks, errors, errorDetails }, null, 2));
  await screenshot("failure").catch(() => {}); await screenshot("reception-failure", receptionPage).catch(() => {}); throw error;
} finally {
  await browser.close();
  if (receptionId) {
    const deactivated = await service.from("staff_profiles").update({ active: false }).eq("id", receptionId);
    assert.equal(deactivated.error, null, "Deactivate only this run's synthetic reception account.");
  }
}
