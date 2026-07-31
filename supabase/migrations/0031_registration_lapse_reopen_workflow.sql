alter type public.admission_lead_stage add value if not exists 'registration_lapsed';
alter type public.admissions_registration_status add value if not exists 'lapsed';

alter table public.admissions_registrations
  add column if not exists registration_deadline_at timestamptz not null default (now() + interval '14 days'),
  add column if not exists lapsed_at timestamptz,
  add column if not exists lapsed_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists lapsed_reason text,
  add column if not exists lapsed_correspondence_log_id uuid references public.correspondence_logs(id) on delete set null,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists reopened_reason text,
  add column if not exists reopened_correspondence_log_id uuid references public.correspondence_logs(id) on delete set null;

create index if not exists admissions_registrations_deadline_status_idx
  on public.admissions_registrations(registration_deadline_at, status)
  where status in ('in_progress', 'submitted');

create or replace function public.prevent_invalid_admissions_registration_lifecycle_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'lapsed' and new.status in ('submitted', 'complete') then
    raise exception 'Lapsed registrations must be reopened before submission or conversion';
  end if;

  if new.status = 'submitted'
    and old.status <> 'submitted'
    and new.registration_deadline_at <= now() then
    raise exception 'Registration deadline has passed; admissions must reopen the registration before submission';
  end if;

  if new.status = 'complete'
    and old.status <> 'complete'
    and new.registration_deadline_at <= now() then
    raise exception 'Registration deadline has passed; admissions must reopen the registration before conversion';
  end if;

  if new.status = 'lapsed'
    and (
      old.status = 'complete'
      or old.student_id is not null
      or old.converted_at is not null
    ) then
    raise exception 'Complete or converted registrations cannot be lapsed';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_invalid_admissions_registration_lifecycle_update
  on public.admissions_registrations;

create trigger prevent_invalid_admissions_registration_lifecycle_update
  before update on public.admissions_registrations
  for each row
  execute function public.prevent_invalid_admissions_registration_lifecycle_update();

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
    'registration_lapsed_notice',
    1,
    'email',
    'Suppressed placeholder for future lapsed-registration correspondence. Production sending remains disabled until Microsoft 365/Outlook SMTP readiness is confirmed.',
    'Your BETAR registration has lapsed',
    'Placeholder only. Do not send real applicant email until the approved Microsoft 365/Outlook SMTP sender is configured and verified.'
  ),
  (
    'registration_reopened_notice',
    1,
    'email',
    'Suppressed placeholder for future reopened-registration correspondence. Production sending remains disabled until Microsoft 365/Outlook SMTP readiness is confirmed.',
    'Your BETAR registration has been reopened',
    'Placeholder only. Do not send real applicant email until the approved Microsoft 365/Outlook SMTP sender is configured and verified.'
  )
on conflict (template_key, channel, version) do nothing;

create or replace function public.process_admissions_registration_deadline_workflow(
  p_reference_time timestamptz default now(),
  p_lapse_reason text default 'Registration deadline passed before submission or conversion.'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_type public.audit_actor_type;
  v_lapse_reason text := coalesce(nullif(left(trim(coalesce(p_lapse_reason, '')), 4000), ''), 'Registration deadline passed before submission or conversion.');
  v_lapsed_count integer := 0;
  v_template_id uuid;
  v_registration record;
  v_correspondence_log_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    if v_actor_user_id is null then
      raise exception 'An authenticated staff session is required'
        using errcode = '28000';
    end if;

    if not public.is_admin() then
      raise exception 'Only admissions admins can process registration deadlines'
        using errcode = '42501';
    end if;
  end if;

  v_actor_type := case
    when auth.role() = 'service_role' then 'service'::public.audit_actor_type
    else 'staff'::public.audit_actor_type
  end;

  select id
  into v_template_id
  from public.correspondence_templates
  where template_key = 'registration_lapsed_notice'
    and channel = 'email'
    and version = 1
  limit 1;

  for v_registration in
    select
      registration.*,
      application.email as application_email,
      application.first_name as application_first_name,
      application.last_name as application_last_name,
      lead.email as lead_email,
      lead.first_name as lead_first_name,
      lead.last_name as lead_last_name,
      person.email as person_email,
      person.first_name as person_first_name,
      person.last_name as person_last_name
    from public.admissions_registrations registration
    join public.applications application on application.id = registration.application_id
    join public.admission_leads lead on lead.id = registration.admission_lead_id
    join public.persons person on person.id = registration.person_id
    join public.application_offers offer on offer.id = registration.application_offer_id
    where registration.status in ('in_progress', 'submitted')
      and registration.registration_deadline_at <= p_reference_time
      and registration.student_id is null
      and registration.converted_at is null
      and lead.archived = false
      and lead.converted_student_id is null
      and offer.status = 'accepted'
    order by registration.registration_deadline_at asc, registration.created_at asc
    for update of registration, lead
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
      delivery_status,
      metadata,
      created_by_user_id
    )
    values (
      v_registration.person_id,
      lower(coalesce(v_registration.application_email, v_registration.person_email, v_registration.lead_email)),
      concat_ws(' ', coalesce(v_registration.application_first_name, v_registration.person_first_name, v_registration.lead_first_name), coalesce(v_registration.application_last_name, v_registration.person_last_name, v_registration.lead_last_name)),
      'admissions_registration',
      v_registration.id,
      v_template_id,
      'registration_lapsed_notice',
      1,
      'email',
      'Your BETAR registration has lapsed',
      'suppressed',
      jsonb_build_object(
        'registration_id', v_registration.id,
        'offer_id', v_registration.application_offer_id,
        'application_id', v_registration.application_id,
        'admission_lead_id', v_registration.admission_lead_id,
        'person_id', v_registration.person_id,
        'registration_deadline_at', v_registration.registration_deadline_at,
        'previous_status', v_registration.status,
        'delivery_status', 'suppressed',
        'production_email_send_enabled', false,
        'provider_message_id', null,
        'template_placeholder', true
      ),
      v_actor_user_id
    )
    returning id into v_correspondence_log_id;

    update public.admissions_registrations
    set
      status = 'lapsed',
      lapsed_at = p_reference_time,
      lapsed_by_user_id = v_actor_user_id,
      lapsed_reason = v_lapse_reason,
      lapsed_correspondence_log_id = v_correspondence_log_id
    where id = v_registration.id;

    update public.admission_leads
    set
      stage = 'registration_lapsed',
      next_action_on = null
    where id = v_registration.admission_lead_id;

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
      v_actor_type,
      v_actor_user_id,
      null,
      'registration.lapsed',
      'admissions_registration',
      v_registration.id,
      v_lapse_reason,
      jsonb_build_object(
        'registration_id', v_registration.id,
        'offer_id', v_registration.application_offer_id,
        'application_id', v_registration.application_id,
        'admission_lead_id', v_registration.admission_lead_id,
        'person_id', v_registration.person_id,
        'registration_deadline_at', v_registration.registration_deadline_at,
        'reference_time', p_reference_time,
        'previous_status', v_registration.status,
        'correspondence_log_id', v_correspondence_log_id,
        'delivery_status', 'suppressed',
        'production_email_send_enabled', false,
        'provider_message_id', null
      )
    );

    v_lapsed_count := v_lapsed_count + 1;
  end loop;

  return jsonb_build_object(
    'lapsed_count', v_lapsed_count,
    'reference_time', p_reference_time,
    'production_email_send_enabled', false
  );
end;
$$;

create or replace function public.reopen_lapsed_admissions_registration(
  p_registration_id uuid,
  p_reopen_reason text,
  p_new_deadline_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_registration public.admissions_registrations%rowtype;
  v_offer public.application_offers%rowtype;
  v_application public.applications%rowtype;
  v_lead public.admission_leads%rowtype;
  v_person public.persons%rowtype;
  v_reopen_reason text := nullif(left(trim(coalesce(p_reopen_reason, '')), 4000), '');
  v_new_deadline_at timestamptz := coalesce(p_new_deadline_at, now() + interval '14 days');
  v_template_id uuid;
  v_correspondence_log_id uuid;
begin
  if v_actor_user_id is null then
    raise exception 'An authenticated staff session is required'
      using errcode = '28000';
  end if;

  if not public.is_admin() then
    raise exception 'Only admissions admins can reopen lapsed registrations'
      using errcode = '42501';
  end if;

  if v_reopen_reason is null then
    raise exception 'Reopen reason is required';
  end if;

  if v_new_deadline_at <= now() then
    raise exception 'Reopened registration deadline must be in the future';
  end if;

  select *
  into v_registration
  from public.admissions_registrations
  where id = p_registration_id
  for update;

  if not found then
    raise exception 'Registration was not found'
      using errcode = 'P0002';
  end if;

  if v_registration.status <> 'lapsed' then
    raise exception 'Only lapsed registrations can be reopened';
  end if;

  if v_registration.student_id is not null or v_registration.converted_at is not null or v_registration.status = 'complete' then
    raise exception 'Converted registrations cannot be reopened';
  end if;

  select *
  into v_offer
  from public.application_offers
  where id = v_registration.application_offer_id
  for update;

  if not found or v_offer.status <> 'accepted' or v_offer.person_id <> v_registration.person_id then
    raise exception 'Registration is not linked to an accepted offer';
  end if;

  select *
  into v_application
  from public.applications
  where id = v_registration.application_id
    and person_id = v_registration.person_id
  for update;

  if not found or v_application.status <> 'submitted' then
    raise exception 'Registration is not linked to a submitted application';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = v_registration.admission_lead_id
    and person_id = v_registration.person_id
  for update;

  if not found then
    raise exception 'Registration lead was not found';
  end if;

  if v_lead.archived or v_lead.converted_student_id is not null then
    raise exception 'Archived or converted admissions leads cannot be reopened';
  end if;

  if v_lead.stage <> 'registration_lapsed' then
    raise exception 'Only lapsed registration leads can be reopened';
  end if;

  select *
  into v_person
  from public.persons
  where id = v_registration.person_id;

  if not found then
    raise exception 'Registration person was not found';
  end if;

  select id
  into v_template_id
  from public.correspondence_templates
  where template_key = 'registration_reopened_notice'
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
    v_registration.person_id,
    lower(coalesce(v_application.email, v_person.email, v_lead.email)),
    concat_ws(' ', coalesce(v_application.first_name, v_person.first_name, v_lead.first_name), coalesce(v_application.last_name, v_person.last_name, v_lead.last_name)),
    'admissions_registration',
    v_registration.id,
    v_template_id,
    'registration_reopened_notice',
    1,
    'email',
    'Your BETAR registration has been reopened',
    'suppressed',
    jsonb_build_object(
      'registration_id', v_registration.id,
      'offer_id', v_registration.application_offer_id,
      'application_id', v_registration.application_id,
      'admission_lead_id', v_registration.admission_lead_id,
      'person_id', v_registration.person_id,
      'registration_deadline_at', v_registration.registration_deadline_at,
      'new_registration_deadline_at', v_new_deadline_at,
      'delivery_status', 'suppressed',
      'production_email_send_enabled', false,
      'provider_message_id', null,
      'template_placeholder', true
    ),
    v_actor_user_id
  )
  returning id into v_correspondence_log_id;

  update public.admissions_registrations
  set
    status = 'in_progress',
    registration_deadline_at = v_new_deadline_at,
    submitted_at = null,
    submitted_by_auth_user_id = null,
    terms_version = null,
    terms_hash = null,
    terms_accepted_at = null,
    terms_accepted_by_auth_user_id = null,
    terms_accepted_by_person_id = null,
    terms_acceptance_ip = null,
    terms_acceptance_user_agent = null,
    module_confirmation_accepted = false,
    module_confirmed_at = null,
    module_confirmed_by_auth_user_id = null,
    reopened_at = now(),
    reopened_by_user_id = v_actor_user_id,
    reopened_reason = v_reopen_reason,
    reopened_correspondence_log_id = v_correspondence_log_id
  where id = v_registration.id;

  update public.admission_leads
  set
    stage = 'registration_in_progress',
    next_action_on = v_new_deadline_at::date
  where id = v_registration.admission_lead_id;

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
    'registration.reopened',
    'admissions_registration',
    v_registration.id,
    v_reopen_reason,
    jsonb_build_object(
      'registration_id', v_registration.id,
      'offer_id', v_registration.application_offer_id,
      'application_id', v_registration.application_id,
      'admission_lead_id', v_registration.admission_lead_id,
      'person_id', v_registration.person_id,
      'previous_registration_deadline_at', v_registration.registration_deadline_at,
      'registration_deadline_at', v_new_deadline_at,
      'previous_status', v_registration.status,
      'previous_submitted_at', v_registration.submitted_at,
      'previous_terms_version', v_registration.terms_version,
      'submission_fields_cleared', true,
      'correspondence_log_id', v_correspondence_log_id,
      'delivery_status', 'suppressed',
      'production_email_send_enabled', false,
      'provider_message_id', null
    )
  );

  return v_registration.id;
end;
$$;

create or replace function public.convert_submitted_admissions_registration(p_registration_id uuid)
returns table (
  converted_registration_id uuid,
  converted_conversion_request_id uuid,
  converted_student_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registration public.admissions_registrations%rowtype;
  v_offer public.application_offers%rowtype;
  v_application public.applications%rowtype;
  v_lead public.admission_leads%rowtype;
  v_existing_request public.admissions_conversion_requests%rowtype;
  v_conversion_request_id uuid;
  v_student_id uuid;
  v_initial_offering_ids uuid[];
  v_missing_fields text[] := '{}'::text[];
  v_missing_document_slots text[] := '{}'::text[];
  v_selected_offering_count integer;
begin
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'Only admissions admins can convert submitted registrations'
      using errcode = '42501';
  end if;

  select *
  into v_registration
  from public.admissions_registrations
  where id = p_registration_id
  for update;

  if not found then
    raise exception 'Registration was not found'
      using errcode = 'P0002';
  end if;

  if v_registration.status::text = 'complete' then
    if v_registration.student_id is null then
      raise exception 'Complete registration % has no student_id', v_registration.id;
    end if;

    converted_registration_id := v_registration.id;
    converted_conversion_request_id := v_registration.conversion_request_id;
    converted_student_id := v_registration.student_id;
    return next;
    return;
  end if;

  if v_registration.status::text = 'lapsed' then
    raise exception 'Lapsed registrations must be reopened and resubmitted before conversion';
  end if;

  if v_registration.status <> 'submitted' then
    raise exception 'Only submitted registrations can be converted';
  end if;

  select *
  into v_offer
  from public.application_offers
  where id = v_registration.application_offer_id
  for update;

  if not found or v_offer.status <> 'accepted' or v_offer.person_id <> v_registration.person_id then
    raise exception 'Registration is not linked to an accepted offer';
  end if;

  select *
  into v_application
  from public.applications
  where id = v_registration.application_id
    and person_id = v_registration.person_id
  for update;

  if not found or v_application.status <> 'submitted' then
    raise exception 'Registration is not linked to a submitted application';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = v_registration.admission_lead_id
    and person_id = v_registration.person_id
  for update;

  if not found then
    raise exception 'Registration lead was not found';
  end if;

  if v_lead.archived then
    raise exception 'Archived admissions leads cannot be converted';
  end if;

  if v_lead.converted_student_id is not null then
    raise exception 'Admissions lead has already been converted';
  end if;

  if v_lead.stage not in ('accepted', 'registration_in_progress') then
    raise exception 'Registration lead is not in a convertible stage';
  end if;

  if v_registration.registration_deadline_at <= now() then
    raise exception 'Registration deadline has passed; reopen the registration before conversion';
  end if;

  if v_registration.first_name is null then
    v_missing_fields := array_append(v_missing_fields, 'first_name');
  end if;
  if v_registration.last_name is null then
    v_missing_fields := array_append(v_missing_fields, 'last_name');
  end if;
  if v_registration.date_of_birth is null then
    v_missing_fields := array_append(v_missing_fields, 'date_of_birth');
  end if;
  if v_registration.email is null or position('@' in v_registration.email) = 0 then
    v_missing_fields := array_append(v_missing_fields, 'email');
  end if;
  if v_registration.phone is null then
    v_missing_fields := array_append(v_missing_fields, 'phone');
  end if;
  if v_registration.address_line_1 is null then
    v_missing_fields := array_append(v_missing_fields, 'address_line_1');
  end if;
  if v_registration.city is null then
    v_missing_fields := array_append(v_missing_fields, 'city');
  end if;
  if v_registration.postcode is null then
    v_missing_fields := array_append(v_missing_fields, 'postcode');
  end if;
  if v_registration.country is null then
    v_missing_fields := array_append(v_missing_fields, 'country');
  end if;
  if v_registration.module_confirmation_accepted <> true then
    v_missing_fields := array_append(v_missing_fields, 'module_confirmation_accepted');
  end if;
  if v_registration.terms_version is null
    or v_registration.terms_hash is null
    or v_registration.terms_accepted_at is null
    or v_registration.terms_accepted_by_auth_user_id is null
    or v_registration.terms_accepted_by_person_id <> v_registration.person_id then
    v_missing_fields := array_append(v_missing_fields, 'terms_acceptance');
  end if;
  if v_registration.submitted_at is null or v_registration.submitted_by_auth_user_id is null then
    v_missing_fields := array_append(v_missing_fields, 'registration_submission');
  end if;

  select count(*)
  into v_selected_offering_count
  from public.admissions_registration_module_offerings registration_choice
  where registration_choice.registration_id = v_registration.id;

  if v_selected_offering_count not between 1 and 2 then
    v_missing_fields := array_append(v_missing_fields, 'confirmed_module_offerings');
  end if;

  if exists (
    select 1
    from public.admissions_registration_module_offerings registration_choice
    where registration_choice.registration_id = v_registration.id
      and registration_choice.application_offer_id <> v_registration.application_offer_id
  ) then
    raise exception 'Registration module snapshot does not match the accepted offer';
  end if;

  if exists (
    select 1
    from public.admissions_registration_module_offerings registration_choice
    where registration_choice.registration_id = v_registration.id
      and not exists (
        select 1
        from public.application_offer_module_offerings offer_choice
        where offer_choice.offer_id = v_offer.id
          and offer_choice.offering_id = registration_choice.offering_id
      )
  ) then
    raise exception 'Registration module snapshot must come from the accepted offer';
  end if;

  if exists (
    select 1
    from public.admissions_registration_module_offerings registration_choice
    where registration_choice.registration_id = v_registration.id
      and not exists (
        select 1
        from public.module_offerings offering
        join public.course_modules course_module on course_module.id = offering.module_id
        join public.terms term on term.id = offering.term_id
        where offering.id = registration_choice.offering_id
          and offering.term_id = v_registration.intended_start_term_id
          and course_module.active = true
          and term.status in ('published', 'active')
      )
  ) then
    raise exception 'Confirmed module offerings must remain active offerings for the accepted start term';
  end if;

  select coalesce(array_agg('document:' || required_slot.slot_key::text order by required_slot.slot_key::text), '{}'::text[])
  into v_missing_document_slots
  from (
    values
      ('identity_evidence'::public.admissions_registration_document_slot_key),
      ('qualification_evidence'::public.admissions_registration_document_slot_key)
  ) as required_slot(slot_key)
  where not exists (
    select 1
    from public.admissions_registration_document_slots document_slot
    join public.managed_files managed_file on managed_file.id = document_slot.managed_file_id
    join storage.objects storage_object
      on storage_object.bucket_id = managed_file.bucket
      and storage_object.name = managed_file.object_path
    where document_slot.registration_id = v_registration.id
      and document_slot.person_id = v_registration.person_id
      and document_slot.slot_key = required_slot.slot_key
      and document_slot.required = true
      and document_slot.verification_status <> 'rejected'
      and managed_file.person_id = v_registration.person_id
      and managed_file.bucket in ('id-documents', 'qualification-documents')
  );

  if cardinality(v_missing_document_slots) > 0 then
    v_missing_fields := v_missing_fields || v_missing_document_slots;
  end if;

  if cardinality(v_missing_fields) > 0 then
    raise exception 'Registration cannot be converted until required checks pass: %', array_to_string(v_missing_fields, ', ');
  end if;

  select coalesce(array_agg(registration_choice.offering_id order by registration_choice.choice_order), '{}'::uuid[])
  into v_initial_offering_ids
  from public.admissions_registration_module_offerings registration_choice
  where registration_choice.registration_id = v_registration.id;

  select *
  into v_existing_request
  from public.admissions_conversion_requests
  where registration_entity_type = 'admissions_registration'
    and registration_entity_id = v_registration.id
  for update;

  if found then
    if v_existing_request.status = 'cancelled' then
      raise exception 'Admissions conversion request has been cancelled';
    end if;

    v_conversion_request_id := v_existing_request.id;

    if v_existing_request.status = 'converted' then
      if v_existing_request.student_id is null then
        raise exception 'Converted request % has no student_id', v_existing_request.id;
      end if;
      v_student_id := v_existing_request.student_id;
    else
      update public.admissions_conversion_requests
      set
        person_id = v_registration.person_id,
        source_entity_type = 'admissions_registration',
        source_entity_id = v_registration.id,
        accepted_offer_entity_type = 'application_offer',
        accepted_offer_entity_id = v_offer.id,
        registration_entity_type = 'admissions_registration',
        registration_entity_id = v_registration.id,
        status = 'ready_for_conversion',
        offer_accepted_at = v_offer.accepted_at,
        registration_completed_at = v_registration.submitted_at,
        terms_version = v_registration.terms_version,
        terms_hash = v_registration.terms_hash,
        terms_accepted_at = v_registration.terms_accepted_at,
        terms_accepted_by_auth_user_id = v_registration.terms_accepted_by_auth_user_id,
        terms_acceptance_ip = v_registration.terms_acceptance_ip,
        first_name = v_registration.first_name,
        last_name = v_registration.last_name,
        preferred_name = v_registration.preferred_name,
        date_of_birth = v_registration.date_of_birth,
        email = v_registration.email,
        phone = v_registration.phone,
        address_line_1 = v_registration.address_line_1,
        address_line_2 = v_registration.address_line_2,
        city = v_registration.city,
        postcode = v_registration.postcode,
        country = v_registration.country,
        programme = v_registration.programme,
        start_term_id = v_registration.intended_start_term_id,
        initial_module_offering_ids = v_initial_offering_ids,
        student_id = v_registration.student_id
      where id = v_existing_request.id;
    end if;
  else
    insert into public.admissions_conversion_requests (
      person_id,
      source_entity_type,
      source_entity_id,
      accepted_offer_entity_type,
      accepted_offer_entity_id,
      registration_entity_type,
      registration_entity_id,
      status,
      offer_accepted_at,
      registration_completed_at,
      terms_version,
      terms_hash,
      terms_accepted_at,
      terms_accepted_by_auth_user_id,
      terms_acceptance_ip,
      first_name,
      last_name,
      preferred_name,
      date_of_birth,
      email,
      phone,
      address_line_1,
      address_line_2,
      city,
      postcode,
      country,
      programme,
      start_term_id,
      initial_module_offering_ids,
      student_id
    )
    values (
      v_registration.person_id,
      'admissions_registration',
      v_registration.id,
      'application_offer',
      v_offer.id,
      'admissions_registration',
      v_registration.id,
      'ready_for_conversion',
      v_offer.accepted_at,
      v_registration.submitted_at,
      v_registration.terms_version,
      v_registration.terms_hash,
      v_registration.terms_accepted_at,
      v_registration.terms_accepted_by_auth_user_id,
      v_registration.terms_acceptance_ip,
      v_registration.first_name,
      v_registration.last_name,
      v_registration.preferred_name,
      v_registration.date_of_birth,
      v_registration.email,
      v_registration.phone,
      v_registration.address_line_1,
      v_registration.address_line_2,
      v_registration.city,
      v_registration.postcode,
      v_registration.country,
      v_registration.programme,
      v_registration.intended_start_term_id,
      v_initial_offering_ids,
      v_registration.student_id
    )
    returning id into v_conversion_request_id;
  end if;

  insert into public.admissions_conversion_documents (
    conversion_request_id,
    managed_file_id,
    document_kind,
    verified_at,
    verified_by_user_id
  )
  select
    v_conversion_request_id,
    document_slot.managed_file_id,
    case document_slot.slot_key
      when 'identity_evidence' then 'identity_document'
      when 'qualification_evidence' then 'qualification_document'
      when 'student_id_photo' then 'student_photo'
    end,
    coalesce(document_slot.verification_at, now()),
    coalesce(document_slot.verifier_user_id, auth.uid())
  from public.admissions_registration_document_slots document_slot
  where document_slot.registration_id = v_registration.id
    and document_slot.managed_file_id is not null
    and document_slot.verification_status <> 'rejected'
  on conflict (conversion_request_id, managed_file_id)
  do update set
    document_kind = excluded.document_kind,
    verified_at = excluded.verified_at,
    verified_by_user_id = excluded.verified_by_user_id;

  if v_student_id is null then
    select converted.student_id
    into v_student_id
    from public.convert_admissions_registration(v_conversion_request_id) as converted;
  end if;

  update public.admissions_registrations
  set
    status = 'complete',
    conversion_request_id = v_conversion_request_id,
    student_id = v_student_id,
    converted_at = coalesce(converted_at, now()),
    converted_by_user_id = coalesce(converted_by_user_id, auth.uid())
  where id = v_registration.id;

  update public.admission_leads
  set
    stage = 'registered',
    converted_student_id = v_student_id,
    next_action_on = null
  where id = v_registration.admission_lead_id;

  update public.applications
  set
    converted_student_id = v_student_id,
    converted_at = coalesce(converted_at, now())
  where id = v_registration.application_id;

  update public.application_offers
  set
    converted_student_id = v_student_id,
    converted_at = coalesce(converted_at, now())
  where id = v_registration.application_offer_id;

  converted_registration_id := v_registration.id;
  converted_conversion_request_id := v_conversion_request_id;
  converted_student_id := v_student_id;
  return next;
end;
$$;

revoke all on function public.process_admissions_registration_deadline_workflow(timestamptz, text) from public;
revoke all on function public.reopen_lapsed_admissions_registration(uuid, text, timestamptz) from public;

grant execute on function public.process_admissions_registration_deadline_workflow(timestamptz, text) to authenticated, service_role;
grant execute on function public.reopen_lapsed_admissions_registration(uuid, text, timestamptz) to authenticated;
