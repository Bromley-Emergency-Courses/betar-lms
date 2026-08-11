import { z } from "zod";

export type AdmissionsEmailPilotRecordType = "new_applicant" | "returning_student";

export interface AdmissionsEmailPilotTestRecord {
  id: string;
  recordType: AdmissionsEmailPilotRecordType;
  label: string;
  reason: string;
  active: boolean;
  markedAt: string;
  unmarkedAt?: string;
  unmarkReason?: string;
}

const idSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(1, "A reason is required.").max(2000);

const markSchema = z.object({
  intent: z.literal("mark"),
  record_type: z.enum(["new_applicant", "returning_student"]),
  entity_id: idSchema,
  label: z.string().trim().min(1, "A test label is required.").max(160),
  reason: reasonSchema,
  confirmed_fake: z.literal("true", { error: "Confirm that this is a fake record using an address you control." })
});

const unmarkSchema = z.object({
  intent: z.literal("unmark"),
  record_type: z.enum(["new_applicant", "returning_student"]),
  entity_id: idSchema,
  test_record_id: idSchema,
  reason: reasonSchema
});

export type AdmissionsEmailPilotAction = z.infer<typeof markSchema> | z.infer<typeof unmarkSchema>;

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export function parseAdmissionsEmailPilotActionForm(formData: FormData): AdmissionsEmailPilotAction {
  const intent = formString(formData, "intent");
  if (intent === "mark") {
    return markSchema.parse({
      intent,
      record_type: formString(formData, "record_type"),
      entity_id: formString(formData, "entity_id"),
      label: formString(formData, "label"),
      reason: formString(formData, "reason"),
      confirmed_fake: formString(formData, "confirmed_fake")
    });
  }

  return unmarkSchema.parse({
    intent,
    record_type: formString(formData, "record_type"),
    entity_id: formString(formData, "entity_id"),
    test_record_id: formString(formData, "test_record_id"),
    reason: formString(formData, "reason")
  });
}

export function mapAdmissionsEmailPilotTestRecord(row: Record<string, unknown>): AdmissionsEmailPilotTestRecord {
  const recordType = row.record_type === "returning_student" ? "returning_student" : "new_applicant";
  return {
    id: String(row.id),
    recordType,
    label: String(row.label),
    reason: String(row.reason),
    active: Boolean(row.active),
    markedAt: String(row.marked_at),
    unmarkedAt: typeof row.unmarked_at === "string" ? row.unmarked_at : undefined,
    unmarkReason: typeof row.unmark_reason === "string" ? row.unmark_reason : undefined
  };
}
