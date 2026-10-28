import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const adminId = randomUUID();
const teacherId = randomUUID();
const receptionId = randomUUID();
let studentId: string;
let termId: string;
let details: Record<string, unknown>;
async function row() { return (await db.query<Record<string, unknown>>("select * from students where id=$1", [studentId])).rows[0]; }
async function save(input = details, revision: number | null = 0) {
  return db.query("select public.save_student_profile($1,$2,$3::jsonb)", [studentId, revision, JSON.stringify(input)]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;`);
  await db.exec(readFileSync("supabase/migrations/0001_betar_lms_schema.sql", "utf8").replace('create extension if not exists "pgcrypto";', ""));
  await db.exec(readFileSync("supabase/migrations/0059_student_profile_editor.sql", "utf8"));
  await db.exec("create schema storage; create table storage.objects(bucket_id text,name text,metadata jsonb);");
  await db.exec(readFileSync("supabase/migrations/0065_student_photo_workspace.sql", "utf8"));
  await db.exec(`grant usage on schema public, auth to authenticated;
    insert into auth.users values ('${adminId}'),('${teacherId}'),('${receptionId}');
    insert into staff_profiles(id,full_name,role) values ('${adminId}','Admin','admin'),('${teacherId}','Teacher','teacher'),('${receptionId}','Reception','reception');`);
}, 30000);
beforeEach(async () => {
  studentId = randomUUID(); termId = randomUUID();
  await db.query("select set_config('test.actor',$1,false)", [adminId]);
  await db.query("insert into terms(id,name,starts_on,ends_on) values($1,$2,'2025-01-01','2025-05-31')", [termId, termId]);
  await db.query("insert into students(id,temporary_id,first_name,last_name,email,programme,photo_path) values($1,$2,'Original','Student','original@example.test','pgcert','private-photo')", [studentId, studentId]);
  details = { first_name: "Updated", last_name: "Learner", temporary_id: `TMP-${studentId}`, cccu_student_id: `CCCU-${studentId}`, email: "updated@example.test", phone: "+44 1234", programme: "microcredential", start_term_id: termId, status: "interrupted", admission_stage: "accepted", notes: "Reviewed profile" };
});
afterAll(async () => { await db?.close(); });

async function photoPath(metadata: unknown = { mimetype: "image/png", size: 100 }) {
  const path = `${studentId}/workspace/${randomUUID()}.png`;
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('student-photos',$1,$2::jsonb)", [path,JSON.stringify(metadata)]);
  return path;
}
async function savePhoto(path: string | null, revision: number | null = 0, confirmed = false) { return db.query("select save_student_photo($1,$2,$3,$4)", [studentId,revision,path,confirmed]); }
describe("student photo reference transaction", () => {
  it("saves only the private photo reference, revision and before/after audit", async () => {
    const original = await row(); const path = await photoPath(); await savePhoto(path);
    expect(await row()).toEqual({ ...original, photo_path: path, profile_revision: 1 });
    const audit = (await db.query<{ metadata: unknown; actor_user_id: string }>("select metadata,actor_user_id from audit_events where entity_id=$1", [studentId])).rows[0];
    expect(audit).toEqual({ actor_user_id: adminId, metadata: { before_path: "private-photo", after_path: path, before_revision: 0, after_revision: 1 } });
  });
  it("requires explicit removal and retains a readable audit", async () => {
    await expect(savePhoto(null)).rejects.toThrow("Confirm removing"); await savePhoto(null,0,true);
    expect(await row()).toMatchObject({ photo_path: null, profile_revision: 1 }); await expect(savePhoto(null,1,true)).rejects.toThrow("no profile photo");
  });
  it("rejects stale profile and photo changes, including legacy updates", async () => {
    const path = await photoPath(); await db.query("update students set notes='Legacy update' where id=$1", [studentId]);
    await expect(savePhoto(path)).rejects.toThrow("changed"); await expect(savePhoto(null,0,true)).rejects.toThrow("changed"); await expect(savePhoto(path,null)).rejects.toThrow("changed");
    expect(await row()).toMatchObject({ photo_path: "private-photo" });
  });
  it("rejects missing objects, unsafe/cross-student paths, unsupported objects and reuse of retired photos", async () => {
    await expect(savePhoto(`${studentId}/workspace/${randomUUID()}.png`)).rejects.toThrow("Upload a supported");
    for (const path of ["https://example.test/photo.png", `${randomUUID()}/workspace/${randomUUID()}.png`,`${studentId}/../photo.png`]) await expect(savePhoto(path)).rejects.toThrow("Invalid student photo path");
    for (const metadata of [{ mimetype: "image/svg+xml",size: 100 },{ mimetype: "image/png",size: 10485761 },{ mimetype: "image/png",size: 0 }]) await expect(savePhoto(await photoPath(metadata))).rejects.toThrow("supported private photo");
    const path = await photoPath(); await savePhoto(path); await savePhoto(null,1,true); await expect(savePhoto(path,2)).rejects.toThrow("already been used");
  });
  it("rolls back the reference and revision when auditing fails", async () => {
    const path = await photoPath();
    await db.exec("create function fail_photo_audit() returns trigger language plpgsql as $$ begin raise exception 'Audit unavailable'; end; $$; create trigger fail_photo_audit before insert on audit_events for each row execute function fail_photo_audit();");
    try { await expect(savePhoto(path)).rejects.toThrow("Audit unavailable"); await expect(savePhoto(null,0,true)).rejects.toThrow("Audit unavailable"); }
    finally { await db.exec("drop trigger fail_photo_audit on audit_events; drop function fail_photo_audit();"); }
    expect(await row()).toMatchObject({ photo_path: "private-photo", profile_revision: 0 });
  });
  it.each([teacherId,receptionId,""])("denies non-admin reads and writes for %s", async actor => {
    await db.query("select set_config('test.actor',$1,false)",[actor]);
    await expect(savePhoto(null,0,true)).rejects.toThrow("administrator"); await expect(db.query("select read_student_photo_workspace($1)",[studentId])).rejects.toThrow("administrator");
  });
  it("rejects inactive administrators and keeps public grants restricted", async () => {
    await db.query("update staff_profiles set active=false where id=$1",[adminId]);
    try { await expect(savePhoto(null,0,true)).rejects.toThrow("administrator"); } finally { await db.query("update staff_profiles set active=true where id=$1",[adminId]); }
    for (const role of ["anon","authenticated","service_role"]) {
      const permission = (await db.query<{ allowed: boolean }>("select has_function_privilege($1,'save_student_photo(uuid,integer,text,boolean)','execute') allowed",[role])).rows[0]; expect(permission.allowed).toBe(role === "authenticated");
    }
  });
});

describe("student profile command", () => {
  it("saves every editable field atomically while retaining photo and recording the actor and previous values", async () => {
    await save();
    expect(await row()).toMatchObject({ ...details, profile_revision: 1, photo_path: "private-photo" });
    const audit = (await db.query<{ actor_user_id: string; metadata: { before: unknown; after: unknown } }>("select * from audit_events where entity_id=$1", [studentId])).rows[0];
    expect(audit.actor_user_id).toBe(adminId);
    expect(audit.metadata.before).toMatchObject({ first_name: "Original", status: "prospect" });
    expect(audit.metadata.after).toEqual(details);
  });
  it("clears optional fields without turning missing values into empty records", async () => {
    await save({ ...details, cccu_student_id: null, phone: null, start_term_id: null, notes: null });
    expect(await row()).toMatchObject({ cccu_student_id: null, phone: null, start_term_id: null, notes: null });
  });
  it("rejects concurrent and legacy-writer stale edits without overwriting the newer record", async () => {
    const results = await Promise.allSettled([save(), save({ ...details, first_name: "Other editor" })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    await db.query("update students set notes='Legacy edit', profile_revision=0 where id=$1", [studentId]);
    expect(await row()).toMatchObject({ profile_revision: 2, notes: "Legacy edit" });
    await expect(save(details, 1)).rejects.toThrow("Student details changed");
    await expect(save(details, null)).rejects.toThrow("Student details changed");
  });
  it.each(["teacher", "reception", "anonymous", "inactive admin"])("denies %s even when calling the database command directly", async role => {
    const actor = role === "teacher" ? teacherId : role === "reception" ? receptionId : role === "anonymous" ? "" : adminId;
    await db.query("select set_config('test.actor',$1,false)", [actor]);
    if (role === "inactive admin") await db.query("update staff_profiles set active=false where id=$1", [adminId]);
    try { await expect(save()).rejects.toThrow("administrator"); }
    finally { await db.query("update staff_profiles set active=true where id=$1", [adminId]); }
    expect(await row()).toMatchObject({ first_name: "Original", profile_revision: 0 });
  });
  it.each([{ photo_path: "forged" }, { profile_revision: 99 }, { id: randomUUID() }, { credits: 60 }, { first_name: " " }, { first_name: 123 }, { email: "invalid" }, { programme: "invalid" }, { status: "Fail" }, { start_term_id: randomUUID() }])("rejects invalid or non-profile fields: %j", async changes => {
    await expect(save({ ...details, ...changes })).rejects.toThrow();
    expect(await row()).toMatchObject({ first_name: "Original", profile_revision: 0 });
  });
  it("rejects incomplete profiles and duplicate identifiers with no partial update", async () => {
    const partial = { ...details }; delete partial.notes;
    await expect(save(partial)).rejects.toThrow("editable student profile fields");
    const other = randomUUID();
    await db.query("insert into students(temporary_id,first_name,last_name,email,programme) values($1,'Other','Student','other@example.test','pgcert')", [other]);
    await expect(save({ ...details, temporary_id: other })).rejects.toThrow("unique");
    expect(await row()).toMatchObject({ first_name: "Original", profile_revision: 0 });
  });
  it("rolls back the update and revision if the final audit insert fails", async () => {
    await db.exec("create function fail_profile_audit() returns trigger language plpgsql as $$ begin raise exception 'Audit unavailable'; end; $$; create trigger fail_profile_audit before insert on audit_events for each row execute function fail_profile_audit();");
    try { await expect(save()).rejects.toThrow("Audit unavailable"); }
    finally { await db.exec("drop trigger fail_profile_audit on audit_events; drop function fail_profile_audit();"); }
    expect(await row()).toMatchObject({ first_name: "Original", profile_revision: 0 });
  });
  it("limits the public command to authenticated roles and hides the revision helper", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const result = await db.query<{ allowed: boolean; helper: boolean }>("select has_function_privilege($1,'save_student_profile(uuid,integer,jsonb)','execute') allowed, has_function_privilege($1,'advance_student_profile_revision()','execute') helper", [role]);
      expect(result.rows[0]).toEqual({ allowed: role === "authenticated", helper: false });
    }
    await db.exec("set role authenticated");
    try { await save(); }
    finally { await db.exec("reset role"); }
    expect(await row()).toMatchObject({ first_name: "Updated" });
  });
});
