import { z } from "zod";

export const modulePreferenceWindowStatuses = ["draft", "open", "closed", "confirmed"] as const;
export const modulePreferenceWindowCreatedAction = "module_preference_window.created";
export const modulePreferenceWindowOpenedAction = "module_preference_window.opened";
export const modulePreferenceWindowClosedAction = "module_preference_window.closed";
export const modulePreferenceWindowConfirmedAction = "module_preference_window.confirmed";
export const modulePreferenceSubmittedAction = "module_preference.submitted";
export const modulePreferenceUpdatedAction = "module_preference.updated";
export const modulePreferenceWindowEntityType = "module_preference_window";
export const modulePreferenceSubmissionEntityType = "module_preference_submission";

export type ModulePreferenceWindowStatus = (typeof modulePreferenceWindowStatuses)[number];

export interface ModulePreferenceWindowLifecycleInput {
  status: ModulePreferenceWindowStatus;
  closesAt?: string | null;
}

export interface ModulePreferenceSubmissionAccessInput {
  status: ModulePreferenceWindowStatus;
  opensAt: string;
  closesAt: string;
  now?: Date;
}

export interface ModulePreferenceSubmissionAccessDecision {
  allowed: boolean;
  reason: "allowed" | "not_open" | "not_started" | "closed";
}

export interface ModulePreferenceChoiceValidationInput {
  offeringIds: string[];
  availableOfferingIds: string[];
}

export interface ModulePreferenceChoiceValidationResult {
  valid: boolean;
  errors: string[];
  normalizedOfferingIds: string[];
}

const idSchema = z.string().uuid();

const nullableText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => (value.length > 0 ? value : null));

const dateTimeInput = z
  .string()
  .trim()
  .transform((value, context) => {
    if (!value || Number.isNaN(Date.parse(value))) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid date and time."
      });
      return z.NEVER;
    }

    return new Date(value).toISOString();
  });

const offeringIdsSchema = z
  .array(idSchema)
  .transform((values) => values.filter((value) => value.length > 0))
  .superRefine((values, context) => {
    if (values.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Choose at least one module offering for the window."
      });
    }

    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        message: "Duplicate module offerings are not allowed."
      });
    }
  });

const windowFormSchema = z
  .object({
    window_id: z.union([idSchema, z.literal("")]).transform((value) => (value ? value : null)),
    term_id: idSchema,
    title: z.string().trim().min(1, "Window title is required.").max(200),
    opens_at: dateTimeInput,
    closes_at: dateTimeInput,
    offering_ids: offeringIdsSchema,
    notes: nullableText(4000)
  })
  .superRefine((payload, context) => {
    if (new Date(payload.opens_at).getTime() >= new Date(payload.closes_at).getTime()) {
      context.addIssue({
        code: "custom",
        path: ["closes_at"],
        message: "Close date must be after the open date."
      });
    }
  });

const lifecycleFormSchema = z.object({
  window_id: idSchema
});

const submissionFormSchema = z
  .object({
    window_id: idSchema,
    first_choice_offering_id: z.union([idSchema, z.literal("")]).transform((value) => (value ? value : null)),
    second_choice_offering_id: z.union([idSchema, z.literal("")]).transform((value) => (value ? value : null)),
    skip_reason: nullableText(1000)
  })
  .transform((payload) => ({
    window_id: payload.window_id,
    first_choice_offering_id: payload.first_choice_offering_id,
    second_choice_offering_id: payload.second_choice_offering_id,
    offering_ids: [payload.first_choice_offering_id, payload.second_choice_offering_id].filter((value): value is string =>
      Boolean(value)
    ),
    skip_reason: payload.skip_reason
  }))
  .superRefine((payload, context) => {
    const uniqueIds = new Set(payload.offering_ids);

    if (uniqueIds.size !== payload.offering_ids.length) {
      context.addIssue({
        code: "custom",
        path: ["offering_ids"],
        message: "Duplicate module preferences are not allowed."
      });
    }

    if (!payload.first_choice_offering_id && payload.second_choice_offering_id) {
      context.addIssue({
        code: "custom",
        path: ["first_choice_offering_id"],
        message: "Choose a first preference before choosing a second preference."
      });
    }
  });

export type ModulePreferenceWindowFormPayload = z.infer<typeof windowFormSchema>;
export type ModulePreferenceLifecyclePayload = z.infer<typeof lifecycleFormSchema>;
export type ModulePreferenceSubmissionPayload = z.infer<typeof submissionFormSchema>;

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function formStrings(formData: FormData, key: string): string[] {
  return formData.getAll(key).map(String).filter(Boolean);
}

function parseOrThrow<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join(" "));
  }
  return parsed.data;
}

export function parseModulePreferenceWindowForm(formData: FormData): ModulePreferenceWindowFormPayload {
  return parseOrThrow(windowFormSchema, {
    window_id: formString(formData, "window_id"),
    term_id: formString(formData, "term_id"),
    title: formString(formData, "title"),
    opens_at: formString(formData, "opens_at"),
    closes_at: formString(formData, "closes_at"),
    offering_ids: formStrings(formData, "offering_ids"),
    notes: formString(formData, "notes")
  });
}

export function parseModulePreferenceLifecycleForm(formData: FormData): ModulePreferenceLifecyclePayload {
  return parseOrThrow(lifecycleFormSchema, {
    window_id: formString(formData, "window_id")
  });
}

export function parseModulePreferenceSubmissionForm(formData: FormData): ModulePreferenceSubmissionPayload {
  return parseOrThrow(submissionFormSchema, {
    window_id: formString(formData, "window_id"),
    first_choice_offering_id: formString(formData, "first_choice_offering_id"),
    second_choice_offering_id: formString(formData, "second_choice_offering_id"),
    skip_reason: formString(formData, "skip_reason")
  });
}

export function canSubmitModulePreferences(
  input: ModulePreferenceSubmissionAccessInput
): ModulePreferenceSubmissionAccessDecision {
  if (input.status !== "open") {
    return { allowed: false, reason: "not_open" };
  }

  const now = input.now ?? new Date();
  if (new Date(input.opensAt).getTime() > now.getTime()) {
    return { allowed: false, reason: "not_started" };
  }

  if (new Date(input.closesAt).getTime() <= now.getTime()) {
    return { allowed: false, reason: "closed" };
  }

  return { allowed: true, reason: "allowed" };
}

export function canOpenModulePreferenceWindow(input: ModulePreferenceWindowLifecycleInput): boolean {
  return input.status === "draft" && (!input.closesAt || new Date(input.closesAt).getTime() > Date.now());
}

export function canCloseModulePreferenceWindow(status: ModulePreferenceWindowStatus): boolean {
  return status === "open";
}

export function canConfirmModulePreferenceWindow(status: ModulePreferenceWindowStatus): boolean {
  return status === "closed";
}

export function validateModulePreferenceChoices(
  input: ModulePreferenceChoiceValidationInput
): ModulePreferenceChoiceValidationResult {
  const normalizedOfferingIds = input.offeringIds.filter(Boolean);
  const errors: string[] = [];
  const uniqueIds = new Set(normalizedOfferingIds);
  const availableIds = new Set(input.availableOfferingIds);

  if (normalizedOfferingIds.length > 2) {
    errors.push("Choose no more than two module offerings.");
  }

  if (uniqueIds.size !== normalizedOfferingIds.length) {
    errors.push("Duplicate module preferences are not allowed.");
  }

  if (normalizedOfferingIds.some((offeringId) => !availableIds.has(offeringId))) {
    errors.push("Selected module offerings must be available in this preference window.");
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedOfferingIds
  };
}
