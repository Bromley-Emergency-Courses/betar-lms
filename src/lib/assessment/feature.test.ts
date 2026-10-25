import { afterEach, describe, expect, it, vi } from "vitest";
import { assessmentPrototypeEnabled, studentWorkspaceEnabled } from "./feature";

afterEach(() => vi.unstubAllEnvs());

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
