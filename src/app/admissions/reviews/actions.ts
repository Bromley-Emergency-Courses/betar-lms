"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseRecordApplicationDecisionForm } from "@/lib/application-decisions";
import {
  parseApplicationEvidenceOverrideForm,
  parseCancelApplicationCorrectionForm,
  parseRequestApplicationCorrectionsForm,
  parseReviewApplicationCorrectionsForm
} from "@/lib/application-corrections";
import { parseProcessApplicationOfferDeadlineWorkflowForm } from "@/lib/application-offers";
import { parseConvertSubmittedAdmissionsRegistrationForm } from "@/lib/admissions-conversion";
import {
  parseProcessAdmissionsRegistrationDeadlineWorkflowForm,
  parseReopenLapsedAdmissionsRegistrationForm,
  parseStaffRegistrationDocumentVerificationForm
} from "@/lib/admissions-registration";
import {
  parseRecordStaffApplicationReviewForm,
  parseVerifyApplicationDocumentForm
} from "@/lib/application-review";
import { admissionsStaffWorkspacesEnabled } from "@/lib/admissions-feature";
import { requirePermission } from "@/lib/auth";
import { correspondenceEmailFailed, sendCorrespondenceLogEmail } from "@/lib/email-delivery";
import { applicationMagicLinkRedirectUrl } from "@/lib/application-invitations";
import { sendPortalMagicLinkEmail } from "@/lib/portal-email";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

function admissionIdFromForm(formData: FormData): string | null {
  const value = String(formData.get("admission_id") ?? "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function revalidateApplicantRecord(formData: FormData) {
  const admissionId = admissionIdFromForm(formData);
  revalidatePath("/admissions/new-students");
  if (admissionId) revalidatePath(`/admissions/new-students/${admissionId}`);
}

function reviewRedirect(applicationId: string, result: string, formData: FormData): never {
  const admissionId = admissionIdFromForm(formData);
  if (admissionsStaffWorkspacesEnabled() && admissionId) {
    redirect(`/admissions/new-students/${admissionId}?${result}=1#application`);
  }
  redirect(`/admissions/reviews?application=${applicationId}&${result}=1#application-${applicationId}`);
}

function correspondenceLogIdFromRpc(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const value = (data as { correspondence_log_id?: unknown }).correspondence_log_id;
  return typeof value === "string" ? value : null;
}

async function requestOrigin(): Promise<string> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost:3000";
  const protocol = headerStore.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function verifyApplicationDocument(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseVerifyApplicationDocumentForm(formData);

  if (!isSupabaseConfigured()) {
    reviewRedirect(parsed.application_id, "document_demo", formData);
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
  revalidateApplicantRecord(formData);
  reviewRedirect(parsed.application_id, "document_verified", formData);
}

export async function recordStaffApplicationReview(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseRecordStaffApplicationReviewForm(formData);

  if (!isSupabaseConfigured()) {
    reviewRedirect(parsed.application_id, "review_demo", formData);
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
  revalidateApplicantRecord(formData);
  reviewRedirect(parsed.application_id, "review_saved", formData);
}

export async function requestApplicationCorrections(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseRequestApplicationCorrectionsForm(formData);

  if (!isSupabaseConfigured()) {
    reviewRedirect(parsed.application_id, "correction_demo", formData);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("request_application_corrections", {
    p_application_id: parsed.application_id,
    p_items: parsed.items,
    p_summary: parsed.summary,
    p_due_at: parsed.due_at
  });

  if (error) {
    throw new Error(error.message);
  }

  const correspondenceLogId = correspondenceLogIdFromRpc(data);
  if (!correspondenceLogId) {
    throw new Error("The correction request did not return its correspondence attempt.");
  }

  const logResult = await supabase
    .from("correspondence_logs")
    .select("person_id, recipient_email, recipient_name, rendered_subject, metadata")
    .eq("id", correspondenceLogId)
    .maybeSingle();
  if (logResult.error) {
    throw new Error(logResult.error.message);
  }
  if (!logResult.data) {
    throw new Error("The correction correspondence attempt could not be found.");
  }

  const metadata = logResult.data.metadata && typeof logResult.data.metadata === "object" && !Array.isArray(logResult.data.metadata)
    ? logResult.data.metadata as Record<string, string | number | boolean | null>
    : {};
  const admissionLeadId = typeof metadata.admission_lead_id === "string" ? metadata.admission_lead_id : null;
  const deliveryResult = await sendPortalMagicLinkEmail({
    correspondenceLogId,
    email: logResult.data.recipient_email,
    recipientName: logResult.data.recipient_name,
    subject: logResult.data.rendered_subject,
    templateKey: "application_correction_requested",
    redirectTo: applicationMagicLinkRedirectUrl(await requestOrigin(), "/apply/application"),
    personId: logResult.data.person_id,
    admissionLeadId,
    metadata
  });

  revalidatePath("/admissions/reviews");
  revalidatePath("/admissions");
  revalidatePath("/apply/application");
  revalidateApplicantRecord(formData);
  if (deliveryResult.status === "disabled" || deliveryResult.status === "suppressed") {
    reviewRedirect(parsed.application_id, "correction_email_disabled", formData);
  }
  if (correspondenceEmailFailed(deliveryResult)) {
    reviewRedirect(parsed.application_id, "correction_email_failed", formData);
  }
  reviewRedirect(parsed.application_id, "correction_requested", formData);
}

export async function reviewApplicationCorrections(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseReviewApplicationCorrectionsForm(formData);

  if (!isSupabaseConfigured()) {
    reviewRedirect(parsed.application_id, "correction_review_demo", formData);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("review_application_corrections", {
    p_request_id: parsed.request_id,
    p_reviews: parsed.reviews
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/reviews");
  revalidatePath("/admissions");
  revalidatePath("/apply/application");
  revalidateApplicantRecord(formData);
  reviewRedirect(parsed.application_id, "correction_reviewed", formData);
}

export async function cancelApplicationCorrection(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseCancelApplicationCorrectionForm(formData);

  if (!isSupabaseConfigured()) {
    reviewRedirect(parsed.application_id, "correction_cancel_demo", formData);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_application_correction_request", {
    p_request_id: parsed.request_id,
    p_reason: parsed.reason
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/reviews");
  revalidatePath("/admissions");
  revalidatePath("/apply/application");
  revalidateApplicantRecord(formData);
  reviewRedirect(parsed.application_id, "correction_cancelled", formData);
}

export async function recordApplicationEvidenceOverride(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseApplicationEvidenceOverrideForm(formData);

  if (!isSupabaseConfigured()) {
    reviewRedirect(parsed.application_id, "evidence_override_demo", formData);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_application_evidence_override", {
    p_slot_id: parsed.slot_id,
    p_reason: parsed.reason
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/reviews");
  revalidatePath("/admissions");
  revalidateApplicantRecord(formData);
  reviewRedirect(parsed.application_id, "evidence_override_recorded", formData);
}

export async function verifyAdmissionsRegistrationDocument(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseStaffRegistrationDocumentVerificationForm(formData);

  if (!isSupabaseConfigured()) {
    reviewRedirect(parsed.application_id, "registration_document_demo", formData);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("verify_admissions_registration_document_slot", {
    p_slot_id: parsed.slot_id,
    p_verification_route: parsed.verification_route,
    p_verification_status: parsed.verification_status,
    p_verification_note: parsed.verification_note
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admissions/reviews");
  revalidatePath("/admissions");
  revalidateApplicantRecord(formData);
  reviewRedirect(parsed.application_id, "registration_document_verified", formData);
}

export async function recordApplicationDecision(formData: FormData) {
  await requirePermission("manage_admissions");
  const parsed = parseRecordApplicationDecisionForm(formData);

  if (!isSupabaseConfigured()) {
    reviewRedirect(parsed.application_id, "decision_demo", formData);
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
  revalidateApplicantRecord(formData);
  const correspondenceLogId = correspondenceLogIdFromRpc(data);
  if (correspondenceLogId) {
    const deliveryResult = await sendCorrespondenceLogEmail(correspondenceLogId);
    if (correspondenceEmailFailed(deliveryResult)) {
      reviewRedirect(parsed.application_id, "decision_email_failed", formData);
    }
  }

  reviewRedirect(parsed.application_id, "decision_recorded", formData);
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
    reviewRedirect(parsed.application_id, "conversion_demo", formData);
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
  revalidateApplicantRecord(formData);
  reviewRedirect(parsed.application_id, "registration_converted", formData);
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
    reviewRedirect(parsed.application_id, "registration_reopened_demo", formData);
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
  revalidateApplicantRecord(formData);
  reviewRedirect(parsed.application_id, "registration_reopened", formData);
}
