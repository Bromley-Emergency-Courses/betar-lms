import { z } from "zod";

export const admissionsWorkspaces = ["new_students", "returning_students"] as const;
export const admissionsActionScopes = ["one", "selected", "all_matching"] as const;
export const admissionsOperationalActions = [
  "invite_application",
  "send_reminder",
  "send_general_communication",
  "close_abandoned",
  "lapse_offer",
  "lapse_registration",
  "contact_returning_student",
  "confirm_returning_selection",
  "resolve_returning_no_response"
] as const;

export const admissionsCorrespondenceActions = [
  "invite_application",
  "send_reminder",
  "send_general_communication",
  "contact_returning_student"
] as const;

const newStudentActions = new Set<(typeof admissionsOperationalActions)[number]>([
  "invite_application",
  "send_reminder",
  "send_general_communication",
  "close_abandoned",
  "lapse_offer",
  "lapse_registration"
]);

const returningStudentActions = new Set<(typeof admissionsOperationalActions)[number]>([
  "contact_returning_student",
  "send_reminder",
  "send_general_communication",
  "confirm_returning_selection",
  "resolve_returning_no_response"
]);

const jsonObjectSchema = z.record(z.string(), z.json());
const optionalText = z.string().trim().transform((value) => (value.length > 0 ? value : null));

const operationalTargetSchema = z
  .object({
    entity_type: z.string().trim().min(1).max(80),
    entity_id: z.string().uuid(),
    person_id: z.string().uuid().nullable().optional(),
    recipient_email: z.string().trim().toLowerCase().email().nullable().optional(),
    recipient_name: z.string().trim().max(200).nullable().optional(),
    eligible: z.boolean(),
    exclusion_reason: z.string().trim().max(2000).nullable().optional(),
    source_snapshot: jsonObjectSchema
  })
  .superRefine((target, context) => {
    if (!target.eligible && !target.exclusion_reason) {
      context.addIssue({ code: "custom", message: "Excluded records require a reason.", path: ["exclusion_reason"] });
    }
    if (target.eligible && target.exclusion_reason) {
      context.addIssue({ code: "custom", message: "Eligible records cannot have an exclusion reason.", path: ["exclusion_reason"] });
    }
  });

const operationalBatchSchema = z
  .object({
    request_key: z.string().uuid(),
    workspace: z.enum(admissionsWorkspaces),
    action: z.enum(admissionsOperationalActions),
    scope: z.enum(admissionsActionScopes),
    reviewed_filters: jsonObjectSchema,
    targets: z.array(operationalTargetSchema).min(1).max(500),
    template_key: optionalText,
    template_version: z.number().int().positive().nullable(),
    rendered_subject: optionalText,
    rendered_body: optionalText
  })
  .superRefine((batch, context) => {
    const validActions = batch.workspace === "new_students" ? newStudentActions : returningStudentActions;
    if (!validActions.has(batch.action)) {
      context.addIssue({ code: "custom", message: "This action is not valid in the selected workspace.", path: ["action"] });
    }

    if (batch.scope === "one" && batch.targets.length !== 1) {
      context.addIssue({ code: "custom", message: "One-record scope requires exactly one reviewed record.", path: ["scope"] });
    }

    const seenTargets = new Set<string>();
    for (const [index, target] of batch.targets.entries()) {
      const expectedEntityType = batch.workspace === "new_students"
        ? "admission_lead"
        : "returning_student_cycle_participant";
      if (target.entity_type !== expectedEntityType) {
        context.addIssue({
          code: "custom",
          message: "The reviewed record type does not match the selected workspace.",
          path: ["targets", index, "entity_type"]
        });
      }
      if (
        batch.workspace === "returning_students" &&
        target.eligible &&
        typeof target.source_snapshot.student_id !== "string"
      ) {
        context.addIssue({
          code: "custom",
          message: "Returning-student targets require their snapshotted student ID.",
          path: ["targets", index, "source_snapshot", "student_id"]
        });
      }
      const targetKey = `${target.entity_type}:${target.entity_id}`;
      if (seenTargets.has(targetKey)) {
        context.addIssue({ code: "custom", message: "Each record can appear only once.", path: ["targets", index] });
      }
      seenTargets.add(targetKey);
    }

    const correspondenceAction = admissionsCorrespondenceActions.some((action) => action === batch.action);
    if (correspondenceAction) {
      if (!batch.template_key || !batch.template_version || !batch.rendered_subject || !batch.rendered_body) {
        context.addIssue({ code: "custom", message: "Correspondence actions require a reviewed template and message." });
      }
      batch.targets.forEach((target, index) => {
        if (target.eligible && (!target.person_id || !target.recipient_email)) {
          context.addIssue({
            code: "custom",
            message: "Eligible correspondence records require a person and recipient address.",
            path: ["targets", index]
          });
        }
      });
      if (batch.action === "invite_application" && batch.template_key !== "application_invitation") {
        context.addIssue({ code: "custom", message: "Application invitations require the invitation template.", path: ["template_key"] });
      }
      if (
        batch.action === "contact_returning_student" &&
        batch.template_key !== "module_preference_window_opened"
      ) {
        context.addIssue({ code: "custom", message: "Returning-student contact requires the access template.", path: ["template_key"] });
      }
    } else if (batch.template_key || batch.template_version || batch.rendered_subject || batch.rendered_body) {
      context.addIssue({ code: "custom", message: "Only correspondence actions can include message content." });
    }
  });

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function parseJson(value: string, message: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(message);
  }
}

export function parseAdmissionsOperationalBatchForm(formData: FormData) {
  const templateVersion = formString(formData, "template_version").trim();
  return operationalBatchSchema.parse({
    request_key: formString(formData, "request_key"),
    workspace: formString(formData, "workspace"),
    action: formString(formData, "action"),
    scope: formString(formData, "scope"),
    reviewed_filters: parseJson(formString(formData, "reviewed_filters_json") || "{}", "Reviewed filters must be valid JSON."),
    targets: parseJson(formString(formData, "targets_json"), "Reviewed targets must be valid JSON."),
    template_key: formString(formData, "template_key"),
    template_version: templateVersion ? Number(templateVersion) : null,
    rendered_subject: formString(formData, "rendered_subject"),
    rendered_body: formString(formData, "rendered_body")
  });
}
