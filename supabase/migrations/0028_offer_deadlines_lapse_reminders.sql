alter type public.admission_lead_stage add value if not exists 'offer_lapsed';

do $$
declare
  v_function_definition text;
begin
  select pg_get_functiondef('public.respond_to_application_offer(uuid, text, inet, text)'::regprocedure)
  into v_function_definition;

  if v_function_definition like '%v_offer.deadline_at is not null and v_offer.deadline_at < now()%' then
    execute replace(
      v_function_definition,
      'v_offer.deadline_at is not null and v_offer.deadline_at < now()',
      'v_offer.deadline_at is not null and v_offer.deadline_at <= now()'
    );
  end if;
end;
$$;

alter table public.application_offers
  add column if not exists deadline_reminder_count integer not null default 0 check (deadline_reminder_count >= 0),
  add column if not exists last_deadline_reminder_at timestamptz,
  add column if not exists last_deadline_reminder_correspondence_log_id uuid references public.correspondence_logs(id) on delete set null;

update public.application_offers
set deadline_at = greatest(issued_at + interval '14 days', now() + interval '14 days')
where status = 'issued'
  and deadline_at is null;

do $$
begin
  alter table public.application_offers
    add constraint application_offers_issued_deadline_required
    check (status <> 'issued' or deadline_at is not null)
    not valid;
exception
  when duplicate_object then null;
end;
$$;

alter table public.application_offers
  validate constraint application_offers_issued_deadline_required;

create index if not exists application_offers_deadline_workflow_idx
  on public.application_offers(status, deadline_at)
  where status = 'issued';

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
    'offer_deadline_reminder',
    1,
    'email',
    'Suppressed placeholder for future offer deadline reminder correspondence. Production sending remains disabled until Microsoft 365/Outlook SMTP readiness is confirmed.',
    'Reminder: your BETAR offer deadline is approaching',
    'Placeholder only. Do not send real applicant email until the approved Microsoft 365/Outlook SMTP sender is configured and verified.'
  ),
  (
    'offer_lapsed_notice',
    1,
    'email',
    'Suppressed placeholder for future lapsed-offer correspondence. Production sending remains disabled until Microsoft 365/Outlook SMTP readiness is confirmed.',
    'Your BETAR offer has lapsed',
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
  v_offer_deadline_at timestamptz;
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

  if p_decision_outcome = 'offer' then
    v_offer_deadline_at := coalesce(p_offer_deadline_at, now() + interval '14 days');

    if v_offer_deadline_at <= now() then
      raise exception 'Offer deadline must be in the future';
    end if;
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
      v_offer_deadline_at,
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
      next_action_on = v_offer_deadline_at::date
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
      case when p_decision_outcome = 'offer' then v_offer_deadline_at else null end,
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
    'deadline_at',
    case when p_decision_outcome = 'offer' then v_offer_deadline_at else null end,
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

create or replace function public.process_application_offer_deadline_workflow(
  p_reference_time timestamptz default now(),
  p_reminder_window_days integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_staff public.staff_profiles%rowtype;
  v_reference_time timestamptz := coalesce(p_reference_time, now());
  v_reminder_window_days integer := coalesce(p_reminder_window_days, 3);
  v_reminder_until timestamptz;
  v_template_id uuid;
  v_correspondence_log_id uuid;
  v_reminder_count integer := 0;
  v_lapsed_count integer := 0;
  v_reminder_offer_ids uuid[] := array[]::uuid[];
  v_lapsed_offer_ids uuid[] := array[]::uuid[];
  v_offer record;
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
    raise exception 'Only admissions admins can process offer deadline workflows';
  end if;

  if v_reminder_window_days < 0 or v_reminder_window_days > 30 then
    raise exception 'Reminder window must be between 0 and 30 days';
  end if;

  v_reminder_until := v_reference_time + make_interval(days => v_reminder_window_days);

  select id
  into v_template_id
  from public.correspondence_templates
  where template_key = 'offer_deadline_reminder'
    and channel = 'email'
    and version = 1
  limit 1;

  for v_offer in
    select
      offer.id,
      offer.application_id,
      offer.person_id,
      offer.offer_reference,
      offer.deadline_at,
      offer.deadline_reminder_count,
      application.admission_lead_id,
      application.first_name as application_first_name,
      application.last_name as application_last_name,
      application.email as application_email,
      lead.first_name as lead_first_name,
      lead.last_name as lead_last_name,
      lead.email as lead_email,
      person.first_name as person_first_name,
      person.last_name as person_last_name,
      person.email as person_email
    from public.application_offers offer
    join public.applications application on application.id = offer.application_id
    join public.admission_leads lead on lead.id = application.admission_lead_id
    join public.persons person on person.id = offer.person_id
    where offer.status = 'issued'
      and offer.deadline_at is not null
      and offer.deadline_at > v_reference_time
      and offer.deadline_at <= v_reminder_until
      and offer.last_deadline_reminder_at is null
      and application.status = 'submitted'
      and lead.stage = 'offered'
      and lead.archived = false
      and lead.converted_student_id is null
    order by offer.deadline_at asc, offer.issued_at asc
    for update of offer, lead
  loop
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
      provider_message_id,
      delivery_status,
      metadata,
      created_by_user_id
    )
    values (
      v_offer.person_id,
      lower(coalesce(v_offer.application_email, v_offer.person_email, v_offer.lead_email)),
      concat_ws(' ', coalesce(v_offer.application_first_name, v_offer.person_first_name, v_offer.lead_first_name), coalesce(v_offer.application_last_name, v_offer.person_last_name, v_offer.lead_last_name)),
      'application_offer',
      v_offer.id,
      v_template_id,
      'offer_deadline_reminder',
      1,
      'email',
      'Reminder: your BETAR offer deadline is approaching',
      null,
      'suppressed',
      jsonb_build_object(
        'application_id',
        v_offer.application_id,
        'admission_lead_id',
        v_offer.admission_lead_id,
        'offer_id',
        v_offer.id,
        'offer_reference',
        v_offer.offer_reference,
        'deadline_at',
        v_offer.deadline_at,
        'reference_time',
        v_reference_time,
        'reminder_window_days',
        v_reminder_window_days,
        'delivery_status',
        'suppressed',
        'provider_message_id',
        null,
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
    set
      deadline_reminder_count = deadline_reminder_count + 1,
      last_deadline_reminder_at = v_reference_time,
      last_deadline_reminder_correspondence_log_id = v_correspondence_log_id
    where id = v_offer.id;

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
      'offer.reminder_eligible',
      'application_offer',
      v_offer.id,
      'Offer deadline reminder eligibility recorded',
      jsonb_build_object(
        'offer_id',
        v_offer.id,
        'application_id',
        v_offer.application_id,
        'admission_lead_id',
        v_offer.admission_lead_id,
        'person_id',
        v_offer.person_id,
        'deadline_at',
        v_offer.deadline_at,
        'reference_time',
        v_reference_time,
        'reminder_window_days',
        v_reminder_window_days,
        'correspondence_log_id',
        v_correspondence_log_id,
        'delivery_status',
        'suppressed',
        'production_email_send_enabled',
        false,
        'provider_message_id',
        null
      )
    );

    v_reminder_count := v_reminder_count + 1;
    v_reminder_offer_ids := array_append(v_reminder_offer_ids, v_offer.id);
  end loop;

  select id
  into v_template_id
  from public.correspondence_templates
  where template_key = 'offer_lapsed_notice'
    and channel = 'email'
    and version = 1
  limit 1;

  for v_offer in
    select
      offer.id,
      offer.application_id,
      offer.person_id,
      offer.offer_reference,
      offer.deadline_at,
      application.admission_lead_id,
      application.first_name as application_first_name,
      application.last_name as application_last_name,
      application.email as application_email,
      lead.first_name as lead_first_name,
      lead.last_name as lead_last_name,
      lead.email as lead_email,
      person.first_name as person_first_name,
      person.last_name as person_last_name,
      person.email as person_email
    from public.application_offers offer
    join public.applications application on application.id = offer.application_id
    join public.admission_leads lead on lead.id = application.admission_lead_id
    join public.persons person on person.id = offer.person_id
    where offer.status = 'issued'
      and offer.deadline_at is not null
      and offer.deadline_at <= v_reference_time
      and application.status = 'submitted'
      and lead.stage = 'offered'
      and lead.archived = false
      and lead.converted_student_id is null
    order by offer.deadline_at asc, offer.issued_at asc
    for update of offer, lead
  loop
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
      provider_message_id,
      delivery_status,
      metadata,
      created_by_user_id
    )
    values (
      v_offer.person_id,
      lower(coalesce(v_offer.application_email, v_offer.person_email, v_offer.lead_email)),
      concat_ws(' ', coalesce(v_offer.application_first_name, v_offer.person_first_name, v_offer.lead_first_name), coalesce(v_offer.application_last_name, v_offer.person_last_name, v_offer.lead_last_name)),
      'application_offer',
      v_offer.id,
      v_template_id,
      'offer_lapsed_notice',
      1,
      'email',
      'Your BETAR offer has lapsed',
      null,
      'suppressed',
      jsonb_build_object(
        'application_id',
        v_offer.application_id,
        'admission_lead_id',
        v_offer.admission_lead_id,
        'offer_id',
        v_offer.id,
        'offer_reference',
        v_offer.offer_reference,
        'deadline_at',
        v_offer.deadline_at,
        'lapsed_at',
        v_reference_time,
        'delivery_status',
        'suppressed',
        'provider_message_id',
        null,
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
    set
      status = 'lapsed',
      lapsed_at = v_reference_time
    where id = v_offer.id;

    update public.admission_leads
    set
      stage = 'offer_lapsed',
      next_action_on = null
    where id = v_offer.admission_lead_id;

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
      'offer.lapsed',
      'application_offer',
      v_offer.id,
      'Offer deadline passed; offer marked lapsed',
      jsonb_build_object(
        'offer_id',
        v_offer.id,
        'application_id',
        v_offer.application_id,
        'admission_lead_id',
        v_offer.admission_lead_id,
        'person_id',
        v_offer.person_id,
        'deadline_at',
        v_offer.deadline_at,
        'lapsed_at',
        v_reference_time,
        'correspondence_log_id',
        v_correspondence_log_id,
        'delivery_status',
        'suppressed',
        'production_email_send_enabled',
        false,
        'provider_message_id',
        null
      )
    );

    v_lapsed_count := v_lapsed_count + 1;
    v_lapsed_offer_ids := array_append(v_lapsed_offer_ids, v_offer.id);
  end loop;

  return jsonb_build_object(
    'reminder_count',
    v_reminder_count,
    'lapsed_count',
    v_lapsed_count,
    'reminder_offer_ids',
    to_jsonb(v_reminder_offer_ids),
    'lapsed_offer_ids',
    to_jsonb(v_lapsed_offer_ids),
    'reference_time',
    v_reference_time,
    'reminder_window_days',
    v_reminder_window_days,
    'delivery_status',
    'suppressed',
    'production_email_send_enabled',
    false,
    'provider_message_id',
    null
  );
end;
$$;

revoke all on function public.process_application_offer_deadline_workflow(timestamptz, integer) from public;
grant execute on function public.process_application_offer_deadline_workflow(timestamptz, integer) to authenticated;
