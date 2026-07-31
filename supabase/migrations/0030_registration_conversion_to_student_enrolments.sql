alter type public.admission_lead_stage add value if not exists 'registered';
alter type public.admissions_registration_status add value if not exists 'complete';

alter table public.applications
  add column if not exists converted_student_id uuid references public.students(id) on delete set null,
  add column if not exists converted_at timestamptz;

alter table public.application_offers
  add column if not exists converted_student_id uuid references public.students(id) on delete set null,
  add column if not exists converted_at timestamptz;

alter table public.admissions_registrations
  add column if not exists conversion_request_id uuid references public.admissions_conversion_requests(id) on delete set null,
  add column if not exists student_id uuid references public.students(id) on delete set null,
  add column if not exists converted_at timestamptz,
  add column if not exists converted_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists applications_converted_student_idx
  on public.applications(converted_student_id)
  where converted_student_id is not null;

create index if not exists application_offers_converted_student_idx
  on public.application_offers(converted_student_id)
  where converted_student_id is not null;

create index if not exists admissions_registrations_student_idx
  on public.admissions_registrations(student_id)
  where student_id is not null;

create unique index if not exists admissions_registrations_conversion_request_idx
  on public.admissions_registrations(conversion_request_id)
  where conversion_request_id is not null;

create or replace function public.convert_admissions_registration(p_conversion_request_id uuid)
returns table (
  conversion_request_id uuid,
  student_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.admissions_conversion_requests%rowtype;
  v_actor_type public.audit_actor_type;
  v_student_id uuid;
  v_temporary_id text;
  v_missing_offering_count integer;
  v_wrong_term_count integer;
  v_cross_person_file_count integer;
  v_cross_student_file_count integer;
  v_initial_offering_ids uuid[];
begin
  select *
  into v_request
  from public.admissions_conversion_requests
  where id = p_conversion_request_id
  for update;

  if not found then
    raise exception 'Admissions conversion request not found'
      using errcode = 'P0002';
  end if;

  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  if auth.role() is distinct from 'service_role' and not public.is_admin() then
    raise exception 'Only admissions admins can convert submitted registrations'
      using errcode = '42501';
  end if;

  if v_request.status = 'converted' then
    if v_request.student_id is null then
      raise exception 'Converted request % has no student_id', v_request.id;
    end if;

    conversion_request_id := v_request.id;
    student_id := v_request.student_id;
    return next;
    return;
  end if;

  if v_request.status <> 'ready_for_conversion' then
    raise exception 'Admissions conversion request % is %, not ready_for_conversion', v_request.id, v_request.status;
  end if;

  if v_request.offer_accepted_at is null then
    raise exception 'Offer acceptance must be recorded before conversion';
  end if;

  if v_request.registration_completed_at is null then
    raise exception 'Registration completion must be recorded before conversion';
  end if;

  if v_request.terms_version is null
    or v_request.terms_hash is null
    or v_request.terms_accepted_at is null then
    raise exception 'Terms acceptance version, hash, and timestamp must be recorded before conversion';
  end if;

  select array_agg(distinct requested.offering_id)
  into v_initial_offering_ids
  from unnest(v_request.initial_module_offering_ids) as requested(offering_id)
  where requested.offering_id is not null;

  if coalesce(cardinality(v_initial_offering_ids), 0) = 0 then
    raise exception 'At least one initial module offering is required before conversion';
  end if;

  select count(*)
  into v_missing_offering_count
  from unnest(v_initial_offering_ids) as requested(offering_id)
  left join public.module_offerings offering on offering.id = requested.offering_id
  where offering.id is null;

  if v_missing_offering_count > 0 then
    raise exception 'Initial module offering list contains unknown offering IDs';
  end if;

  select count(*)
  into v_wrong_term_count
  from public.module_offerings offering
  where offering.id = any(v_initial_offering_ids)
    and offering.term_id <> v_request.start_term_id;

  if v_wrong_term_count > 0 then
    raise exception 'Initial module offerings must belong to the conversion start term';
  end if;

  select count(*)
  into v_cross_person_file_count
  from public.admissions_conversion_documents conversion_document
  join public.managed_files managed_file on managed_file.id = conversion_document.managed_file_id
  where conversion_document.conversion_request_id = v_request.id
    and managed_file.person_id is not null
    and managed_file.person_id <> v_request.person_id;

  if v_cross_person_file_count > 0 then
    raise exception 'Conversion document list contains files linked to a different person';
  end if;

  update public.persons
  set
    first_name = v_request.first_name,
    last_name = v_request.last_name,
    preferred_name = v_request.preferred_name,
    date_of_birth = v_request.date_of_birth,
    email = v_request.email,
    phone = v_request.phone,
    address_line_1 = v_request.address_line_1,
    address_line_2 = v_request.address_line_2,
    city = v_request.city,
    postcode = v_request.postcode,
    country = v_request.country
  where id = v_request.person_id;

  if v_request.student_id is not null then
    select students.id
    into v_student_id
    from public.students
    where students.id = v_request.student_id
    for update;

    if v_student_id is null then
      raise exception 'Requested target student % was not found', v_request.student_id
        using errcode = 'P0002';
    end if;
  else
    select students.id
    into v_student_id
    from public.students
    where students.person_id = v_request.person_id
    order by students.created_at asc
    limit 1
    for update;
  end if;

  v_temporary_id := coalesce(
    nullif(trim(v_request.temporary_id), ''),
    'BETAR-TMP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
  );

  v_actor_type := case
    when auth.role() = 'service_role' then 'service'::public.audit_actor_type
    else 'staff'::public.audit_actor_type
  end;

  if v_student_id is null then
    insert into public.students (
      person_id,
      cccu_student_id,
      temporary_id,
      first_name,
      last_name,
      email,
      phone,
      status,
      admission_stage,
      programme,
      start_term_id,
      notes
    )
    values (
      v_request.person_id,
      v_request.cccu_student_id,
      v_temporary_id,
      v_request.first_name,
      v_request.last_name,
      v_request.email,
      v_request.phone,
      'active',
      'cccu_registration_complete',
      v_request.programme,
      v_request.start_term_id,
      'Converted from ' || v_request.source_entity_type || ' ' || v_request.source_entity_id::text
    )
    returning id into v_student_id;
  else
    update public.students
    set
      person_id = v_request.person_id,
      cccu_student_id = coalesce(v_request.cccu_student_id, students.cccu_student_id),
      temporary_id = students.temporary_id,
      first_name = v_request.first_name,
      last_name = v_request.last_name,
      email = v_request.email,
      phone = v_request.phone,
      status = 'active',
      admission_stage = 'cccu_registration_complete',
      programme = v_request.programme,
      start_term_id = v_request.start_term_id
    where students.id = v_student_id;
  end if;

  select count(*)
  into v_cross_student_file_count
  from public.admissions_conversion_documents conversion_document
  join public.managed_files managed_file on managed_file.id = conversion_document.managed_file_id
  where conversion_document.conversion_request_id = v_request.id
    and managed_file.student_id is not null
    and managed_file.student_id <> v_student_id;

  if v_cross_student_file_count > 0 then
    raise exception 'Conversion document list contains files linked to a different student';
  end if;

  insert into public.enrolments (student_id, offering_id, status)
  select v_student_id, requested.offering_id, 'planned'
  from unnest(v_initial_offering_ids) as requested(offering_id)
  on conflict on constraint enrolments_student_id_offering_id_key do nothing;

  update public.managed_files
  set
    student_id = v_student_id,
    person_id = v_request.person_id
  where id in (
    select conversion_document.managed_file_id
    from public.admissions_conversion_documents conversion_document
    where conversion_document.conversion_request_id = v_request.id
  );

  update public.person_auth_identities
  set actor_type = 'student'
  where person_id = v_request.person_id
    and active = true;

  update public.admissions_conversion_requests
  set
    status = 'converted',
    student_id = v_student_id,
    converted_at = now(),
    converted_by_user_id = auth.uid()
  where id = v_request.id;

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
    auth.uid(),
    null,
    'registration.converted_to_student',
    'admissions_conversion_request',
    v_request.id,
    null,
    jsonb_build_object(
      'person_id', v_request.person_id,
      'student_id', v_student_id,
      'source_entity_type', v_request.source_entity_type,
      'source_entity_id', v_request.source_entity_id,
      'accepted_offer_entity_type', v_request.accepted_offer_entity_type,
      'accepted_offer_entity_id', v_request.accepted_offer_entity_id,
      'registration_entity_type', v_request.registration_entity_type,
      'registration_entity_id', v_request.registration_entity_id,
      'start_term_id', v_request.start_term_id,
      'initial_module_offering_ids', to_jsonb(v_initial_offering_ids),
      'finance_generation_enabled', false
    )
  );

  conversion_request_id := v_request.id;
  student_id := v_student_id;
  return next;
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

revoke all on function public.convert_admissions_registration(uuid) from public;
revoke execute on function public.convert_admissions_registration(uuid) from authenticated;
grant execute on function public.convert_admissions_registration(uuid) to service_role;

revoke all on function public.convert_submitted_admissions_registration(uuid) from public;
grant execute on function public.convert_submitted_admissions_registration(uuid) to authenticated, service_role;
