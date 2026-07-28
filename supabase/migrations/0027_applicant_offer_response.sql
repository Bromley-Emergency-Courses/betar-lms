alter type public.admission_lead_stage add value if not exists 'offer_declined';

alter table public.application_offers
  add column accepted_by_auth_user_id uuid references auth.users(id) on delete set null,
  add column accepted_by_person_id uuid references public.persons(id) on delete set null,
  add column accepted_ip_address inet,
  add column accepted_user_agent text,
  add column declined_by_auth_user_id uuid references auth.users(id) on delete set null,
  add column declined_by_person_id uuid references public.persons(id) on delete set null,
  add column declined_ip_address inet,
  add column declined_user_agent text;

alter table public.application_offers
  add constraint application_offers_accepted_identity_check
  check (
    (status = 'accepted'
      and accepted_at is not null
      and accepted_by_auth_user_id is not null
      and accepted_by_person_id is not null
      and declined_by_auth_user_id is null
      and declined_by_person_id is null)
    or status <> 'accepted'
  ) not valid,
  add constraint application_offers_declined_identity_check
  check (
    (status = 'declined'
      and declined_at is not null
      and declined_by_auth_user_id is not null
      and declined_by_person_id is not null
      and accepted_by_auth_user_id is null
      and accepted_by_person_id is null)
    or status <> 'declined'
  ) not valid;

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
    'offer_accepted_confirmation',
    1,
    'email',
    'Suppressed placeholder for applicant offer acceptance confirmation. Production sending remains disabled until Microsoft 365/Outlook SMTP readiness is confirmed.',
    'Your BETAR offer acceptance',
    'Placeholder only. Do not send real applicant email until the approved Microsoft 365/Outlook SMTP sender is configured and verified.'
  ),
  (
    'offer_declined_confirmation',
    1,
    'email',
    'Suppressed placeholder for applicant offer decline confirmation. Production sending remains disabled until Microsoft 365/Outlook SMTP readiness is confirmed.',
    'Your BETAR offer response',
    'Placeholder only. Do not send real applicant email until the approved Microsoft 365/Outlook SMTP sender is configured and verified.'
  )
on conflict (template_key, channel, version) do nothing;

create policy "portal users read own offered module offerings"
  on public.module_offerings for select
  using (
    exists (
      select 1
      from public.application_offer_module_offerings offer_choice
      join public.application_offers offer on offer.id = offer_choice.offer_id
      where offer_choice.offering_id = module_offerings.id
        and offer.person_id = public.current_person_id()
    )
  );

create policy "portal users read own offered course modules"
  on public.course_modules for select
  using (
    exists (
      select 1
      from public.module_offerings offering
      join public.application_offer_module_offerings offer_choice on offer_choice.offering_id = offering.id
      join public.application_offers offer on offer.id = offer_choice.offer_id
      where offering.module_id = course_modules.id
        and offer.person_id = public.current_person_id()
    )
  );

create policy "portal users read own offer terms"
  on public.terms for select
  using (
    exists (
      select 1
      from public.application_offers offer
      where offer.intended_start_term_id = terms.id
        and offer.person_id = public.current_person_id()
    )
  );

create or replace function public.respond_to_application_offer(
  p_offer_id uuid,
  p_response text,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_person_id uuid := public.current_person_id();
  v_actor_type public.portal_actor_type := public.current_portal_actor_type();
  v_response text := lower(trim(coalesce(p_response, '')));
  v_user_agent text := nullif(left(trim(coalesce(p_user_agent, '')), 500), '');
  v_offer public.application_offers%rowtype;
  v_application public.applications%rowtype;
  v_lead public.admission_leads%rowtype;
  v_person public.persons%rowtype;
  v_template_id uuid;
  v_template_key text;
  v_rendered_subject text;
  v_correspondence_log_id uuid;
  v_new_offer_status public.application_offer_status;
  v_new_lead_stage public.admission_lead_stage;
  v_action text;
begin
  if v_actor_user_id is null or v_actor_person_id is null or v_actor_type <> 'applicant' then
    raise exception 'An authenticated applicant session is required';
  end if;

  if v_response not in ('accept', 'decline') then
    raise exception 'Offer response must be accept or decline';
  end if;

  select *
  into v_offer
  from public.application_offers
  where id = p_offer_id
  for update;

  if not found or v_offer.person_id <> v_actor_person_id then
    raise exception 'Offer was not found for this applicant';
  end if;

  if v_offer.status <> 'issued' then
    raise exception 'Only issued offers can be accepted or declined';
  end if;

  if v_offer.deadline_at is not null and v_offer.deadline_at < now() then
    raise exception 'Offer deadline has passed';
  end if;

  select *
  into v_application
  from public.applications
  where id = v_offer.application_id
  for update;

  if not found or v_application.person_id <> v_actor_person_id or v_application.status <> 'submitted' then
    raise exception 'Offer application is not eligible for applicant response';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = v_application.admission_lead_id
  for update;

  if not found or v_lead.archived or v_lead.converted_student_id is not null or v_lead.stage <> 'offered' then
    raise exception 'Offer is not in an admissions stage that can receive applicant responses';
  end if;

  select *
  into v_person
  from public.persons
  where id = v_actor_person_id;

  if not found then
    raise exception 'Applicant person was not found';
  end if;

  if v_response = 'accept' then
    v_new_offer_status := 'accepted';
    v_new_lead_stage := 'accepted';
    v_template_key := 'offer_accepted_confirmation';
    v_rendered_subject := 'Your BETAR offer acceptance';
    v_action := 'offer.accepted';

    update public.application_offers
    set
      status = v_new_offer_status,
      accepted_at = now(),
      accepted_by_auth_user_id = v_actor_user_id,
      accepted_by_person_id = v_actor_person_id,
      accepted_ip_address = p_ip_address,
      accepted_user_agent = v_user_agent
    where id = v_offer.id;
  else
    v_new_offer_status := 'declined';
    v_new_lead_stage := 'offer_declined';
    v_template_key := 'offer_declined_confirmation';
    v_rendered_subject := 'Your BETAR offer response';
    v_action := 'offer.declined';

    update public.application_offers
    set
      status = v_new_offer_status,
      declined_at = now(),
      declined_by_auth_user_id = v_actor_user_id,
      declined_by_person_id = v_actor_person_id,
      declined_ip_address = p_ip_address,
      declined_user_agent = v_user_agent
    where id = v_offer.id;
  end if;

  update public.admission_leads
  set
    stage = v_new_lead_stage,
    next_action_on = null
  where id = v_lead.id;

  select id
  into v_template_id
  from public.correspondence_templates
  where template_key = v_template_key
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
    provider_message_id,
    delivery_status,
    metadata,
    created_by_user_id
  )
  values (
    v_actor_person_id,
    lower(coalesce(v_application.email, v_person.email, v_lead.email)),
    concat_ws(' ', coalesce(v_application.first_name, v_person.first_name, v_lead.first_name), coalesce(v_application.last_name, v_person.last_name, v_lead.last_name)),
    'application_offer',
    v_offer.id,
    v_template_id,
    v_template_key,
    1,
    'email',
    v_rendered_subject,
    null,
    'suppressed',
    jsonb_build_object(
      'application_id',
      v_application.id,
      'admission_lead_id',
      v_application.admission_lead_id,
      'offer_id',
      v_offer.id,
      'offer_reference',
      v_offer.offer_reference,
      'response',
      v_response,
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
    null
  )
  returning id into v_correspondence_log_id;

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
    'applicant',
    v_actor_user_id,
    v_actor_person_id,
    v_action,
    'application_offer',
    v_offer.id,
    case when v_response = 'accept' then 'Applicant accepted offer' else 'Applicant declined offer' end,
    jsonb_build_object(
      'offer_id',
      v_offer.id,
      'application_id',
      v_application.id,
      'admission_lead_id',
      v_application.admission_lead_id,
      'person_id',
      v_actor_person_id,
      'response',
      v_response,
      'deadline_at',
      v_offer.deadline_at,
      'correspondence_log_id',
      v_correspondence_log_id,
      'production_email_send_enabled',
      false,
      'provider_message_id',
      null
    )
  );

  return jsonb_build_object(
    'offer_id',
    v_offer.id,
    'status',
    v_new_offer_status,
    'lead_stage',
    v_new_lead_stage,
    'correspondence_log_id',
    v_correspondence_log_id,
    'delivery_status',
    'suppressed',
    'provider_message_id',
    null
  );
end;
$$;

revoke all on function public.respond_to_application_offer(uuid, text, inet, text) from public;
grant execute on function public.respond_to_application_offer(uuid, text, inet, text) to authenticated;
