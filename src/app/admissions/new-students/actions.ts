"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  applicationSupportNeedsViewedAction,
  buildApplicationSupportNeedsViewedAuditMetadata
} from "@/lib/application-review";
import { requirePermission } from "@/lib/auth";
import { correspondenceEmailFailed, sendCorrespondenceLogEmail } from "@/lib/email-delivery";
import {
  parseAdmissionOutcomeForm,
  parseOfferReissueForm,
  parseOfferWithdrawalForm
} from "@/lib/new-student-terminal-actions";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

export interface RevealApplicationSupportNeedsState {
  status: "idle" | "revealed" | "unavailable";
  supportDetail?: string;
  requestedAdjustments?: string;
  message?: string;
}

const supportNeedsReferenceSchema = z.object({
  admission_id: z.string().uuid(),
  application_id: z.string().uuid()
});

const applicationDeadlineSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function revalidateAdmission(admissionId: string, offerChanged = false) {
  revalidatePath("/admissions");
  revalidatePath("/admissions/new-students");
  revalidatePath(`/admissions/new-students/${admissionId}`);
  if (offerChanged) revalidatePath("/portal");
}

function admissionRedirect(admissionId: string, result: string): never {
  redirect(`/admissions/new-students/${admissionId}?${result}=1#workflow-actions`);
}

function correspondenceLogIdFromRpc(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as { correspondence_log_id?: unknown }).correspondence_log_id;
  return typeof value === "string" ? value : null;
}

export async function abandonNewStudentAdmission(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseAdmissionOutcomeForm(formData);
  if (!isSupabaseConfigured()) admissionRedirect(parsed.admission_id, "admission_abandoned_demo");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("abandon_new_student_admission", {
    p_admission_lead_id: parsed.admission_id,
    p_reason: parsed.reason
  });
  if (error) throw new Error(error.message);

  revalidateAdmission(parsed.admission_id);
  admissionRedirect(parsed.admission_id, "admission_abandoned");
}

export async function setNewStudentApplicationDeadline(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = applicationDeadlineSchema.safeParse(String(formData.get("application_deadline") ?? ""));
  if (!parsed.success) redirect("/admissions/new-students?deadline_error=invalid");
  const deadline = parsed.data;
  if (!isSupabaseConfigured()) redirect("/admissions/new-students?deadline_updated=demo");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_published_term_application_deadline", {
    p_deadline_date: deadline
  });
  if (error) {
    const code = error.message.includes("before the target term starts")
      ? "after_term_start"
      : error.message.includes("published target term")
        ? "no_published_term"
        : "failed";
    redirect(`/admissions/new-students?deadline_error=${code}`);
  }

  revalidatePath("/admissions");
  revalidatePath("/admissions/new-students");
  revalidatePath("/apply/application");
  redirect("/admissions/new-students?deadline_updated=1");
}

export async function reopenAbandonedNewStudentAdmission(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseAdmissionOutcomeForm(formData);
  if (!isSupabaseConfigured()) admissionRedirect(parsed.admission_id, "abandonment_reopened_demo");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reopen_abandoned_new_student_admission", {
    p_admission_lead_id: parsed.admission_id,
    p_reason: parsed.reason
  });
  if (error) throw new Error(error.message);

  revalidateAdmission(parsed.admission_id);
  admissionRedirect(parsed.admission_id, "abandonment_reopened");
}

export async function reissueLapsedApplicationOffer(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseOfferReissueForm(formData);
  if (!isSupabaseConfigured()) admissionRedirect(parsed.admission_id, "offer_reissued_demo");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("reissue_lapsed_application_offer", {
    p_offer_id: parsed.offer_id,
    p_new_deadline_at: parsed.new_deadline_at,
    p_reason: parsed.reason
  });
  if (error) throw new Error(error.message);

  revalidateAdmission(parsed.admission_id, true);
  const correspondenceLogId = correspondenceLogIdFromRpc(data);
  if (correspondenceLogId) {
    const delivery = await sendCorrespondenceLogEmail(correspondenceLogId);
    if (correspondenceEmailFailed(delivery)) {
      admissionRedirect(parsed.admission_id, "offer_reissue_email_failed");
    }
  }
  admissionRedirect(parsed.admission_id, "offer_reissued");
}

export async function withdrawApplicationOffer(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseOfferWithdrawalForm(formData);
  if (!isSupabaseConfigured()) admissionRedirect(parsed.admission_id, "offer_withdrawn_demo");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("withdraw_application_offer", {
    p_offer_id: parsed.offer_id,
    p_reason: parsed.reason
  });
  if (error) throw new Error(error.message);

  revalidateAdmission(parsed.admission_id, true);
  const correspondenceLogId = correspondenceLogIdFromRpc(data);
  if (correspondenceLogId) {
    const delivery = await sendCorrespondenceLogEmail(correspondenceLogId);
    if (correspondenceEmailFailed(delivery)) {
      admissionRedirect(parsed.admission_id, "offer_withdrawal_email_failed");
    }
  }
  admissionRedirect(parsed.admission_id, "offer_withdrawn");
}

export async function revealApplicationSupportNeeds(
  _previousState: RevealApplicationSupportNeedsState,
  formData: FormData
): Promise<RevealApplicationSupportNeedsState> {
  const staff = await requirePermission("manage_admissions");
  const parsed = supportNeedsReferenceSchema.parse({
    admission_id: String(formData.get("admission_id") ?? ""),
    application_id: String(formData.get("application_id") ?? "")
  });

  if (!isSupabaseConfigured()) {
    return {
      status: "revealed",
      supportDetail: "Applicant disclosed a disability-related support need.",
      requestedAdjustments: "May need scheduling notice for practical sessions."
    };
  }

  const supabase = await createSupabaseServerClient();
  const applicationResult = await supabase
    .from("applications")
    .select("id, admission_lead_id, person_id")
    .eq("id", parsed.application_id)
    .eq("admission_lead_id", parsed.admission_id)
    .maybeSingle();
  if (applicationResult.error) throw new Error(applicationResult.error.message);
  if (!applicationResult.data) {
    return { status: "unavailable", message: "The application record could not be verified." };
  }

  const supportResult = await supabase
    .from("application_support_needs")
    .select("disclosed, support_detail, requested_adjustments")
    .eq("application_id", parsed.application_id)
    .maybeSingle();
  if (supportResult.error) throw new Error(supportResult.error.message);
  if (!supportResult.data) {
    return { status: "unavailable", message: "No restricted support information is recorded." };
  }

  const { error: auditError } = await supabase.from("audit_events").insert({
    actor_type: "staff",
    actor_user_id: staff.id,
    actor_person_id: null,
    action: applicationSupportNeedsViewedAction,
    entity_type: "application_support_needs",
    entity_id: parsed.application_id,
    reason: null,
    metadata: buildApplicationSupportNeedsViewedAuditMetadata({
      applicationId: parsed.application_id,
      admissionLeadId: parsed.admission_id,
      personId: String(applicationResult.data.person_id),
      disclosed: Boolean(supportResult.data.disclosed),
      supportDetail: supportResult.data.support_detail,
      requestedAdjustments: supportResult.data.requested_adjustments
    })
  });
  if (auditError) throw new Error(`Failed to audit restricted-information access: ${auditError.message}`);

  return {
    status: "revealed",
    supportDetail: supportResult.data.support_detail ?? undefined,
    requestedAdjustments: supportResult.data.requested_adjustments ?? undefined
  };
}
