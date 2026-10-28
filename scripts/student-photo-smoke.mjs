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
const service = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const admin = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
const teacher = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
assert.equal((await admin.auth.signInWithPassword({ email: credentials.adminEmail, password: credentials.password })).error, null);
assert.equal((await teacher.auth.signInWithPassword({ email: credentials.teacherEmail, password: credentials.password })).error, null);
const fixtureId = randomUUID(); const studentId = `69000000${randomUUID().slice(8)}`;
const artifacts = `.context/student-photo-review/${fixtureId}`; mkdirSync(artifacts, { recursive: true });
const name = `Photo Review ${fixtureId.slice(0,8)}`;
assert.equal((await service.from("students").insert({ id: studentId, temporary_id: `PHOTO-${studentId}`, first_name: "Photo", last_name: `Review ${fixtureId.slice(0,8)}`, email: `${studentId}@example.test`, programme: "pgcert", status: "active", admission_stage: "accepted" })).error, null);
async function student() { const result = await admin.from("students").select("*").eq("id",studentId).single(); assert.equal(result.error,null); return result.data; }
const original = await student();
const base = "http://127.0.0.1:3100"; const path = `/students/${studentId}?tab=overview`;
writeFileSync(`${artifacts}/fixture.json`, JSON.stringify({ fixtureId, studentId, url: `${base}${path}`, synthetic: true }, null, 2));
const browser = await browserType.launch(); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" }); const page = await context.newPage();
page.setDefaultTimeout(15000); const checks = []; const errors = []; const errorDetails = [];
page.on("pageerror", error => { errors.push(error.message); errorDetails.push({ completedGroups: checks.length, message: error.message, stack: error.stack }); });
const fixturePage = await browser.newPage({ viewport: { width: 240, height: 240 } });
const images = [];
for (const [index,color] of ["#315f49","#34557a"].entries()) {
  await fixturePage.setContent(`<div style="position:fixed;inset:0;background:${color};color:white;display:grid;place-content:center;text-align:center;font:36px sans-serif">TEST ${index+1}<small style="font-size:14px">Synthetic photo</small></div>`);
  images.push(await fixturePage.screenshot({ path: `${artifacts}/synthetic-${index+1}.png` }));
}
await fixturePage.close();
const file = index => ({ name: `synthetic-${index+1}.png`, mimeType: "image/png", buffer: images[index] });
const screenshot = name => page.screenshot({ path: `${artifacts}/${name}.png`, style: "nextjs-portal { visibility: hidden; }" });
async function login(target,email) {
  await target.goto(`${base}/login?next=${encodeURIComponent(path)}`); await target.getByLabel("Email",{ exact: true }).fill(email); await target.getByLabel("Password",{ exact: true }).fill(credentials.password);
  await target.getByRole("button",{ name: "Sign in",exact: true }).click(); await target.waitForURL(`${base}${path}`);
}
async function open() { await page.getByRole("button",{ name: "Manage photo",exact: true }).first().click(); const editor = page.getByRole("dialog",{ name: "Manage profile photo",exact: true }); await editor.waitFor(); return editor; }
async function choose(editor,index) { await editor.getByLabel("Choose photo (PNG, JPG or WEBP)",{ exact: true }).setInputFiles(file(index)); await editor.getByRole("button",{ name: "Save photo",exact: true }).waitFor(); await page.waitForFunction(() => !document.querySelector('dialog button[type="submit"]').disabled); }
async function save(editor,remove = false) {
  const response = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/students/${studentId}`);
  const refresh = page.waitForResponse(response => response.request().method() === "GET" && response.request().headers().rsc === "1" && new URL(response.url()).pathname === `/students/${studentId}`);
  await editor.getByRole("button",{ name: remove ? "Remove photo" : "Save photo",exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(await (await response).finished(), null);
  assert.equal(await (await refresh).finished(), null);
}
async function discard(editor) { await editor.getByRole("button",{ name: "Cancel",exact: true }).click(); await editor.getByRole("button",{ name: "Discard changes",exact: true }).click(); await editor.waitFor({ state: "detached" }); }
async function served(index,target = page) {
  const response = await target.request.get(`${base}/api/students/${studentId}/photo`); assert.equal(response.status(),200); assert.deepEqual(await response.body(),images[index]); assert.equal(response.headers()["cache-control"],"private, no-store"); assert.equal(response.headers()["x-content-type-options"],"nosniff");
}
try {
  await login(page,credentials.adminEmail);
  let editor = await open(); await choose(editor,0); assert.equal((await student()).photo_path,null); await screenshot("photo-upload-editor"); await save(editor);
  const first = await student(); assert.ok(first.photo_path.startsWith(`${studentId}/workspace/`)); assert.equal(first.profile_revision,1); await served(0);
  await page.reload(); const avatar = page.getByRole("button",{ name: `View ${name} profile photo`,exact: true }).last(); await avatar.getByRole("img").waitFor(); await avatar.click();
  const expanded = page.getByRole("button",{ name: "Close profile photo",exact: true }); await expanded.getByRole("img").waitFor(); await screenshot("photo-expanded"); await expanded.click();
  checks.push("Real private PNG upload saves only on confirmation, persists after reload and still enlarges from the avatar");

  editor = await open(); await choose(editor,1); await save(editor); const second = await student(); assert.notEqual(second.photo_path,first.photo_path); await served(1);
  assert.ok((await admin.storage.from("student-photos").download(first.photo_path)).error); await page.reload(); await served(1);
  assert.ok((await page.getByRole("button",{ name: `View ${name} profile photo`,exact: true }).last().getByRole("img").getAttribute("src")).includes(`v=${second.profile_revision}`));
  checks.push("Replacement uses a new object, immediately refreshes the thumbnail and private response, and cleans the unreferenced prior object");

  editor = await open(); await editor.getByLabel("Choose photo (PNG, JPG or WEBP)",{ exact: true }).setInputFiles({ name: "bad.svg",mimeType: "image/svg+xml",buffer: Buffer.from("<svg/>") });
  await editor.getByRole("alert").filter({ hasText: "PNG, JPG, or WEBP" }).waitFor(); assert.equal(await editor.getByRole("button",{ name: "Save photo",exact: true }).isDisabled(),true);
  await editor.getByLabel("Choose photo (PNG, JPG or WEBP)",{ exact: true }).setInputFiles({ name: "large.png",mimeType: "image/png",buffer: Buffer.alloc(10*1024*1024+1) });
  await editor.getByRole("alert").filter({ hasText: "10MB" }).waitFor(); assert.equal((await student()).photo_path,second.photo_path); await discard(editor);
  checks.push("Unsupported and oversized images are rejected without altering the saved photo");

  editor = await open(); await choose(editor,0); await editor.getByRole("button",{ name: "Cancel",exact: true }).click(); await editor.getByRole("button",{ name: "Keep editing",exact: true }).click();
  assert.equal(await editor.getByRole("img",{ name: "Selected photo preview",exact: true }).count(),1);
  assert.equal(await page.evaluate(() => { const event = new Event("beforeunload",{ cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }),true);
  await discard(editor); assert.equal((await student()).photo_path,second.photo_path);
  checks.push("Keep editing retains the file/preview; discard and native unload guards protect unsaved selections");

  editor = await open(); await choose(editor,1);
  const legacy = await context.newPage(); await legacy.goto(`${base}/students/${studentId}?view=legacy&mode=edit`);
  await legacy.locator('input[name="photo"]').setInputFiles(file(0)); await legacy.getByRole("button",{ name: "Replace photo",exact: true }).click(); await legacy.waitForURL(`${base}/students/${studentId}?mode=edit`);
  await page.bringToFront(); await editor.getByRole("button",{ name: "Save photo",exact: true }).click(); await editor.getByRole("alert").filter({ hasText: "Student or photo changed" }).waitFor();
  assert.equal(await editor.getByRole("img",{ name: "Selected photo preview",exact: true }).count(),1); await served(0); await discard(editor); await legacy.close();
  editor = await open(); assert.equal(await editor.getByRole("img",{ name: "Current profile photo",exact: true }).count(),1); await editor.getByRole("button",{ name: "Cancel",exact: true }).click();
  checks.push("Legacy replacement uses the same audited safe save; an older workspace draft fails without upload or overwrite and reopens fresh");

  const teacherPage = await browser.newPage(); await login(teacherPage,credentials.teacherEmail); assert.equal(await teacherPage.getByRole("button",{ name: "Manage photo",exact: true }).count(),0); await served(0,teacherPage);
  assert.ok((await teacher.rpc("read_student_photo_workspace",{ student_key: studentId })).error);
  assert.ok((await teacher.rpc("save_student_photo",{ student_key: studentId,expected_revision: (await student()).profile_revision,object_path: null,removal_confirmed: true })).error);
  assert.ok((await teacher.storage.from("student-photos").upload(`${studentId}/teacher.png`,images[0],{ contentType: "image/png" })).error);
  const anonymous = await browser.newPage(); const response = await anonymous.request.get(`${base}/api/students/${studentId}/photo`); assert.ok(!response.headers()["content-type"]?.startsWith("image/"));
  const privatePath = (await student()).photo_path; const publicResponse = await fetch(`${settings.API_URL}/storage/v1/object/public/student-photos/${privatePath}`); assert.notEqual(publicResponse.status,200);
  await anonymous.close(); await teacherPage.close(); checks.push("Teachers may view but not mutate; anonymous application/public-storage access cannot fetch the private image");

  await page.setViewportSize({ width: 390,height: 844 }); editor = await open(); assert.equal(await editor.getByRole("button",{ name: "Save photo",exact: true }).isDisabled(),true);
  await editor.getByRole("checkbox",{ name: "Remove current photo and use initials instead",exact: true }).check(); await screenshot("photo-mobile-removal"); await save(editor,true);
  assert.equal((await student()).photo_path,null); assert.ok((await admin.storage.from("student-photos").download(privatePath)).error);
  const missing = await page.request.get(`${base}/api/students/${studentId}/photo?v=1`); assert.equal(missing.status(),404); assert.equal(missing.headers()["cache-control"],"private, no-store");
  await page.reload(); assert.equal(await page.getByRole("button",{ name: `View ${name} profile photo`,exact: true }).last().getByRole("img").count(),0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true);
  checks.push("Deliberate mobile removal clears the reference, deletes the unreferenced file and shows initials, including after reload and old URL requests");

  editor = await open(); await choose(editor,0); await save(editor); await page.setViewportSize({ width: 1440,height: 1000 }); await page.reload(); await served(0);
  const saved = await student(); const { photo_path: originalPath,profile_revision: originalRevision,...originalDetails } = original; const { photo_path: finalPath,profile_revision: finalRevision,...finalDetails } = saved;
  assert.equal(originalPath,null); assert.equal(originalRevision,0); assert.ok(finalPath); assert.equal(finalRevision,5); assert.deepEqual(finalDetails,originalDetails);
  const audits = await admin.from("audit_events").select("actor_user_id,metadata").eq("entity_id",studentId).eq("action","save_student_photo"); assert.equal(audits.error,null); assert.equal(audits.data.length,5); assert.ok(audits.data.some(audit => audit.metadata.after_path === null));
  assert.deepEqual(errors,[]); await screenshot("photo-workspace"); checks.push("Re-upload after removal works; all five changes are audited and no identity/lifecycle/contact fields change");
  writeFileSync(`${artifacts}/results.json`,JSON.stringify({ browser: browserName,browserVersion: browser.version(),checks,errors,url: `${base}${path}`,synthetic: true },null,2));
  writeFileSync(".context/student-photo-review/latest.json",JSON.stringify({ artifacts,url: `${base}${path}`,checks: checks.length },null,2));
  console.log(JSON.stringify({ artifacts,url: `${base}${path}`,checks: checks.length,errors },null,2));
} catch (error) { writeFileSync(`${artifacts}/failure-errors.json`, JSON.stringify(errorDetails, null, 2)); await screenshot("failure"); throw error; }
finally { await browser.close(); }
