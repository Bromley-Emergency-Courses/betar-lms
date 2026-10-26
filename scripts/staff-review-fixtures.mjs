import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

validateLocalProjectConfig(readFileSync("dev/assessment/supabase/config.toml", "utf8"));
assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", localContainer], { encoding: "utf8" }).trim(), "true");
const settings = validateLocalSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", "dev/assessment", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
const path = ".context/staff-review/cohort.json";
if (existsSync(path)) { console.log(`Existing review cohort retained: ${path}`); process.exit(0); }
const credentials = JSON.parse(readFileSync(process.argv[2], "utf8"));
const client = key => createClient(settings.API_URL, key, { auth: { persistSession: false } });
const service = client(settings.SERVICE_ROLE_KEY), admin = client(settings.ANON_KEY), teacher = client(settings.ANON_KEY);
assert.equal((await admin.auth.signInWithPassword({ email: credentials.adminEmail, password: credentials.password })).error, null);
assert.equal((await teacher.auth.signInWithPassword({ email: credentials.teacherEmail, password: credentials.password })).error, null);
async function insert(table, values) { assert.equal((await service.from(table).insert(values)).error, null); }
async function rpc(client, name, args) { const result = await client.rpc(name, args); assert.equal(result.error, null); return result.data; }
const active = await admin.from("terms").select("id,name").eq("status", "active").single(); assert.equal(active.error, null);
const termId = active.data.id, historyTerm = randomUUID(), suffix = randomUUID().slice(0, 4), cohort = `REVIEW-${suffix}`;
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const date = offset => new Date(new Date(`${today}T12:00:00Z`).getTime() + offset * 86400000).toISOString().slice(0, 10);
await insert("terms", { id: historyTerm, name: `Spring 2024 · ${cohort}`, starts_on: "2024-01-01", ends_on: "2024-05-31", status: "closed" });
const offerings = [], modules = [], definitions = [];
for (const [index, title] of ["Vascular access", "Lung ultrasound", "Ultrasound theory"].entries()) {
  const moduleId = randomUUID(), offeringId = randomUUID(), definitionId = randomUUID();
  await insert("course_modules", { id: moduleId, code: `${["VA", "LU", "TH"][index]}-${suffix}`, title, mode: index === 2 ? "online" : "practical", credits: 10 });
  await rpc(admin, "save_module_assessment_plan", { input: { module_id: moduleId, theory_scheme: "mcq", theory_pass_mark: 50, ...(index < 2 ? { practical_pass_mark: 50 } : {}), reason: "Synthetic staff acceptance examples" }, expected_plan_id: null });
  await insert("module_offerings", { id: offeringId, module_id: moduleId, term_id: termId, price_pence: 0, capacity: 20, presentation_required: index < 2 });
  await insert("assessment_definitions", { id: definitionId, module_id: moduleId, name: "Observed scan", domains: [{ id: "image", label: "Image quality" }, { id: "interpret", label: "Interpretation" }], score_min: 0, score_max: 5, active: true });
  offerings.push(offeringId); modules.push(moduleId); definitions.push(definitionId);
}
const historicalOffering = randomUUID();
await insert("module_offerings", { id: historicalOffering, module_id: modules[2], term_id: historyTerm, price_pence: 0, capacity: 20, presentation_required: false });
const students = [];
async function exam(enrolmentId, component, score, sittingDate = today) {
  const assessment = await rpc(admin, "read_enrolment_assessment", { enrolment_key: enrolmentId });
  await rpc(admin, "execute_assessment_command", { command: { type: "AddManualAttempt", enrolment_id: enrolmentId, component, sitting_date: sittingDate, ...(component === "theory" ? { items: [{ kind: "mcq", score }] } : { score }), reason: "Synthetic staff acceptance example" }, expected_revision: assessment.revision });
}
for (const [index, name] of ["Alex Morgan", "Sam Taylor", "Jordan Ellis"].entries()) {
  const studentId = randomUUID(), enrolments = [];
  await insert("students", { id: studentId, temporary_id: `${cohort}-${index + 1}`, first_name: name.split(" ")[0], last_name: name.split(" ")[1], email: `${studentId}@example.test`, programme: "pgcert", status: "active", admission_stage: "accepted" });
  for (const offeringId of index < 2 ? offerings.slice(0, 2) : [offerings[2], historicalOffering]) {
    const enrolmentId = randomUUID(); await insert("enrolments", { id: enrolmentId, student_id: studentId, offering_id: offeringId, attendance_days_required_override: index === 0 ? 2 : 0 }); enrolments.push(enrolmentId);
  }
  students.push({ id: studentId, name, enrolments });
}
await exam(students[1].enrolments[0], "theory", 35); await exam(students[1].enrolments[0], "practical", 70);
await exam(students[1].enrolments[1], "theory", 75); await exam(students[1].enrolments[1], "practical", 80);
await exam(students[2].enrolments[0], "theory", 76); await exam(students[2].enrolments[1], "theory", 72, "2024-04-01");
const rubric = [...readFileSync("src/lib/presentation-rubric.ts", "utf8").matchAll(/id: "([^"]+)"/g)].map(match => match[1]); assert.equal(rubric.length, 10);
for (const [index, actor] of [teacher, admin].entries()) {
  const options = await rpc(actor, "read_student_teaching_options", { student_key: students[1].id });
  await rpc(actor, "create_student_teaching_record", { command: { id: randomUUID(), student_id: students[1].id, offering_id: offerings[index], offering_token: options.presentations.find(offering => offering.id === offerings[index]).token, kind: "presentation", occurred_on: today, presentation_type: index ? "journal_club" : "case_presentation", duration_minutes: 18, scores: Object.fromEntries(rubric.map(key => [key, 4])), time_penalty: index ? 0 : 3, comments: index ? "Completed presentation: another assessor may score this existing event." : "Good structure; discuss image optimisation next time. Manual time deduction: 3 points." } });
}
const sessions = [randomUUID(), randomUUID(), randomUUID()];
for (const [index, id] of sessions.entries()) await insert("attendance_sessions", { id, term_id: termId, session_date: date(index * 7), starts_at: "09:00", ends_at: "17:00", location: "Staff review teaching room" });
await insert("attendance_records", { student_id: students[0].id, session_id: sessions[0], status: "attended", checked_in_at: new Date().toISOString() });
for (const kind of ["attendance", "presentation", "presentation"]) {
  const options = await rpc(teacher, "read_student_teaching_plans", { student_key: students[0].id });
  const offeringId = kind === "attendance" ? offerings[0] : options.offerings.find(offering => !offering.plannedSessionId).id;
  await rpc(teacher, "save_student_teaching_plan", { command: { studentId: students[0].id, offeringId, token: options.token, kind, sessionId: sessions[1], fromSessionId: null, expected: true } });
}
const options = await rpc(teacher, "read_student_teaching_options", { student_key: students[0].id });
await rpc(teacher, "create_student_teaching_record", { command: { id: randomUUID(), student_id: students[0].id, offering_id: offerings[0], offering_token: options.offerings.find(offering => offering.id === offerings[0]).token, kind: "observation", occurred_on: today, summary: "Practising ultrasound-guided access. Review needle-tip visibility at the next session.", concern_level: "watch" } });
mkdirSync(".context/staff-review", { recursive: true });
writeFileSync(path, JSON.stringify({ synthetic: true, cohort, termId, termName: active.data.name, students, offerings, sessions, definitions, url: `http://127.0.0.1:3100/staff?screen=overview&mode=term&term=${termId}&q=${cohort}` }, null, 2));
console.log(`Created three isolated review students. ${path}`);
await admin.auth.signOut({ scope: "local" }); await teacher.auth.signOut({ scope: "local" });
