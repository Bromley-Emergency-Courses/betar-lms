export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

export type AuditActorType = "staff" | "applicant" | "student" | "service";
export type CorrespondenceChannel = "email" | "letter";
export type CorrespondenceDeliveryStatus = "queued" | "sent" | "delivered" | "failed" | "bounced" | "suppressed";
export type CorrespondenceBounceStatus = "none" | "soft_bounce" | "hard_bounce" | "complaint" | "blocked" | "unknown";

export interface AuditEventInsert {
  actor_type: AuditActorType;
  actor_user_id?: string | null;
  actor_person_id?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  reason?: string | null;
  metadata: JsonRecord;
}

export interface CorrespondenceLogInsert {
  person_id: string;
  recipient_email: string;
  recipient_name?: string | null;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
  template_id?: string | null;
  template_key: string;
  template_version: number;
  channel: CorrespondenceChannel;
  rendered_subject: string;
  rendered_body?: string | null;
  delivery_provider?: string | null;
  provider_message_id?: string | null;
  delivery_status?: CorrespondenceDeliveryStatus;
  bounce_status?: CorrespondenceBounceStatus;
  sent_at?: string | null;
  generated_file_id?: string | null;
  operational_batch_id?: string | null;
  operational_batch_target_id?: string | null;
  attempt_number?: number;
  metadata: JsonRecord;
  created_by_user_id?: string | null;
}

const sensitiveKeyFragments = [
  "authorization",
  "bankaccount",
  "cardnumber",
  "cookie",
  "cvv",
  "dateofbirth",
  "diagnosis",
  "disability",
  "dob",
  "drivinglicence",
  "health",
  "medical",
  "nationalinsurance",
  "ninumber",
  "passportnumber",
  "password",
  "secret",
  "session",
  "sortcode",
  "token"
];

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isSensitiveAuditMetadataKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return sensitiveKeyFragments.some((fragment) => normalized.includes(fragment));
}

export function redactAuditMetadataValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(redactAuditMetadataValue);
  }

  if (value !== null && typeof value === "object") {
    return redactAuditMetadata(value);
  }

  return value;
}

export function redactAuditMetadata(metadata: JsonRecord = {}): JsonRecord {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      isSensitiveAuditMetadataKey(key) ? "[redacted]" : redactAuditMetadataValue(value)
    ])
  );
}

export function buildAuditEventInsert(input: Omit<AuditEventInsert, "metadata"> & { metadata?: JsonRecord }): AuditEventInsert {
  return {
    ...input,
    actor_user_id: input.actor_user_id ?? null,
    actor_person_id: input.actor_person_id ?? null,
    entity_id: input.entity_id ?? null,
    reason: input.reason ?? null,
    metadata: redactAuditMetadata(input.metadata)
  };
}

export function buildCorrespondenceLogInsert(
  input: Omit<CorrespondenceLogInsert, "metadata"> & { metadata?: JsonRecord }
): CorrespondenceLogInsert {
  return {
    ...input,
    recipient_name: input.recipient_name ?? null,
    related_entity_type: input.related_entity_type ?? null,
    related_entity_id: input.related_entity_id ?? null,
    template_id: input.template_id ?? null,
    rendered_body: input.rendered_body ?? null,
    delivery_provider: input.delivery_provider ?? null,
    provider_message_id: input.provider_message_id ?? null,
    delivery_status: input.delivery_status ?? "queued",
    bounce_status: input.bounce_status ?? "none",
    sent_at: input.sent_at ?? null,
    generated_file_id: input.generated_file_id ?? null,
    operational_batch_id: input.operational_batch_id ?? null,
    operational_batch_target_id: input.operational_batch_target_id ?? null,
    attempt_number: input.attempt_number ?? 1,
    created_by_user_id: input.created_by_user_id ?? null,
    metadata: input.metadata ?? {}
  };
}
