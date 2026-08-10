import { type EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { safePortalNextPath } from "@/lib/portal-access";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

function loginRedirect(request: NextRequest, message: string, next: string): NextResponse {
  const redirectUrl = new URL("/apply/login", request.url);
  redirectUrl.searchParams.set("error", message);
  redirectUrl.searchParams.set("next", next);
  return NextResponse.redirect(redirectUrl);
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const next = safePortalNextPath(requestUrl.searchParams.get("next") ?? "/apply/application");

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL(next, request.url));
  }

  const supabase = await createSupabaseServerClient();
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const invitationId = requestUrl.searchParams.get("invitation_id");
  const claimNonce = requestUrl.searchParams.get("claim_nonce");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return loginRedirect(request, error.message, next);
    }
  } else if (tokenHash) {
    const type = (requestUrl.searchParams.get("type") ?? "email") as EmailOtpType;
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash
    });
    if (error) {
      return loginRedirect(
        request,
        "This sign-in link has expired or has already been used. Request a fresh link below.",
        next
      );
    }
  } else {
    return loginRedirect(request, "Sign-in link was missing a verification code.", next);
  }

  const { error: claimError } = await supabase.rpc("claim_application_invitation_for_auth_user", {
    p_invitation_id: invitationId,
    p_claim_nonce: claimNonce
  });
  if (claimError) {
    await supabase.auth.signOut();
    return loginRedirect(request, claimError.message, next);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
