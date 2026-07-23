"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { applicationMagicLinkRedirectUrl, parseApplicantMagicLinkForm } from "@/lib/application-invitations";
import { safePortalNextPath } from "@/lib/portal-access";
import { createSupabaseAuthEmailClient, isSupabaseConfigured } from "@/lib/supabase";

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

  const authClient = createSupabaseAuthEmailClient();
  const { error } = await authClient.auth.signInWithOtp({
    email: parsed.email,
    options: {
      emailRedirectTo: applicationMagicLinkRedirectUrl(await requestOrigin(), next),
      shouldCreateUser: true
    }
  });

  if (error) {
    redirect(loginPath({ error: error.message, next }));
  }

  redirect(loginPath({ sent: "1", next }));
}
