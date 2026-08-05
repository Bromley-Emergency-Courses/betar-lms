"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseRespondToApplicationOfferForm } from "@/lib/application-offers";
import { getClientIpAddress } from "@/lib/application-submit";
import { correspondenceEmailFailed, sendCorrespondenceLogEmail } from "@/lib/email-delivery";
import { requireApplicantProfile } from "@/lib/portal-auth";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

function offerResponseErrorCode(message: string): string {
  if (message.includes("deadline")) {
    return "deadline";
  }
  if (message.includes("Only issued offers")) {
    return "not_issued";
  }
  if (message.includes("admissions stage")) {
    return "stage";
  }
  if (message.includes("not found")) {
    return "not_found";
  }
  return "failed";
}

export async function respondToApplicationOffer(formData: FormData) {
  await requireApplicantProfile("/portal");
  const parsed = parseRespondToApplicationOfferForm(formData);

  if (!isSupabaseConfigured()) {
    redirect(`/portal?offer=${parsed.offer_response === "accept" ? "accepted-demo" : "declined-demo"}`);
  }

  const headerStore = await headers();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("respond_to_application_offer", {
    p_offer_id: parsed.offer_id,
    p_response: parsed.offer_response,
    p_ip_address: getClientIpAddress(headerStore),
    p_user_agent: headerStore.get("user-agent")
  });

  if (error) {
    redirect(`/portal?offerError=${offerResponseErrorCode(error.message)}`);
  }

  revalidatePath("/portal");
  const correspondenceLogId =
    data && typeof data === "object" && typeof (data as { correspondence_log_id?: unknown }).correspondence_log_id === "string"
      ? (data as { correspondence_log_id: string }).correspondence_log_id
      : null;
  if (correspondenceLogId) {
    const deliveryResult = await sendCorrespondenceLogEmail(correspondenceLogId);
    if (correspondenceEmailFailed(deliveryResult)) {
      redirect(`/portal?offer=${parsed.offer_response === "accept" ? "accepted-email-failed" : "declined-email-failed"}`);
    }
  }

  redirect(`/portal?offer=${parsed.offer_response === "accept" ? "accepted" : "declined"}`);
}
