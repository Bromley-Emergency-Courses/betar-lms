import { z } from "zod";

export const assessmentStatuses = ["Planned", "In progress", "Abandoned", "Pass", "Fail", "Module deferred", "Assessment deferred"] as const;
export const assessmentIndicators = ["Attendance non-compliance", "Presentation incomplete", "theory:Resit required", "theory:Resit scheduled", "practical:Resit required", "practical:Resit scheduled"] as const;
const component = z.enum(["theory", "practical"]);
const percentage = z.number().finite().min(0).max(100);
const base = { enrolment_id: z.uuid(), reason: z.string().trim().min(1, "Enter a reason.").max(4000) };
const item = z.union([
  z.strictObject({ kind: z.enum(["mcq", "physics", "coursework", "viva"]), score: percentage }),
  z.strictObject({ kind: z.enum(["physics", "coursework", "viva"]), carried_from_item_id: z.uuid() })
]);
const score = { score: percentage.optional(), sitting_date: z.iso.date(), sitting_term_id: z.uuid().optional(), items: z.array(item).max(4) };
const override = { kind: z.enum(["status", "credits", "indicator"]), indicator: z.enum(assessmentIndicators).optional() };
const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("AddManualAttempt"), component, ...score, previous_result_unavailable: z.string().trim().min(1).max(4000).optional() }),
  z.strictObject({ ...base, type: z.literal("CorrectManualAttempt"), attempt_id: z.uuid(), ...score }),
  z.strictObject({ ...base, type: z.literal("CorrectImportedAttempt"), attempt_id: z.uuid(), source_id: z.uuid(), expected_source_revision: z.number().int().nonnegative(), score: percentage.optional(), items: z.array(item).max(4) }),
  z.strictObject({ ...base, type: z.literal("ExcludeAttempt"), attempt_id: z.uuid(), category: z.enum(["invalid", "incorrect_ownership"]), expected_source_revision: z.number().int().nonnegative().optional() }),
  z.strictObject({ ...base, type: z.literal("RestoreAttempt"), attempt_id: z.uuid(), exclusion_id: z.uuid(), expected_source_revision: z.number().int().nonnegative().optional(), reviewed_source_version_id: z.uuid().optional() }),
  z.strictObject({ ...base, type: z.literal("ScheduleResit"), component, note: z.string().trim().min(1, "Record when the resit is arranged.").max(4000) }),
  z.strictObject({ ...base, type: z.literal("CancelResit"), component }),
  z.strictObject({ ...base, type: z.literal("DeferAssessment"), component, note: z.string().trim().min(1).max(4000) }),
  z.strictObject({ ...base, type: z.literal("ClearAssessmentDeferral"), component }),
  z.strictObject({ ...base, type: z.literal("SetAssessmentOverride"), ...override, value: z.union([z.enum(assessmentStatuses), z.number().finite().int().min(0), z.boolean()]) }),
  z.strictObject({ ...base, type: z.literal("ClearAssessmentOverride"), ...override })
]).superRefine((command, context) => {
  if (command.type !== "SetAssessmentOverride" && command.type !== "ClearAssessmentOverride") return;
  if ((command.kind === "indicator") !== Boolean(command.indicator)) context.addIssue({ code: "custom", message: "Select one warning flag only for a warning-flag decision." });
  if (command.type === "SetAssessmentOverride") {
    const expectedType = { status: "string", credits: "number", indicator: "boolean" }[command.kind];
    if (typeof command.value !== expectedType) context.addIssue({ code: "custom", message: "The decision value does not match the selected task." });
  }
});

export const workspaceCommandSchema = z.strictObject({ command: commandSchema, expectedRevision: z.number().int().nonnegative() });
export type WorkspaceAssessmentCommand = z.infer<typeof commandSchema>;
