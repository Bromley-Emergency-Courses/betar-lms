export function assessmentWorkflowMode(): "off" | "shadow" | "live" {
  const mode = process.env.ASSESSMENT_WORKFLOW_MODE;
  return mode === "shadow" || mode === "live" ? mode : "off";
}

export function assessmentWorkflowEnabled(): boolean {
  return assessmentWorkflowMode() !== "off";
}

export function assessmentPrototypeEnabled(variant?: string): boolean {
  return process.env.NODE_ENV === "development" && assessmentWorkflowEnabled() && ["A", "B", "C"].includes(variant ?? "");
}

export function studentWorkspaceEnabled(): boolean {
  return process.env.STUDENT_WORKSPACE_ENABLED === "true" && assessmentWorkflowEnabled();
}
