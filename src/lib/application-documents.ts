import { z } from "zod";

export const applicationDocumentUploadedAction = "document.uploaded";
export const applicationDocumentEntityType = "application_document";

export const applicationDocumentSlotKeys = [
  "qualification_evidence",
  "professional_registration_evidence",
  "cv_or_supporting_evidence",
  "funding_evidence"
] as const;

export type ApplicationDocumentSlotKey = (typeof applicationDocumentSlotKeys)[number];
export type ApplicationDocumentVerificationStatus = "unverified" | "verified" | "rejected";
export type ApplicationDocumentBucket = "application-docs" | "qualification-documents";
export type ApplicationDocumentRetentionClass = "application_document" | "qualification_document";

export interface ApplicationDocumentSlotDefinition {
  key: ApplicationDocumentSlotKey;
  label: string;
  required: boolean;
  bucket: ApplicationDocumentBucket;
  retentionClass: ApplicationDocumentRetentionClass;
  acceptedMimeTypes: string[];
  acceptedExtensions: string[];
  maxBytes: number;
}

export interface ApplicationDocumentValidationInput {
  file: Pick<File, "name" | "size" | "type">;
  slotKey: ApplicationDocumentSlotKey;
}

export interface ApplicationDocumentValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedFilename: string;
  contentType: string;
  extension: string;
}

const twentyFiveMb = 25 * 1024 * 1024;

const commonApplicationMimeTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp"
];

const commonApplicationExtensions = [".pdf", ".docx", ".txt", ".png", ".jpg", ".jpeg", ".webp"];

export const applicationDocumentSlotDefinitions: ApplicationDocumentSlotDefinition[] = [
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
    maxBytes: twentyFiveMb
  },
  {
    key: "professional_registration_evidence",
    label: "Professional registration evidence",
    required: true,
    bucket: "application-docs",
    retentionClass: "application_document",
    acceptedMimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
    acceptedExtensions: [".pdf", ".png", ".jpg", ".jpeg", ".webp"],
    maxBytes: 10 * 1024 * 1024
  },
  {
    key: "cv_or_supporting_evidence",
    label: "CV or supporting evidence",
    required: false,
    bucket: "application-docs",
    retentionClass: "application_document",
    acceptedMimeTypes: commonApplicationMimeTypes,
    acceptedExtensions: commonApplicationExtensions,
    maxBytes: twentyFiveMb
  },
  {
    key: "funding_evidence",
    label: "Funding or sponsor evidence",
    required: false,
    bucket: "application-docs",
    retentionClass: "application_document",
    acceptedMimeTypes: commonApplicationMimeTypes,
    acceptedExtensions: commonApplicationExtensions,
    maxBytes: twentyFiveMb
  }
];

const slotDefinitionByKey = new Map(applicationDocumentSlotDefinitions.map((slot) => [slot.key, slot]));

const uploadFormSchema = z.object({
  application_id: z.string().uuid(),
  slot_key: z.enum(applicationDocumentSlotKeys)
});

export type ApplicationDocumentUploadPayload = z.infer<typeof uploadFormSchema>;

export function parseApplicationDocumentUploadForm(formData: FormData): ApplicationDocumentUploadPayload {
  return uploadFormSchema.parse({
    application_id: String(formData.get("application_id") ?? ""),
    slot_key: String(formData.get("slot_key") ?? "")
  });
}

export function getApplicationDocumentSlotDefinition(slotKey: ApplicationDocumentSlotKey): ApplicationDocumentSlotDefinition {
  const definition = slotDefinitionByKey.get(slotKey);
  if (!definition) {
    throw new Error("Unknown application document slot.");
  }
  return definition;
}

export function getRequiredApplicationDocumentSlotKeys(): ApplicationDocumentSlotKey[] {
  return applicationDocumentSlotDefinitions.filter((slot) => slot.required).map((slot) => slot.key);
}

export function sanitizeApplicationDocumentFilename(filename: string): string {
  const trimmed = filename.trim().split(/[\\/]/).pop() ?? "document";
  const cleaned = trimmed
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .toLowerCase();
  const extensionIndex = cleaned.lastIndexOf(".");
  const ascii =
    extensionIndex > 0
      ? `${cleaned.slice(0, extensionIndex).replace(/[.-]+$/g, "")}${cleaned.slice(extensionIndex)}`
      : cleaned;

  return ascii.length > 0 ? ascii.slice(0, 140) : "document";
}

export function getFilenameExtension(filename: string): string {
  const sanitized = sanitizeApplicationDocumentFilename(filename);
  const index = sanitized.lastIndexOf(".");
  return index >= 0 ? sanitized.slice(index).toLowerCase() : "";
}

export function validateApplicationDocumentUpload(input: ApplicationDocumentValidationInput): ApplicationDocumentValidationResult {
  const definition = getApplicationDocumentSlotDefinition(input.slotKey);
  const sanitizedFilename = sanitizeApplicationDocumentFilename(input.file.name);
  const contentType = input.file.type.trim().toLowerCase();
  const extension = getFilenameExtension(sanitizedFilename);
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

export function buildApplicationDocumentObjectPath(
  personId: string,
  applicationId: string,
  slotKey: ApplicationDocumentSlotKey,
  sanitizedFilename: string,
  uniqueToken: string
): string {
  return `${personId}/${applicationId}/${slotKey}/${uniqueToken}-${sanitizedFilename}`;
}
