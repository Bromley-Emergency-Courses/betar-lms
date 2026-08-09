alter type public.admission_lead_stage add value if not exists 'abandoned';
alter type public.admission_lead_stage add value if not exists 'withdrawn';

create table public.admission_abandonment_periods (
  id uuid primary key default gen_random_uuid(),
  admission_lead_id uuid not null references public.admission_leads(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  previous_lead_stage public.admission_lead_stage not null,
  abandonment_reason text not null check (length(trim(abandonment_reason)) > 0),
  abandoned_by_user_id uuid references public.staff_profiles(id) on delete set null,
  abandoned_at timestamptz not null default now(),
  reopen_reason text,
  reopened_by_user_id uuid references public.staff_profiles(id) on delete set null,
  reopened_at timestamptz,
  created_at timestamptz not null default now(),
  check (previous_lead_stage in ('interest', 'application_invited')),
  check (
    (reopened_at is null and reopen_reason is null and reopened_by_user_id is null)
    or (reopened_at is not null and length(trim(reopen_reason)) > 0)
  )
);

create unique index admission_abandonment_periods_one_active_idx
  on public.admission_abandonment_periods(admission_lead_id)
  where reopened_at is null;

create index admission_abandonment_periods_lead_history_idx
  on public.admission_abandonment_periods(admission_lead_id, abandoned_at desc);

alter table public.application_offers
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawal_reason text,
  add column if not exists reissue_count integer not null default 0 check (reissue_count >= 0),
  add column if not exists last_reissued_at timestamptz;

update public.application_offers
set
  withdrawn_at = coalesce(withdrawn_at, updated_at, now()),
  withdrawal_reason = coalesce(nullif(trim(withdrawal_reason), ''), 'Withdrawn before reasoned withdrawal records were introduced.')
where status = 'withdrawn'
  and (withdrawn_at is null or nullif(trim(withdrawal_reason), '') is null);

alter table public.application_offers
  drop constraint if exists application_offers_withdrawal_state_check;

alter table public.application_offers
  add constraint application_offers_withdrawal_state_check check (
    (status = 'withdrawn' and withdrawn_at is not null and length(trim(withdrawal_reason)) > 0)
    or (status <> 'withdrawn' and withdrawn_at is null and withdrawal_reason is null)
  );

create table public.application_offer_reissues (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.application_offers(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  previous_deadline_at timestamptz not null,
  previous_lapsed_at timestamptz not null,
  new_deadline_at timestamptz not null,
  reason text not null check (length(trim(reason)) > 0),
  reissued_by_user_id uuid references public.staff_profiles(id) on delete set null,
  correspondence_log_id uuid references public.correspondence_logs(id) on delete set null,
  reissued_at timestamptz not null default now(),
  check (new_deadline_at > reissued_at)
);

create index application_offer_reissues_offer_history_idx
  on public.application_offer_reissues(offer_id, reissued_at desc);

create table public.application_offer_withdrawals (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique references public.application_offers(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  reason text not null check (length(trim(reason)) > 0),
  withdrawn_by_user_id uuid references public.staff_profiles(id) on delete set null,
  correspondence_log_id uuid references public.correspondence_logs(id) on delete set null,
  withdrawn_at timestamptz not null default now()
);

alter table public.admission_abandonment_periods enable row level security;
alter table public.application_offer_reissues enable row level security;
alter table public.application_offer_withdrawals enable row level security;

create policy "admins manage admission abandonment periods"
  on public.admission_abandonment_periods for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins manage application offer reissues"
  on public.application_offer_reissues for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins manage application offer withdrawals"
  on public.application_offer_withdrawals for all
  using (public.is_admin())
  with check (public.is_admin());

insert into public.correspondence_templates (
  template_key,
  version,
  channel,
  description,
  subject_template,
  body_template
)
values
  (
    'offer_reissued',
    1,
    'email',
    'Notifies an applicant that a lapsed offer has been reissued with a new deadline.',
    'Your BETAR offer has been reissued',
    'Your BETAR offer has been reissued. Sign in to the applicant portal to respond by the new deadline.'
  ),
  (
    'offer_withdrawn',
    1,
    'email',
    'Notifies an applicant that BETAR has withdrawn an offer.',
    'Your BETAR offer has been withdrawn',
    'Your BETAR offer has been withdrawn. Contact BETAR Admissions if you need to discuss this outcome.'
  )
on conflict (template_key, channel, version) do nothing;

create or replace function public.abandon_new_student_admission(
  p_admission_lead_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_lead public.admission_leads%rowtype;
  v_application public.applications%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 4000), '');
  v_period_id uuid;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can abandon admissions records' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'An abandonment reason is required';
  end if;

  select * into v_lead
  from public.admission_leads
  where id = p_admission_lead_id
  for update;

  if not found then
    raise exception 'Admissions record was not found' using errcode = 'P0002';
  end if;
  if v_lead.archived or v_lead.converted_student_id is not null then
    raise exception 'Archived or complete admissions records cannot be abandoned';
  end if;
  if v_lead.stage not in ('interest', 'application_invited') then
    raise exception 'Only enquiries and unsubmitted applications can be abandoned';
  end if;
  if exists (
    select 1 from public.admission_abandonment_periods
    where admission_lead_id = v_lead.id and reopened_at is null
  ) then
    raise exception 'This admissions record is already abandoned';
  end if;

  select * into v_application
  from public.applications
  where admission_lead_id = v_lead.id
  order by created_at desc, id desc
  limit 1
  for update;

  if found and v_application.status <> 'draft' then
    raise exception 'Submitted applications require a genuine post-submission outcome';
  end if;
  if exists (
    select 1 from public.application_decisions decision
    join public.applications application on application.id = decision.application_id
    where application.admission_lead_id = v_lead.id
  ) then
    raise exception 'Admissions records with a decision cannot be abandoned';
  end if;

  insert into public.admission_abandonment_periods (
    admission_lead_id,
    application_id,
    previous_lead_stage,
    abandonment_reason,
    abandoned_by_user_id
  )
  values (
    v_lead.id,
    v_application.id,
    v_lead.stage,
    v_reason,
    v_actor_user_id
  )
  returning id into v_period_id;

  update public.admission_leads
  set stage = 'abandoned', next_action_on = null, updated_at = now()
  where id = v_lead.id;

  insert into public.audit_events (
    actor_type, actor_user_id, actor_person_id, action, entity_type, entity_id, reason, metadata
  )
  values (
    'staff', v_actor_user_id, v_lead.person_id, 'admission.abandoned',
    'admission_abandonment_period', v_period_id, v_reason,
    jsonb_build_object(
      'admission_lead_id', v_lead.id,
      'application_id', v_application.id,
      'previous_lead_stage', v_lead.stage,
      'archived', false
    )
  );

  return v_period_id;
end;
$$;

create or replace function public.reopen_abandoned_new_student_admission(
  p_admission_lead_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_lead public.admission_leads%rowtype;
  v_period public.admission_abandonment_periods%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 4000), '');
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can reopen abandoned admissions records' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'A reopening reason is required';
  end if;

  select * into v_lead
  from public.admission_leads
  where id = p_admission_lead_id
  for update;

  if not found then
    raise exception 'Admissions record was not found' using errcode = 'P0002';
  end if;
  if v_lead.archived or v_lead.converted_student_id is not null or v_lead.stage <> 'abandoned' then
    raise exception 'Only an active abandoned pre-submission record can be reopened';
  end if;

  select * into v_period
  from public.admission_abandonment_periods
  where admission_lead_id = v_lead.id and reopened_at is null
  order by abandoned_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Active abandonment history was not found';
  end if;
  if exists (
    select 1 from public.applications
    where admission_lead_id = v_lead.id and status = 'submitted'
  ) or exists (
    select 1 from public.application_decisions decision
    join public.applications application on application.id = decision.application_id
    where application.admission_lead_id = v_lead.id
  ) then
    raise exception 'A post-submission outcome cannot be reopened as abandonment';
  end if;

  update public.admission_abandonment_periods
  set reopen_reason = v_reason, reopened_by_user_id = v_actor_user_id, reopened_at = now()
  where id = v_period.id;

  update public.admission_leads
  set stage = v_period.previous_lead_stage, updated_at = now()
  where id = v_lead.id;

  insert into public.audit_events (
    actor_type, actor_user_id, actor_person_id, action, entity_type, entity_id, reason, metadata
  )
  values (
    'staff', v_actor_user_id, v_lead.person_id, 'admission.abandonment_reopened',
    'admission_abandonment_period', v_period.id, v_reason,
    jsonb_build_object(
      'admission_lead_id', v_lead.id,
      'restored_lead_stage', v_period.previous_lead_stage,
      'archived', false
    )
  );

  return v_period.id;
end;
$$;

create or replace function public.reissue_lapsed_application_offer(
  p_offer_id uuid,
  p_new_deadline_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_offer public.application_offers%rowtype;
  v_application public.applications%rowtype;
  v_lead public.admission_leads%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 4000), '');
  v_template_id uuid;
  v_correspondence_log_id uuid;
  v_reissue_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can reissue offers' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'An offer reissue reason is required';
  end if;
  if p_new_deadline_at is null or p_new_deadline_at <= v_now then
    raise exception 'A future offer deadline is required';
  end if;

  select * into v_offer from public.application_offers where id = p_offer_id for update;
  if not found or v_offer.status <> 'lapsed' or v_offer.lapsed_at is null then
    raise exception 'Only a lapsed offer can be reissued';
  end if;

  select * into v_application from public.applications where id = v_offer.application_id for update;
  select * into v_lead from public.admission_leads where id = v_application.admission_lead_id for update;
  if v_application.status <> 'submitted'
    or v_lead.archived
    or v_lead.converted_student_id is not null
    or v_lead.stage <> 'offer_lapsed' then
    raise exception 'This lapsed offer is not eligible for reissue';
  end if;
  if exists (select 1 from public.admissions_registrations where application_id = v_application.id) then
    raise exception 'An offer with registration history cannot be reissued';
  end if;

  select id into v_template_id
  from public.correspondence_templates
  where template_key = 'offer_reissued' and version = 1 and channel = 'email'
  limit 1;

  insert into public.correspondence_logs (
    person_id, recipient_email, recipient_name, related_entity_type, related_entity_id,
    template_id, template_key, template_version, channel, rendered_subject, rendered_body,
    delivery_status, metadata, created_by_user_id
  )
  values (
    v_application.person_id,
    coalesce(nullif(trim(v_application.email), ''), v_lead.email),
    trim(concat_ws(' ', v_application.first_name, v_application.last_name)),
    'application_offer', v_offer.id,
    v_template_id, 'offer_reissued', 1, 'email', 'Your BETAR offer has been reissued', null,
    'suppressed',
    jsonb_build_object(
      'application_id', v_application.id,
      'admission_lead_id', v_lead.id,
      'offer_id', v_offer.id,
      'offer_reference', v_offer.offer_reference,
      'deadline_at', p_new_deadline_at,
      'production_email_send_enabled', false
    ),
    v_actor_user_id
  )
  returning id into v_correspondence_log_id;

  insert into public.application_offer_reissues (
    offer_id, application_id, previous_deadline_at, previous_lapsed_at,
    new_deadline_at, reason, reissued_by_user_id, correspondence_log_id, reissued_at
  )
  values (
    v_offer.id, v_application.id, v_offer.deadline_at, v_offer.lapsed_at,
    p_new_deadline_at, v_reason, v_actor_user_id, v_correspondence_log_id, v_now
  )
  returning id into v_reissue_id;

  update public.application_offers
  set
    status = 'issued', deadline_at = p_new_deadline_at, lapsed_at = null,
    reissue_count = reissue_count + 1, last_reissued_at = v_now, updated_at = v_now
  where id = v_offer.id;

  update public.admission_leads
  set stage = 'offered', next_action_on = null, updated_at = v_now
  where id = v_lead.id;

  insert into public.audit_events (
    actor_type, actor_user_id, actor_person_id, action, entity_type, entity_id, reason, metadata
  )
  values (
    'staff', v_actor_user_id, v_application.person_id, 'offer.reissued',
    'application_offer_reissue', v_reissue_id, v_reason,
    jsonb_build_object(
      'application_id', v_application.id,
      'admission_lead_id', v_lead.id,
      'offer_id', v_offer.id,
      'previous_deadline_at', v_offer.deadline_at,
      'new_deadline_at', p_new_deadline_at,
      'correspondence_log_id', v_correspondence_log_id
    )
  );

  return jsonb_build_object(
    'offer_id', v_offer.id,
    'reissue_id', v_reissue_id,
    'correspondence_log_id', v_correspondence_log_id
  );
end;
$$;

create or replace function public.withdraw_application_offer(
  p_offer_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_offer public.application_offers%rowtype;
  v_application public.applications%rowtype;
  v_lead public.admission_leads%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 4000), '');
  v_template_id uuid;
  v_correspondence_log_id uuid;
  v_withdrawal_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can withdraw offers' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'An offer withdrawal reason is required';
  end if;

  select * into v_offer from public.application_offers where id = p_offer_id for update;
  if not found or v_offer.status not in ('issued', 'lapsed') then
    raise exception 'Only an issued or lapsed offer can be withdrawn';
  end if;

  select * into v_application from public.applications where id = v_offer.application_id for update;
  select * into v_lead from public.admission_leads where id = v_application.admission_lead_id for update;
  if v_application.status <> 'submitted'
    or v_lead.archived
    or v_lead.converted_student_id is not null
    or v_lead.stage not in ('offered', 'offer_lapsed') then
    raise exception 'This offer is not eligible for withdrawal';
  end if;
  if exists (select 1 from public.admissions_registrations where application_id = v_application.id) then
    raise exception 'An offer with registration history cannot be withdrawn';
  end if;

  select id into v_template_id
  from public.correspondence_templates
  where template_key = 'offer_withdrawn' and version = 1 and channel = 'email'
  limit 1;

  insert into public.correspondence_logs (
    person_id, recipient_email, recipient_name, related_entity_type, related_entity_id,
    template_id, template_key, template_version, channel, rendered_subject, rendered_body,
    delivery_status, metadata, created_by_user_id
  )
  values (
    v_application.person_id,
    coalesce(nullif(trim(v_application.email), ''), v_lead.email),
    trim(concat_ws(' ', v_application.first_name, v_application.last_name)),
    'application_offer', v_offer.id,
    v_template_id, 'offer_withdrawn', 1, 'email', 'Your BETAR offer has been withdrawn', null,
    'suppressed',
    jsonb_build_object(
      'application_id', v_application.id,
      'admission_lead_id', v_lead.id,
      'offer_id', v_offer.id,
      'offer_reference', v_offer.offer_reference,
      'production_email_send_enabled', false
    ),
    v_actor_user_id
  )
  returning id into v_correspondence_log_id;

  insert into public.application_offer_withdrawals (
    offer_id, application_id, reason, withdrawn_by_user_id, correspondence_log_id, withdrawn_at
  )
  values (
    v_offer.id, v_application.id, v_reason, v_actor_user_id, v_correspondence_log_id, v_now
  )
  returning id into v_withdrawal_id;

  update public.application_offers
  set
    status = 'withdrawn', withdrawn_at = v_now, withdrawal_reason = v_reason,
    lapsed_at = null, deadline_at = null, updated_at = v_now
  where id = v_offer.id;

  update public.admission_leads
  set stage = 'withdrawn', next_action_on = null, updated_at = v_now
  where id = v_lead.id;

  insert into public.audit_events (
    actor_type, actor_user_id, actor_person_id, action, entity_type, entity_id, reason, metadata
  )
  values (
    'staff', v_actor_user_id, v_application.person_id, 'offer.withdrawn',
    'application_offer_withdrawal', v_withdrawal_id, v_reason,
    jsonb_build_object(
      'application_id', v_application.id,
      'admission_lead_id', v_lead.id,
      'offer_id', v_offer.id,
      'previous_status', v_offer.status,
      'correspondence_log_id', v_correspondence_log_id
    )
  );

  return jsonb_build_object(
    'offer_id', v_offer.id,
    'withdrawal_id', v_withdrawal_id,
    'correspondence_log_id', v_correspondence_log_id
  );
end;
$$;

revoke all on function public.abandon_new_student_admission(uuid, text) from public;
revoke all on function public.reopen_abandoned_new_student_admission(uuid, text) from public;
revoke all on function public.reissue_lapsed_application_offer(uuid, timestamptz, text) from public;
revoke all on function public.withdraw_application_offer(uuid, text) from public;

grant execute on function public.abandon_new_student_admission(uuid, text) to authenticated;
grant execute on function public.reopen_abandoned_new_student_admission(uuid, text) to authenticated;
grant execute on function public.reissue_lapsed_application_offer(uuid, timestamptz, text) to authenticated;
grant execute on function public.withdraw_application_offer(uuid, text) to authenticated;

create or replace view public.staff_new_student_admissions_work_items
with (security_invoker = true)
as
with workflow_source as (
  select
    lead.id as admission_lead_id,
    lead.person_id,
    lead.first_name,
    lead.last_name,
    lead.email,
    lead.phone,
    lead.programme,
    lead.stage::text as source_lead_stage,
    lead.archived,
    lead.application_invited_at,
    lead.next_action_on,
    lead.converted_student_id as lead_converted_student_id,
    lead.created_at,
    lead.updated_at as lead_updated_at,
    abandonment.id as active_abandonment_id,
    application.id as application_id,
    application.person_id as application_person_id,
    application.status::text as application_status,
    application.intended_start_term_id as application_target_term_id,
    application.submitted_at,
    application.updated_at as application_updated_at,
    review.readiness_status::text as review_readiness_status,
    review.updated_at as review_updated_at,
    decision.id as decision_id,
    decision.outcome::text as decision_outcome,
    decision.decided_at,
    rejection.id as rejection_id,
    offer.id as offer_id,
    offer.status::text as offer_status,
    offer.intended_start_term_id as offer_target_term_id,
    offer.deadline_at as offer_deadline_at,
    offer.converted_student_id as offer_converted_student_id,
    offer.updated_at as offer_updated_at,
    registration.id as registration_id,
    registration.status::text as registration_status,
    registration.intended_start_term_id as registration_target_term_id,
    registration.registration_deadline_at,
    registration.student_id as registration_student_id,
    registration.converted_at as registration_converted_at,
    registration.updated_at as registration_updated_at,
    coalesce(decision_totals.decision_count, 0) as decision_count,
    coalesce(offer_totals.offer_count, 0) as offer_count,
    coalesce(registration_totals.registration_count, 0) as registration_count
  from public.admission_leads lead
  left join lateral (
    select period.id
    from public.admission_abandonment_periods period
    where period.admission_lead_id = lead.id and period.reopened_at is null
    order by period.abandoned_at desc
    limit 1
  ) abandonment on true
  left join public.applications application on application.admission_lead_id = lead.id
  left join public.application_reviews review on review.application_id = application.id
  left join lateral (
    select candidate.* from public.application_decisions candidate
    where candidate.application_id = application.id
    order by candidate.decided_at desc, candidate.id desc limit 1
  ) decision on true
  left join lateral (
    select count(*)::integer as decision_count from public.application_decisions candidate
    where candidate.application_id = application.id
  ) decision_totals on true
  left join public.application_rejections rejection on rejection.decision_id = decision.id
  left join lateral (
    select candidate.* from public.application_offers candidate
    where candidate.application_id = application.id
    order by candidate.issued_at desc, candidate.id desc limit 1
  ) offer on true
  left join lateral (
    select count(*)::integer as offer_count from public.application_offers candidate
    where candidate.application_id = application.id
  ) offer_totals on true
  left join lateral (
    select candidate.* from public.admissions_registrations candidate
    where candidate.application_id = application.id
    order by candidate.created_at desc, candidate.id desc limit 1
  ) registration on true
  left join lateral (
    select count(*)::integer as registration_count from public.admissions_registrations candidate
    where candidate.application_id = application.id
  ) registration_totals on true
), projected as (
  select
    workflow_source.*,
    public.derive_new_student_journey_stage(
      application_status,
      decision_outcome,
      offer_status,
      registration_status,
      coalesce(registration_student_id, offer_converted_student_id, lead_converted_student_id),
      application_invited_at,
      archived or active_abandonment_id is not null
    ) as journey_stage,
    coalesce(registration_target_term_id, offer_target_term_id, application_target_term_id) as target_term_id,
    greatest(
      lead_updated_at, application_invited_at, application_updated_at, review_updated_at,
      decided_at, offer_updated_at, registration_updated_at, registration_converted_at
    ) as last_activity_at
  from workflow_source
), checked as (
  select
    projected.*,
    coalesce((
      (application_person_id is not null and person_id is not null and application_person_id <> person_id)
      or decision_count > 1
      or offer_count > 1
      or registration_count > 1
      or (decision_id is not null and application_status is distinct from 'submitted')
      or (decision_outcome = 'offer' and offer_id is null)
      or (decision_outcome = 'rejection' and rejection_id is null)
      or (offer_id is not null and decision_outcome is distinct from 'offer')
      or (registration_id is not null and offer_status is distinct from 'accepted')
      or (registration_status = 'complete' and registration_student_id is null)
      or (registration_student_id is not null and lead_converted_student_id is not null and registration_student_id <> lead_converted_student_id)
      or (registration_student_id is not null and offer_converted_student_id is not null and registration_student_id <> offer_converted_student_id)
      or (archived and journey_stage not in ('closed', 'complete'))
      or (active_abandonment_id is not null and source_lead_stage <> 'abandoned')
      or (source_lead_stage = 'abandoned' and active_abandonment_id is null)
      or (source_lead_stage = 'withdrawn' and offer_status is distinct from 'withdrawn')
      or (source_lead_stage = 'reviewed' and application_status is distinct from 'submitted')
      or (source_lead_stage = 'offered' and offer_status not in ('issued', 'lapsed', 'accepted'))
      or (source_lead_stage = 'rejected' and decision_outcome is distinct from 'rejection')
      or (source_lead_stage = 'accepted' and offer_status is distinct from 'accepted')
      or (source_lead_stage = 'registration_in_progress' and registration_id is null)
      or (source_lead_stage = 'registration_lapsed' and registration_status is distinct from 'lapsed')
      or (source_lead_stage = 'registered' and registration_student_id is null)
      or (source_lead_stage = 'offer_declined' and offer_status is distinct from 'declined')
      or (source_lead_stage = 'offer_lapsed' and offer_status is distinct from 'lapsed')
    ), false) as has_data_inconsistency
  from projected
)
select
  admission_lead_id, person_id, first_name, last_name, email, phone, programme,
  source_lead_stage, journey_stage, target_term_id, application_id, application_status,
  review_readiness_status, decision_outcome, offer_id, offer_status, registration_id,
  registration_status, has_data_inconsistency,
  array_remove(array[
    case when has_data_inconsistency then 'data_inconsistency' end,
    case when journey_stage = 'review' and review_readiness_status = 'needs_information' then 'needs_information' end,
    case when journey_stage = 'review' and review_readiness_status = 'ready_for_decision' then 'ready_for_decision' end,
    case when journey_stage = 'offer' and offer_status = 'lapsed' then 'offer_lapsed' end,
    case when journey_stage = 'offer' and offer_status = 'issued' and offer_deadline_at <= now() then 'offer_overdue' end,
    case when journey_stage = 'registration' and registration_status = 'lapsed' then 'registration_lapsed' end,
    case when journey_stage = 'registration' and registration_status in ('not_started', 'in_progress', 'submitted') and registration_deadline_at <= now() then 'registration_overdue' end
  ]::text[], null) as attention_indicators,
  case
    when has_data_inconsistency then 'repair_inconsistency'
    when journey_stage = 'enquiry' then 'invite_applicant'
    when journey_stage = 'application' then 'await_application_submission'
    when journey_stage = 'review' and review_readiness_status = 'ready_for_decision' then 'record_decision'
    when journey_stage = 'review' and review_readiness_status = 'needs_information' then 'resolve_information_request'
    when journey_stage = 'review' then 'review_application'
    when journey_stage = 'offer' and offer_status = 'lapsed' then 'reissue_offer'
    when journey_stage = 'offer' and offer_status = 'issued' and offer_deadline_at <= now() then 'lapse_offer'
    when journey_stage = 'offer' then 'await_offer_response'
    when journey_stage = 'registration' and registration_status = 'lapsed' then 'reopen_registration'
    when journey_stage = 'registration' and registration_status = 'submitted' then 'convert_registration'
    when journey_stage = 'registration' then 'await_registration'
    else 'none'
  end as primary_next_action,
  case when journey_stage = 'offer' then offer_deadline_at when journey_stage = 'registration' then registration_deadline_at else null end as current_deadline_at,
  last_activity_at,
  created_at
from checked;

revoke all on table public.staff_new_student_admissions_work_items from public;
grant select on table public.staff_new_student_admissions_work_items to authenticated;
