import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { studentBrowser } from "./student-browser.mjs";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

if (!process.argv[2]) throw new Error("Pass the private synthetic administrator/teacher credentials JSON.");
validateLocalProjectConfig(readFileSync("dev/assessment/supabase/config.toml", "utf8"));
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", localContainer], { encoding: "utf8" }).trim(), "true");
const settings = validateLocalSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", "dev/assessment", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
const credentials = JSON.parse(readFileSync(process.argv[2], "utf8"));
const client = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
assert.equal((await client.auth.signInWithPassword({ email: credentials.adminEmail, password: credentials.password })).error, null);
const studentId = "49000000-0000-4000-8000-000000000002";
const termId = "49000000-0000-4000-8000-000000000003";
const laterTermId = "49000000-0000-4000-8000-000000000004";
const outcomes = await client.from("assessment_outcomes").select("enrolment_id,module_code,module_title,original_cohort,assessment").eq("student_id", studentId);
assert.equal(outcomes.error, null);
assert.ok(outcomes.data.length >= 4, "Existing synthetic rehearsal fixtures are required; this check never seeds or modifies them.");
const base = "http://127.0.0.1:3100";
const rosterPath = `/staff?mode=term&term=${termId}`;
const profilePath = `${rosterPath}&studentId=${studentId}&q=Synthetic`;
const browserType = studentBrowser(process.argv[3]);
const artifacts = `.context/staff-companion-review/${browserType.name()}`;
mkdirSync(artifacts, { recursive: true });
const browser = await browserType.launch();
const errors = [], checks = [];
const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, reducedMotion: "reduce" });
page.setDefaultTimeout(20000);
page.on("pageerror", error => errors.push(error.message));
async function login(target, email) {
  await target.goto(`${base}/login`);
  await target.getByLabel("Email", { exact: true }).fill(email);
  await target.getByLabel("Password", { exact: true }).fill(credentials.password);
  await target.getByRole("button", { name: "Sign in", exact: true }).click();
  await target.waitForURL(url => url.pathname !== "/login");
}
async function openProfile(target) {
  await target.goto(`${base}${profilePath}`);
  await target.getByRole("heading", { name: "Module enrolments", exact: true }).waitFor();
}
async function checkResults(target) {
  for (const outcome of outcomes.data) {
    const card = target.getByRole("article", { name: `${outcome.module_code} · ${outcome.original_cohort}`, exact: true });
    const assessment = outcome.assessment;
    const reviewed = assessment.plan && !assessment.needs_plan;
    const scores = await card.locator("dd").allTextContents();
    const score = component => assessment.components?.[component]?.score == null ? "Pending" : `${assessment.components[component].score}%`;
    assert.deepEqual(scores, [reviewed ? score("theory") : "Unavailable", reviewed ? assessment.plan.mode === "online" ? "N/A" : score("practical") : "Unavailable"]);
    assert.ok((await card.innerText()).includes(assessment.needs_plan ? "Plan review required" : assessment.effective_status));
  }
}
async function screenshot(name) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${artifacts}/${name}.png`, caret: "initial", style: "nextjs-portal { visibility: hidden; }" });
}
try {
  await page.goto(`${base}${profilePath}`);
  await page.waitForURL(url => url.pathname === "/login");
  checks.push("Unauthenticated companion profile redirects to login.");
  await login(page, credentials.adminEmail);
  const writes = [];
  page.on("request", request => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(request.url()); });
  await openProfile(page);
  await checkResults(page);
  assert.equal(await page.getByRole("button", { name: /edit|add|record|save|cancel enrolment/i }).count(), 0);
  for (const width of [320, 390, 768, 820, 1024, 1180]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1180 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Profile overflows at ${width}px`);
    if ([390, 820].includes(width)) await screenshot(`profile-${width}`);
  }
  await page.getByLabel("Show attendance for term", { exact: true }).selectOption(laterTermId);
  await page.getByRole("button", { name: "Show dates", exact: true }).click();
  await page.waitForURL(url => url.searchParams.get("attendanceTerm") === laterTermId);
  await page.getByRole("link", { name: "Back to students", exact: true }).click();
  await page.getByRole("heading", { name: "Term overview", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("q"), "Synthetic");
  assert.equal(new URL(page.url()).searchParams.get("term"), termId);
  checks.push("Read-only results match canonical projection across original terms and repeated modules; attendance navigation retains roster context.");
  for (const width of [320, 390, 768, 820, 1180]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Register overflows at ${width}px`);
  }
  await screenshot("term-tablet");
  await page.getByRole("link", { name: "By module", exact: true }).click();
  await page.getByRole("heading", { name: "Module overview", exact: true }).waitFor();
  for (const [label, filter] of [["Here today", "here"], ["At risk", "risk"], ["All", "all"]]) {
    await page.getByRole("navigation", { name: "Student filters" }).getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL(url => url.searchParams.get("filter") === filter);
  }
  checks.push("Phone and tablet layouts avoid page overflow; matrix scrolls locally; module/term and quick filters navigate correctly.");
  await page.goto(`${base}/staff?studentId=invalid`);
  await page.getByRole("alert").filter({ hasText: "Teaching records could not be loaded" }).waitFor();
  assert.equal(writes.length, 0, "Companion navigation must not issue writes.");
  checks.push("Invalid profile identifiers fail safely; companion interactions issue no mutation requests.");
  const teacher = await browser.newPage();
  teacher.on("pageerror", error => errors.push(error.message));
  await login(teacher, credentials.teacherEmail);
  await openProfile(teacher);
  await checkResults(teacher);
  assert.equal(await teacher.getByRole("button", { name: /edit|add|record|save/i }).count(), 0);
  await teacher.close();
  checks.push("Teacher can read identical results without result-management controls.");
  await page.goto(`${base}/staff?view=legacy`);
  await page.getByRole("heading", { name: "Staff Teaching", exact: true }).waitFor();
  checks.push("Existing staff workflow remains available.");
  assert.deepEqual(errors, []);
  writeFileSync(`${artifacts}/result.json`, JSON.stringify({ synthetic: true, readOnly: true, checks, errors }, null, 2));
  process.stdout.write(`${checks.join("\n")}\nArtifacts: ${artifacts}\n`);
} finally {
  await browser.close();
  await client.auth.signOut();
}
