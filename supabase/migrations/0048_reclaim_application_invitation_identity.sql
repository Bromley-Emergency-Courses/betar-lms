create or replace function public.claim_application_invitation_for_auth_user(
  p_invitation_id uuid default null,
  p_claim_nonce text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_email text;
  v_existing_person_id uuid;
  v_invitation public.application_invitations%rowtype;
begin
  if v_auth_user_id is null then
    raise exception 'An authenticated applicant session is required';
  end if;

  select lower(email)
  into v_email
  from auth.users
  where id = v_auth_user_id;

  if v_email is null then
    raise exception 'Authenticated user email was not found';
  end if;

  select person_id
  into v_existing_person_id
  from public.person_auth_identities
  where auth_user_id = v_auth_user_id
    and active = true
  limit 1;

  if p_invitation_id is null and p_claim_nonce is null and v_existing_person_id is not null then
    return v_existing_person_id;
  end if;

  if p_invitation_id is null or nullif(trim(coalesce(p_claim_nonce, '')), '') is null then
    raise exception 'Application invitation proof is required';
  end if;

  update public.application_invitations
  set status = 'expired'
  where status = 'pending'
    and expires_at <= now();

  select *
  into v_invitation
  from public.application_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'Application invitation was not found';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'Application invitation is not active';
  end if;

  if v_invitation.expires_at <= now() then
    update public.application_invitations
    set status = 'expired'
    where id = v_invitation.id;

    raise exception 'Application invitation has expired';
  end if;

  if lower(v_invitation.email) <> v_email then
    raise exception 'Application invitation does not match the authenticated email address';
  end if;

  if v_invitation.claim_nonce_hash <> encode(digest(p_claim_nonce, 'sha256'), 'hex') then
    raise exception 'Application invitation proof is invalid';
  end if;

  if v_existing_person_id is not null and v_existing_person_id <> v_invitation.person_id then
    raise exception 'Authenticated account is already linked to a different person';
  end if;

  if v_existing_person_id = v_invitation.person_id then
    update public.application_invitations
    set
      status = 'claimed',
      claimed_at = now(),
      claimed_auth_user_id = v_auth_user_id
    where id = v_invitation.id;

    return v_invitation.person_id;
  end if;

  update public.person_auth_identities
  set active = false
  where person_id = v_invitation.person_id
    and active = true
    and actor_type = 'applicant'
    and auth_user_id <> v_auth_user_id;

  insert into public.person_auth_identities (
    person_id,
    auth_user_id,
    email,
    actor_type,
    active
  )
  values (
    v_invitation.person_id,
    v_auth_user_id,
    v_email,
    'applicant',
    true
  )
  on conflict (auth_user_id) do update
  set
    person_id = excluded.person_id,
    email = excluded.email,
    actor_type = 'applicant',
    active = true;

  update public.application_invitations
  set
    status = 'claimed',
    claimed_at = now(),
    claimed_auth_user_id = v_auth_user_id
  where id = v_invitation.id;

  insert into public.audit_events (
    actor_type,
    actor_user_id,
    actor_person_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    'applicant',
    v_auth_user_id,
    v_invitation.person_id,
    'application.access_claimed',
    'application_invitation',
    v_invitation.id,
    jsonb_build_object(
      'admission_lead_id',
      v_invitation.admission_lead_id
    )
  );

  return v_invitation.person_id;
end;
$$;

revoke all on function public.claim_application_invitation_for_auth_user(uuid, text) from public;
grant execute on function public.claim_application_invitation_for_auth_user(uuid, text) to authenticated;
