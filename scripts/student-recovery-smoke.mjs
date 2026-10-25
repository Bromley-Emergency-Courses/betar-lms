import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

if (!process.argv[2]) throw new Error("Pass the private synthetic administrator/teacher credentials JSON.");
validateLocalProjectConfig(readFileSync("dev/assessment/supabase/config.toml", "utf8"));
const settings = validateLocalSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", "dev/assessment", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", localContainer], { encoding: "utf8" }).trim(), "true");
const credentials = JSON.parse(readFileSync(process.argv[2], "utf8"));
const admin = createClient(settings.API_URL, settings.ANON_KEY, { auth: { persistSession: false } });
assert.equal((await admin.auth.signInWithPassword({ email: credentials.adminEmail, password: credentials.password })).error, null);
const fixtureId = randomUUID(); const token = fixtureId.replaceAll("-", "");
const artifacts = `.context/student-recovery-review/${fixtureId}`; mkdirSync(artifacts, { recursive: true });
const email = `recovery-${fixtureId}@example.test`;
const fault = `recovery_fault_${token}`;
const sql = input => execFileSync("docker", ["exec", "-i", localContainer, "psql", "-X", "-q", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input, encoding: "utf8" });
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(20000);
const base = "http://127.0.0.1:3100"; const checks = []; const errors = []; let studentId;
page.on("pageerror", error => errors.push(error.message));
async function lostResponse(pathname, committed) {
  const pattern = `${base}${pathname}*`;
  let consumed = false;
  const handler = async route => {
    if (consumed || route.request().method() !== "POST") return route.continue();
    consumed = true;
    if (committed) { const response = await route.fetch(); assert.equal(response.status(), 200); await response.body(); }
    await route.abort("failed");
    await page.unroute(pattern, handler);
  };
  await page.route(pattern, handler);
}
async function student() { const result = await admin.from("students").select("*").eq("id", studentId).single(); assert.equal(result.error, null); return result.data; }
async function objects() { const result = await admin.storage.from("student-photos").list(`${studentId}/workspace`); assert.equal(result.error, null); return result.data; }
async function openPhoto() { await page.getByRole("button", { name: "Manage photo", exact: true }).first().click(); const dialog = page.getByRole("dialog", { name: "Manage profile photo", exact: true }); await dialog.waitFor(); return dialog; }
async function choose(dialog, image) { await dialog.getByLabel("Choose photo (PNG, JPG or WEBP)", { exact: true }).setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: image }); await page.waitForFunction(() => !document.querySelector('dialog button[type="submit"]').disabled); }
async function savePhoto(dialog) {
  const response = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/students/${studentId}`);
  const refresh = page.waitForResponse(response => response.request().method() === "GET" && response.request().headers().rsc === "1" && new URL(response.url()).pathname === `/students/${studentId}`);
  await dialog.getByRole("button", { name: "Save photo", exact: true }).click(); await dialog.waitFor({ state: "detached" });
  assert.equal(await (await response).finished(), null); assert.equal(await (await refresh).finished(), null);
}
async function discard(dialog) { await dialog.getByRole("button", { name: "Cancel", exact: true }).click(); await dialog.getByRole("button", { name: "Discard changes", exact: true }).click(); await dialog.waitFor({ state: "detached" }); }
function removeFaults() {
  sql(`drop trigger if exists ${fault} on public.students; drop trigger if exists ${fault} on storage.objects; drop function if exists public.${fault}();`);
}
function photoFault(kind) {
  removeFaults();
  if (kind === "save") sql(`create function public.${fault}() returns trigger language plpgsql as $$ begin if new.id='${studentId}'::uuid and new.photo_path is distinct from old.photo_path then raise exception 'Synthetic photo save rejected'; end if; return new; end $$;
    create trigger ${fault} before update on public.students for each row execute function public.${fault}();`);
  else sql(`create function public.${fault}() returns trigger language plpgsql as $$ begin if ${kind === "upload" ? "new" : "old"}.bucket_id='student-photos' and ${kind === "upload" ? "new" : "old"}.name like '${studentId}/workspace/%' then raise exception 'Synthetic storage ${kind} rejected'; end if; return ${kind === "upload" ? "new" : "old"}; end $$;
    create trigger ${fault} before ${kind === "upload" ? "insert" : "delete"} on storage.objects for each row execute function public.${fault}();`);
}
try {
  await page.goto(`${base}/login?next=%2Fstudents`); await page.getByLabel("Email", { exact: true }).fill(credentials.adminEmail); await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await page.waitForURL(`${base}/students`);
  await page.getByRole("button", { name: "Add student / prospect", exact: true }).click();
  const creation = page.getByRole("dialog", { name: "Add student or prospect", exact: true });
  await creation.getByLabel("First name", { exact: true }).fill("Recovery"); await creation.getByLabel("Last name", { exact: true }).fill(fixtureId.slice(0, 8)); await creation.getByLabel("Email", { exact: true }).fill(email);
  await lostResponse("/students", false); await creation.getByRole("button", { name: "Create student", exact: true }).click();
  await creation.getByRole("alert").filter({ hasText: "Creation could not be confirmed" }).waitFor();
  let records = await admin.from("students").select("id").eq("email", email); assert.equal(records.error, null); assert.equal(records.data.length, 0);
  assert.equal(await creation.getByLabel("Email", { exact: true }).inputValue(), email);
  checks.push("A dropped creation request writes nothing and keeps the complete draft");
  await lostResponse("/students", true); await creation.getByRole("button", { name: "Create student", exact: true }).click();
  await creation.getByRole("alert").filter({ hasText: "Creation could not be confirmed" }).waitFor();
  records = await admin.from("students").select("id").eq("email", email); assert.equal(records.error, null); assert.equal(records.data.length, 1); studentId = records.data[0].id;
  await creation.getByRole("button", { name: "Create student", exact: true }).click(); await page.waitForURL(url => url.pathname === `/students/${studentId}`);
  await page.getByRole("heading", { name: `Recovery ${fixtureId.slice(0, 8)}`, exact: true }).waitFor();
  const audits = await admin.from("audit_events").select("id").eq("entity_id", studentId).eq("action", "create_workspace_student"); assert.equal(audits.error, null); assert.equal(audits.data.length, 1);
  checks.push("A lost response after committed creation recovers the same student and exactly one audit on unchanged retry");
  const canvas = await browser.newPage({ viewport: { width: 100, height: 100 } }); await canvas.setContent('<div style="background:#34557a;height:100vh">SYNTHETIC</div>'); const image = await canvas.screenshot(); await canvas.close();
  let photo = await openPhoto(); await choose(photo, image);
  photoFault("upload"); await photo.getByRole("button", { name: "Save photo", exact: true }).click(); await photo.getByRole("alert").filter({ hasText: "Photo upload could not be confirmed" }).waitFor();
  assert.equal((await student()).photo_path, null); assert.equal((await objects()).length, 0); assert.equal(await photo.getByRole("img", { name: "Selected photo preview", exact: true }).count(), 1);
  checks.push("Real Storage upload failure preserves the selected file and leaves the student unchanged");
  photoFault("save"); await photo.getByRole("button", { name: "Save photo", exact: true }).click(); await photo.getByRole("alert").filter({ hasText: "Synthetic photo save rejected" }).waitFor();
  assert.equal((await student()).photo_path, null); assert.equal((await objects()).length, 0);
  removeFaults(); await savePhoto(photo); const firstPath = (await student()).photo_path;
  assert.equal((await objects()).length, 1); assert.equal((await admin.storage.from("student-photos").download(firstPath)).error, null);
  checks.push("A real database save rejection cleans its unreferenced upload; retry succeeds without duplicate objects");
  photo = await openPhoto(); await choose(photo, image); photoFault("cleanup"); await savePhoto(photo);
  await page.getByText(/Storage cleanup needs administrator review/).waitFor(); const secondPath = (await student()).photo_path; assert.notEqual(secondPath, firstPath);
  assert.equal((await objects()).length, 2); removeFaults();
  checks.push("Cleanup failure does not undo a committed photo; the old private object is retained with an operator warning");
  photo = await openPhoto(); await choose(photo, image); await lostResponse(`/students/${studentId}`, true);
  await photo.getByRole("button", { name: "Save photo", exact: true }).click(); await photo.getByRole("alert").filter({ hasText: "photo change could not be confirmed" }).waitFor();
  const committed = await student(); assert.notEqual(committed.photo_path, secondPath); assert.equal((await admin.storage.from("student-photos").download(committed.photo_path)).error, null);
  await photo.getByRole("button", { name: "Save photo", exact: true }).click(); await photo.getByRole("alert").filter({ hasText: "Student or photo changed" }).waitFor();
  assert.equal((await student()).photo_path, committed.photo_path); assert.equal((await objects()).length, 2);
  await discard(photo); photo = await openPhoto(); await photo.getByRole("img", { name: "Current profile photo", exact: true }).waitFor();
  await photo.getByRole("button", { name: "Cancel", exact: true }).click();
  checks.push("An ambiguous committed photo response retains the saved object; stale retry cannot duplicate/delete it, and reopening shows the committed photo");
  const photoBackup = await admin.storage.from("student-photos").download(committed.photo_path); assert.equal(photoBackup.error, null);
  const backupBytes = Buffer.from(await photoBackup.data.arrayBuffer()); writeFileSync(`${artifacts}/private-photo-backup.png`, backupBytes);
  const restorePath = `${studentId}/rehearsal-restore/${randomUUID()}.png`;
  assert.equal((await admin.storage.from("student-photos").upload(restorePath, backupBytes, { contentType: "image/png", upsert: false })).error, null);
  const restoredPhoto = await admin.storage.from("student-photos").download(restorePath); assert.equal(restoredPhoto.error, null);
  assert.deepEqual(Buffer.from(await restoredPhoto.data.arrayBuffer()), backupBytes);
  assert.equal((await admin.storage.from("student-photos").remove([restorePath])).error, null);
  assert.equal((await student()).photo_path, committed.photo_path);
  checks.push("Private object backup restores identical bytes to a separate disposable key without changing or deleting the current photo");
  writeFileSync(`${artifacts}/photo-retention.txt`, sql(readFileSync("scripts/student-photo-retention.sql", "utf8")));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${artifacts}/recovered-student.png` });
  writeFileSync(`${artifacts}/results.json`, JSON.stringify({ checks, errors, studentId, retainedUnreferencedObject: firstPath, currentPhoto: committed.photo_path, synthetic: true, faultsRemoved: true }, null, 2));
  writeFileSync(".context/student-recovery-review/latest.json", JSON.stringify({ artifacts, url: `${base}/students/${studentId}`, checks: checks.length }, null, 2));
  console.log(JSON.stringify({ artifacts, checks: checks.length }, null, 2));
} catch (error) { await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true }).catch(() => {}); console.error(`Recovery fixture: ${artifacts}; fault trigger: ${fault}`); throw error; }
finally { try { removeFaults(); } finally { await browser.close(); await admin.auth.signOut({ scope: "local" }); } }
