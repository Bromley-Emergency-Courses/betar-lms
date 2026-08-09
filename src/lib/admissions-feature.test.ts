import { describe, expect, it } from "vitest";
import { admissionsStaffWorkspacesEnabled } from "@/lib/admissions-feature";

describe("admissions staff workspace cutover flag", () => {
  it("keeps the coordinated replacement disabled by default", () => {
    expect(admissionsStaffWorkspacesEnabled({})).toBe(false);
    expect(admissionsStaffWorkspacesEnabled({ ADMISSIONS_STAFF_WORKSPACES_ENABLED: "false" })).toBe(false);
  });

  it("requires an explicit enabled value", () => {
    expect(admissionsStaffWorkspacesEnabled({ ADMISSIONS_STAFF_WORKSPACES_ENABLED: "true" })).toBe(true);
    expect(admissionsStaffWorkspacesEnabled({ ADMISSIONS_STAFF_WORKSPACES_ENABLED: "1" })).toBe(true);
  });
});
