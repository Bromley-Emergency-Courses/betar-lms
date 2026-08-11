import "server-only";

import {
  evaluateAdmissionsEmailSafety,
  getAdmissionsEmailConfig,
  type AdmissionsEmailTemplateKey,
  type AdmissionsEmailTestRecordMatch
} from "@/lib/admissions-email";
import { sendCorrespondenceLogEmail, type CorrespondenceEmailDeliveryResult } from "@/lib/email-delivery";
import { portalMagicLinkCallbackUrl } from "@/lib/portal-magic-link";
import { createSupabaseServiceRoleClient, isSupabaseServiceRoleConfigured } from "@/lib/supabase-admin";

export interface PortalMagicLinkEmailInput {
  email: string;
  recipientName?: string | null;
  subject: string;
  templateKey: AdmissionsEmailTemplateKey;
  redirectTo: string;
  personId?: string | null;
  admissionLeadId?: string | null;
  studentId?: string | null;
  correspondenceLogId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

interface ResolvedPortalRecipient {
  personId: string;
  admissionLeadId: string | null;
  studentId: string | null;
}

async function resolvePortalRecipient(
  input: PortalMagicLinkEmailInput
): Promise<ResolvedPortalRecipient | null> {
  if (input.personId && (input.admissionLeadId || input.studentId)) {
    return {
      personId: input.personId,
      admissionLeadId: input.admissionLeadId ?? null,
      studentId: input.studentId ?? null
    };
  }

  const supabase = createSupabaseServiceRoleClient();
  const identityResult = await supabase
    .from("person_auth_identities")
    .select("person_id")
    .eq("active", true)
    .eq("actor_type", "applicant")
    .eq("email", input.email.trim().toLowerCase())
    .limit(3);

  if (identityResult.error) {
    throw new Error(identityResult.error.message);
  }

  const personIds = [...new Set((identityResult.data ?? []).map((row) => String(row.person_id)))];
  if (personIds.length !== 1) {
    return null;
  }

  const leadResult = await supabase
    .from("admission_leads")
    .select("id")
    .eq("person_id", personIds[0])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (leadResult.error) {
    throw new Error(leadResult.error.message);
  }
  if (!leadResult.data) {
    return null;
  }

  return {
    personId: personIds[0],
    admissionLeadId: String(leadResult.data.id),
    studentId: null
  };
}

async function findOrCreateCorrespondenceLog(
  input: PortalMagicLinkEmailInput,
  recipient: ResolvedPortalRecipient
): Promise<string> {
  const supabase = createSupabaseServiceRoleClient();

  if (input.correspondenceLogId) {
    const existingResult = await supabase
      .from("correspondence_logs")
      .select("id")
      .eq("id", input.correspondenceLogId)
      .eq("person_id", recipient.personId)
      .eq("recipient_email", input.email.trim().toLowerCase())
      .eq("template_key", input.templateKey)
      .maybeSingle();

    if (existingResult.error) {
      throw new Error(existingResult.error.message);
    }
    if (!existingResult.data) {
      throw new Error("The requested correspondence log does not match this portal recipient.");
    }

    return String(existingResult.data.id);
  }

  const invitationId = input.metadata?.invitation_id;

  if (typeof invitationId === "string" && invitationId.length > 0) {
    const existingResult = await supabase
      .from("correspondence_logs")
      .select("id")
      .eq("person_id", recipient.personId)
      .eq("related_entity_type", "application_invitation")
      .eq("related_entity_id", invitationId)
      .eq("delivery_status", "queued")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingResult.error) {
      throw new Error(existingResult.error.message);
    }
    if (existingResult.data) {
      return String(existingResult.data.id);
    }
  }

  const relatedEntityType = recipient.studentId ? "student" : "admission_lead";
  const relatedEntityId = recipient.studentId ?? recipient.admissionLeadId;
  if (!relatedEntityId) {
    throw new Error("A related applicant or student record is required for correspondence.");
  }

  const { data, error } = await supabase
    .from("correspondence_logs")
    .insert({
      person_id: recipient.personId,
      recipient_email: input.email.trim().toLowerCase(),
      recipient_name: input.recipientName?.trim() || null,
      related_entity_type: relatedEntityType,
      related_entity_id: relatedEntityId,
      template_key: input.templateKey,
      template_version: 1,
      channel: "email",
      rendered_subject: input.subject.trim(),
      delivery_status: "queued",
      metadata: {
        ...(input.metadata ?? {}),
        ...(recipient.admissionLeadId ? { admission_lead_id: recipient.admissionLeadId } : {}),
        ...(recipient.studentId ? { student_id: recipient.studentId } : {})
      }
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return String(data.id);
}

async function markMagicLinkGenerationFailed(correspondenceLogId: string, message: string) {
  const supabase = createSupabaseServiceRoleClient();
  const { data } = await supabase
    .from("correspondence_logs")
    .select("metadata")
    .eq("id", correspondenceLogId)
    .maybeSingle();
  const metadata = data?.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
    ? data.metadata
    : {};

  await supabase
    .from("correspondence_logs")
    .update({
      delivery_status: "failed",
      metadata: {
        ...metadata,
        delivery_status: "failed",
        email_delivery_error: message.slice(0, 500),
        failed_at: new Date().toISOString()
      }
    })
    .eq("id", correspondenceLogId);
}

async function mergeCorrespondenceMetadata(
  correspondenceLogId: string,
  metadata: Record<string, string | number | boolean | null>
) {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("correspondence_logs")
    .select("metadata")
    .eq("id", correspondenceLogId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const existing = data?.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
    ? data.metadata
    : {};
  const updateResult = await supabase
    .from("correspondence_logs")
    .update({ metadata: { ...existing, ...metadata } })
    .eq("id", correspondenceLogId);
  if (updateResult.error) throw new Error(updateResult.error.message);
}

async function suppressMagicLinkAttempt(correspondenceLogId: string, mode: string, reason: string) {
  const supabase = createSupabaseServiceRoleClient();
  const { data } = await supabase
    .from("correspondence_logs")
    .select("metadata")
    .eq("id", correspondenceLogId)
    .maybeSingle();
  const metadata = data?.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
    ? data.metadata
    : {};

  await supabase
    .from("correspondence_logs")
    .update({
      delivery_status: "suppressed",
      metadata: {
        ...metadata,
        delivery_status: "suppressed",
        email_delivery_mode: mode,
        email_suppression_reason: reason,
        suppressed_at: new Date().toISOString()
      }
    })
    .eq("id", correspondenceLogId);
}

export async function sendPortalMagicLinkEmail(
  input: PortalMagicLinkEmailInput
): Promise<CorrespondenceEmailDeliveryResult> {
  if (!isSupabaseServiceRoleConfigured()) {
    return { status: "skipped", reason: "missing_service_role" };
  }

  let recipient: ResolvedPortalRecipient | null;
  try {
    recipient = await resolvePortalRecipient(input);
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Portal recipient lookup failed." };
  }

  if (!recipient) {
    return { status: "suppressed", reason: "missing_related_record" };
  }

  let correspondenceLogId: string;
  try {
    correspondenceLogId = await findOrCreateCorrespondenceLog(input, recipient);
    if (input.metadata) await mergeCorrespondenceMetadata(correspondenceLogId, input.metadata);
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Correspondence attempt could not be created." };
  }

  const emailConfig = getAdmissionsEmailConfig();
  if (!emailConfig.enabled) {
    await suppressMagicLinkAttempt(correspondenceLogId, "disabled", "master_disabled");
    return { status: "disabled" };
  }

  if (!emailConfig.config) {
    return sendCorrespondenceLogEmail(correspondenceLogId);
  }

  if (emailConfig.mode === "pilot") {
    const pilotRecordResult = await createSupabaseServiceRoleClient()
      .from("admissions_email_test_records")
      .select("person_id, admission_lead_id, student_id")
      .eq("person_id", recipient.personId)
      .eq("active", true);

    if (pilotRecordResult.error) {
      const message = `Pilot recipient verification failed: ${pilotRecordResult.error.message}`;
      await markMagicLinkGenerationFailed(correspondenceLogId, message);
      return { status: "failed", error: message };
    }

    const safety = evaluateAdmissionsEmailSafety({
      mode: emailConfig.mode,
      pilotAllowlist: emailConfig.pilotAllowlist,
      recipient: input.email,
      identity: {
        personId: recipient.personId,
        admissionLeadId: recipient.admissionLeadId,
        studentId: recipient.studentId
      },
      testRecords: (pilotRecordResult.data ?? []) as AdmissionsEmailTestRecordMatch[]
    });

    if (!safety.allowed) {
      await suppressMagicLinkAttempt(correspondenceLogId, emailConfig.mode, safety.reason);
      return { status: "suppressed", reason: safety.reason };
    }
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
    await markMagicLinkGenerationFailed(correspondenceLogId, error.message);
    return { status: "failed", error: error.message };
  }

  const actionLink = portalMagicLinkCallbackUrl(data, input.redirectTo);
  if (!actionLink) {
    const message = "Supabase did not return valid magic-link verification details.";
    await markMagicLinkGenerationFailed(correspondenceLogId, message);
    return { status: "failed", error: message };
  }

  return sendCorrespondenceLogEmail(correspondenceLogId, { ...(input.metadata ?? {}), action_link: actionLink });
}
