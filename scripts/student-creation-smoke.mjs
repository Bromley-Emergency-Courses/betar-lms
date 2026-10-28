import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

if (!process.argv[2]) throw new Error("Pass the private synthetic administrator/teacher credentials JSON.");
validateLocalProjectConfig(readFileSync("dev/assessment/supabase/config.toml","utf8"));
assert.equal(execFileSync("docker",["inspect","--format","{{.State.Running}}",localContainer],{ encoding: "utf8" }).trim(),"true");
const settings = validateLocalSettings(JSON.parse(execFileSync("supabase",["status","--workdir","dev/assessment","--output","json"],{ encoding: "utf8",stdio: ["ignore","pipe","pipe"] })));
const credentials = JSON.parse(readFileSync(process.argv[2],"utf8"));
const service = createClient(settings.API_URL,settings.SERVICE_ROLE_KEY,{ auth: { persistSession: false } });
const admin = createClient(settings.API_URL,settings.ANON_KEY,{ auth: { persistSession: false } });
const teacher = createClient(settings.API_URL,settings.ANON_KEY,{ auth: { persistSession: false } });
assert.equal((await admin.auth.signInWithPassword({ email: credentials.adminEmail,password: credentials.password })).error,null);
assert.equal((await teacher.auth.signInWithPassword({ email: credentials.teacherEmail,password: credentials.password })).error,null);
const fixtureId = randomUUID(); const token = fixtureId.slice(0,8); const termId = randomUUID(); const duplicateId = `69000000${randomUUID().slice(8)}`;
const artifacts = `.context/student-creation-review/${fixtureId}`; mkdirSync(artifacts,{ recursive: true });
assert.equal((await service.from("terms").insert({ id: termId,name: `Creation ${token}`,starts_on: "2025-01-01",ends_on: "2025-05-31",status: "closed" })).error,null);
assert.equal((await service.from("students").insert({ id: duplicateId,temporary_id: `CREATE-DUP-${token}`,first_name: "Existing",last_name: token,email: `${duplicateId}@example.test`,programme: "pgcert" })).error,null);
const base = "http://127.0.0.1:3100";
const directory = `/students?q=${token}&programme=pgcert&status=prospect&admission=interest&credits=none&risk=none&sort=student&direction=desc`;
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440,height: 1000 },reducedMotion: "reduce" }); page.setDefaultTimeout(15000);
const errors = []; const checks = []; const createdIds = []; page.on("pageerror",error => errors.push(error.message));
const screenshot = name => page.screenshot({ path: `${artifacts}/${name}.png`,style: "nextjs-portal { visibility: hidden; }" });
async function login(target,email) {
  await target.goto(`${base}/login?next=${encodeURIComponent(directory)}`); await target.getByLabel("Email",{ exact: true }).fill(email); await target.getByLabel("Password",{ exact: true }).fill(credentials.password);
  await target.getByRole("button",{ name: "Sign in",exact: true }).click(); await target.waitForURL(`${base}${directory}`);
}
async function open() { await page.getByRole("button",{ name: "Add student / prospect",exact: true }).click(); const editor = page.getByRole("dialog",{ name: "Add student or prospect",exact: true }); await editor.waitFor(); return editor; }
async function identity(editor,suffix) {
  await editor.getByLabel("First name",{ exact: true }).fill("Creation"); await editor.getByLabel("Last name",{ exact: true }).fill(`${token} ${suffix}`); await editor.getByLabel("Email",{ exact: true }).fill(`${token}-${suffix}@example.test`);
}
async function create(editor) {
  await editor.getByRole("button",{ name: "Create student",exact: true }).click(); await page.waitForURL(url => /^\/students\/[0-9a-f-]{36}$/.test(url.pathname));
  const id = new URL(page.url()).pathname.split("/").at(-1); createdIds.push(id); return id;
}
async function student(id) { const result = await admin.from("students").select("*").eq("id",id).single(); assert.equal(result.error,null); return result.data; }
async function noRelatedRecords(id) { for (const table of ["enrolments","finance_records","encounter_logs","assessment_attempts","presentation_scores"]) { const result = await admin.from(table).select("id",{ count: "exact" }).eq("student_id",id); assert.equal(result.error,null); assert.equal(result.count,0); } }
async function discard(editor) { await editor.getByRole("button",{ name: "Cancel",exact: true }).click(); await editor.getByRole("button",{ name: "Discard changes",exact: true }).click(); await editor.waitFor({ state: "detached" }); }
try {
  await login(page,credentials.adminEmail); let editor = await open(); await identity(editor,"prospect"); await screenshot("creation-dialog"); const prospectId = await create(editor);
  let saved = await student(prospectId); assert.equal(saved.temporary_id,`BETAR-TMP-${prospectId}`); assert.equal(saved.status,"prospect"); assert.equal(saved.admission_stage,"interest"); assert.equal(saved.start_term_id,null); assert.equal(saved.cccu_student_id,null); assert.equal(saved.phone,null); assert.equal(saved.notes,null); assert.ok(saved.person_id);
  await noRelatedRecords(prospectId); assert.equal(new URL(page.url()).searchParams.get("returnTo"),directory); await page.reload(); await page.getByRole("heading",{ name: `Creation ${token} prospect`,exact: true }).waitFor();
  await page.getByRole("link",{ name: "Students directory",exact: true }).click(); await page.waitForURL(`${base}${directory}`); await page.getByRole("link").filter({ hasText: `Creation ${token} prospect` }).waitFor();
  checks.push("Default prospect creation persists generated identifier, person linkage and null optional fields without enrolments/fees; reload and all directory filters survive return navigation");

  editor = await open(); await identity(editor,"active"); await editor.getByLabel("Temporary ID",{ exact: true }).fill(`MANUAL-${token}`); await editor.getByLabel("CCCU student ID",{ exact: true }).fill(`CCCU-${token}`); await editor.getByLabel("Phone",{ exact: true }).fill("+44 1234 567890");
  await editor.getByRole("combobox",{ name: "Programme",exact: true }).selectOption("microcredential"); await editor.getByRole("combobox",{ name: "Start term",exact: true }).selectOption(termId); await editor.getByRole("combobox",{ name: "Student status",exact: true }).selectOption("active"); await editor.getByRole("combobox",{ name: "Admission stage",exact: true }).selectOption("accepted"); await editor.getByLabel("Notes",{ exact: true }).fill("Manual administrative record; no invitation sent.");
  const activeId = await create(editor); saved = await student(activeId); assert.equal(saved.temporary_id,`MANUAL-${token}`); assert.equal(saved.cccu_student_id,`CCCU-${token}`); assert.equal(saved.phone,"+44 1234 567890"); assert.equal(saved.programme,"microcredential"); assert.equal(saved.start_term_id,termId); assert.equal(saved.status,"active"); assert.equal(saved.admission_stage,"accepted"); assert.equal(saved.notes,"Manual administrative record; no invitation sent."); await noRelatedRecords(activeId);
  checks.push("Every existing manual creation field persists, including explicit IDs, phone, programme, start term, lifecycle, admission stage and notes");

  await page.goto(`${base}${directory}`); editor = await open(); await identity(editor,"duplicate"); await editor.getByLabel("Temporary ID",{ exact: true }).fill(`CREATE-DUP-${token}`);
  await editor.getByRole("button",{ name: "Create student",exact: true }).click(); await editor.getByRole("alert").filter({ hasText: "identifier is already in use" }).waitFor(); assert.equal(await editor.getByLabel("Last name",{ exact: true }).inputValue(),`${token} duplicate`);
  await editor.getByLabel("Temporary ID",{ exact: true }).fill(`RECOVERED-${token}`); const recoveredId = await create(editor); assert.equal((await student(recoveredId)).temporary_id,`RECOVERED-${token}`);
  checks.push("Duplicate identifiers produce readable errors and preserve inputs; correcting the same draft creates exactly one new record");

  await page.goto(`${base}${directory}`); editor = await open(); await identity(editor,"discarded"); await editor.getByRole("button",{ name: "Cancel",exact: true }).click(); await editor.getByRole("button",{ name: "Keep editing",exact: true }).click(); assert.equal(await editor.getByLabel("Last name",{ exact: true }).inputValue(),`${token} discarded`);
  assert.equal(await page.evaluate(() => { const event = new Event("beforeunload",{ cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }),true);
  await discard(editor); assert.equal(page.url(),`${base}${directory}`); assert.equal((await admin.from("students").select("id",{ count: "exact" }).eq("email",`${token}-discarded@example.test`)).count,0);
  checks.push("Keep editing and native unload protect drafts; discard writes nothing and retains the directory query");

  await page.setViewportSize({ width: 390,height: 844 }); await page.goto(`${base}${directory}&mode=add`); editor = page.getByRole("dialog",{ name: "Add student or prospect",exact: true }); await editor.waitFor(); await identity(editor,"mobile"); await screenshot("creation-mobile"); const mobileId = await create(editor);
  assert.equal(new URL(page.url()).searchParams.get("returnTo"),directory); assert.equal((await student(mobileId)).status,"prospect"); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true);
  checks.push("Mobile and existing mode=add deep links use the focused dialog; successful creation removes add mode from preserved return context");

  const teacherPage = await browser.newPage(); await login(teacherPage,credentials.teacherEmail); await teacherPage.goto(`${base}${directory}&mode=add`); assert.equal(await teacherPage.getByRole("button",{ name: "Add student / prospect",exact: true }).count(),0); assert.equal(await teacherPage.getByRole("dialog").count(),0);
  const command = { student_key: randomUUID(),details: { first_name: "Direct",last_name: token,temporary_id: null,cccu_student_id: null,email: `${token}-direct@example.test`,phone: null,programme: "pgcert",start_term_id: null,status: "prospect",admission_stage: "interest",notes: null } };
  assert.ok((await teacher.rpc("create_workspace_student",command)).error); const anonymous = createClient(settings.API_URL,settings.ANON_KEY,{ auth: { persistSession: false } }); assert.ok((await anonymous.rpc("create_workspace_student",command)).error); await teacherPage.close();
  checks.push("Teacher deep links cannot open creation controls and direct teacher/anonymous commands are denied");

  const races = await Promise.all([admin.rpc("create_workspace_student",command),admin.rpc("create_workspace_student",command)]); assert.ok(races.every(result => result.error === null && result.data === command.student_key)); createdIds.push(command.student_key);
  const audit = await admin.from("audit_events").select("id",{ count: "exact" }).eq("entity_id",command.student_key).eq("action","create_workspace_student"); assert.equal(audit.error,null); assert.equal(audit.count,1);
  const before = await student(command.student_key); assert.ok((await admin.rpc("create_workspace_student",{ ...command,details: { ...command.details,last_name: "Changed retry" } })).error); assert.deepEqual(await student(command.student_key),before);
  checks.push("Two concurrent identical Docker commands recover one student and one audit; changing the used request cannot overwrite or duplicate it");

  for (const id of createdIds) { const audit = await admin.from("audit_events").select("id",{ count: "exact" }).eq("entity_id",id).eq("action","create_workspace_student"); assert.equal(audit.error,null); assert.equal(audit.count,1); }
  assert.deepEqual(errors,[]); await page.setViewportSize({ width: 1440,height: 1000 }); await page.goto(`${base}/students/${activeId}?returnTo=${encodeURIComponent(directory)}`); await screenshot("created-student");
  writeFileSync(`${artifacts}/results.json`,JSON.stringify({ checks,errors,createdIds,url: page.url(),synthetic: true },null,2));
  writeFileSync(".context/student-creation-review/latest.json",JSON.stringify({ artifacts,url: page.url(),checks: checks.length },null,2)); console.log(JSON.stringify({ artifacts,url: page.url(),checks: checks.length,errors },null,2));
} catch (error) { await screenshot("failure"); throw error; }
finally { await browser.close(); }
