import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("student workspace release safety", () => {
  it("disables automatic Vercel deployment for the review branch without changing other branches", () => {
    const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
    expect(config.git.deploymentEnabled).toEqual({ "12amathew/connect-notion-pages": false });
  });

  it("uses the checked-in guarded prototype launcher instead of private workspace code", () => {
    const config = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(config.scripts["assessment:prototype"]).toBe("node scripts/assessment-local.mjs serve shadow 3100");
  });
});
