import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { localAppEnvironment, validateLocalSettings, validateLocalProjectConfig } from "./assessment-local-config.mjs";

const settings = { API_URL: "http://127.0.0.1:56321", DB_URL: "postgresql://postgres:test@127.0.0.1:56322/postgres", ANON_KEY: "synthetic-anon", SERVICE_ROLE_KEY: "synthetic-service" };

test("rejects edited project identity, ports and automatic seeding before Docker operations", () => {
  const config = readFileSync(new URL("../dev/assessment/supabase/config.toml", import.meta.url), "utf8");
  assert.doesNotThrow(() => validateLocalProjectConfig(config));
  for (const [original, replacement] of [["assessment-yangon-49", "betar-lms"], ["56321", "54321"], ["56322", "54322"], ["56320", "54320"], ["[db.seed]\nenabled = false", "[db.seed]\nenabled = true"]]) {
    assert.throws(() => validateLocalProjectConfig(config.replace(original, replacement)));
  }
});

test("rejects production and other local stacks", () => {
  for (const API_URL of ["https://production.example.test", "http://127.0.0.1:54321", "http://127.0.0.1:55321"]) {
    assert.throws(() => validateLocalSettings({ ...settings, API_URL }));
  }
  for (const DB_URL of ["postgresql://postgres:test@db.example.test:56322/postgres", "postgresql://postgres:test@127.0.0.1:54322/postgres", "postgresql://postgres:test@127.0.0.1:56322/other"]) {
    assert.throws(() => validateLocalSettings({ ...settings, DB_URL }));
  }
});

test("overrides inherited remote credentials and disables external effects", () => {
  const env = localAppEnvironment(settings, "shadow", 3100, { NEXT_PUBLIC_SUPABASE_URL: "https://production.example.test", ADMISSIONS_EMAIL_ENABLED: "true", EXAM_PORTAL_LMS_RESULTS_URL: "https://portal.example.test" });
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, settings.API_URL);
  assert.equal(env.ADMISSIONS_EMAIL_ENABLED, "false");
  assert.equal(env.EXAM_PORTAL_LMS_RESULTS_URL, "");
  assert.equal(env.STUDENT_WORKSPACE_ENABLED, "true");
  assert.throws(() => localAppEnvironment(settings, "invalid", 3100));
  assert.throws(() => localAppEnvironment(settings, "live", 80));
});
