import { z } from "zod";

const administrativeDetailsSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(40).nullable(),
  programme: z.enum(["pgcert", "microcredential"]),
  module_interest_ids: z.array(z.string().uuid()).max(20),
  source: z.string().trim().max(120).nullable(),
  last_contacted_on: z.string().date().nullable(),
  next_action_on: z.string().date().nullable(),
  notes: z.string().trim().max(6000).nullable()
});

function optionalFormValue(formData: FormData, key: string): string | null {
  const nextValue = String(formData.get(key) ?? "").trim();
  return nextValue.length > 0 ? nextValue : null;
}

export type AdmissionLeadAdministrativeDetails = z.infer<typeof administrativeDetailsSchema>;

export function parseAdmissionLeadAdministrativeDetails(formData: FormData): AdmissionLeadAdministrativeDetails {
  return administrativeDetailsSchema.parse({
    first_name: String(formData.get("first_name") ?? ""),
    last_name: String(formData.get("last_name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: optionalFormValue(formData, "phone"),
    programme: String(formData.get("programme") || "pgcert"),
    module_interest_ids: formData
      .getAll("module_interest_ids")
      .map((entryValue) => String(entryValue).trim())
      .filter(Boolean),
    source: optionalFormValue(formData, "source"),
    last_contacted_on: optionalFormValue(formData, "last_contacted_on"),
    next_action_on: optionalFormValue(formData, "next_action_on"),
    notes: optionalFormValue(formData, "notes")
  });
}
