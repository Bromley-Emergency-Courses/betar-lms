import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { liveAppEnvironment, validateLiveProject, validateLiveSettings } from "./assessment-live-config.mjs";

const settings = { API_URL: "http://127.0.0.1:57321", DB_URL: "postgresql://postgres:synthetic@127.0.0.1:57322/postgres", ANON_KEY: "synthetic-anon", SERVICE_ROLE_KEY: "synthetic-service" };
test("accepts only the separately authorized disposable project", () => {
  validateLiveProject(readFileSync("dev/assessment-live/supabase/config.toml", "utf8"));
  assert.throws(() => validateLiveProject(readFileSync("dev/assessment/supabase/config.toml", "utf8")));
  assert.equal(validateLiveSettings(settings), settings);
  for (const API_URL of ["http://127.0.0.1:56321", "http://localhost:57321", "https://example.supabase.co"]) assert.throws(() => validateLiveSettings({ ...settings, API_URL }));
  assert.throws(() => validateLiveSettings({ ...settings, DB_URL: "postgresql://postgres@127.0.0.1:56322/postgres" }));
});
test("all rehearsal modes force isolated application and disable external side effects", () => {
  for (const mode of ["off", "shadow", "live"]) {
    const env = liveAppEnvironment(settings, mode, false, { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", ADMISSIONS_EMAIL_ENABLED: "true", EXAM_PORTAL_LMS_API_SECRET: "must-not-survive" });
    assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, settings.API_URL); assert.equal(env.ASSESSMENT_WORKFLOW_MODE, mode);
    assert.equal(env.STUDENT_WORKSPACE_ENABLED, "false"); assert.equal(env.ADMISSIONS_EMAIL_ENABLED, "false"); assert.equal(env.EXAM_PORTAL_LMS_API_SECRET, "");
  }
  assert.throws(() => liveAppEnvironment(settings, "production"));
});
