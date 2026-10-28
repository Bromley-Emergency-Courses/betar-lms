import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { studentBrowser } from "./student-browser.mjs";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

const credentialsPath = process.argv[2];
const browserType = studentBrowser(process.argv[3]);
const browserName = browserType.name();
if (!credentialsPath) throw new Error("Pass a private JSON credentials file with adminEmail, teacherEmail and password.");
validateLocalProjectConfig(readFileSync("dev/assessment/supabase/config.toml", "utf8"));
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", localContainer], { encoding: "utf8" }).trim(), "true");
const settings = validateLocalSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", "dev/assessment", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
const base = "http://127.0.0.1:3100";
const artifacts = browserName === "chromium" ? ".context/student-workspace-review" : `.context/student-workspace-review/${browserName}`;
mkdirSync(artifacts, { recursive: true });
const client = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
const { error: loginError } = await client.auth.signInWithPassword({ email: credentials.adminEmail, password: credentials.password });
assert.equal(loginError, null, "Synthetic administrator login must succeed");
const { data: students, error: studentError } = await client.from("students").select("id,first_name,last_name,photo_path,profile_revision").order("id");
assert.equal(studentError, null);
const student = students.find(student => student.id === (credentials.studentId ?? "49000000-0000-4000-8000-000000000002"));
assert.ok(student, "Set studentId to an existing synthetic assessment fixture, or retain the original rehearsal student.");
const { data: outcomes, error: outcomeError } = await client.from("assessment_outcomes").select("*").eq("student_id", student.id).order("enrolment_id");
assert.equal(outcomeError, null);
assert.ok(outcomes.length, "The fixture needs module enrolments");
const { data: attempts, error: attemptError } = await client.from("assessment_attempt_history").select("*").in("enrolment_id", outcomes.map(outcome => outcome.enrolment_id));
assert.equal(attemptError, null);
assert.ok(attempts.some(attempt => attempt.sequence > 1), "The fixture needs a historical failure and resit");
const { data: revisions, error: revisionError } = await client.from("assessment_revision_history").select("*").in("attempt_id", attempts.map(attempt => attempt.id));
assert.equal(revisionError, null);
assert.ok(revisions.some(revision => revision.revision > 1), "The fixture needs a correction history");

const browser = await browserType.launch();
const errors = [];
const checks = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
page.setDefaultTimeout(15000);
const studentPath = `/students/${student.id}`;
const studentName = `${student.first_name} ${student.last_name}`;
const screenshot = name => page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: !name.startsWith("mobile-") && name !== "desktop-pinned", style: "nextjs-portal { visibility: hidden; }" });

async function login(target, email, path) {
  await target.goto(`${base}/login?next=${encodeURIComponent(path)}`);
  await target.getByLabel("Email", { exact: true }).fill(email);
  await target.getByLabel("Password", { exact: true }).fill(credentials.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click();
  await target.waitForURL(`${base}${path}`);
}

async function verifyPhoto(trigger) {
  await trigger.click();
  const expanded = page.getByRole("button", { name: "Close profile photo", exact: true });
  await expanded.waitFor();
  if (student.photo_path) {
    const image = expanded.getByRole("img", { name: `${studentName} profile photo`, exact: true });
    assert.equal(await image.getAttribute("src"), `/api/students/${student.id}/photo?v=${student.profile_revision}`);
    await image.evaluate(image => image.decode());
    assert.ok(await image.evaluate(image => image.naturalWidth > 0));
  } else {
    assert.equal((await expanded.innerText()).trim(), `${student.first_name[0]}${student.last_name[0]}`);
  }
  await expanded.click();
  assert.equal(await page.getByRole("button", { name: "Close profile photo", exact: true }).count(), 0);
}

async function verifyHistory(outcome, index) {
  const trigger = page.getByRole("button", { name: /View results for/ }).nth(index);
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Result history/ }).click();
  const entries = dialog.getByRole("region", { name: "Result history", exact: true }).locator("ol > li");
  const expected = attempts.filter(attempt => attempt.enrolment_id === outcome.enrolment_id);
  assert.equal(await entries.count(), expected.length, "Every saved attempt must remain visible");
  for (const attempt of expected) {
    const component = attempt.component === "theory" ? "Theory" : "Practical";
    const label = `${component} · ${attempt.sequence === null ? "Previous result unavailable" : `Attempt ${attempt.sequence}`}`;
    const entry = entries.filter({ has: page.getByText(label, { exact: true }) });
    assert.equal(await entry.count(), 1);
    assert.ok((await entry.innerText()).includes(`${attempt.score}% · ${attempt.passed ? "Passed" : "Failed"}`));
    await entry.locator("summary").filter({ hasText: "Score history" }).click();
    const versions = revisions.filter(revision => revision.attempt_id === attempt.id);
    assert.equal(await entry.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Score history" }) }).locator("article").count(), versions.length);
    for (const version of versions) {
      assert.ok((await entry.innerText()).includes(`Version ${version.revision} · ${version.score}%`));
    }
  }
  if (index === 0) await screenshot("result-history");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.getByRole("button", { name: /View results for/ }).nth(index).evaluate(element => element === document.activeElement), true, "Closing restores keyboard focus");
}

try {
  await login(page, credentials.adminEmail, "/students");
  await page.getByRole("textbox", { name: "Student", exact: true }).fill(student.first_name);
  await page.getByRole("combobox", { name: "Programme", exact: true }).selectOption("pgcert");
  await page.getByRole("link", { name: new RegExp(studentName) }).click();
  await page.getByRole("heading", { name: studentName, exact: true }).waitFor();
  await verifyPhoto(page.getByRole("button", { name: `View ${studentName} profile photo`, exact: true }));
  await screenshot("overview");
  await page.getByRole("link", { name: "Students directory", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Student", exact: true }).inputValue(), student.first_name);
  assert.equal(await page.getByRole("combobox", { name: "Programme", exact: true }).inputValue(), "pgcert");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Student", exact: true }).inputValue(), "");
  checks.push("Directory filters survive student navigation and clear correctly");

  await page.goto(`${base}${studentPath}?tab=modules`);
  await page.getByRole("heading", { name: "Modules & results", exact: true }).waitFor();
  await screenshot("modules");
  for (const [index, outcome] of outcomes.entries()) await verifyHistory(outcome, index);
  await page.reload();
  for (const [index, outcome] of outcomes.entries()) await verifyHistory(outcome, index);
  checks.push(`All ${attempts.length} attempts and ${revisions.length} score versions survive reload`);
  await page.getByRole("button", { name: "Board", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "View results", exact: true }).count(), outcomes.length);
  await screenshot("board");
  checks.push("Table and board use the same saved enrolments");

  await page.goto(`${base}/assessments?student=${student.id}`);
  await page.getByRole("heading", { name: "Assessment records", exact: true }).waitFor();
  for (const [index, outcome] of outcomes.entries()) await verifyHistory(outcome, index);
  checks.push("Cross-student register shows identical attempt and correction history");

  const { data: allOutcomes, error: allOutcomesError } = await client.from("assessment_outcomes").select("enrolment_id,original_cohort,assessment");
  assert.equal(allOutcomesError, null);
  assert.ok(allOutcomes.length < 1000, "The browser fixture must fit within this assertion query's page");
  await page.goto(`${base}/assessments`);
  const termFilter = page.getByRole("combobox", { name: "Teaching term", exact: true });
  const outcomeFilter = page.getByRole("combobox", { name: "Outcome", exact: true });
  assert.equal(await termFilter.inputValue(), "");
  assert.equal(await page.getByRole("button", { name: /View results for/ }).count(), allOutcomes.length);
  const cohorts = [...new Set(allOutcomes.map(outcome => outcome.original_cohort))];
  assert.ok(cohorts.length > 1, "Term filtering needs multiple synthetic teaching terms");
  for (const cohort of cohorts) {
    const cohortOutcomes = allOutcomes.filter(outcome => outcome.original_cohort === cohort);
    await termFilter.selectOption({ label: cohort });
    assert.equal(await page.getByRole("button", { name: /View results for/ }).count(), cohortOutcomes.length);
    await outcomeFilter.selectOption("Fail");
    const failedCount = cohortOutcomes.filter(outcome => outcome.assessment.effective_status === "Fail").length;
    assert.equal(await page.getByRole("button", { name: /View results for/ }).count(), failedCount);
    await page.getByRole("button", { name: "Board", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "View results", exact: true }).count(), failedCount);
    if (failedCount) {
      assert.equal(await page.getByText(`Teaching term: ${cohort}`, { exact: true }).count(), failedCount);
      await screenshot("term-filtered-board");
    }
    await outcomeFilter.selectOption("all");
    assert.equal(await page.getByRole("button", { name: "View results", exact: true }).count(), cohortOutcomes.length);
    await page.getByRole("textbox", { name: "Find a student or module", exact: true }).fill("no-matching-synthetic-student");
    assert.equal(await page.getByRole("button", { name: "View results", exact: true }).count(), 0);
    await page.getByRole("textbox", { name: "Find a student or module", exact: true }).fill("");
    await page.getByRole("button", { name: "Table", exact: true }).click();
  }
  await termFilter.selectOption("");
  assert.equal(await page.getByRole("button", { name: /View results for/ }).count(), allOutcomes.length);
  checks.push("All teaching terms remain available; term, outcome and search filters combine consistently in table and board views");

  await page.setViewportSize({ width: 1440, height: 720 });
  await page.goto(`${base}${studentPath}`);
  await page.getByRole("heading", { name: studentName, exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction(() => document.querySelector('[class*="compactIdentity"]')?.getAttribute("aria-hidden") === "false");
  const desktopHeader = await page.locator('[class*="compactIdentity"]').boundingBox();
  const sectionNavigation = await page.getByRole("navigation", { name: "Student sections", exact: true }).boundingBox();
  assert.ok(sectionNavigation.y >= desktopHeader.y + desktopHeader.height, "Desktop section navigation stays below the compact identity");
  await verifyPhoto(page.locator('[class*="compactIdentity"]').getByRole("button", { name: `View ${studentName} profile photo`, exact: true }));
  await page.locator('[class*="compactIdentity"]').getByRole("button", { name: `View ${studentName} profile photo`, exact: true }).evaluate(button => button.blur());
  await screenshot("desktop-pinned");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => document.querySelector('[class*="compactIdentity"]')?.getAttribute("aria-hidden") === "true");
  checks.push("Desktop identity appears only after the photo/name leave view and section navigation stays reachable");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}${studentPath}`);
  await page.getByRole("heading", { name: studentName, exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "App menu", exact: true }).getAttribute("aria-expanded"), "false");
  await screenshot("mobile-overview");
  await page.getByRole("combobox", { name: "Student section", exact: true }).selectOption("modules");
  await page.getByRole("heading", { name: "Modules & results", exact: true }).waitFor();
  const compact = page.locator('[class*="compactIdentity"]');
  await page.waitForFunction(() => document.querySelector('[class*="compactIdentity"]')?.getAttribute("aria-hidden") === "false");
  assert.ok((await compact.innerText()).includes(studentName));
  await verifyPhoto(compact.getByRole("button", { name: `View ${studentName} profile photo`, exact: true }));
  checks.push("Shared profile photo enlarges and closes from the original, desktop pinned and mobile pinned avatars");
  await compact.getByText("Student actions", { exact: true }).click();
  assert.equal(await compact.getByRole("button", { name: "Edit student details", exact: true }).isVisible(), true);
  await compact.getByText("Student actions", { exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Mobile document must not scroll horizontally");
  await screenshot("mobile-modules");
  await page.getByRole("button", { name: "App menu", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "App menu", exact: true }).evaluate(element => element === document.activeElement), true, "Pointer activation must keep keyboard access within the app menu");
  assert.equal(await page.locator("#workspace-app-navigation").isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "App menu", exact: true }).getAttribute("aria-expanded"), "false");
  checks.push("Mobile app menu, section selector, pinned identity and admin actions work with reduced motion");

  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const path of [`${studentPath}?view=legacy&mode=edit`, `/assessments?view=legacy&mode=edit&student=${student.id}`]) {
    await page.goto(`${base}${path}`);
    await page.getByText(/Manual import matching is disabled/).waitFor();
    assert.equal(await page.getByText("Broaden search to all students", { exact: true }).count(), 0);
    assert.equal(await page.getByText("Match imported result / replace manually", { exact: true }).count(), 0);
    const commands = await page.locator('input[name="command"]').evaluateAll(inputs => inputs.map(input => JSON.parse(input.value).type));
    assert.equal(commands.some(type => ["MatchSourceResult", "UnmatchSourceResult", "ReplaceSourceResult", "VoidSourceResult", "RestoreSourceResult"].includes(type)), false);
    assert.ok(await page.getByRole("link", { name: "Results history in the assessment workspace", exact: true }).isVisible());
  }
  checks.push("Legacy administrator views retain evidence and workspace links without manual matching, reassignment or old source mutation forms");

  const teacherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const teacherPage = await teacherContext.newPage();
  teacherPage.on("pageerror", error => errors.push(error.message));
  await login(teacherPage, credentials.teacherEmail, studentPath);
  await teacherPage.getByRole("heading", { name: studentName, exact: true }).waitFor();
  assert.equal(await teacherPage.getByRole("button", { name: "Edit student details", exact: true }).count(), 0);
  assert.equal(await teacherPage.getByRole("button", { name: "Finance", exact: true }).count(), 0);
  await teacherPage.goto(`${base}${studentPath}?tab=finance`);
  await teacherPage.getByRole("heading", { name: "Modules at a glance", exact: true }).waitFor();
  assert.equal(await teacherPage.getByRole("heading", { name: "Finance", exact: true }).count(), 0);
  await teacherPage.goto(`${base}${studentPath}?tab=modules`);
  await teacherPage.getByRole("button", { name: /View results for/ }).first().click();
  assert.equal(await teacherPage.getByRole("button", { name: "Exceptional decision", exact: true }).count(), 0);
  assert.equal(await teacherPage.getByRole("button", { name: /^(Correct result|Record result|Record resit|Arrange resit)$/ }).count(), 0);
  await teacherContext.close();
  checks.push("Teachers have no finance section or student edit action, including direct section URLs");
  assert.deepEqual(errors, [], "No browser runtime errors");
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ browser: browserName, browserVersion: browser.version(), stage: "read-layout-checkpoint", mode: "shadow", checks, browserErrors: errors, testedStudent: student.id, completeWorkflowAcceptance: false }, null, 2));
  process.stdout.write(`${checks.length} read-only browser check groups passed. Evidence: ${artifacts}\n`);
} catch (error) {
  await screenshot("failure").catch(() => {});
  throw error;
} finally {
  await browser.close();
  await client.auth.signOut({ scope: "local" });
}
