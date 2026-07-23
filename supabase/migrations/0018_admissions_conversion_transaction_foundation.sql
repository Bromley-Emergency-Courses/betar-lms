create type public.admissions_conversion_status as enum (
  'draft',
  'ready_for_conversion',
  'converted',
  'cancelled'
);

create table public.admissions_conversion_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete restrict,
  source_entity_type text not null,
  source_entity_id uuid not null,
  accepted_offer_entity_type text not null default 'offer',
  accepted_offer_entity_id uuid not null,
  registration_entity_type text not null default 'registration',
  registration_entity_id uuid not null,
  status public.admissions_conversion_status not null default 'draft',
  offer_accepted_at timestamptz,
  registration_completed_at timestamptz,
  terms_version text,
  terms_hash text,
  terms_accepted_at timestamptz,
  terms_accepted_by_auth_user_id uuid references auth.users(id) on delete set null,
  terms_acceptance_ip inet,
  first_name text not null,
  last_name text not null,
  preferred_name text,
  date_of_birth date,
  email text not null,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  postcode text,
  country text,
  cccu_student_id text,
  temporary_id text,
  programme text not null check (programme in ('pgcert', 'microcredential')),
  start_term_id uuid not null references public.terms(id) on delete restrict,
  initial_module_offering_ids uuid[] not null default '{}',
  student_id uuid references public.students(id) on delete set null,
  converted_at timestamptz,
  converted_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(source_entity_type)) > 0),
  check (length(trim(accepted_offer_entity_type)) > 0),
  check (length(trim(registration_entity_type)) > 0),
  check (length(trim(first_name)) > 0),
  check (length(trim(last_name)) > 0),
  check (length(trim(email)) > 3),
  check (temporary_id is null or length(trim(temporary_id)) > 0),
  check (terms_version is null or length(trim(terms_version)) > 0),
  check (terms_hash is null or length(trim(terms_hash)) > 0),
  unique (source_entity_type, source_entity_id),
  unique (registration_entity_type, registration_entity_id)
);

create table public.admissions_conversion_documents (
  id uuid primary key default gen_random_uuid(),
  conversion_request_id uuid not null references public.admissions_conversion_requests(id) on delete cascade,
  managed_file_id uuid not null references public.managed_files(id) on delete restrict,
  document_kind text not null,
  verified_at timestamptz not null,
  verified_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    document_kind in (
      'application_document',
      'identity_document',
      'qualification_document',
      'student_photo',
      'generated_letter',
      'deferral_evidence',
      'other'
    )
  ),
  unique (conversion_request_id, managed_file_id)
);

alter table public.admissions_conversion_requests enable row level security;
alter table public.admissions_conversion_documents enable row level security;

create trigger touch_admissions_conversion_requests_updated_at
  before update on public.admissions_conversion_requests
  for each row
  execute function public.touch_person_updated_at();

create index admissions_conversion_requests_person_id_idx
  on public.admissions_conversion_requests(person_id);

create index admissions_conversion_requests_status_idx
  on public.admissions_conversion_requests(status);

create index admissions_conversion_requests_student_id_idx
  on public.admissions_conversion_requests(student_id);

create unique index admissions_conversion_requests_converted_student_id_idx
  on public.admissions_conversion_requests(student_id)
  where student_id is not null;

create index admissions_conversion_documents_request_id_idx
  on public.admissions_conversion_documents(conversion_request_id);

create index admissions_conversion_documents_managed_file_id_idx
  on public.admissions_conversion_documents(managed_file_id);

create policy "admins manage admissions conversion requests"
  on public.admissions_conversion_requests for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own admissions conversion requests"
  on public.admissions_conversion_requests for select
  using (person_id = public.current_person_id());

create policy "admins manage admissions conversion documents"
  on public.admissions_conversion_documents for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own admissions conversion documents"
  on public.admissions_conversion_documents for select
  using (
    exists (
      select 1
      from public.admissions_conversion_requests request
      where request.id = admissions_conversion_documents.conversion_request_id
        and request.person_id = public.current_person_id()
    )
  );

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

  if auth.role() is distinct from 'service_role'
    and not public.is_admin()
    and public.current_person_id() is distinct from v_request.person_id then
    raise exception 'Not authorized to convert this registration'
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
    when public.is_admin() then 'staff'::public.audit_actor_type
    when public.current_portal_actor_type() = 'student' then 'student'::public.audit_actor_type
    else 'applicant'::public.audit_actor_type
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

  insert into public.enrolments (student_id, offering_id, status)
  select v_student_id, requested.offering_id, 'planned'
  from unnest(v_initial_offering_ids) as requested(offering_id)
  on conflict (student_id, offering_id) do nothing;

  insert into public.finance_records (student_id, term_id, expected_amount_pence)
  select
    v_student_id,
    offering.term_id,
    sum(offering.price_pence)::integer
  from public.module_offerings offering
  where offering.id = any(v_initial_offering_ids)
  group by offering.term_id
  on conflict (student_id, term_id) do update
  set
    expected_amount_pence = excluded.expected_amount_pence,
    updated_at = now();

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
    case when v_actor_type in ('applicant', 'student') then v_request.person_id else null end,
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
      'initial_module_offering_ids', to_jsonb(v_initial_offering_ids)
    )
  );

  conversion_request_id := v_request.id;
  student_id := v_student_id;
  return next;
end;
$$;

revoke all on function public.convert_admissions_registration(uuid) from public;
grant execute on function public.convert_admissions_registration(uuid) to authenticated, service_role;
