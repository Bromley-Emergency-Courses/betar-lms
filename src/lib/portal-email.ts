import "server-only";

import { renderCorrespondenceEmail, type AdmissionsEmailTemplateKey } from "@/lib/admissions-email";
import { sendDirectAdmissionsEmail, type CorrespondenceEmailDeliveryResult } from "@/lib/email-delivery";
import { createSupabaseServiceRoleClient, isSupabaseServiceRoleConfigured } from "@/lib/supabase-admin";

export interface PortalMagicLinkEmailInput {
  email: string;
  recipientName?: string | null;
  subject: string;
  templateKey: AdmissionsEmailTemplateKey;
  redirectTo: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export type CorrespondenceMagicLinkResult =
  | { status: "ready"; actionLink: string }
  | { status: "skipped"; reason: "missing_service_role" }
  | { status: "failed"; error: string };

function actionLinkFromGenerateLinkData(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const properties = (data as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object") {
    return null;
  }

  const actionLink = (properties as { action_link?: unknown }).action_link;
  return typeof actionLink === "string" && actionLink.length > 0 ? actionLink : null;
}

function textToHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .split("\n\n")
    .map((paragraph) => `<p>${paragraph.replaceAll("\n", "<br />")}</p>`)
    .join("\n");
}

export async function sendPortalMagicLinkEmail(
  input: PortalMagicLinkEmailInput
): Promise<CorrespondenceEmailDeliveryResult> {
  if (!isSupabaseServiceRoleConfigured()) {
    return { status: "skipped", reason: "missing_service_role" };
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: input.email,
    options: {
      redirectTo: input.redirectTo
    }
  });

  if (error) {
    return { status: "failed", error: error.message };
  }

  const actionLink = actionLinkFromGenerateLinkData(data);
  if (!actionLink) {
    return { status: "failed", error: "Supabase did not return a magic link." };
  }

  const rendered = renderCorrespondenceEmail({
    templateKey: input.templateKey,
    recipientName: input.recipientName,
    renderedSubject: input.subject,
    metadata: {
      ...(input.metadata ?? {}),
      action_link: actionLink
    }
  });

  return sendDirectAdmissionsEmail({
    to: input.email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html || textToHtml(rendered.text)
  });
}

export async function generatePortalMagicLinkForCorrespondenceLog(
  correspondenceLogId: string,
  redirectTo: string
): Promise<CorrespondenceMagicLinkResult> {
  if (!isSupabaseServiceRoleConfigured()) {
    return { status: "skipped", reason: "missing_service_role" };
  }

  const supabase = createSupabaseServiceRoleClient();
  const logResult = await supabase
    .from("correspondence_logs")
    .select("recipient_email")
    .eq("id", correspondenceLogId)
    .maybeSingle();

  if (logResult.error) {
    return { status: "failed", error: logResult.error.message };
  }
  if (!logResult.data) {
    return { status: "failed", error: "Correspondence log was not found." };
  }

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: String(logResult.data.recipient_email),
    options: { redirectTo }
  });

  if (error) {
    return { status: "failed", error: error.message };
  }

  const actionLink = actionLinkFromGenerateLinkData(data);
  if (!actionLink) {
    return { status: "failed", error: "Supabase did not return a magic link." };
  }

  return { status: "ready", actionLink };
}
