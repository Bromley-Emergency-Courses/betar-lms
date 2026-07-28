"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseRecordApplicationDecisionForm } from "@/lib/application-decisions";
import {
  parseRecordStaffApplicationReviewForm,
  parseVerifyApplicationDocumentForm
} from "@/lib/application-review";
import { requirePermission } from "@/lib/auth";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

function reviewRedirect(applicationId: string, result: string): never {
  redirect(`/admissions/reviews?application=${applicationId}&${result}=1#application-${applicationId}`);
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
  const { error } = await supabase.rpc("record_application_decision", {
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
  reviewRedirect(parsed.application_id, "decision_recorded");
}
