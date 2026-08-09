import "server-only";

import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import {
  evaluateAdmissionsEmailSafety,
  getAdmissionsEmailConfig,
  isSupportedAdmissionsTemplateKey,
  renderCorrespondenceEmail,
  type AdmissionsEmailConfig,
  type AdmissionsEmailRecipientIdentity,
  type AdmissionsEmailTestRecordMatch,
  type RenderedCorrespondenceEmail
} from "@/lib/admissions-email";
import type { CorrespondenceDeliveryStatus, JsonRecord } from "@/lib/audit-correspondence";
import { createSupabaseServiceRoleClient, isSupabaseServiceRoleConfigured } from "@/lib/supabase-admin";

export type CorrespondenceEmailDeliveryResult =
  | { status: "disabled" }
  | { status: "skipped"; reason: "already_sent" | "unsupported_template" | "missing_service_role" }
  | {
      status: "suppressed";
      reason:
        | "master_disabled"
        | "recipient_not_allowlisted"
        | "missing_related_record"
        | "related_record_not_marked_fake";
    }
  | { status: "sent"; providerMessageId: string | null }
  | { status: "failed"; error: string };

interface CorrespondenceLogRow {
  id: string;
  person_id: string;
  recipient_email: string;
  recipient_name: string | null;
  template_key: string;
  rendered_subject: string;
  rendered_body: string | null;
  delivery_status: CorrespondenceDeliveryStatus;
  metadata: JsonRecord;
}

function metadataIdentifier(metadata: JsonRecord, key: "admission_lead_id" | "student_id"): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function correspondenceIdentity(row: CorrespondenceLogRow): AdmissionsEmailRecipientIdentity {
  return {
    personId: row.person_id,
    admissionLeadId: metadataIdentifier(row.metadata, "admission_lead_id"),
    studentId: metadataIdentifier(row.metadata, "student_id")
  };
}

function asJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed.";
}

async function graphErrorMessage(response: Response): Promise<string> {
  const body = await response.text();
  if (!body) {
    return `Microsoft Graph request failed with status ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string } };
    const code = parsed.error?.code ? `${parsed.error.code}: ` : "";
    return `${code}${parsed.error?.message ?? body}`.slice(0, 500);
  } catch {
    return body.slice(0, 500);
  }
}

async function getGraphAccessToken(config: Extract<AdmissionsEmailConfig, { provider: "graph" }>): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default"
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error(await graphErrorMessage(response));
  }

  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("Microsoft Graph token response did not include an access token.");
  }

  return payload.access_token;
}

async function sendWithGraph(
  config: Extract<AdmissionsEmailConfig, { provider: "graph" }>,
  recipientEmail: string,
  rendered: RenderedCorrespondenceEmail
): Promise<string | null> {
  const accessToken = await getGraphAccessToken(config);
  const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderEmail)}/sendMail`;
  const response = await fetch(sendUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      message: {
        subject: rendered.subject,
        body: {
          contentType: "HTML",
          content: rendered.html
        },
        toRecipients: [
          {
            emailAddress: {
              address: recipientEmail
            }
          }
        ],
        replyTo: config.replyTo
          ? [
              {
                emailAddress: {
                  address: config.replyTo
                }
              }
            ]
          : undefined
      },
      saveToSentItems: true
    })
  });

  if (!response.ok) {
    throw new Error(await graphErrorMessage(response));
  }

  return null;
}

async function sendWithSmtp(
  config: Extract<AdmissionsEmailConfig, { provider: "smtp" }>,
  recipientEmail: string,
  rendered: RenderedCorrespondenceEmail
): Promise<string | null> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: true,
    tls: {
      minVersion: "TLSv1.2"
    },
    auth: {
      user: config.user,
      pass: config.password
    }
  } satisfies SMTPTransport.Options);

  const info = await transporter.sendMail({
    from: config.from,
    to: recipientEmail,
    replyTo: config.replyTo,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html
  });

  return typeof info.messageId === "string" ? info.messageId : null;
}

async function updateDeliveryStatus(
  correspondenceLogId: string,
  deliveryStatus: CorrespondenceDeliveryStatus,
  metadata: JsonRecord,
  providerMessageId?: string | null,
  deliveryProvider?: string | null
) {
  const supabase = createSupabaseServiceRoleClient();
  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    delivery_status: deliveryStatus,
    metadata,
    delivery_provider: deliveryProvider ?? null
  };

  if (deliveryStatus === "sent") {
    updatePayload.sent_at = now;
    updatePayload.provider_message_id = providerMessageId ?? null;
  }

  const { error } = await supabase
    .from("correspondence_logs")
    .update(updatePayload)
    .eq("id", correspondenceLogId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function sendCorrespondenceLogEmail(
  correspondenceLogId: string,
  transientMetadata: JsonRecord = {}
): Promise<CorrespondenceEmailDeliveryResult> {
  const emailConfig = getAdmissionsEmailConfig();

  if (!isSupabaseServiceRoleConfigured()) {
    return { status: "skipped", reason: "missing_service_role" };
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("correspondence_logs")
    .select("id, person_id, recipient_email, recipient_name, template_key, rendered_subject, rendered_body, delivery_status, metadata")
    .eq("id", correspondenceLogId)
    .maybeSingle();

  if (error) {
    return { status: "failed", error: error.message };
  }
  if (!data) {
    return { status: "failed", error: "Correspondence log was not found." };
  }

  const row = {
    ...data,
    metadata: asJsonRecord(data.metadata)
  } as CorrespondenceLogRow;

  if (row.delivery_status === "sent" || row.delivery_status === "delivered") {
    return { status: "skipped", reason: "already_sent" };
  }

  if (!emailConfig.enabled) {
    await updateDeliveryStatus(row.id, "suppressed", {
      ...row.metadata,
      delivery_status: "suppressed",
      email_delivery_mode: "disabled",
      email_suppression_reason: "master_disabled",
      suppressed_at: new Date().toISOString()
    });
    return { status: "disabled" };
  }

  if (!isSupportedAdmissionsTemplateKey(row.template_key)) {
    return { status: "skipped", reason: "unsupported_template" };
  }

  let testRecords: AdmissionsEmailTestRecordMatch[] = [];
  if (emailConfig.mode === "pilot") {
    const testRecordResult = await supabase
      .from("admissions_email_test_records")
      .select("person_id, admission_lead_id, student_id")
      .eq("person_id", row.person_id)
      .eq("active", true);

    if (testRecordResult.error) {
      const message = `Pilot recipient verification failed: ${testRecordResult.error.message}`;
      await updateDeliveryStatus(row.id, "failed", {
        ...row.metadata,
        delivery_status: "failed",
        email_delivery_mode: "pilot",
        email_delivery_error: message,
        failed_at: new Date().toISOString()
      });
      return { status: "failed", error: message };
    }

    testRecords = (testRecordResult.data ?? []) as AdmissionsEmailTestRecordMatch[];
  }

  const safety = evaluateAdmissionsEmailSafety({
    mode: emailConfig.mode,
    pilotAllowlist: emailConfig.pilotAllowlist,
    recipient: row.recipient_email,
    identity: correspondenceIdentity(row),
    testRecords
  });

  if (!safety.allowed) {
    await updateDeliveryStatus(row.id, "suppressed", {
      ...row.metadata,
      delivery_status: "suppressed",
      email_delivery_mode: emailConfig.mode,
      email_suppression_reason: safety.reason,
      suppressed_at: new Date().toISOString()
    });
    return { status: "suppressed", reason: safety.reason };
  }

  if (!emailConfig.config) {
    const message = `Admissions email is enabled but missing env vars: ${emailConfig.missing.join(", ")}`;
    await updateDeliveryStatus(row.id, "failed", {
      ...row.metadata,
      delivery_status: "failed",
      email_delivery_mode: emailConfig.mode,
      email_delivery_error: message
    });
    return { status: "failed", error: message };
  }

  const rendered = renderCorrespondenceEmail({
    templateKey: row.template_key,
    recipientName: row.recipient_name,
    renderedSubject: row.rendered_subject,
    renderedBody: row.rendered_body,
    metadata: {
      ...row.metadata,
      ...transientMetadata
    }
  });

  try {
    const providerMessageId =
      emailConfig.config.provider === "graph"
        ? await sendWithGraph(emailConfig.config, row.recipient_email, rendered)
        : await sendWithSmtp(emailConfig.config, row.recipient_email, rendered);

    await updateDeliveryStatus(row.id, "sent", {
      ...row.metadata,
      delivery_status: "sent",
      email_delivery_mode: emailConfig.mode,
      provider_message_id: providerMessageId,
      sent_via: emailConfig.config.provider,
      sent_at: new Date().toISOString()
    }, providerMessageId, emailConfig.config.provider);

    return { status: "sent", providerMessageId };
  } catch (error) {
    const message = safeErrorMessage(error);
    await updateDeliveryStatus(row.id, "failed", {
      ...row.metadata,
      delivery_status: "failed",
      email_delivery_mode: emailConfig.mode,
      provider_message_id: null,
      email_delivery_error: message,
      failed_at: new Date().toISOString()
    }, null, emailConfig.config.provider);
    return { status: "failed", error: message };
  }
}

export function correspondenceEmailFailed(result: CorrespondenceEmailDeliveryResult): boolean {
  return (
    result.status === "failed" ||
    result.status === "suppressed" ||
    (result.status === "skipped" && result.reason !== "already_sent")
  );
}
