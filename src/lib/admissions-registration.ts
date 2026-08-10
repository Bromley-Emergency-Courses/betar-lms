import { createHash } from "node:crypto";
import { z } from "zod";
import { buildAuditEventInsert, type JsonRecord } from "@/lib/audit-correspondence";
import { sanitizeApplicationDocumentFilename } from "@/lib/application-documents";

export const admissionsRegistrationStatuses = ["not_started", "in_progress", "submitted", "complete", "lapsed"] as const;
export const admissionsRegistrationStartedAction = "registration.started";
export const admissionsRegistrationSavedAction = "registration.saved";
export const admissionsRegistrationSubmittedAction = "registration.submitted";
export const admissionsRegistrationTermsAcceptedAction = "registration.terms_accepted";
export const admissionsRegistrationDocumentUploadedAction = "document.uploaded";
export const admissionsRegistrationLapsedAction = "registration.lapsed";
export const admissionsRegistrationReopenedAction = "registration.reopened";
export const admissionsRegistrationEntityType = "admissions_registration";
export const admissionsRegistrationLapsedTemplateKey = "registration_lapsed_notice";
export const admissionsRegistrationReopenedTemplateKey = "registration_reopened_notice";
export const admissionsRegistrationTermsVersion = "registration-terms-2026-07-28-v1";
export const admissionsRegistrationTermsText =
  "I agree to the BETAR registration terms and conditions for my accepted course place, including the course participation, attendance, assessment, fee liability, and data processing terms presented in this portal.";
export const admissionsRegistrationTermsHash = createHash("sha256").update(admissionsRegistrationTermsText).digest("hex");

export const admissionsRegistrationDocumentSlotKeys = [
  "identity_evidence",
  "qualification_evidence",
  "student_id_photo"
] as const;

export type AdmissionsRegistrationStatus = (typeof admissionsRegistrationStatuses)[number];
export type AdmissionsRegistrationDocumentSlotKey = (typeof admissionsRegistrationDocumentSlotKeys)[number];
export type AdmissionsRegistrationDocumentVerificationRoute = "upload" | "in_person";
export type AdmissionsRegistrationDocumentBucket = "id-documents" | "qualification-documents" | "student-photos";
export type AdmissionsRegistrationDocumentRetentionClass = "identity_document" | "qualification_document" | "student_photo";

export interface AdmissionsRegistrationDocumentSlotDefinition {
  key: AdmissionsRegistrationDocumentSlotKey;
  label: string;
  required: boolean;
  bucket: AdmissionsRegistrationDocumentBucket;
  retentionClass: AdmissionsRegistrationDocumentRetentionClass;
  acceptedMimeTypes: string[];
  acceptedExtensions: string[];
  maxBytes: number;
}

export interface AdmissionsRegistrationAccessRow {
  offerStatus: string;
  offerPersonId: string;
  actorPersonId: string;
  leadStage: string;
  archived: boolean;
  convertedStudentId?: string | null;
}

export interface AdmissionsRegistrationAuditInput {
  registrationId: string;
  offerId: string;
  applicationId: string;
  admissionLeadId: string;
  personId: string;
  status?: AdmissionsRegistrationStatus;
}

export interface StaffRegistrationReopenAccessRow {
  registrationStatus?: string | null;
  convertedStudentId?: string | null;
  leadStage: string;
}

export interface StaffRegistrationReopenAccessDecision {
  allowed: boolean;
  reason: "allowed" | "missing_registration" | "not_lapsed" | "already_converted" | "lead_not_reopenable";
}

export interface AdmissionsRegistrationDocumentValidationInput {
  file: Pick<File, "name" | "size" | "type">;
  slotKey: AdmissionsRegistrationDocumentSlotKey;
}

export interface AdmissionsRegistrationDocumentValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedFilename: string;
  contentType: string;
  extension: string;
}

export const admissionsRegistrationDocumentSlotDefinitions: AdmissionsRegistrationDocumentSlotDefinition[] = [
  {
    key: "identity_evidence",
    label: "Identity evidence",
    required: true,
    bucket: "id-documents",
    retentionClass: "identity_document",
    acceptedMimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
    acceptedExtensions: [".pdf", ".png", ".jpg", ".jpeg", ".webp"],
    maxBytes: 10 * 1024 * 1024
  },
  {
    key: "qualification_evidence",
    label: "Qualification certificate or transcript",
    required: true,
    bucket: "qualification-documents",
    retentionClass: "qualification_document",
    acceptedMimeTypes: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/png",
      "image/jpeg",
      "image/webp"
    ],
    acceptedExtensions: [".pdf", ".docx", ".png", ".jpg", ".jpeg", ".webp"],
    maxBytes: 25 * 1024 * 1024
  },
  {
    key: "student_id_photo",
    label: "Student ID photo",
    required: false,
    bucket: "student-photos",
    retentionClass: "student_photo",
    acceptedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    acceptedExtensions: [".png", ".jpg", ".jpeg", ".webp"],
    maxBytes: 10 * 1024 * 1024
  }
];

const slotDefinitionByKey = new Map(admissionsRegistrationDocumentSlotDefinitions.map((slot) => [slot.key, slot]));

const nullableText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => (value.length > 0 ? value : null));

const optionalDate = z
  .string()
  .trim()
  .transform((value, context) => {
    if (!value) {
      return null;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid date."
      });
      return z.NEVER;
    }

    return value;
  });

const nullableEmail = z
  .string()
  .trim()
  .transform((value, context) => {
    if (!value) {
      return null;
    }

    const parsed = z.string().email().safeParse(value);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid email address."
      });
      return z.NEVER;
    }

    return parsed.data.toLowerCase();
  });

const idSchema = z.string().uuid();

const beginRegistrationSchema = z.object({
  offer_id: idSchema
});

const registrationDraftSchema = z.object({
  registration_id: idSchema,
  title: nullableText(40),
  first_name: nullableText(120),
  middle_names: nullableText(160),
  last_name: nullableText(120),
  preferred_name: nullableText(120),
  previous_surname: nullableText(120),
  date_of_birth: optionalDate,
  email: nullableEmail,
  phone: nullableText(80),
  address_line_1: nullableText(180),
  address_line_2: nullableText(180),
  city: nullableText(120),
  postcode: nullableText(40),
  country: nullableText(120),
  module_confirmation_accepted: z.boolean()
});

const registrationDocumentUploadSchema = z.object({
  registration_id: idSchema,
  slot_key: z.enum(admissionsRegistrationDocumentSlotKeys)
});

const registrationDocumentVerificationRouteSchema = z.object({
  registration_id: idSchema,
  slot_key: z.enum(admissionsRegistrationDocumentSlotKeys),
  verification_route: z.enum(["upload", "in_person"])
});

const staffRegistrationDocumentVerificationSchema = z.object({
  application_id: idSchema,
  registration_id: idSchema,
  slot_id: idSchema,
  verification_route: z.enum(["upload", "in_person"]),
  verification_status: z.enum(["unverified", "verified", "rejected"]),
  verification_note: nullableText(4000)
});

const registrationSubmitSchema = z
  .object({
    registration_id: idSchema,
    terms_accepted: z.boolean()
  })
  .superRefine((payload, context) => {
    if (!payload.terms_accepted) {
      context.addIssue({
        code: "custom",
        path: ["terms_accepted"],
        message: "Terms acceptance is required before registration submission."
      });
    }
  });

const registrationDeadlineWorkflowFormSchema = z.object({
  lapse_reason: nullableText(4000).default("Registration deadline passed before submission or conversion.")
});

const registrationReopenSchema = z.object({
  registration_id: idSchema,
  application_id: idSchema,
  reopen_reason: z.string().trim().min(1, "Reopen reason is required.").max(4000),
  new_deadline_at: z
    .string()
    .trim()
    .transform((value, context) => {
      if (!value) {
        return null;
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T23:59:59Z`))) {
        context.addIssue({
          code: "custom",
          message: "Enter a valid registration deadline."
        });
        return z.NEVER;
      }

      return `${value}T23:59:59Z`;
    })
});

export type BeginAdmissionsRegistrationPayload = z.infer<typeof beginRegistrationSchema>;
export type AdmissionsRegistrationDraftPayload = z.infer<typeof registrationDraftSchema>;
export type AdmissionsRegistrationDocumentUploadPayload = z.infer<typeof registrationDocumentUploadSchema>;
export type AdmissionsRegistrationDocumentVerificationRoutePayload = z.infer<typeof registrationDocumentVerificationRouteSchema>;
export type StaffRegistrationDocumentVerificationPayload = z.infer<typeof staffRegistrationDocumentVerificationSchema>;
export type SubmitAdmissionsRegistrationPayload = z.infer<typeof registrationSubmitSchema>;
export type ProcessAdmissionsRegistrationDeadlineWorkflowPayload = z.infer<typeof registrationDeadlineWorkflowFormSchema>;
export type ReopenLapsedAdmissionsRegistrationPayload = z.infer<typeof registrationReopenSchema>;

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function formBoolean(formData: FormData, key: string): boolean {
  const value = String(formData.get(key) ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

export function parseBeginAdmissionsRegistrationForm(formData: FormData): BeginAdmissionsRegistrationPayload {
  return beginRegistrationSchema.parse({
    offer_id: formString(formData, "offer_id")
  });
}

export function parseAdmissionsRegistrationDraftForm(formData: FormData): AdmissionsRegistrationDraftPayload {
  return registrationDraftSchema.parse({
    registration_id: formString(formData, "registration_id"),
    title: formString(formData, "title"),
    first_name: formString(formData, "first_name"),
    middle_names: formString(formData, "middle_names"),
    last_name: formString(formData, "last_name"),
    preferred_name: formString(formData, "preferred_name"),
    previous_surname: formString(formData, "previous_surname"),
    date_of_birth: formString(formData, "date_of_birth"),
    email: formString(formData, "email"),
    phone: formString(formData, "phone"),
    address_line_1: formString(formData, "address_line_1"),
    address_line_2: formString(formData, "address_line_2"),
    city: formString(formData, "city"),
    postcode: formString(formData, "postcode"),
    country: formString(formData, "country"),
    module_confirmation_accepted: formBoolean(formData, "module_confirmation_accepted")
  });
}

export function parseAdmissionsRegistrationDocumentUploadForm(
  formData: FormData
): AdmissionsRegistrationDocumentUploadPayload {
  return registrationDocumentUploadSchema.parse({
    registration_id: formString(formData, "registration_id"),
    slot_key: formString(formData, "slot_key")
  });
}

export function parseAdmissionsRegistrationDocumentVerificationRouteForm(
  formData: FormData
): AdmissionsRegistrationDocumentVerificationRoutePayload {
  return registrationDocumentVerificationRouteSchema.parse({
    registration_id: formString(formData, "registration_id"),
    slot_key: formString(formData, "slot_key"),
    verification_route: formString(formData, "verification_route")
  });
}

export function parseStaffRegistrationDocumentVerificationForm(
  formData: FormData
): StaffRegistrationDocumentVerificationPayload {
  return staffRegistrationDocumentVerificationSchema.parse({
    application_id: formString(formData, "application_id"),
    registration_id: formString(formData, "registration_id"),
    slot_id: formString(formData, "slot_id"),
    verification_route: formString(formData, "verification_route"),
    verification_status: formString(formData, "verification_status"),
    verification_note: formString(formData, "verification_note")
  });
}

export function parseSubmitAdmissionsRegistrationForm(formData: FormData): SubmitAdmissionsRegistrationPayload {
  return registrationSubmitSchema.parse({
    registration_id: formString(formData, "registration_id"),
    terms_accepted: formBoolean(formData, "terms_accepted")
  });
}

export function parseProcessAdmissionsRegistrationDeadlineWorkflowForm(
  formData: FormData
): ProcessAdmissionsRegistrationDeadlineWorkflowPayload {
  return registrationDeadlineWorkflowFormSchema.parse({
    lapse_reason: formString(formData, "lapse_reason")
  });
}

export function parseReopenLapsedAdmissionsRegistrationForm(
  formData: FormData
): ReopenLapsedAdmissionsRegistrationPayload {
  return registrationReopenSchema.parse({
    registration_id: formString(formData, "registration_id"),
    application_id: formString(formData, "application_id"),
    reopen_reason: formString(formData, "reopen_reason"),
    new_deadline_at: formString(formData, "new_deadline_at")
  });
}

export function getAdmissionsRegistrationDocumentSlotDefinition(
  slotKey: AdmissionsRegistrationDocumentSlotKey
): AdmissionsRegistrationDocumentSlotDefinition {
  const definition = slotDefinitionByKey.get(slotKey);
  if (!definition) {
    throw new Error("Unknown registration document slot.");
  }
  return definition;
}

export function validateAdmissionsRegistrationDocumentUpload(
  input: AdmissionsRegistrationDocumentValidationInput
): AdmissionsRegistrationDocumentValidationResult {
  const definition = getAdmissionsRegistrationDocumentSlotDefinition(input.slotKey);
  const sanitizedFilename = sanitizeApplicationDocumentFilename(input.file.name);
  const contentType = input.file.type.trim().toLowerCase();
  const extensionIndex = sanitizedFilename.lastIndexOf(".");
  const extension = extensionIndex >= 0 ? sanitizedFilename.slice(extensionIndex).toLowerCase() : "";
  const errors: string[] = [];

  if (input.file.size <= 0) {
    errors.push("Choose a non-empty file.");
  }

  if (input.file.size > definition.maxBytes) {
    errors.push(`File must be ${Math.floor(definition.maxBytes / 1024 / 1024)} MB or smaller.`);
  }

  if (!definition.acceptedMimeTypes.includes(contentType)) {
    errors.push("File type is not accepted for this slot.");
  }

  if (!definition.acceptedExtensions.includes(extension)) {
    errors.push("File extension is not accepted for this slot.");
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitizedFilename,
    contentType,
    extension
  };
}

export function buildAdmissionsRegistrationDocumentObjectPath(
  personId: string,
  registrationId: string,
  slotKey: AdmissionsRegistrationDocumentSlotKey,
  sanitizedFilename: string,
  uniqueToken: string
): string {
  return `${personId}/${registrationId}/${slotKey}/${uniqueToken}-${sanitizedFilename}`;
}

export function canAccessAcceptedOfferRegistration(row: AdmissionsRegistrationAccessRow): boolean {
  return (
    row.offerStatus === "accepted" &&
    row.offerPersonId === row.actorPersonId &&
    !row.archived &&
    !row.convertedStudentId &&
    ["accepted", "registration_in_progress"].includes(row.leadStage)
  );
}

export function canReopenLapsedRegistration(
  row: StaffRegistrationReopenAccessRow | undefined
): StaffRegistrationReopenAccessDecision {
  if (!row) {
    return { allowed: false, reason: "missing_registration" };
  }

  if (row.convertedStudentId || row.registrationStatus === "complete") {
    return { allowed: false, reason: "already_converted" };
  }

  if (row.registrationStatus !== "lapsed") {
    return { allowed: false, reason: "not_lapsed" };
  }

  if (row.leadStage !== "registration_lapsed") {
    return { allowed: false, reason: "lead_not_reopenable" };
  }

  return { allowed: true, reason: "allowed" };
}

export function buildAdmissionsRegistrationAuditMetadata(input: AdmissionsRegistrationAuditInput): JsonRecord {
  return buildAuditEventInsert({
    actor_type: "applicant",
    action: admissionsRegistrationSavedAction,
    entity_type: admissionsRegistrationEntityType,
    entity_id: input.registrationId,
    metadata: {
      registration_id: input.registrationId,
      offer_id: input.offerId,
      application_id: input.applicationId,
      admission_lead_id: input.admissionLeadId,
      person_id: input.personId,
      status: input.status ?? "in_progress"
    }
  }).metadata;
}
