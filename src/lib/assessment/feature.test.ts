import { afterEach, describe, expect, it, vi } from "vitest";
import { assessmentOperationsPaused, assessmentPrototypeEnabled, staffCompanionEnabled, staffCompanionTeachingEnabled, studentWorkspaceEnabled } from "./feature";

afterEach(() => vi.unstubAllEnvs());

it("pauses assessment operations independently of the enabled teaching workspace", () => {
  vi.stubEnv("ASSESSMENT_OPERATIONS_PAUSED", "true");
  vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "shadow");
  vi.stubEnv("STUDENT_WORKSPACE_ENABLED", "true");
  vi.stubEnv("STAFF_COMPANION_ENABLED", "true");
  vi.stubEnv("STAFF_COMPANION_TEACHING_ENABLED", "true");
  expect(assessmentOperationsPaused()).toBe(true);
  expect(staffCompanionTeachingEnabled()).toBe(true);
  vi.stubEnv("ASSESSMENT_OPERATIONS_PAUSED", "false");
  expect(assessmentOperationsPaused()).toBe(false);
});

describe("staff companion integration gate", () => {
  it.each([undefined, "false", "true"])("requires all flags and an enabled assessment mode (%s)", companion => {
    for (const workspace of [undefined, "false", "true"]) {
      for (const mode of [undefined, "off", "shadow", "live"]) {
        vi.stubEnv("STAFF_COMPANION_ENABLED", companion);
        vi.stubEnv("STUDENT_WORKSPACE_ENABLED", workspace);
        vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", mode);
        expect(staffCompanionEnabled()).toBe(companion === "true" && workspace === "true" && (mode === "shadow" || mode === "live"));
        for (const teaching of [undefined, "false", "true"]) {
          vi.stubEnv("STAFF_COMPANION_TEACHING_ENABLED", teaching);
          expect(staffCompanionTeachingEnabled()).toBe(teaching === "true" && staffCompanionEnabled());
        }
      }
    }
  });
});

describe("student workspace integration gate", () => {
  it.each([
    [undefined, "shadow", false],
    ["false", "live", false],
    ["true", "off", false],
    ["true", undefined, false],
    ["true", "shadow", true],
    ["true", "live", true]
  ])("requires an explicit workspace flag (%s) and enabled assessment mode (%s)", (flag, mode, enabled) => {
    vi.stubEnv("STUDENT_WORKSPACE_ENABLED", flag);
    vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", mode);
    expect(studentWorkspaceEnabled()).toBe(enabled);
  });
});

describe("development-only assessment prototypes", () => {
  it.each(["A", "B", "C", "invalid", undefined])("ignores prototype parameter %s in production", variant => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "live");
    expect(assessmentPrototypeEnabled(variant)).toBe(false);
  });

  it.each(["A", "B", "C"])("allows the approved %s prototype only in enabled development mode", variant => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "shadow");
    expect(assessmentPrototypeEnabled(variant)).toBe(true);
    vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "off");
    expect(assessmentPrototypeEnabled(variant)).toBe(false);
  });

  it.each(["invalid", "", undefined])("does not divert normal development routes for %s", variant => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "shadow");
    expect(assessmentPrototypeEnabled(variant)).toBe(false);
  });
});
