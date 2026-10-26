import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { studentBrowser } from "./student-browser.mjs";
import { trackPageRequests } from "./student-browser-settle.mjs";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

validateLocalProjectConfig(readFileSync("dev/assessment/supabase/config.toml", "utf8"));
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", localContainer], { encoding: "utf8" }).trim(), "true");
validateLocalSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", "dev/assessment", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
const credentials = JSON.parse(readFileSync(process.argv[2], "utf8"));
const fixture = JSON.parse(readFileSync(".context/staff-review/cohort.json", "utf8"));
assert.equal(fixture.synthetic, true); assert.equal(new URL(fixture.url).origin, "http://127.0.0.1:3100");
const browserType = studentBrowser(process.argv[3]);
const artifacts = `.context/staff-navigation-review/${browserType.name()}`; mkdirSync(artifacts, { recursive: true });
const browser = await browserType.launch(); const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
page.setDefaultTimeout(15000); const settle = trackPageRequests(page), errors = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
const nav = page.getByRole("navigation", { name: "Teaching navigation", exact: true });
const base = "http://127.0.0.1:3100";
async function navigate(url) { await settle(); await page.goto(url); await nav.waitFor(); }
async function destination(label) { await nav.getByRole("link", { name: label, exact: true }).click(); await nav.getByRole("link", { name: label, exact: true }).filter({ has: page.locator('svg') }).waitFor(); }
async function shot(name) { await settle(); await page.screenshot({ path: `${artifacts}/${name}.png` }); }
try {
  await page.goto(`${base}/login?next=${encodeURIComponent(new URL(fixture.url).pathname + new URL(fixture.url).search)}`);
  await page.getByLabel("Email", { exact: true }).fill(credentials.teacherEmail); await page.getByLabel("Password", { exact: true }).fill(credentials.password); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(fixture.url); await nav.waitFor();
  assert.equal(await nav.getByRole("link").count(), 3);
  await destination("Add record"); await page.getByRole("heading", { name: "Choose a student", exact: true }).waitFor();
  await page.getByRole("link", { name: /Alex Morgan/ }).click(); await page.getByRole("heading", { name: "Add teaching record", exact: true }).waitFor();
  await page.getByLabel("Module", { exact: true }).selectOption(fixture.offerings[0]);
  for (const width of [320, 390, 820, 1180]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Entry overflows at ${width}`);
    assert.equal(await page.locator(".sidebar").isVisible(), false);
    assert.ok((await nav.getByRole("link", { name: "Add record", exact: true }).boundingBox()).height >= 44);
    assert.ok((await page.getByLabel("Module", { exact: true }).boundingBox()).height >= 44);
    await shot(`entry-${width}`);
  }
  await page.getByRole("button", { name: "Add encounter", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add observation", exact: true });
  await editor.getByLabel("Observation details", { exact: true }).fill("Unsaved navigation review draft");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await editor.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(await editor.getByLabel("Observation details", { exact: true }).inputValue(), "Unsaved navigation review draft");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click(); await editor.getByRole("button", { name: "Discard changes", exact: true }).click(); await editor.waitFor({ state: "detached" });
  checks.push("Add record starts with a student picker, scopes module actions, fits phone/tablet and reuses dirty-draft protection");
  await destination("Student"); await page.getByRole("heading", { name: "Module enrolments", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("studentId"), fixture.students[0].id);
  await destination("Overview"); await page.getByRole("heading", { name: "Term overview", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("q"), fixture.cohort);
  assert.equal(new URL(page.url()).searchParams.get("studentId"), fixture.students[0].id);
  await destination("Student"); await page.getByRole("heading", { name: "Alex Morgan", exact: true }).waitFor();
  await page.getByRole("link", { name: "Change student", exact: true }).click(); await page.getByRole("heading", { name: "Choose a student", exact: true }).waitFor();
  await page.getByRole("link", { name: /Sam Taylor/ }).click(); await page.getByRole("heading", { name: "Sam Taylor", exact: true }).waitFor();
  await destination("Add record"); await page.getByLabel("Module", { exact: true }).selectOption(fixture.offerings[1]);
  await page.getByRole("button", { name: "Presentation scoring", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Add encounter", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Plan teaching dates", exact: true }).count(), 0);
  await page.getByRole("link", { name: "Change student", exact: true }).click(); await page.getByRole("link", { name: /Jordan Ellis/ }).click();
  await page.getByText(/No eligible active module enrolments/).waitFor();
  await destination("Student"); await page.getByRole("heading", { name: /Spring 2024/ }).waitFor();
  checks.push("Student selection and roster context survive destination changes; Pass allows existing scoring only and historical/completed enrolments stay read-only");
  await page.getByRole("button", { name: "App menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Application", exact: true }).getByRole("link", { name: "Students", exact: true }).waitFor();
  await page.keyboard.press("Escape"); assert.equal(await page.getByRole("button", { name: "App menu", exact: true }).getAttribute("aria-expanded"), "false");
  await navigate(fixture.url); await page.setViewportSize({ width: 820, height: 1180 });
  await page.getByRole("heading", { name: "Term overview", exact: true }).waitFor(); await shot("tablet-overview");
  await page.getByRole("link", { name: /Alex Morgan/ }).click(); await page.getByRole("heading", { name: "Module enrolments", exact: true }).waitFor(); await shot("tablet-student");
  await settle(); assert.deepEqual(errors, []);
  checks.push("Focused shell keeps app navigation/sign-out accessible and preserves existing roster-to-profile links");
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ checks, errors, synthetic: true }, null, 2)); console.log(`${checks.length} navigation groups passed: ${artifacts}`);
} catch (error) { await page.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {}); writeFileSync(`${artifacts}/failure.json`, JSON.stringify({ checks, errors, error: String(error) }, null, 2)); throw error; }
finally { await browser.close(); }
