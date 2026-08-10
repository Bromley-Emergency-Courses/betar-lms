import "server-only";

import { applicationMagicLinkRedirectUrl, isIssuedApplicationInvitation } from "@/lib/application-invitations";
import { resolveAdmissionsBatchPreview } from "@/lib/admissions-batch-review-data";
import { sendCorrespondenceLogEmail } from "@/lib/email-delivery";
import { sendPortalMagicLinkEmail } from "@/lib/portal-email";
import { createSupabaseServerClient } from "@/lib/supabase";

interface ClaimedBatchTarget {
  target_id: string;
  batch_action: string;
  entity_id: string;
  correspondence_log_id?: string | null;
}

function deliveryOutcome(result: Awaited<ReturnType<typeof sendPortalMagicLinkEmail>>) {
  if (result.status === "sent" || (result.status === "skipped" && result.reason === "already_sent")) {
    return { status: "succeeded" as const, reason: null };
  }
  if (result.status === "suppressed") {
    return { status: "excluded" as const, reason: `Email was suppressed by the ${result.reason.replaceAll("_", " ")} safety rule.` };
  }
  if (result.status === "disabled") {
    return { status: "excluded" as const, reason: "Email delivery was disabled before this target executed." };
  }
  const reason = result.status === "failed"
    ? result.error
    : `Email delivery could not run: ${result.reason.replaceAll("_", " ")}.`;
  return { status: "failed" as const, reason };
}

async function finishTarget(targetId: string, status: "succeeded" | "failed" | "excluded", reason: string | null) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("finish_admissions_operational_batch_target", {
    p_target_id: targetId,
    p_status: status,
    p_reason: reason
  });
  if (error) throw new Error(error.message);
}

async function executeInvitationTarget(target: ClaimedBatchTarget, batch: Record<string, unknown>, origin: string) {
  const preview = await resolveAdmissionsBatchPreview({
    workspace: "new_students",
    action: "invite_application",
    scope: "one",
    selected_ids: [target.entity_id],
    filters: { search: "", attention: "all", stage: "all" },
    rendered_subject: String(batch.rendered_subject),
    rendered_body: String(batch.rendered_body)
  });
  const reviewed = preview.targets[0];
  if (!reviewed?.eligible) {
    await finishTarget(target.target_id, "excluded", reviewed?.exclusion_reason ?? "The admissions record is no longer eligible for invitation.");
    return;
  }

  const supabase = await createSupabaseServerClient();
  const invitationResult = await supabase.rpc("issue_application_invitation", { p_lead_id: target.entity_id });
  if (invitationResult.error) throw new Error(invitationResult.error.message);
  if (!isIssuedApplicationInvitation(invitationResult.data)) throw new Error("Invitation workflow returned an invalid response.");
  const invitation = invitationResult.data;

  const logResult = await supabase
    .from("correspondence_logs")
    .select("id")
    .eq("related_entity_type", "application_invitation")
    .eq("related_entity_id", invitation.invitation_id)
    .eq("delivery_status", "queued")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (logResult.error) throw new Error(logResult.error.message);
  if (!logResult.data) throw new Error("The queued invitation correspondence was not found.");

  const linkResult = await supabase.rpc("link_invitation_operational_batch_target", {
    p_target_id: target.target_id,
    p_correspondence_log_id: String(logResult.data.id),
    p_person_id: invitation.person_id,
    p_recipient_email: invitation.email,
    p_recipient_name: reviewed.recipient_name ?? "Applicant"
  });
  if (linkResult.error) throw new Error(linkResult.error.message);

  const delivery = await sendPortalMagicLinkEmail({
    email: invitation.email,
    recipientName: reviewed.recipient_name,
    subject: String(batch.rendered_subject),
    templateKey: "application_invitation",
    redirectTo: applicationMagicLinkRedirectUrl(origin, "/apply/application", invitation),
    personId: invitation.person_id,
    admissionLeadId: invitation.lead_id,
    metadata: {
      admission_lead_id: invitation.lead_id,
      invitation_id: invitation.invitation_id,
      application_target_term_id: typeof reviewed.source_snapshot.application_target_term_id === "string"
        ? reviewed.source_snapshot.application_target_term_id
        : null,
      application_deadline_at: typeof reviewed.source_snapshot.application_deadline_at === "string"
        ? reviewed.source_snapshot.application_deadline_at
        : null,
      application_deadline_state: "due"
    }
  });
  const outcome = deliveryOutcome(delivery);
  await finishTarget(target.target_id, outcome.status, outcome.reason);
}

async function executeAbandonmentTarget(target: ClaimedBatchTarget, batch: Record<string, unknown>) {
  const reason = typeof batch.action_reason === "string" ? batch.action_reason : "";
  const preview = await resolveAdmissionsBatchPreview({
    workspace: "new_students",
    action: "close_abandoned",
    scope: "one",
    selected_ids: [target.entity_id],
    filters: { search: "", attention: "all", stage: "all" },
    action_reason: reason
  });
  const reviewed = preview.targets[0];
  if (!reviewed?.eligible) {
    await finishTarget(target.target_id, "excluded", reviewed?.exclusion_reason ?? "The admissions record is no longer eligible for abandonment.");
    return;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("abandon_new_student_admission", {
    p_admission_lead_id: target.entity_id,
    p_reason: reason
  });
  if (error) throw new Error(error.message);
  await finishTarget(target.target_id, "succeeded", null);
}

async function executeApplicationReminderTarget(target: ClaimedBatchTarget, batch: Record<string, unknown>) {
  const preview = await resolveAdmissionsBatchPreview({
    workspace: "new_students",
    action: "send_reminder",
    scope: "one",
    selected_ids: [target.entity_id],
    filters: { search: "", attention: "all", stage: "all" },
    rendered_subject: String(batch.rendered_subject),
    rendered_body: String(batch.rendered_body)
  });
  const reviewed = preview.targets[0];
  if (!reviewed?.eligible) {
    await finishTarget(target.target_id, "excluded", reviewed?.exclusion_reason ?? "The application is no longer eligible for a reminder.");
    return;
  }
  let correspondenceLogId = target.correspondence_log_id ?? null;
  if (!correspondenceLogId) {
    const supabase = await createSupabaseServerClient();
    const logResult = await supabase
      .from("correspondence_logs")
      .select("id")
      .eq("operational_batch_target_id", target.target_id)
      .order("attempt_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (logResult.error) throw new Error(logResult.error.message);
    correspondenceLogId = logResult.data ? String(logResult.data.id) : null;
  }
  if (!correspondenceLogId) throw new Error("The queued application reminder correspondence was not found.");

  const delivery = await sendCorrespondenceLogEmail(correspondenceLogId);
  const outcome = deliveryOutcome(delivery);
  await finishTarget(target.target_id, outcome.status, outcome.reason);
}

async function executeTarget(target: ClaimedBatchTarget, batch: Record<string, unknown>, origin: string) {
  try {
    if (target.batch_action === "invite_application") await executeInvitationTarget(target, batch, origin);
    else if (target.batch_action === "send_reminder") await executeApplicationReminderTarget(target, batch);
    else if (target.batch_action === "close_abandoned") await executeAbandonmentTarget(target, batch);
    else await finishTarget(target.target_id, "excluded", "This batch action is not available in the current executor.");
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 2000) : "Operational target execution failed.";
    try {
      await finishTarget(target.target_id, "failed", reason);
    } catch {
      // A later recovery pass will reclaim a target if the outcome write itself was interrupted.
    }
  }
}

export async function processAdmissionsOperationalBatch(batchId: string, origin: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const batchResult = await supabase
    .from("admissions_operational_batches")
    .select("id, action, status, action_reason, rendered_subject, rendered_body")
    .eq("id", batchId)
    .maybeSingle();
  if (batchResult.error || !batchResult.data || !["queued", "running"].includes(String(batchResult.data.status))) return;
  const batch = batchResult.data as Record<string, unknown>;
  if (!["invite_application", "send_reminder", "close_abandoned"].includes(String(batch.action))) return;

  await supabase.rpc("requeue_stale_admissions_operational_batch_targets", {
    p_batch_id: batchId,
    p_stale_before: new Date(Date.now() - 5 * 60 * 1000).toISOString()
  });

  for (let round = 0; round < 100; round += 1) {
    const claimResult = await supabase.rpc("claim_admissions_operational_batch_targets", {
      p_batch_id: batchId,
      p_limit: 5
    });
    if (claimResult.error) return;
    const targets = (claimResult.data ?? []) as ClaimedBatchTarget[];
    if (targets.length === 0) return;
    await Promise.all(targets.map((target) => executeTarget(target, batch, origin)));
  }
}
