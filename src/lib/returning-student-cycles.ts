import { z } from "zod";

export const returningStudentEligibleStatusGroups = ["active", "deferred", "interrupted"] as const;
export const returningStudentCyclePhases = [
  "setup",
  "collecting_responses",
  "review_confirmation",
  "complete"
] as const;

const idSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(1, "A reason is required.").max(4000);
const statusGroupsSchema = z
  .array(z.enum(returningStudentEligibleStatusGroups))
  .min(1, "Choose at least one status group.")
  .superRefine((groups, context) => {
    if (new Set(groups).size !== groups.length) {
      context.addIssue({ code: "custom", message: "Status groups cannot be duplicated." });
    }
  });

const createCycleSchema = z.object({
  target_term_id: idSchema,
  status_groups: statusGroupsSchema
});

const configureStatusGroupsSchema = z.object({
  cycle_id: idSchema,
  status_groups: statusGroupsSchema
});

const cycleActionSchema = z.object({ cycle_id: idSchema });

const addParticipantSchema = z.object({
  cycle_id: idSchema,
  student_id: idSchema,
  reason: reasonSchema
});

const participantActionSchema = z.object({
  cycle_id: idSchema,
  participant_id: idSchema,
  reason: reasonSchema
});

const plannedCapacitySchema = z.object({
  cycle_id: idSchema,
  cycle_offering_id: idSchema,
  planned_capacity: z.coerce.number().int().positive().max(10000),
  reason: reasonSchema
});

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function formStrings(formData: FormData, key: string): string[] {
  return formData.getAll(key).map(String);
}

export function parseCreateReturningStudentCycleForm(formData: FormData) {
  return createCycleSchema.parse({
    target_term_id: formString(formData, "target_term_id"),
    status_groups: formStrings(formData, "status_groups")
  });
}

export function parseConfigureReturningStudentCycleStatusGroupsForm(formData: FormData) {
  return configureStatusGroupsSchema.parse({
    cycle_id: formString(formData, "cycle_id"),
    status_groups: formStrings(formData, "status_groups")
  });
}

export function parseReturningStudentCycleActionForm(formData: FormData) {
  return cycleActionSchema.parse({ cycle_id: formString(formData, "cycle_id") });
}

export function parseAddReturningStudentCycleParticipantForm(formData: FormData) {
  return addParticipantSchema.parse({
    cycle_id: formString(formData, "cycle_id"),
    student_id: formString(formData, "student_id"),
    reason: formString(formData, "reason")
  });
}

export function parseReturningStudentCycleParticipantActionForm(formData: FormData) {
  return participantActionSchema.parse({
    cycle_id: formString(formData, "cycle_id"),
    participant_id: formString(formData, "participant_id"),
    reason: formString(formData, "reason")
  });
}

export function parseReturningStudentCyclePlannedCapacityForm(formData: FormData) {
  return plannedCapacitySchema.parse({
    cycle_id: formString(formData, "cycle_id"),
    cycle_offering_id: formString(formData, "cycle_offering_id"),
    planned_capacity: formString(formData, "planned_capacity"),
    reason: formString(formData, "reason")
  });
}
