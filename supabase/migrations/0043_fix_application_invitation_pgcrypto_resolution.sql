-- Supabase installs pgcrypto in the extensions schema. These security-definer
-- functions previously restricted their search path to public, so their
-- existing digest(...) calls could not resolve on a real Supabase database.
alter function public.issue_application_invitation(uuid, timestamptz)
  set search_path = public, extensions;

alter function public.claim_application_invitation_for_auth_user(uuid, text)
  set search_path = public, extensions;
