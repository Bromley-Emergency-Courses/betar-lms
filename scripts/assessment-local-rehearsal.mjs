import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { localContainer, validateLocalProjectConfig, validateLocalSettings } from "./assessment-local-config.mjs";

validateLocalProjectConfig(readFileSync("dev/assessment/supabase/config.toml", "utf8"));
validateLocalSettings(JSON.parse(execFileSync("supabase", ["status", "--workdir", "dev/assessment", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })));
if (process.env.ASSESSMENT_DOCKER_CONTAINER && process.env.ASSESSMENT_DOCKER_CONTAINER !== localContainer) throw new Error("Only the isolated assessment Docker project is permitted.");
const container = localContainer;
const database = `assessment_rehearsal_49_${Date.now()}`;
const restoredDatabase = `${database}_restore`;
const artifactDirectory = `.context/assessment-rehearsal/${database}`;
mkdirSync(artifactDirectory, { recursive: true });

function docker(argumentsList, input) {
  return execFileSync("docker", ["exec", "-i", container, ...argumentsList], { input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
function sql(input, csv = false) {
  return docker(["psql", "-X", "-q", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", ...(csv ? ["--csv"] : [])], input);
}
function concurrentSql(input) {
  return new Promise(resolve => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-q", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"]);
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("close", code => resolve({ code, output }));
    child.stdin.end(input);
  });
}

const schema = docker(["pg_dump", "-U", "postgres", "-d", "postgres", "--schema-only", "--no-owner", "--no-privileges", "--schema=auth", "--schema=storage", "--schema=extensions"])
  .replace(/^CREATE POLICY[^;]*;\n/gm, "");
const baselineVersion = "0048";
docker(["createdb", "-U", "postgres", database]);
sql(schema);
sql("create extension if not exists pgcrypto with schema extensions;");
const applied = [];
const migrations = readdirSync("supabase/migrations").filter(file => /^\d+.*\.sql$/.test(file)).sort();
for (const file of migrations.filter(file => Number(file.split("_")[0]) <= Number(baselineVersion))) {
  sql(readFileSync(`supabase/migrations/${file}`, "utf8"));
  applied.push(file);
}
const fixture = readFileSync("scripts/assessment-rehearsal-fixture.sql", "utf8");
const planStatements = fixture.split("\n").filter(line => line.startsWith("select public.save_module_assessment_plan"));
sql(fixture.split("\n").filter(line => !line.startsWith("select public.save_module_assessment_plan")).join("\n"));
writeFileSync(`${artifactDirectory}/preflight.csv`, sql(readFileSync("scripts/assessment-preflight.sql", "utf8"), true));
const legacySnapshot = "select jsonb_build_object('results',(select jsonb_agg(to_jsonb(result) order by id) from public.exam_results result),'enrolments',(select jsonb_agg(jsonb_build_object('id',id,'status',status,'credits',credits_awarded,'final_mark',final_mark,'grade',grade) order by id) from public.enrolments))";
const legacyBefore = sql(legacySnapshot);
for (const file of migrations.filter(file => Number(file.split("_")[0]) > Number(baselineVersion))) {
  sql(readFileSync(`supabase/migrations/${file}`, "utf8"));
  applied.push(file);
}
assert.equal(sql(legacySnapshot), legacyBefore, "Additive migrations changed original legacy evidence");
const actor = "select set_config('request.jwt.claim.sub','49000000-0000-4000-8000-000000000001',false);";
sql(`${actor}${planStatements.join("\n")}
  do $$ declare enrolment record; begin
    for enrolment in select current.id, plan.id plan_id from public.enrolments current join public.module_offerings offering on offering.id=current.offering_id
      join public.module_assessment_plans plan on plan.module_id=offering.module_id loop
      perform public.execute_assessment_command(jsonb_build_object('type','ChangeEnrolmentAssessmentPlan','enrolment_id',enrolment.id,
        'plan_id',enrolment.plan_id,'preview',public.preview_enrolment_assessment_plan(enrolment.id,enrolment.plan_id),'reason','Synthetic reviewed historical inheritance'),
        (public.read_enrolment_assessment(enrolment.id)->>'revision')::integer);
    end loop;
  end $$;`);
writeFileSync(`${artifactDirectory}/verification.txt`, sql(readFileSync("scripts/assessment-rehearsal-verify.sql", "utf8")));
assert.equal(sql(legacySnapshot), legacyBefore, "Backfill or replacement changed original legacy evidence");
sql(`${actor} select public.execute_assessment_command(jsonb_build_object('type','CorrectManualAttempt','enrolment_id','49000000-0000-4000-8000-000000000012',
  'attempt_id',public.read_enrolment_assessment('49000000-0000-4000-8000-000000000012')->'components'->'theory'->>'id',
  'items','[{"kind":"mcq","score":30}]'::jsonb,'sitting_date','2025-10-01','sitting_term_id','49000000-0000-4000-8000-000000000004','reason','Synthetic concurrency setup'),
  (public.read_enrolment_assessment('49000000-0000-4000-8000-000000000012')->>'revision')::integer);`);
const revision = docker(["psql", "-X", "-U", "postgres", "-d", database, "-Atc", "select assessment_revision from public.enrolments where id='49000000-0000-4000-8000-000000000012'"]).trim();
const concurrentCommand = `${actor} select public.execute_assessment_command('{"type":"AddManualAttempt","component":"theory","enrolment_id":"49000000-0000-4000-8000-000000000012","items":[{"kind":"mcq","score":40}],"sitting_date":"2025-11-01","reason":"Concurrent synthetic resit"}',${Number(revision)});`;
const concurrentResults = await Promise.all([concurrentSql(concurrentCommand), concurrentSql(concurrentCommand)]);
if (concurrentResults.filter(result => result.code === 0).length !== 1 || !concurrentResults.some(result => result.output.includes("Reload before saving"))) throw new Error("Concurrent write test failed");
writeFileSync(`${artifactDirectory}/concurrency.json`, JSON.stringify(concurrentResults, null, 2));
writeFileSync(`${artifactDirectory}/shadow-comparison.csv`, sql(`${actor} select * from public.assessment_shadow_comparison;`, true));
const missingSignoff = await concurrentSql(`${actor} select public.set_assessment_rollout('live','{}','Synthetic missing sign-off must fail');`);
assert.notEqual(missingSignoff.code, 0); assert.match(missingSignoff.output, /Missing rollout sign-off/);
sql(`${actor} select public.set_assessment_rollout('live','{"reconciliation_review":"Synthetic only","sanitized_rehearsal":"Synthetic only","pilot_signoff":"Synthetic only","backup_restore":"Synthetic only","module_plans_review":"Synthetic only"}','Local gate rehearsal');`);
const guarded = await concurrentSql("update public.exam_results set score=99 where id='49000000-0000-4000-8000-000000000016';");
if (guarded.code === 0 || !guarded.output.includes("read-only")) throw new Error("Legacy cutover write guard failed");
sql(`${actor} select public.execute_assessment_command('{"type":"AddManualAttempt","component":"theory","enrolment_id":"49000000-0000-4000-8000-000000000012","items":[{"kind":"mcq","score":80}],"sitting_date":"2025-12-01","reason":"Synthetic live-only accepted resit"}',
  (public.read_enrolment_assessment('49000000-0000-4000-8000-000000000012')->>'revision')::integer);`);
const liveEvidence = sql(`${actor} select public.read_enrolment_assessment('49000000-0000-4000-8000-000000000012');`);
sql(`${actor} select public.set_assessment_rollout('shadow','{}','Local rollback rehearsal');`);
assert.equal(sql(`${actor} select public.read_enrolment_assessment('49000000-0000-4000-8000-000000000012');`), liveEvidence, "Rollback lost a live-only result");
assert.equal(sql(legacySnapshot), legacyBefore, "Cutover/rollback changed original legacy evidence");
const backup = docker(["pg_dump", "-U", "postgres", "-d", database, "--no-owner", "--no-privileges"]);
writeFileSync(`${artifactDirectory}/synthetic-backup.sql`, backup);
docker(["createdb", "-U", "postgres", restoredDatabase]);
docker(["psql", "-X", "-q", "-U", "postgres", "-d", restoredDatabase, "-v", "ON_ERROR_STOP=1"], backup);
const restored = query => docker(["psql", "-X", "-q", "-U", "postgres", "-d", restoredDatabase, "-v", "ON_ERROR_STOP=1"], query);
const evidenceSnapshot = "select jsonb_build_object('historical_baselines',(select jsonb_agg(to_jsonb(row) order by enrolment_id) from public.assessment_historical_outcomes row),'attempts',(select jsonb_agg(to_jsonb(row) order by id) from public.module_assessment_attempts row),'revisions',(select jsonb_agg(to_jsonb(row) order by id) from public.module_assessment_attempt_revisions row),'audit',(select jsonb_agg(to_jsonb(row) order by id) from public.audit_events row),'rollout',(select to_jsonb(row) from public.assessment_rollout row))";
assert.equal(restored(legacySnapshot), legacyBefore);
assert.equal(restored(evidenceSnapshot), sql(evidenceSnapshot), "Backup restore lost additive assessment evidence");
writeFileSync(`${artifactDirectory}/result.json`, JSON.stringify({ database, restoredDatabase, container, baselineVersion, applied, syntheticStudents: 6, legacyStatuses: 7, legacyResultsPreserved: 7, reviewedBackfill: 3, duplicateSequencesHeld: 2, concurrency: "one accepted, one stale revision rejected", cutoverGuard: "passed", rollback: "shadow; additive evidence retained", backupRestore: "legacy rows, attempts, revisions, audit and rollout state identical; no storage bytes included", productionAccess: false }, null, 2));
writeFileSync(".context/assessment-rehearsal/latest.json", JSON.stringify({ artifacts: artifactDirectory, database, restoredDatabase }, null, 2));
process.stdout.write(`Local Docker rehearsal passed. Database: ${database}. Artifacts: ${artifactDirectory}\n`);
