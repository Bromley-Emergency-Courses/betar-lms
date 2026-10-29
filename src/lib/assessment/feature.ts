export function assessmentWorkflowMode(): "off" | "shadow" | "live" {
  const mode = process.env.ASSESSMENT_WORKFLOW_MODE;
  return mode === "shadow" || mode === "live" ? mode : "off";
}

export function assessmentWorkflowEnabled(): boolean {
  return assessmentWorkflowMode() !== "off";
}

export function assessmentOperationsPaused(): boolean {
  return process.env.ASSESSMENT_OPERATIONS_PAUSED === "true";
}

export function assessmentPrototypeEnabled(variant?: string): boolean {
  return process.env.NODE_ENV === "development" && assessmentWorkflowEnabled() && ["A", "B", "C"].includes(variant ?? "");
}

export function studentWorkspaceEnabled(): boolean {
  return process.env.STUDENT_WORKSPACE_ENABLED === "true" && assessmentWorkflowEnabled();
}

export function staffCompanionEnabled(): boolean {
  return process.env.STAFF_COMPANION_ENABLED === "true" && studentWorkspaceEnabled();
}

export function staffCompanionTeachingEnabled(): boolean {
  return process.env.STAFF_COMPANION_TEACHING_ENABLED === "true" && staffCompanionEnabled();
}
