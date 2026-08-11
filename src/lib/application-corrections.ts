import { z } from "zod";
import { applicationDocumentSlotKeys } from "@/lib/application-documents";

export const applicationCorrectionFieldKeys = [
  "title",
  "first_name",
  "middle_names",
  "last_name",
  "preferred_name",
  "previous_surname",
  "date_of_birth",
  "previous_study_detail",
  "partner_student_id",
  "email",
  "phone",
  "address_line_1",
  "address_line_2",
  "city",
  "postcode",
  "country",
  "clinical_role",
  "employer",
  "department_specialty",
  "professional_registration_body",
  "professional_registration_number",
  "highest_qualification",
  "qualification_awarding_body",
  "qualification_year",
  "qualification_result",
  "qualification_country",
  "work_experience",
  "nationality",
  "country_of_birth",
  "country_of_residence",
  "needs_visa_check",
  "visa_notes",
  "funding_source",
  "funding_organisation",
  "funding_contact",
  "pocus_previous_experience",
  "pocus_motivation",
  "pocus_case_improved_management",
  "pocus_limitations_case",
  "evidence_summary"
] as const;

export type ApplicationCorrectionFieldKey = (typeof applicationCorrectionFieldKeys)[number];

const applicationCorrectionFieldLabels: Record<ApplicationCorrectionFieldKey, string> = {
  title: "Title",
  first_name: "First name",
  middle_names: "Middle names",
  last_name: "Last name",
  preferred_name: "Preferred name",
  previous_surname: "Previous surname",
  date_of_birth: "Date of birth",
  previous_study_detail: "Previous BETAR/university study",
  partner_student_id: "Partner/university student ID",
  email: "Email",
  phone: "Phone",
  address_line_1: "Address line 1",
  address_line_2: "Address line 2",
  city: "City/town",
  postcode: "Postcode",
  country: "Country",
  clinical_role: "Current clinical role",
  employer: "Employer/organisation",
  department_specialty: "Department/specialty",
  professional_registration_body: "Registration body",
  professional_registration_number: "Registration number",
  highest_qualification: "Qualification title/level",
  qualification_awarding_body: "Awarding body",
  qualification_year: "Award year",
  qualification_result: "Result/classification",
  qualification_country: "Country awarded",
  work_experience: "Relevant clinical experience",
  nationality: "Nationality",
  country_of_birth: "Country of birth",
  country_of_residence: "Country of ordinary residence",
  needs_visa_check: "Needs visa/right-to-study check",
  visa_notes: "Visa/right-to-study notes",
  funding_source: "Expected funding source",
  funding_organisation: "Funding organisation",
  funding_contact: "Funding contact",
  pocus_previous_experience: "Previous experience in POCUS",
  pocus_motivation: "Motivation to enrol",
  pocus_case_improved_management: "Case where POCUS improved clinical management",
  pocus_limitations_case: "Case where POCUS limitations were recognised",
  evidence_summary: "Evidence summary"
};

export function applicationCorrectionFieldLabel(key: ApplicationCorrectionFieldKey): string {
  return applicationCorrectionFieldLabels[key];
}

export const applicationCorrectionRequestStatuses = ["open", "resubmitted", "resolved", "cancelled"] as const;
export const applicationCorrectionReviewOutcomes = ["accepted", "revise"] as const;

const idSchema = z.string().uuid();
const instructionsSchema = z.string().trim().min(1, "Instructions are required.").max(4000);
const noteSchema = z
  .string()
  .trim()
  .max(4000)
  .transform((value) => (value.length > 0 ? value : null));

const correctionItemSchema = z.discriminatedUnion("target_type", [
  z.object({
    target_type: z.literal("application_field"),
    target_key: z.enum(applicationCorrectionFieldKeys),
    instructions: instructionsSchema
  }),
  z.object({
    target_type: z.literal("document_slot"),
    target_key: z.enum(applicationDocumentSlotKeys),
    instructions: instructionsSchema
  })
]);

const correctionItemsSchema = z
  .array(correctionItemSchema)
  .min(1, "Add at least one correction item.")
  .max(20)
  .superRefine((items, context) => {
    const targets = new Set<string>();
    for (const [index, item] of items.entries()) {
      const target = `${item.target_type}:${item.target_key}`;
      if (targets.has(target)) {
        context.addIssue({
          code: "custom",
          message: "Each field or document can only be requested once.",
          path: [index, "target_key"]
        });
      }
      targets.add(target);
    }
  });

const requestFormSchema = z.object({
  application_id: idSchema,
  summary: noteSchema,
  due_at: z
    .string()
    .trim()
    .max(80)
    .transform((value, context) => {
      if (value.length === 0) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        context.addIssue({ code: "custom", message: "Correction due date must be valid." });
        return z.NEVER;
      }
      return parsed.toISOString();
    }),
  items: correctionItemsSchema
});

const scalarJsonSchema = z.union([z.string().max(10000), z.number().finite(), z.boolean(), z.null()]);

const saveResponseFormSchema = z
  .object({
    item_id: idSchema,
    proposed_value: scalarJsonSchema.optional(),
    replacement_managed_file_id: z.union([idSchema, z.null()]),
    clear_value: z.boolean(),
    response_note: noteSchema
  })
  .refine(
    (value) =>
      Number(value.proposed_value !== undefined) +
        Number(value.replacement_managed_file_id !== null) +
        Number(value.clear_value) ===
      1,
    "Provide either a corrected value or a replacement document."
  );

const reviewFormSchema = z.object({
  application_id: idSchema,
  request_id: idSchema,
  reviews: z
    .array(
      z
        .object({
          item_id: idSchema,
          outcome: z.enum(applicationCorrectionReviewOutcomes),
          review_note: noteSchema
        })
        .superRefine((review, context) => {
          if (review.outcome === "revise" && !review.review_note) {
            context.addIssue({ code: "custom", message: "Revised items need clear instructions." });
          }
        })
    )
    .min(1)
    .max(20)
});

const reasonFormSchema = z.object({
  application_id: idSchema,
  request_id: idSchema,
  reason: z.string().trim().min(1, "A reason is required.").max(4000)
});

const evidenceOverrideFormSchema = z.object({
  application_id: idSchema,
  slot_id: idSchema,
  reason: z.string().trim().min(1, "An override reason is required.").max(4000)
});

const correctionDocumentUploadFormSchema = z.object({
  application_id: idSchema,
  item_id: idSchema,
  slot_key: z.enum(applicationDocumentSlotKeys),
  response_note: noteSchema
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

export function parseRequestApplicationCorrectionsForm(formData: FormData) {
  return requestFormSchema.parse({
    application_id: formString(formData, "application_id"),
    summary: formString(formData, "summary"),
    due_at: formString(formData, "due_at"),
    items: parseJson(formString(formData, "items_json"), "Correction items must be valid JSON.")
  });
}

export function parseSaveApplicationCorrectionResponseForm(formData: FormData) {
  const proposedValueJson = formString(formData, "proposed_value_json");
  const replacementManagedFileId = formString(formData, "replacement_managed_file_id");
  const clearValue = formString(formData, "clear_value");
  return saveResponseFormSchema.parse({
    item_id: formString(formData, "item_id"),
    proposed_value:
      proposedValueJson.length > 0
        ? parseJson(proposedValueJson, "Corrected value must be valid JSON.")
        : undefined,
    replacement_managed_file_id: replacementManagedFileId || null,
    clear_value: ["1", "true", "on", "yes"].includes(clearValue.toLowerCase()),
    response_note: formString(formData, "response_note")
  });
}

export function parseResubmitApplicationCorrectionsForm(formData: FormData) {
  return z.object({ request_id: idSchema }).parse({ request_id: formString(formData, "request_id") });
}

export function parseReviewApplicationCorrectionsForm(formData: FormData) {
  return reviewFormSchema.parse({
    application_id: formString(formData, "application_id"),
    request_id: formString(formData, "request_id"),
    reviews: parseJson(formString(formData, "reviews_json"), "Correction reviews must be valid JSON.")
  });
}

export function parseCancelApplicationCorrectionForm(formData: FormData) {
  return reasonFormSchema.parse({
    application_id: formString(formData, "application_id"),
    request_id: formString(formData, "request_id"),
    reason: formString(formData, "reason")
  });
}

export function parseApplicationEvidenceOverrideForm(formData: FormData) {
  return evidenceOverrideFormSchema.parse({
    application_id: formString(formData, "application_id"),
    slot_id: formString(formData, "slot_id"),
    reason: formString(formData, "reason")
  });
}

export function parseApplicationCorrectionDocumentUploadForm(formData: FormData) {
  return correctionDocumentUploadFormSchema.parse({
    application_id: formString(formData, "application_id"),
    item_id: formString(formData, "item_id"),
    slot_key: formString(formData, "slot_key"),
    response_note: formString(formData, "response_note")
  });
}
