import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const adminId = randomUUID(); const teacherId = randomUUID(); const receptionId = randomUUID();
let studentId: string; let termId: string; let details: Record<string,unknown>;
async function create(input = details,id = studentId) { return (await db.query<{ id: string }>("select create_workspace_student($1,$2::jsonb) id",[id,JSON.stringify(input)])).rows[0].id; }
async function row() { return (await db.query<Record<string,unknown>>("select * from students where id=$1",[studentId])).rows[0]; }
async function count(table: string) { return (await db.query<{ count: number }>(`select count(*)::int count from ${table}`)).rows[0].count; }
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;`);
  for (const migration of ["0001_betar_lms_schema","0014_persons_foundation","0059_student_profile_editor","0066_student_workspace_creation"]) await db.exec(readFileSync(`supabase/migrations/${migration}.sql`,"utf8").replace('create extension if not exists "pgcrypto";',""));
  await db.exec(`grant usage on schema public,auth to authenticated; insert into auth.users values('${adminId}'),('${teacherId}'),('${receptionId}');
    insert into staff_profiles(id,full_name,role) values('${adminId}','Admin','admin'),('${teacherId}','Teacher','teacher'),('${receptionId}','Reception','reception');`);
},30000);
beforeEach(async () => {
  studentId = randomUUID(); termId = randomUUID(); await db.query("select set_config('test.actor',$1,false)",[adminId]);
  await db.query("insert into terms(id,name,starts_on,ends_on) values($1,$2,'2025-01-01','2025-06-01')",[termId,termId]);
  details = { first_name: " New ",last_name: "Learner",temporary_id: null,cccu_student_id: null,email: "new@example.test",phone: null,programme: "pgcert",start_term_id: null,status: "prospect",admission_stage: "interest",notes: null };
});
afterAll(async () => { await db?.close(); });
describe("atomic student creation", () => {
  it("creates the default prospect and existing person linkage without enrolments or finance", async () => {
    const people = await count("persons"); expect(await create()).toBe(studentId);
    expect(await row()).toMatchObject({ first_name: "New",temporary_id: `BETAR-TMP-${studentId}`,status: "prospect",admission_stage: "interest",photo_path: null,profile_revision: 0 });
    expect(await count("persons")).toBe(people+1); expect(await count("enrolments")).toBe(0); expect(await count("finance_records")).toBe(0);
    const audit = (await db.query<{ actor_user_id: string; metadata: { details: unknown } }>("select * from audit_events where entity_id=$1",[studentId])).rows[0];
    expect(audit.actor_user_id).toBe(adminId); expect(audit.metadata.details).toEqual({ ...details,first_name: "New",temporary_id: `BETAR-TMP-${studentId}` });
  });
  it("preserves all explicit fields, including chosen identifiers and lifecycle metadata", async () => {
    details = { ...details,first_name: "Active",temporary_id: `CUSTOM-${studentId}`,cccu_student_id: `CCCU-${studentId}`,phone: "+44 1234",programme: "microcredential",start_term_id: termId,status: "active",admission_stage: "accepted",notes: "Context" };
    await create(); expect(await row()).toMatchObject(details);
  });
  it("retries an identical command without a second person, student or audit, even after later edits", async () => {
    const people = await count("persons"); await create(); expect(await create()).toBe(studentId);
    await db.query("update students set notes='Later change' where id=$1",[studentId]); expect(await create()).toBe(studentId); expect((await row()).notes).toBe("Later change"); expect(await count("persons")).toBe(people+1);
    expect((await db.query<{ count: number }>("select count(*)::int count from audit_events where entity_id=$1",[studentId])).rows[0].count).toBe(1);
    await expect(create({ ...details,last_name: "Different" })).rejects.toThrow("already used with different details");
    await db.query("delete from students where id=$1",[studentId]); await expect(create()).rejects.toThrow("previously created student was removed");
  });
  it("rejects duplicate identifiers and invalid terms without leaving orphaned people", async () => {
    await create({ ...details,temporary_id: "DUPLICATE",cccu_student_id: "CCCU-DUPLICATE" }); const people = await count("persons");
    await expect(create({ ...details,temporary_id: "DUPLICATE" },randomUUID())).rejects.toThrow("unique");
    await expect(create({ ...details,cccu_student_id: "CCCU-DUPLICATE" },randomUUID())).rejects.toThrow("unique");
    await expect(create({ ...details,start_term_id: randomUUID() },randomUUID())).rejects.toThrow("foreign key"); expect(await count("persons")).toBe(people);
  });
  it("does not silently merge records just because email matches", async () => {
    await create(); const first = await row(); studentId = randomUUID(); await create(); expect((await row()).person_id).not.toBe(first.person_id);
  });
  it.each([{ first_name: " " },{ last_name: 10 },{ temporary_id: "x" },{ email: "invalid" },{ programme: "unknown" },{ status: "Pass" },{ admission_stage: "wrong" },{ notes: false },{ photo_path: "forged" },{ person_id: randomUUID() },{ profile_revision: 5 },{ credits: 60 }])("rejects direct invalid/spoofed fields %j", async changes => {
    await expect(create({ ...details,...changes })).rejects.toThrow(); expect(await row()).toBeUndefined();
  });
  it("rolls back student, person and audit together", async () => {
    const people = await count("persons"); await db.exec("create function fail_creation_audit() returns trigger language plpgsql as $$ begin raise exception 'Audit unavailable'; end; $$; create trigger fail_creation_audit before insert on audit_events for each row execute function fail_creation_audit();");
    try { await expect(create()).rejects.toThrow("Audit unavailable"); } finally { await db.exec("drop trigger fail_creation_audit on audit_events; drop function fail_creation_audit();"); }
    expect(await row()).toBeUndefined(); expect(await count("persons")).toBe(people);
  });
  it.each([teacherId,receptionId,""])("denies non-administrator %s", async actor => { await db.query("select set_config('test.actor',$1,false)",[actor]); await expect(create()).rejects.toThrow("administrator"); });
  it("denies inactive administrators and grants execution only to authenticated roles", async () => {
    await db.query("update staff_profiles set active=false where id=$1",[adminId]); try { await expect(create()).rejects.toThrow("administrator"); } finally { await db.query("update staff_profiles set active=true where id=$1",[adminId]); }
    for (const role of ["anon","authenticated","service_role"]) expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1,'create_workspace_student(uuid,jsonb)','execute') allowed",[role])).rows[0].allowed).toBe(role === "authenticated");
  });
});
