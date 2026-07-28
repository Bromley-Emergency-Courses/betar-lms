do $$
begin
  create type public.application_decision_outcome as enum ('offer', 'rejection');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.application_offer_status as enum ('issued', 'withdrawn', 'accepted', 'declined', 'lapsed');
exception
  when duplicate_object then null;
end;
$$;

create table public.application_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  admission_lead_id uuid not null references public.admission_leads(id) on delete restrict,
  person_id uuid not null references public.persons(id) on delete restrict,
  outcome public.application_decision_outcome not null,
  decision_reason text not null,
  decided_by_user_id uuid references public.staff_profiles(id) on delete set null,
  decided_at timestamptz not null default now(),
  correspondence_log_id uuid references public.correspondence_logs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(decision_reason)) > 0)
);

create table public.application_offers (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null unique references public.application_decisions(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete restrict,
  offer_reference text not null unique,
  programme text not null check (programme in ('pgcert', 'microcredential')),
  intended_start_term_id uuid references public.terms(id) on delete restrict,
  status public.application_offer_status not null default 'issued',
  issued_by_user_id uuid references public.staff_profiles(id) on delete set null,
  issued_at timestamptz not null default now(),
  deadline_at timestamptz,
  letter_template_id uuid references public.correspondence_templates(id) on delete restrict,
  letter_template_key text not null default 'offer_issued',
  letter_template_version integer not null default 1 check (letter_template_version > 0),
  correspondence_log_id uuid references public.correspondence_logs(id) on delete set null,
  accepted_at timestamptz,
  declined_at timestamptz,
  lapsed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (deadline_at is null or deadline_at > issued_at),
  check (
    (status = 'accepted' and accepted_at is not null)
    or (status <> 'accepted' and accepted_at is null)
  ),
  check (
    (status = 'declined' and declined_at is not null)
    or (status <> 'declined' and declined_at is null)
  ),
  check (
    (status = 'lapsed' and lapsed_at is not null)
    or (status <> 'lapsed' and lapsed_at is null)
  )
);

create table public.application_offer_module_offerings (
  offer_id uuid not null references public.application_offers(id) on delete cascade,
  offering_id uuid not null references public.module_offerings(id) on delete restrict,
  choice_order smallint not null check (choice_order in (1, 2)),
  created_at timestamptz not null default now(),
  primary key (offer_id, offering_id),
  unique (offer_id, choice_order)
);

create table public.application_rejections (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null unique references public.application_decisions(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete restrict,
  rejection_reason text not null,
  rejected_by_user_id uuid references public.staff_profiles(id) on delete set null,
  rejected_at timestamptz not null default now(),
  letter_template_id uuid references public.correspondence_templates(id) on delete restrict,
  letter_template_key text not null default 'rejection',
  letter_template_version integer not null default 1 check (letter_template_version > 0),
  correspondence_log_id uuid references public.correspondence_logs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(rejection_reason)) > 0)
);

alter table public.application_decisions enable row level security;
alter table public.application_offers enable row level security;
alter table public.application_offer_module_offerings enable row level security;
alter table public.application_rejections enable row level security;

create index application_decisions_lead_idx
  on public.application_decisions(admission_lead_id, decided_at desc);

create index application_decisions_application_idx
  on public.application_decisions(application_id, decided_at desc);

create index application_decisions_person_idx
  on public.application_decisions(person_id, decided_at desc);

create index application_decisions_outcome_idx
  on public.application_decisions(outcome, decided_at desc);

create index application_offers_person_status_idx
  on public.application_offers(person_id, status, issued_at desc);

create index application_offers_application_idx
  on public.application_offers(application_id, issued_at desc);

create index application_offers_start_term_idx
  on public.application_offers(intended_start_term_id);

create index application_offer_module_offerings_offering_idx
  on public.application_offer_module_offerings(offering_id);

create index application_rejections_person_idx
  on public.application_rejections(person_id, rejected_at desc);

create index application_rejections_application_idx
  on public.application_rejections(application_id, rejected_at desc);

create trigger touch_application_decisions_updated_at
  before update on public.application_decisions
  for each row
  execute function public.touch_person_updated_at();

create trigger touch_application_offers_updated_at
  before update on public.application_offers
  for each row
  execute function public.touch_person_updated_at();

create trigger touch_application_rejections_updated_at
  before update on public.application_rejections
  for each row
  execute function public.touch_person_updated_at();

create policy "admins manage application decisions"
  on public.application_decisions for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins manage application offers"
  on public.application_offers for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own application offers"
  on public.application_offers for select
  using (person_id = public.current_person_id());

create policy "admins manage application offer module offerings"
  on public.application_offer_module_offerings for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own application offer module offerings"
  on public.application_offer_module_offerings for select
  using (
    exists (
      select 1
      from public.application_offers
      where application_offers.id = application_offer_module_offerings.offer_id
        and application_offers.person_id = public.current_person_id()
    )
  );

create policy "admins manage application rejections"
  on public.application_rejections for all
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
    'offer_issued',
    1,
    'email',
    'Placeholder for future offer issue correspondence. Production sending remains disabled until Microsoft 365/Outlook SMTP readiness is confirmed.',
    'Your BETAR application offer',
    'Placeholder only. Do not send real applicant email until the approved Microsoft 365/Outlook SMTP sender is configured and verified.'
  ),
  (
    'rejection',
    1,
    'email',
    'Placeholder for future application rejection correspondence. Production sending remains disabled until Microsoft 365/Outlook SMTP readiness is confirmed.',
    'Your BETAR application outcome',
    'Placeholder only. Do not send real applicant email until the approved Microsoft 365/Outlook SMTP sender is configured and verified.'
  )
on conflict (template_key, channel, version) do nothing;

create or replace function public.record_application_decision(
  p_application_id uuid,
  p_decision_outcome public.application_decision_outcome,
  p_decision_reason text,
  p_offer_deadline_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_staff public.staff_profiles%rowtype;
  v_application public.applications%rowtype;
  v_lead public.admission_leads%rowtype;
  v_person public.persons%rowtype;
  v_review public.application_reviews%rowtype;
  v_decision_reason text := nullif(left(trim(coalesce(p_decision_reason, '')), 4000), '');
  v_decision_id uuid;
  v_offer_id uuid;
  v_rejection_id uuid;
  v_correspondence_log_id uuid;
  v_template_id uuid;
  v_template_key text;
  v_rendered_subject text;
  v_offer_reference text;
  v_offered_module_offering_count integer := 0;
begin
  if v_actor_user_id is null then
    raise exception 'An authenticated staff session is required';
  end if;

  select *
  into v_staff
  from public.staff_profiles
  where id = v_actor_user_id
    and active = true;

  if not found or v_staff.role <> 'admin' then
    raise exception 'Only admissions admins can record application decisions';
  end if;

  if v_decision_reason is null then
    raise exception 'Decision reason is required';
  end if;

  select *
  into v_application
  from public.applications
  where id = p_application_id
  for update;

  if not found or v_application.status <> 'submitted' then
    raise exception 'Only submitted applications can receive an offer or rejection decision';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = v_application.admission_lead_id
  for update;

  if not found then
    raise exception 'Admission lead was not found for this application';
  end if;

  if v_lead.archived or v_lead.converted_student_id is not null then
    raise exception 'Archived or converted applications cannot receive decisions';
  end if;

  if v_lead.stage not in ('submitted', 'reviewed') then
    raise exception 'Application cannot receive a decision from this admissions stage';
  end if;

  select *
  into v_review
  from public.application_reviews
  where application_id = v_application.id
  for update;

  if not found or v_review.readiness_status <> 'ready_for_decision' then
    raise exception 'Application review must be ready for decision before recording an offer or rejection';
  end if;

  if exists (
    select 1
    from public.application_decisions
    where application_id = v_application.id
  ) then
    raise exception 'An offer or rejection decision has already been recorded for this application';
  end if;

  if p_decision_outcome = 'offer' and p_offer_deadline_at is not null and p_offer_deadline_at <= now() then
    raise exception 'Offer deadline must be in the future';
  end if;

  select *
  into v_person
  from public.persons
  where id = v_application.person_id;

  if not found then
    raise exception 'Person was not found for this application';
  end if;

  insert into public.application_decisions (
    application_id,
    admission_lead_id,
    person_id,
    outcome,
    decision_reason,
    decided_by_user_id
  )
  values (
    v_application.id,
    v_application.admission_lead_id,
    v_application.person_id,
    p_decision_outcome,
    v_decision_reason,
    v_actor_user_id
  )
  returning id into v_decision_id;

  if p_decision_outcome = 'offer' then
    v_template_key := 'offer_issued';
    v_rendered_subject := 'Your BETAR application offer';
    v_offer_reference := 'BETAR-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(v_decision_id::text, '-', ''), 1, 8));

    select id
    into v_template_id
    from public.correspondence_templates
    where template_key = v_template_key
      and channel = 'email'
      and version = 1
    limit 1;

    insert into public.application_offers (
      decision_id,
      application_id,
      person_id,
      offer_reference,
      programme,
      intended_start_term_id,
      issued_by_user_id,
      deadline_at,
      letter_template_id,
      letter_template_key,
      letter_template_version
    )
    values (
      v_decision_id,
      v_application.id,
      v_application.person_id,
      v_offer_reference,
      v_application.programme,
      v_application.intended_start_term_id,
      v_actor_user_id,
      p_offer_deadline_at,
      v_template_id,
      v_template_key,
      1
    )
    returning id into v_offer_id;

    insert into public.application_offer_module_offerings (
      offer_id,
      offering_id,
      choice_order
    )
    select
      v_offer_id,
      choice.offering_id,
      choice.choice_order
    from public.application_module_offering_choices choice
    where choice.application_id = v_application.id
    order by choice.choice_order;

    select count(*)
    into v_offered_module_offering_count
    from public.application_offer_module_offerings
    where offer_id = v_offer_id;

    if v_offered_module_offering_count < 1 or v_offered_module_offering_count > 2 then
      raise exception 'Offer decisions require one or two module offering snapshots';
    end if;

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
      v_application.person_id,
      lower(coalesce(v_application.email, v_person.email, v_lead.email)),
      concat_ws(' ', coalesce(v_application.first_name, v_person.first_name, v_lead.first_name), coalesce(v_application.last_name, v_person.last_name, v_lead.last_name)),
      'application_offer',
      v_offer_id,
      v_template_id,
      v_template_key,
      1,
      'email',
      v_rendered_subject,
      'suppressed',
      jsonb_build_object(
        'application_id',
        v_application.id,
        'admission_lead_id',
        v_application.admission_lead_id,
        'offer_id',
        v_offer_id,
        'offer_reference',
        v_offer_reference,
        'delivery_status',
        'suppressed',
        'production_email_send_enabled',
        false,
        'smtp_readiness',
        'unverified',
        'template_placeholder',
        true
      ),
      v_actor_user_id
    )
    returning id into v_correspondence_log_id;

    update public.application_offers
    set correspondence_log_id = v_correspondence_log_id
    where id = v_offer_id;

    update public.admission_leads
    set
      stage = 'offered',
      next_action_on = p_offer_deadline_at::date
    where id = v_lead.id;
  else
    v_template_key := 'rejection';
    v_rendered_subject := 'Your BETAR application outcome';

    select id
    into v_template_id
    from public.correspondence_templates
    where template_key = v_template_key
      and channel = 'email'
      and version = 1
    limit 1;

    insert into public.application_rejections (
      decision_id,
      application_id,
      person_id,
      rejection_reason,
      rejected_by_user_id,
      letter_template_id,
      letter_template_key,
      letter_template_version
    )
    values (
      v_decision_id,
      v_application.id,
      v_application.person_id,
      v_decision_reason,
      v_actor_user_id,
      v_template_id,
      v_template_key,
      1
    )
    returning id into v_rejection_id;

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
      v_application.person_id,
      lower(coalesce(v_application.email, v_person.email, v_lead.email)),
      concat_ws(' ', coalesce(v_application.first_name, v_person.first_name, v_lead.first_name), coalesce(v_application.last_name, v_person.last_name, v_lead.last_name)),
      'application_rejection',
      v_rejection_id,
      v_template_id,
      v_template_key,
      1,
      'email',
      v_rendered_subject,
      'suppressed',
      jsonb_build_object(
        'application_id',
        v_application.id,
        'admission_lead_id',
        v_application.admission_lead_id,
        'rejection_id',
        v_rejection_id,
        'delivery_status',
        'suppressed',
        'production_email_send_enabled',
        false,
        'smtp_readiness',
        'unverified',
        'template_placeholder',
        true
      ),
      v_actor_user_id
    )
    returning id into v_correspondence_log_id;

    update public.application_rejections
    set correspondence_log_id = v_correspondence_log_id
    where id = v_rejection_id;

    update public.admission_leads
    set
      stage = 'rejected',
      next_action_on = null
    where id = v_lead.id;
  end if;

  update public.application_decisions
  set correspondence_log_id = v_correspondence_log_id
  where id = v_decision_id;

  insert into public.audit_events (
    actor_type,
    actor_user_id,
    actor_person_id,
    action,
    entity_type,
    entity_id,
    reason,
    metadata
  )
  values (
    'staff',
    v_actor_user_id,
    null,
    case when p_decision_outcome = 'offer' then 'offer.issued' else 'application.rejected' end,
    'application_decision',
    v_decision_id,
    v_decision_reason,
    jsonb_build_object(
      'application_id',
      v_application.id,
      'admission_lead_id',
      v_application.admission_lead_id,
      'person_id',
      v_application.person_id,
      'outcome',
      p_decision_outcome,
      'has_decision_reason',
      true,
      'offer_id',
      v_offer_id,
      'rejection_id',
      v_rejection_id,
      'correspondence_log_id',
      v_correspondence_log_id,
      'deadline_at',
      case when p_decision_outcome = 'offer' then p_offer_deadline_at else null end,
      'offered_module_offering_count',
      case when p_decision_outcome = 'offer' then v_offered_module_offering_count else null end,
      'production_email_send_enabled',
      false
    )
  );

  return jsonb_build_object(
    'decision_id',
    v_decision_id,
    'outcome',
    p_decision_outcome,
    'offer_id',
    v_offer_id,
    'rejection_id',
    v_rejection_id,
    'correspondence_log_id',
    v_correspondence_log_id,
    'delivery_status',
    'suppressed'
  );
end;
$$;

revoke all on function public.record_application_decision(
  uuid,
  public.application_decision_outcome,
  text,
  timestamptz
) from public;

grant execute on function public.record_application_decision(
  uuid,
  public.application_decision_outcome,
  text,
  timestamptz
) to authenticated;
