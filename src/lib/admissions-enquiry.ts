import { z } from "zod";
import { buildAuditEventInsert, type JsonRecord } from "@/lib/audit-correspondence";

export const publicEnquirySubmittedAction = "enquiry.submitted";
export const publicEnquiryEntityType = "admission_lead";

const allowedProgrammeValues = ["pgcert", "microcredential"] as const;

const publicEnquirySchema = z.object({
  first_name: z.string().trim().min(1, "First name is required.").max(80),
  last_name: z.string().trim().min(1, "Last name is required.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  phone: z
    .string()
    .trim()
    .max(40)
    .transform((value) => (value.length > 0 ? value : null)),
  programme: z.enum(allowedProgrammeValues).default("pgcert"),
  module_interest_ids: z.array(z.string().uuid()).max(20),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((value) => (value.length > 0 ? value : null))
});

export type PublicEnquiryPayload = z.infer<typeof publicEnquirySchema>;

export interface PublicEnquiryAuditInput {
  leadId: string;
  programme: PublicEnquiryPayload["programme"];
  moduleInterestIds: string[];
  source: string;
}

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export function parsePublicEnquiryForm(formData: FormData): PublicEnquiryPayload {
  return publicEnquirySchema.parse({
    first_name: formString(formData, "first_name"),
    last_name: formString(formData, "last_name"),
    email: formString(formData, "email"),
    phone: formString(formData, "phone"),
    programme: formString(formData, "programme") || "pgcert",
    module_interest_ids: formData
      .getAll("module_interest_ids")
      .map((value) => String(value).trim())
      .filter(Boolean),
    notes: formString(formData, "notes")
  });
}

export function buildPublicEnquiryAuditMetadata(input: PublicEnquiryAuditInput): JsonRecord {
  return buildAuditEventInsert({
    actor_type: "applicant",
    action: publicEnquirySubmittedAction,
    entity_type: publicEnquiryEntityType,
    entity_id: input.leadId,
    metadata: {
      programme: input.programme,
      module_interest_count: input.moduleInterestIds.length,
      source: input.source
    }
  }).metadata;
}
