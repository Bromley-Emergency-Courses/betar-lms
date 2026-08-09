import "server-only";

import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import {
  getAdmissionsEmailConfig,
  isSupportedAdmissionsTemplateKey,
  renderCorrespondenceEmail,
  type AdmissionsEmailConfig,
  type RenderedCorrespondenceEmail
} from "@/lib/admissions-email";
import type { CorrespondenceDeliveryStatus, JsonRecord } from "@/lib/audit-correspondence";
import { createSupabaseServiceRoleClient, isSupabaseServiceRoleConfigured } from "@/lib/supabase-admin";

export type CorrespondenceEmailDeliveryResult =
  | { status: "disabled" }
  | { status: "skipped"; reason: "already_sent" | "unsupported_template" | "missing_service_role" }
  | { status: "sent"; providerMessageId: string | null }
  | { status: "failed"; error: string };

export interface DirectAdmissionsEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

interface CorrespondenceLogRow {
  id: string;
  recipient_email: string;
  recipient_name: string | null;
  template_key: string;
  rendered_subject: string;
  delivery_status: CorrespondenceDeliveryStatus;
  metadata: JsonRecord;
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
  providerMessageId?: string | null
) {
  const supabase = createSupabaseServiceRoleClient();
  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    delivery_status: deliveryStatus,
    metadata
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
  if (!emailConfig.enabled) {
    return { status: "disabled" };
  }

  if (!isSupabaseServiceRoleConfigured()) {
    return { status: "skipped", reason: "missing_service_role" };
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("correspondence_logs")
    .select("id, recipient_email, recipient_name, template_key, rendered_subject, delivery_status, metadata")
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

  if (!isSupportedAdmissionsTemplateKey(row.template_key)) {
    return { status: "skipped", reason: "unsupported_template" };
  }

  if (!emailConfig.config) {
    const message = `Admissions email is enabled but missing env vars: ${emailConfig.missing.join(", ")}`;
    await updateDeliveryStatus(row.id, "failed", {
      ...row.metadata,
      delivery_status: "failed",
      production_email_send_enabled: true,
      email_delivery_error: message
    });
    return { status: "failed", error: message };
  }

  const rendered = renderCorrespondenceEmail({
    templateKey: row.template_key,
    recipientName: row.recipient_name,
    renderedSubject: row.rendered_subject,
    metadata: { ...row.metadata, ...transientMetadata }
  });

  try {
    const providerMessageId =
      emailConfig.config.provider === "graph"
        ? await sendWithGraph(emailConfig.config, row.recipient_email, rendered)
        : await sendWithSmtp(emailConfig.config, row.recipient_email, rendered);

    await updateDeliveryStatus(row.id, "sent", {
      ...row.metadata,
      delivery_status: "sent",
      production_email_send_enabled: true,
      provider_message_id: providerMessageId,
      sent_via: emailConfig.config.provider,
      sent_at: new Date().toISOString()
    }, providerMessageId);

    return { status: "sent", providerMessageId };
  } catch (error) {
    const message = safeErrorMessage(error);
    await updateDeliveryStatus(row.id, "failed", {
      ...row.metadata,
      delivery_status: "failed",
      production_email_send_enabled: true,
      provider_message_id: null,
      email_delivery_error: message,
      failed_at: new Date().toISOString()
    });
    return { status: "failed", error: message };
  }
}

export async function sendDirectAdmissionsEmail(input: DirectAdmissionsEmailInput): Promise<CorrespondenceEmailDeliveryResult> {
  const emailConfig = getAdmissionsEmailConfig();
  if (!emailConfig.enabled) {
    return { status: "disabled" };
  }

  if (!emailConfig.config) {
    return {
      status: "failed",
      error: `Admissions email is enabled but missing env vars: ${emailConfig.missing.join(", ")}`
    };
  }

  try {
    const providerMessageId =
      emailConfig.config.provider === "graph"
        ? await sendWithGraph(emailConfig.config, input.to, {
            subject: input.subject,
            text: input.text,
            html: input.html
          })
        : await sendWithSmtp(emailConfig.config, input.to, {
            subject: input.subject,
            text: input.text,
            html: input.html
          });

    return { status: "sent", providerMessageId };
  } catch (error) {
    return { status: "failed", error: safeErrorMessage(error) };
  }
}

export function correspondenceEmailFailed(result: CorrespondenceEmailDeliveryResult): boolean {
  return result.status === "failed" || (result.status === "skipped" && result.reason === "missing_service_role");
}
