"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { applicationMagicLinkRedirectUrl, parseApplicantMagicLinkForm } from "@/lib/application-invitations";
import { correspondenceEmailFailed } from "@/lib/email-delivery";
import { safePortalNextPath } from "@/lib/portal-access";
import { sendPortalMagicLinkEmail } from "@/lib/portal-email";
import { isSupabaseConfigured } from "@/lib/supabase";

async function requestOrigin(): Promise<string> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost:3000";
  const protocol = headerStore.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

function loginPath(params: Record<string, string>): string {
  const searchParams = new URLSearchParams(params);
  return `/apply/login?${searchParams.toString()}`;
}

export async function sendApplicantMagicLink(formData: FormData) {
  const parsed = parseApplicantMagicLinkForm(formData);
  const next = safePortalNextPath(parsed.next);

  if (!isSupabaseConfigured()) {
    redirect(loginPath({ sent: "1", demo: "1", next }));
  }

  const deliveryResult = await sendPortalMagicLinkEmail({
    email: parsed.email,
    subject: "Your BETAR portal sign-in link",
    templateKey: "application_invitation",
    redirectTo: applicationMagicLinkRedirectUrl(await requestOrigin(), next)
  });

  if (deliveryResult.status === "disabled") {
    redirect(loginPath({ error: "Email delivery is disabled for this environment.", next }));
  }

  if (deliveryResult.status === "suppressed") {
    redirect(loginPath({ sent: "1", next }));
  }

  if (correspondenceEmailFailed(deliveryResult)) {
    const message = deliveryResult.status === "failed" ? deliveryResult.error : "Email delivery could not be completed.";
    redirect(loginPath({ error: message, next }));
  }

  redirect(loginPath({ sent: "1", next }));
}
