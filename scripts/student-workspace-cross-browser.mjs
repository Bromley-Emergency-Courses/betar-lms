import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { studentBrowser } from "./student-browser.mjs";

const credentialsPath = process.argv[2];
if (!credentialsPath) throw new Error("Pass the private synthetic administrator/teacher credentials JSON.");
const engines = process.argv[3] ? [studentBrowser(process.argv[3]).name()] : ["firefox", "webkit", "chromium"];
for (const engine of engines) {
  const browser = await studentBrowser(engine).launch();
  await browser.close();
}
const artifacts = `.context/student-cross-browser-review/${randomUUID()}`;
mkdirSync(artifacts, { recursive: true });
const results = [];
const suites = [
  { name: "layout", script: "student-workspace-smoke.mjs" },
  { name: "profile", script: "student-profile-smoke.mjs", latest: ".context/student-profile-review/latest.json" },
  { name: "photo", script: "student-photo-smoke.mjs", latest: ".context/student-photo-review/latest.json" },
  { name: "journey", script: "student-workspace-journey-smoke.mjs", latest: ".context/student-journey-review/latest.json" }
];
for (const engine of engines) {
  for (const suite of suites) {
    console.log(`\n=== ${engine}: ${suite.name} ===`);
    try {
      execFileSync(process.execPath, [`scripts/${suite.script}`, credentialsPath, engine], { stdio: "inherit" });
      const suiteArtifacts = suite.latest
        ? JSON.parse(readFileSync(suite.latest, "utf8")).artifacts
        : `.context/student-workspace-review${engine === "chromium" ? "" : `/${engine}`}`;
      const result = JSON.parse(readFileSync(`${suiteArtifacts}/results.json`, "utf8"));
      assert.equal(result.browser, engine);
      const evidence = `${artifacts}/${engine}-${suite.name}.json`;
      writeFileSync(evidence, JSON.stringify(result, null, 2));
      results.push({ browser: engine, version: result.browserVersion, suite: suite.name, checks: result.checks.length, artifacts: suiteArtifacts, evidence });
      writeFileSync(`${artifacts}/results.json`, JSON.stringify({ complete: false, results }, null, 2));
    } catch (error) {
      writeFileSync(`${artifacts}/results.json`, JSON.stringify({ complete: false, failed: { browser: engine, suite: suite.name }, results }, null, 2));
      throw error;
    }
  }
}
const summary = { complete: true, engines, groups: results.reduce((total, result) => total + result.checks, 0), results };
writeFileSync(`${artifacts}/results.json`, JSON.stringify(summary, null, 2));
writeFileSync(".context/student-cross-browser-review/latest.json", JSON.stringify({ artifacts, engines, groups: summary.groups }, null, 2));
console.log(JSON.stringify({ artifacts, engines, groups: summary.groups }, null, 2));
