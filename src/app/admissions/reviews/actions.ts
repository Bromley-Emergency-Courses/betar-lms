"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseRecordApplicationDecisionForm } from "@/lib/application-decisions";
import { parseProcessApplicationOfferDeadlineWorkflowForm } from "@/lib/application-offers";
import { parseConvertSubmittedAdmissionsRegistrationForm } from "@/lib/admissions-conversion";
import {
  parseProcessAdmissionsRegistrationDeadlineWorkflowForm,
  parseReopenLapsedAdmissionsRegistrationForm
} from "@/lib/admissions-registration";
import {
  parseRecordStaffApplicationReviewForm,
  parseVerifyApplicationDocumentForm
} from "@/lib/application-review";
import { requirePermission } from "@/lib/auth";
import { correspondenceEmailFailed, sendCorrespondenceLogEmail } from "@/lib/email-delivery";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

function reviewRedirect(applicationId: string, result: string): never {
  redirect(`/admissions/reviews?application=${applicationId}&${result}=1#application-${applicationId}`);
}

function correspondenceLogIdFromRpc(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const value = (data as { correspondence_log_id?: unknown }).correspondence_log_id;
  return typeof value === "string" ? value : null;
}

export async function verifyApplicationDocument(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseVerifyApplicationDocumentForm(formData);

  if (!isSupabaseConfigured()) {
    reviewRedirect(parsed.application_id, "document_demo");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("verify_application_document_slot", {
    p_slot_id: parsed.slot_id,
    p_verification_status: parsed.verification_status,
    p_verification_note: parsed.verification_note
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/reviews");
  revalidatePath("/admissions");
  reviewRedirect(parsed.application_id, "document_verified");
}

export async function recordStaffApplicationReview(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseRecordStaffApplicationReviewForm(formData);

  if (!isSupabaseConfigured()) {
    reviewRedirect(parsed.application_id, "review_demo");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_staff_application_review", {
    p_application_id: parsed.application_id,
    p_readiness_status: parsed.readiness_status,
    p_review_notes: parsed.review_notes,
    p_decision_reason_notes: parsed.decision_reason_notes
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/reviews");
  revalidatePath("/admissions");
  reviewRedirect(parsed.application_id, "review_saved");
}

export async function recordApplicationDecision(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseRecordApplicationDecisionForm(formData);

  if (!isSupabaseConfigured()) {
    reviewRedirect(parsed.application_id, "decision_demo");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("record_application_decision", {
    p_application_id: parsed.application_id,
    p_decision_outcome: parsed.decision_outcome,
    p_decision_reason: parsed.decision_reason,
    p_offer_deadline_at: parsed.offer_deadline_at
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/reviews");
  revalidatePath("/admissions");
  const correspondenceLogId = correspondenceLogIdFromRpc(data);
  if (correspondenceLogId) {
    const deliveryResult = await sendCorrespondenceLogEmail(correspondenceLogId);
    if (correspondenceEmailFailed(deliveryResult)) {
      reviewRedirect(parsed.application_id, "decision_email_failed");
    }
  }

  reviewRedirect(parsed.application_id, "decision_recorded");
}

export async function processApplicationOfferDeadlineWorkflow(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseProcessApplicationOfferDeadlineWorkflowForm(formData);

  if (!isSupabaseConfigured()) {
    redirect("/admissions/reviews?offer_deadlines_demo=1");
  }

  const supabase = await createSupabaseServerClient();
  const referenceTime = new Date().toISOString();
  const { error } = await supabase.rpc("process_application_offer_deadline_workflow", {
    p_reference_time: referenceTime,
    p_reminder_window_days: parsed.reminder_window_days
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/reviews");
  revalidatePath("/admissions");
  revalidatePath("/portal");

  const correspondenceResult = await supabase
    .from("correspondence_logs")
    .select("id")
    .in("template_key", ["offer_deadline_reminder", "offer_lapsed_notice"])
    .eq("delivery_status", "suppressed")
    .filter("metadata->>reference_time", "eq", referenceTime);

  if (correspondenceResult.error) {
    throw new Error(correspondenceResult.error.message);
  }

  let failedCount = 0;
  let sentCount = 0;
  let disabled = false;
  for (const row of correspondenceResult.data ?? []) {
    const deliveryResult = await sendCorrespondenceLogEmail(String(row.id));
    if (deliveryResult.status === "disabled") {
      disabled = true;
      break;
    }
    if (correspondenceEmailFailed(deliveryResult)) {
      failedCount += 1;
    } else if (deliveryResult.status === "sent") {
      sentCount += 1;
    }
  }

  if (disabled) {
    redirect("/admissions/reviews?offer_deadlines_email_disabled=1");
  }
  if (failedCount > 0) {
    redirect(`/admissions/reviews?${sentCount > 0 ? "offer_deadlines_email_partial" : "offer_deadlines_email_failed"}=1`);
  }

  redirect("/admissions/reviews?offer_deadlines_processed=1");
}

export async function convertSubmittedAdmissionsRegistration(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseConvertSubmittedAdmissionsRegistrationForm(formData);

  if (!isSupabaseConfigured()) {
    reviewRedirect(parsed.application_id, "conversion_demo");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("convert_submitted_admissions_registration", {
    p_registration_id: parsed.registration_id
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/reviews");
  revalidatePath("/admissions");
  revalidatePath("/students");
  revalidatePath("/portal");
  reviewRedirect(parsed.application_id, "registration_converted");
}

export async function processAdmissionsRegistrationDeadlineWorkflow(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseProcessAdmissionsRegistrationDeadlineWorkflowForm(formData);

  if (!isSupabaseConfigured()) {
    redirect("/admissions/reviews?registration_deadlines_demo=1");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("process_admissions_registration_deadline_workflow", {
    p_reference_time: new Date().toISOString(),
    p_lapse_reason: parsed.lapse_reason
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/reviews");
  revalidatePath("/admissions");
  revalidatePath("/portal");
  redirect("/admissions/reviews?registration_deadlines_processed=1");
}

export async function reopenLapsedAdmissionsRegistration(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseReopenLapsedAdmissionsRegistrationForm(formData);

  if (!isSupabaseConfigured()) {
    reviewRedirect(parsed.application_id, "registration_reopened_demo");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reopen_lapsed_admissions_registration", {
    p_registration_id: parsed.registration_id,
    p_reopen_reason: parsed.reopen_reason,
    p_new_deadline_at: parsed.new_deadline_at
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/reviews");
  revalidatePath("/admissions");
  revalidatePath("/portal");
  revalidatePath("/portal/registration");
  reviewRedirect(parsed.application_id, "registration_reopened");
}
