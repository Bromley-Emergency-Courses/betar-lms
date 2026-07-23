create type public.application_invitation_status as enum (
  'pending',
  'claimed',
  'revoked',
  'expired'
);

alter table public.admission_leads
  add column person_id uuid references public.persons(id) on delete set null,
  add column application_invited_at timestamptz,
  add column application_invited_by_user_id uuid references auth.users(id) on delete set null,
  add column application_invitation_expires_at timestamptz;

create index admission_leads_person_id_idx
  on public.admission_leads(person_id);

create table public.application_invitations (
  id uuid primary key default gen_random_uuid(),
  admission_lead_id uuid not null references public.admission_leads(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete restrict,
  email text not null,
  claim_nonce_hash text not null,
  status public.application_invitation_status not null default 'pending',
  invited_by_user_id uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  claimed_at timestamptz,
  claimed_auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(email)) > 3),
  check (expires_at > invited_at),
  check (
    (status = 'claimed' and claimed_at is not null and claimed_auth_user_id is not null)
    or (status <> 'claimed' and claimed_at is null and claimed_auth_user_id is null)
  )
);

alter table public.application_invitations enable row level security;

create index application_invitations_lead_idx
  on public.application_invitations(admission_lead_id, invited_at desc);

create index application_invitations_person_idx
  on public.application_invitations(person_id, invited_at desc);

create index application_invitations_email_pending_idx
  on public.application_invitations(lower(email), expires_at desc)
  where status = 'pending';

create unique index application_invitations_claim_nonce_hash_idx
  on public.application_invitations(claim_nonce_hash);

create trigger touch_application_invitations_updated_at
  before update on public.application_invitations
  for each row
  execute function public.touch_person_updated_at();

create policy "admins manage application invitations"
  on public.application_invitations for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own application invitations"
  on public.application_invitations for select
  using (person_id = public.current_person_id());

insert into public.correspondence_templates (
  template_key,
  version,
  channel,
  description,
  subject_template,
  body_template
)
values (
  'application_invitation',
  1,
  'email',
  'Application invitation magic-link email sent through Supabase Auth.',
  'Your BETAR application invitation',
  'Applicant receives a Supabase magic link and returns to the BETAR application access page.'
)
on conflict (template_key, channel, version) do nothing;

create or replace function public.issue_application_invitation(
  p_lead_id uuid,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead public.admission_leads%rowtype;
  v_person_id uuid;
  v_invitation_id uuid;
  v_claim_nonce text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires_at timestamptz := coalesce(p_expires_at, now() + interval '14 days');
  v_template_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admissions staff can issue application invitations';
  end if;

  if auth.uid() is null then
    raise exception 'A staff user session is required';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Admission lead was not found';
  end if;

  if v_lead.archived or v_lead.converted_student_id is not null then
    raise exception 'Archived or converted leads cannot be invited to apply';
  end if;

  if v_lead.stage not in ('interest', 'application_invited') then
    raise exception 'Only interest or application-invited leads can be invited to apply';
  end if;

  if v_expires_at <= now() then
    raise exception 'Invitation expiry must be in the future';
  end if;

  if v_lead.person_id is null then
    insert into public.persons (
      first_name,
      last_name,
      email,
      phone
    )
    values (
      v_lead.first_name,
      v_lead.last_name,
      lower(v_lead.email),
      v_lead.phone
    )
    returning id into v_person_id;
  else
    v_person_id := v_lead.person_id;

    update public.persons
    set
      first_name = v_lead.first_name,
      last_name = v_lead.last_name,
      email = lower(v_lead.email),
      phone = v_lead.phone
    where id = v_person_id;
  end if;

  update public.application_invitations
  set status = 'revoked'
  where admission_lead_id = p_lead_id
    and status = 'pending';

  insert into public.application_invitations (
    admission_lead_id,
    person_id,
    email,
    claim_nonce_hash,
    invited_by_user_id,
    expires_at
  )
  values (
    p_lead_id,
    v_person_id,
    lower(v_lead.email),
    encode(digest(v_claim_nonce, 'sha256'), 'hex'),
    auth.uid(),
    v_expires_at
  )
  returning id into v_invitation_id;

  update public.admission_leads
  set
    person_id = v_person_id,
    stage = 'application_invited',
    application_invited_at = now(),
    application_invited_by_user_id = auth.uid(),
    application_invitation_expires_at = v_expires_at,
    last_contacted_on = current_date,
    next_action_on = v_expires_at::date
  where id = p_lead_id;

  select id
  into v_template_id
  from public.correspondence_templates
  where template_key = 'application_invitation'
    and channel = 'email'
    and version = 1
  limit 1;

  insert into public.correspondence_logs (
    person_id,
    recipient_email,
    recipient_name,
    related_entity_type,
    related_entity_id,
    template_id,
    template_key,
    template_version,
    channel,
    rendered_subject,
    delivery_status,
    metadata,
    created_by_user_id
  )
  values (
    v_person_id,
    lower(v_lead.email),
    concat_ws(' ', v_lead.first_name, v_lead.last_name),
    'application_invitation',
    v_invitation_id,
    v_template_id,
    'application_invitation',
    1,
    'email',
    'Your BETAR application invitation',
    'queued',
    jsonb_build_object(
      'admission_lead_id',
      p_lead_id,
      'programme',
      v_lead.programme
    ),
    auth.uid()
  );

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
    'staff',
    auth.uid(),
    null,
    'application.invited',
    'admission_lead',
    p_lead_id,
    jsonb_build_object(
      'person_id',
      v_person_id,
      'invitation_id',
      v_invitation_id,
      'expires_at',
      v_expires_at
    )
  );

  return jsonb_build_object(
    'invitation_id',
    v_invitation_id,
    'claim_nonce',
    v_claim_nonce,
    'lead_id',
    p_lead_id,
    'person_id',
    v_person_id,
    'email',
    lower(v_lead.email),
    'expires_at',
    v_expires_at
  );
end;
$$;

create or replace function public.claim_application_invitation_for_auth_user(
  p_invitation_id uuid default null,
  p_claim_nonce text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
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

revoke all on function public.issue_application_invitation(uuid, timestamptz) from public;
grant execute on function public.issue_application_invitation(uuid, timestamptz) to authenticated;

revoke all on function public.claim_application_invitation_for_auth_user(uuid, text) from public;
grant execute on function public.claim_application_invitation_for_auth_user(uuid, text) to authenticated;
