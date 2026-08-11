import { describe, expect, it } from "vitest";
import {
  admissionsStaffWorkspacesEnabled,
  returningStudentAdmissionsWorkspaceEnabled
} from "@/lib/admissions-feature";

describe("admissions staff workspace cutover flag", () => {
  it("keeps the coordinated replacement disabled by default", () => {
    expect(admissionsStaffWorkspacesEnabled({})).toBe(false);
    expect(admissionsStaffWorkspacesEnabled({ ADMISSIONS_STAFF_WORKSPACES_ENABLED: "false" })).toBe(false);
  });

  it("requires an explicit enabled value", () => {
    expect(admissionsStaffWorkspacesEnabled({ ADMISSIONS_STAFF_WORKSPACES_ENABLED: "true" })).toBe(true);
    expect(admissionsStaffWorkspacesEnabled({ ADMISSIONS_STAFF_WORKSPACES_ENABLED: "1" })).toBe(true);
  });

  it("keeps the unfinished returning-student workspace separately disabled", () => {
    expect(returningStudentAdmissionsWorkspaceEnabled({
      ADMISSIONS_STAFF_WORKSPACES_ENABLED: "true"
    })).toBe(false);
    expect(returningStudentAdmissionsWorkspaceEnabled({
      ADMISSIONS_STAFF_WORKSPACES_ENABLED: "true",
      ADMISSIONS_RETURNING_STUDENT_WORKSPACE_ENABLED: "true"
    })).toBe(true);
    expect(returningStudentAdmissionsWorkspaceEnabled({
      ADMISSIONS_STAFF_WORKSPACES_ENABLED: "false",
      ADMISSIONS_RETURNING_STUDENT_WORKSPACE_ENABLED: "true"
    })).toBe(false);
  });
});
