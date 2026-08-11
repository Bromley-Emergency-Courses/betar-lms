function enabledFlag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function admissionsStaffWorkspacesEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return enabledFlag(env.ADMISSIONS_STAFF_WORKSPACES_ENABLED);
}

export function returningStudentAdmissionsWorkspaceEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return admissionsStaffWorkspacesEnabled(env)
    && enabledFlag(env.ADMISSIONS_RETURNING_STUDENT_WORKSPACE_ENABLED);
}
