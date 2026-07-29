alter type public.admission_lead_stage add value if not exists 'registration_in_progress';

create type public.admissions_registration_status as enum (
  'not_started',
  'in_progress',
  'submitted'
);

create type public.admissions_registration_document_slot_key as enum (
  'identity_evidence',
  'qualification_evidence',
  'student_id_photo'
);

create table public.admissions_registration_terms_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  terms_hash text not null,
  body_text text not null,
  active boolean not null default false,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (length(trim(version)) > 0),
  check (terms_hash ~ '^[a-f0-9]{64}$'),
  check (length(trim(body_text)) > 0)
);

create unique index admissions_registration_terms_versions_one_active_idx
  on public.admissions_registration_terms_versions(active)
  where active;

insert into public.admissions_registration_terms_versions (
  version,
  terms_hash,
  body_text,
  active
)
values (
  'registration-terms-2026-07-28-v1',
  '7e9501cb8522d183eddc5cc3d730a09ecad5ce4366f2312b728f9a31c2f4dd7c',
  'I agree to the BETAR registration terms and conditions for my accepted course place, including the course participation, attendance, assessment, fee liability, and data processing terms presented in this portal.',
  true
)
on conflict (version) do update
set
  terms_hash = excluded.terms_hash,
  body_text = excluded.body_text,
  active = excluded.active;

create table public.admissions_registrations (
  id uuid primary key default gen_random_uuid(),
  application_offer_id uuid not null references public.application_offers(id) on delete restrict,
  application_id uuid not null references public.applications(id) on delete restrict,
  admission_lead_id uuid not null references public.admission_leads(id) on delete restrict,
  person_id uuid not null references public.persons(id) on delete restrict,
  status public.admissions_registration_status not null default 'not_started',
  programme text not null check (programme in ('pgcert', 'microcredential')),
  intended_start_term_id uuid not null references public.terms(id) on delete restrict,
  title text,
  first_name text not null,
  middle_names text,
  last_name text not null,
  preferred_name text,
  previous_surname text,
  date_of_birth date,
  email text not null,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  postcode text,
  country text,
  module_confirmation_accepted boolean not null default false,
  module_confirmed_at timestamptz,
  module_confirmed_by_auth_user_id uuid references auth.users(id) on delete set null,
  terms_version text,
  terms_hash text,
  terms_accepted_at timestamptz,
  terms_accepted_by_auth_user_id uuid references auth.users(id) on delete set null,
  terms_accepted_by_person_id uuid references public.persons(id) on delete set null,
  terms_acceptance_ip inet,
  terms_acceptance_user_agent text,
  started_at timestamptz,
  saved_at timestamptz,
  submitted_at timestamptz,
  submitted_by_auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_offer_id),
  unique (application_id),
  check (length(trim(first_name)) > 0),
  check (length(trim(last_name)) > 0),
  check (length(trim(email)) > 3),
  check (
    (module_confirmation_accepted = false and module_confirmed_at is null)
    or (module_confirmation_accepted = true and module_confirmed_at is not null and module_confirmed_by_auth_user_id is not null)
  ),
  check (
    (status = 'submitted'
      and submitted_at is not null
      and submitted_by_auth_user_id is not null
      and terms_version is not null
      and terms_hash is not null
      and terms_accepted_at is not null
      and terms_accepted_by_auth_user_id is not null
      and terms_accepted_by_person_id is not null
      and module_confirmation_accepted = true)
    or status <> 'submitted'
  )
);

create table public.admissions_registration_module_offerings (
  registration_id uuid not null references public.admissions_registrations(id) on delete cascade,
  application_offer_id uuid not null references public.application_offers(id) on delete restrict,
  offering_id uuid not null references public.module_offerings(id) on delete restrict,
  choice_order smallint not null check (choice_order in (1, 2)),
  term_id uuid not null references public.terms(id) on delete restrict,
  term_name text not null,
  term_starts_on date not null,
  module_code text not null,
  module_title text not null,
  module_credits integer not null check (module_credits > 0),
  module_mode public.module_mode not null,
  price_pence integer not null check (price_pence >= 0),
  capacity integer not null check (capacity >= 0),
  confirmed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(term_name)) > 0),
  check (length(trim(module_code)) > 0),
  check (length(trim(module_title)) > 0),
  primary key (registration_id, offering_id),
  unique (registration_id, choice_order)
);

create table public.admissions_registration_person_detail_versions (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.admissions_registrations(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  previous_detail_snapshot jsonb,
  detail_snapshot jsonb not null,
  changed_by_auth_user_id uuid references auth.users(id) on delete set null,
  changed_by_person_id uuid references public.persons(id) on delete set null,
  source text not null default 'applicant_registration_save',
  created_at timestamptz not null default now(),
  unique (registration_id, version_number),
  check (jsonb_typeof(detail_snapshot) = 'object'),
  check (previous_detail_snapshot is null or jsonb_typeof(previous_detail_snapshot) = 'object')
);

create table public.admissions_registration_document_slots (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.admissions_registrations(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete restrict,
  slot_key public.admissions_registration_document_slot_key not null,
  label text not null,
  required boolean not null default false,
  managed_file_id uuid references public.managed_files(id) on delete set null,
  original_filename text,
  sanitized_filename text,
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_at timestamptz,
  uploaded_by_user_id uuid references auth.users(id) on delete set null,
  uploaded_by_person_id uuid references public.persons(id) on delete set null,
  verification_status public.application_document_verification_status not null default 'unverified',
  verifier_user_id uuid references public.staff_profiles(id) on delete set null,
  verification_at timestamptz,
  verification_note text,
  retention_class text not null
    check (retention_class in ('identity_document', 'qualification_document', 'student_photo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registration_id, slot_key)
);

alter table public.admissions_registration_terms_versions enable row level security;
alter table public.admissions_registrations enable row level security;
alter table public.admissions_registration_module_offerings enable row level security;
alter table public.admissions_registration_person_detail_versions enable row level security;
alter table public.admissions_registration_document_slots enable row level security;

create trigger touch_admissions_registrations_updated_at
  before update on public.admissions_registrations
  for each row
  execute function public.touch_person_updated_at();

create trigger touch_admissions_registration_module_offerings_updated_at
  before update on public.admissions_registration_module_offerings
  for each row
  execute function public.touch_person_updated_at();

create trigger touch_admissions_registration_document_slots_updated_at
  before update on public.admissions_registration_document_slots
  for each row
  execute function public.touch_person_updated_at();

create index admissions_registrations_person_status_idx
  on public.admissions_registrations(person_id, status, updated_at desc);

create index admissions_registrations_application_idx
  on public.admissions_registrations(application_id);

create index admissions_registrations_lead_idx
  on public.admissions_registrations(admission_lead_id);

create index admissions_registration_module_offerings_offer_idx
  on public.admissions_registration_module_offerings(application_offer_id);

create index admissions_registration_person_versions_person_idx
  on public.admissions_registration_person_detail_versions(person_id, created_at desc);

create index admissions_registration_document_slots_person_idx
  on public.admissions_registration_document_slots(person_id);

create index admissions_registration_document_slots_managed_file_idx
  on public.admissions_registration_document_slots(managed_file_id);

create policy "admins manage admissions registration terms"
  on public.admissions_registration_terms_versions for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read active admissions registration terms"
  on public.admissions_registration_terms_versions for select
  using (active = true and public.current_person_id() is not null);

create policy "admins manage admissions registrations"
  on public.admissions_registrations for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own admissions registrations"
  on public.admissions_registrations for select
  using (person_id = public.current_person_id());

create policy "admins manage admissions registration module offerings"
  on public.admissions_registration_module_offerings for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own admissions registration module offerings"
  on public.admissions_registration_module_offerings for select
  using (
    exists (
      select 1
      from public.admissions_registrations registration
      where registration.id = admissions_registration_module_offerings.registration_id
        and registration.person_id = public.current_person_id()
    )
  );

create policy "admins manage admissions registration person versions"
  on public.admissions_registration_person_detail_versions for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own admissions registration person versions"
  on public.admissions_registration_person_detail_versions for select
  using (person_id = public.current_person_id());

create policy "admins manage admissions registration document slots"
  on public.admissions_registration_document_slots for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own admissions registration document slots"
  on public.admissions_registration_document_slots for select
  using (person_id = public.current_person_id());

create policy "portal users read own registration offered module offerings"
  on public.module_offerings for select
  using (
    exists (
      select 1
      from public.admissions_registration_module_offerings registration_choice
      join public.admissions_registrations registration on registration.id = registration_choice.registration_id
      where registration_choice.offering_id = module_offerings.id
        and registration.person_id = public.current_person_id()
    )
  );

create policy "portal users read own registration offered course modules"
  on public.course_modules for select
  using (
    exists (
      select 1
      from public.module_offerings offering
      join public.admissions_registration_module_offerings registration_choice on registration_choice.offering_id = offering.id
      join public.admissions_registrations registration on registration.id = registration_choice.registration_id
      where offering.module_id = course_modules.id
        and registration.person_id = public.current_person_id()
    )
  );

create or replace function public.admissions_registration_person_snapshot(p_registration public.admissions_registrations)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'title', p_registration.title,
    'first_name', p_registration.first_name,
    'middle_names', p_registration.middle_names,
    'last_name', p_registration.last_name,
    'preferred_name', p_registration.preferred_name,
    'previous_surname', p_registration.previous_surname,
    'date_of_birth', p_registration.date_of_birth,
    'email', p_registration.email,
    'phone', p_registration.phone,
    'address_line_1', p_registration.address_line_1,
    'address_line_2', p_registration.address_line_2,
    'city', p_registration.city,
    'postcode', p_registration.postcode,
    'country', p_registration.country
  );
$$;

create or replace function public.begin_admissions_registration(p_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_person_id uuid := public.current_person_id();
  v_actor_type public.portal_actor_type := public.current_portal_actor_type();
  v_offer public.application_offers%rowtype;
  v_application public.applications%rowtype;
  v_lead public.admission_leads%rowtype;
  v_person public.persons%rowtype;
  v_registration public.admissions_registrations%rowtype;
  v_registration_id uuid;
  v_initial_snapshot jsonb;
begin
  if v_auth_user_id is null or v_person_id is null or v_actor_type <> 'applicant' then
    raise exception 'An authenticated applicant session is required';
  end if;

  select *
  into v_offer
  from public.application_offers
  where id = p_offer_id
  for update;

  if not found or v_offer.person_id <> v_person_id then
    raise exception 'Accepted offer was not found for this applicant';
  end if;

  if v_offer.status <> 'accepted' then
    raise exception 'Registration is available only for accepted offers';
  end if;

  select *
  into v_application
  from public.applications
  where id = v_offer.application_id
    and person_id = v_person_id
  for update;

  if not found or v_application.status <> 'submitted' then
    raise exception 'Accepted offer application is not eligible for registration';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = v_application.admission_lead_id
    and person_id = v_person_id
  for update;

  if not found then
    raise exception 'Accepted offer lead was not found for this applicant';
  end if;

  if v_lead.archived or v_lead.converted_student_id is not null or v_lead.stage not in ('accepted', 'registration_in_progress') then
    raise exception 'Accepted offer is not in an admissions stage that can start registration';
  end if;

  select *
  into v_person
  from public.persons
  where id = v_person_id;

  if not found then
    raise exception 'Applicant person was not found';
  end if;

  select *
  into v_registration
  from public.admissions_registrations
  where application_offer_id = v_offer.id
    and person_id = v_person_id
  for update;

  if found then
    return v_registration.id;
  end if;

  insert into public.admissions_registrations (
    application_offer_id,
    application_id,
    admission_lead_id,
    person_id,
    status,
    programme,
    intended_start_term_id,
    title,
    first_name,
    middle_names,
    last_name,
    preferred_name,
    previous_surname,
    date_of_birth,
    email,
    phone,
    address_line_1,
    address_line_2,
    city,
    postcode,
    country,
    started_at,
    saved_at
  )
  values (
    v_offer.id,
    v_application.id,
    v_lead.id,
    v_person_id,
    'in_progress',
    v_offer.programme,
    v_offer.intended_start_term_id,
    v_application.title,
    coalesce(v_application.first_name, v_person.first_name, v_lead.first_name),
    v_application.middle_names,
    coalesce(v_application.last_name, v_person.last_name, v_lead.last_name),
    coalesce(v_application.preferred_name, v_person.preferred_name),
    v_application.previous_surname,
    coalesce(v_application.date_of_birth, v_person.date_of_birth),
    lower(coalesce(v_application.email, v_person.email, v_lead.email)),
    coalesce(v_application.phone, v_person.phone, v_lead.phone),
    coalesce(v_application.address_line_1, v_person.address_line_1),
    coalesce(v_application.address_line_2, v_person.address_line_2),
    coalesce(v_application.city, v_person.city),
    coalesce(v_application.postcode, v_person.postcode),
    coalesce(v_application.country, v_person.country),
    now(),
    now()
  )
  returning * into v_registration;

  insert into public.admissions_registration_module_offerings (
    registration_id,
    application_offer_id,
    offering_id,
    choice_order,
    term_id,
    term_name,
    term_starts_on,
    module_code,
    module_title,
    module_credits,
    module_mode,
    price_pence,
    capacity,
    confirmed
  )
  select
    v_registration.id,
    v_offer.id,
    offer_choice.offering_id,
    offer_choice.choice_order,
    offering.term_id,
    term.name,
    term.starts_on,
    course_module.code,
    course_module.title,
    course_module.credits,
    course_module.mode,
    offering.price_pence,
    offering.capacity,
    true
  from public.application_offer_module_offerings offer_choice
  join public.module_offerings offering on offering.id = offer_choice.offering_id
  join public.course_modules course_module on course_module.id = offering.module_id
  join public.terms term on term.id = offering.term_id
  where offer_choice.offer_id = v_offer.id
  order by offer_choice.choice_order;

  insert into public.admissions_registration_document_slots (
    registration_id,
    person_id,
    slot_key,
    label,
    required,
    retention_class
  )
  values
    (v_registration.id, v_person_id, 'identity_evidence', 'Identity evidence', true, 'identity_document'),
    (v_registration.id, v_person_id, 'qualification_evidence', 'Qualification certificate or transcript', true, 'qualification_document'),
    (v_registration.id, v_person_id, 'student_id_photo', 'Student ID photo', false, 'student_photo');

  v_initial_snapshot := public.admissions_registration_person_snapshot(v_registration);

  insert into public.admissions_registration_person_detail_versions (
    registration_id,
    person_id,
    version_number,
    previous_detail_snapshot,
    detail_snapshot,
    changed_by_auth_user_id,
    changed_by_person_id,
    source
  )
  values (
    v_registration.id,
    v_person_id,
    1,
    null,
    v_initial_snapshot,
    v_auth_user_id,
    v_person_id,
    'accepted_offer_prefill'
  );

  update public.admission_leads
  set
    stage = 'registration_in_progress',
    next_action_on = null
  where id = v_lead.id;

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
    v_person_id,
    'registration.started',
    'admissions_registration',
    v_registration.id,
    jsonb_build_object(
      'registration_id', v_registration.id,
      'offer_id', v_offer.id,
      'application_id', v_application.id,
      'admission_lead_id', v_lead.id,
      'person_id', v_person_id,
      'programme', v_offer.programme,
      'intended_start_term_id', v_offer.intended_start_term_id
    )
  );

  v_registration_id := v_registration.id;
  return v_registration_id;
end;
$$;

create or replace function public.save_admissions_registration(
  p_registration_id uuid,
  p_title text default null,
  p_first_name text default null,
  p_middle_names text default null,
  p_last_name text default null,
  p_preferred_name text default null,
  p_previous_surname text default null,
  p_date_of_birth date default null,
  p_email text default null,
  p_phone text default null,
  p_address_line_1 text default null,
  p_address_line_2 text default null,
  p_city text default null,
  p_postcode text default null,
  p_country text default null,
  p_module_confirmation_accepted boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_person_id uuid := public.current_person_id();
  v_actor_type public.portal_actor_type := public.current_portal_actor_type();
  v_registration public.admissions_registrations%rowtype;
  v_saved_registration public.admissions_registrations%rowtype;
  v_offer public.application_offers%rowtype;
  v_lead public.admission_leads%rowtype;
  v_previous_snapshot jsonb;
  v_new_snapshot jsonb;
  v_next_version integer;
  v_title text := nullif(left(trim(coalesce(p_title, '')), 40), '');
  v_first_name text := nullif(left(trim(coalesce(p_first_name, '')), 120), '');
  v_middle_names text := nullif(left(trim(coalesce(p_middle_names, '')), 160), '');
  v_last_name text := nullif(left(trim(coalesce(p_last_name, '')), 120), '');
  v_preferred_name text := nullif(left(trim(coalesce(p_preferred_name, '')), 120), '');
  v_previous_surname text := nullif(left(trim(coalesce(p_previous_surname, '')), 120), '');
  v_email text := nullif(left(lower(trim(coalesce(p_email, ''))), 254), '');
  v_phone text := nullif(left(trim(coalesce(p_phone, '')), 80), '');
  v_address_line_1 text := nullif(left(trim(coalesce(p_address_line_1, '')), 180), '');
  v_address_line_2 text := nullif(left(trim(coalesce(p_address_line_2, '')), 180), '');
  v_city text := nullif(left(trim(coalesce(p_city, '')), 120), '');
  v_postcode text := nullif(left(trim(coalesce(p_postcode, '')), 40), '');
  v_country text := nullif(left(trim(coalesce(p_country, '')), 120), '');
begin
  if v_auth_user_id is null or v_person_id is null or v_actor_type <> 'applicant' then
    raise exception 'An authenticated applicant session is required';
  end if;

  if v_first_name is null or v_last_name is null or v_email is null then
    raise exception 'First name, last name, and email are required for registration draft save';
  end if;

  select *
  into v_registration
  from public.admissions_registrations
  where id = p_registration_id
    and person_id = v_person_id
  for update;

  if not found then
    raise exception 'Registration was not found for this applicant';
  end if;

  if v_registration.status <> 'in_progress' then
    raise exception 'Only in-progress registrations can be saved';
  end if;

  select *
  into v_offer
  from public.application_offers
  where id = v_registration.application_offer_id
  for update;

  if not found or v_offer.status <> 'accepted' or v_offer.person_id <> v_person_id then
    raise exception 'Registration is no longer linked to an accepted offer';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = v_registration.admission_lead_id
  for update;

  if not found or v_lead.archived or v_lead.converted_student_id is not null or v_lead.stage not in ('accepted', 'registration_in_progress') then
    raise exception 'Registration lead is not editable';
  end if;

  v_previous_snapshot := public.admissions_registration_person_snapshot(v_registration);

  update public.admissions_registrations
  set
    title = v_title,
    first_name = v_first_name,
    middle_names = v_middle_names,
    last_name = v_last_name,
    preferred_name = v_preferred_name,
    previous_surname = v_previous_surname,
    date_of_birth = p_date_of_birth,
    email = v_email,
    phone = v_phone,
    address_line_1 = v_address_line_1,
    address_line_2 = v_address_line_2,
    city = v_city,
    postcode = v_postcode,
    country = v_country,
    module_confirmation_accepted = coalesce(p_module_confirmation_accepted, false),
    module_confirmed_at = case
      when coalesce(p_module_confirmation_accepted, false) = true and module_confirmed_at is null then now()
      when coalesce(p_module_confirmation_accepted, false) = false then null
      else module_confirmed_at
    end,
    module_confirmed_by_auth_user_id = case
      when coalesce(p_module_confirmation_accepted, false) = true then v_auth_user_id
      else null
    end,
    saved_at = now()
  where id = v_registration.id
  returning * into v_saved_registration;

  v_new_snapshot := public.admissions_registration_person_snapshot(v_saved_registration);

  if v_new_snapshot <> v_previous_snapshot then
    select coalesce(max(version_number), 0) + 1
    into v_next_version
    from public.admissions_registration_person_detail_versions
    where registration_id = v_registration.id;

    insert into public.admissions_registration_person_detail_versions (
      registration_id,
      person_id,
      version_number,
      previous_detail_snapshot,
      detail_snapshot,
      changed_by_auth_user_id,
      changed_by_person_id,
      source
    )
    values (
      v_registration.id,
      v_person_id,
      v_next_version,
      v_previous_snapshot,
      v_new_snapshot,
      v_auth_user_id,
      v_person_id,
      'applicant_registration_save'
    );
  end if;

  update public.admission_leads
  set
    stage = 'registration_in_progress',
    next_action_on = null
  where id = v_lead.id;

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
    v_person_id,
    'registration.saved',
    'admissions_registration',
    v_registration.id,
    jsonb_build_object(
      'registration_id', v_registration.id,
      'offer_id', v_registration.application_offer_id,
      'application_id', v_registration.application_id,
      'admission_lead_id', v_registration.admission_lead_id,
      'person_id', v_person_id,
      'status', v_saved_registration.status,
      'personal_details_changed', v_new_snapshot <> v_previous_snapshot,
      'module_confirmation_accepted', v_saved_registration.module_confirmation_accepted
    )
  );

  return v_registration.id;
end;
$$;

create or replace function public.record_admissions_registration_document_upload(
  p_registration_id uuid,
  p_slot_key public.admissions_registration_document_slot_key,
  p_bucket text,
  p_object_path text,
  p_original_filename text,
  p_sanitized_filename text,
  p_content_type text,
  p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_person_id uuid := public.current_person_id();
  v_actor_type public.portal_actor_type := public.current_portal_actor_type();
  v_registration public.admissions_registrations%rowtype;
  v_label text;
  v_required boolean;
  v_bucket text;
  v_retention_class text;
  v_file_category text;
  v_max_bytes bigint;
  v_allowed_content_types text[];
  v_allowed_extensions text[];
  v_extension text;
  v_managed_file_id uuid;
  v_slot_id uuid;
  v_previous_managed_file_id uuid;
  v_original_filename text := nullif(left(trim(coalesce(p_original_filename, '')), 255), '');
  v_sanitized_filename text := nullif(left(trim(coalesce(p_sanitized_filename, '')), 140), '');
  v_content_type text := lower(nullif(trim(coalesce(p_content_type, '')), ''));
begin
  if v_auth_user_id is null or v_person_id is null or v_actor_type <> 'applicant' then
    raise exception 'An authenticated applicant session is required';
  end if;

  case p_slot_key
    when 'identity_evidence' then
      v_label := 'Identity evidence';
      v_required := true;
      v_bucket := 'id-documents';
      v_retention_class := 'identity_document';
      v_file_category := 'identity';
      v_max_bytes := 10485760;
      v_allowed_content_types := array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
      v_allowed_extensions := array['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
    when 'qualification_evidence' then
      v_label := 'Qualification certificate or transcript';
      v_required := true;
      v_bucket := 'qualification-documents';
      v_retention_class := 'qualification_document';
      v_file_category := 'certificate';
      v_max_bytes := 26214400;
      v_allowed_content_types := array[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png',
        'image/jpeg',
        'image/webp'
      ];
      v_allowed_extensions := array['.pdf', '.docx', '.png', '.jpg', '.jpeg', '.webp'];
    when 'student_id_photo' then
      v_label := 'Student ID photo';
      v_required := false;
      v_bucket := 'student-photos';
      v_retention_class := 'student_photo';
      v_file_category := 'other';
      v_max_bytes := 10485760;
      v_allowed_content_types := array['image/png', 'image/jpeg', 'image/webp'];
      v_allowed_extensions := array['.png', '.jpg', '.jpeg', '.webp'];
  end case;

  if p_bucket <> v_bucket then
    raise exception 'Document bucket does not match the selected registration upload slot';
  end if;

  if v_original_filename is null or v_sanitized_filename is null then
    raise exception 'Document filename is required';
  end if;

  if v_sanitized_filename !~ '^[a-z0-9][a-z0-9._-]{0,139}$' then
    raise exception 'Document filename is not valid';
  end if;

  v_extension := lower(substring(v_sanitized_filename from '\.[^.]+$'));

  if v_extension is null or not (v_extension = any(v_allowed_extensions)) then
    raise exception 'Document extension is not accepted for this registration upload slot';
  end if;

  if v_content_type is null or not (v_content_type = any(v_allowed_content_types)) then
    raise exception 'Document content type is not accepted for this registration upload slot';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > v_max_bytes then
    raise exception 'Document size is not accepted for this registration upload slot';
  end if;

  select *
  into v_registration
  from public.admissions_registrations
  where id = p_registration_id
    and person_id = v_person_id
  for update;

  if not found then
    raise exception 'Registration was not found for this applicant';
  end if;

  if v_registration.status <> 'in_progress' then
    raise exception 'Documents can only be uploaded before registration submission';
  end if;

  if p_object_path is null or position(v_person_id::text || '/' || v_registration.id::text || '/' || p_slot_key::text || '/' in p_object_path) <> 1 then
    raise exception 'Document object path is not valid for this applicant registration';
  end if;

  if not exists (
    select 1
    from storage.objects storage_object
    where storage_object.bucket_id = v_bucket
      and storage_object.name = p_object_path
      and coalesce(storage_object.metadata->>'mimetype', '') = v_content_type
      and coalesce((storage_object.metadata->>'size')::bigint, -1) = p_size_bytes
  ) then
    raise exception 'Uploaded document object was not found in private storage';
  end if;

  insert into public.managed_files (
    person_id,
    uploaded_by_person_id,
    bucket,
    object_path,
    label,
    file_category,
    original_filename,
    sanitized_filename,
    content_type,
    size_bytes,
    retention_class
  )
  values (
    v_person_id,
    v_person_id,
    v_bucket,
    p_object_path,
    v_label,
    v_file_category,
    v_original_filename,
    v_sanitized_filename,
    v_content_type,
    p_size_bytes,
    v_retention_class
  )
  returning id into v_managed_file_id;

  select managed_file_id
  into v_previous_managed_file_id
  from public.admissions_registration_document_slots
  where registration_id = v_registration.id
    and slot_key = p_slot_key
  for update;

  insert into public.admissions_registration_document_slots (
    registration_id,
    person_id,
    slot_key,
    label,
    required,
    managed_file_id,
    original_filename,
    sanitized_filename,
    content_type,
    size_bytes,
    uploaded_at,
    uploaded_by_user_id,
    uploaded_by_person_id,
    verification_status,
    verifier_user_id,
    verification_at,
    verification_note,
    retention_class
  )
  values (
    v_registration.id,
    v_person_id,
    p_slot_key,
    v_label,
    v_required,
    v_managed_file_id,
    v_original_filename,
    v_sanitized_filename,
    v_content_type,
    p_size_bytes,
    now(),
    v_auth_user_id,
    v_person_id,
    'unverified',
    null,
    null,
    null,
    v_retention_class
  )
  on conflict (registration_id, slot_key)
  do update set
    label = excluded.label,
    required = excluded.required,
    managed_file_id = excluded.managed_file_id,
    original_filename = excluded.original_filename,
    sanitized_filename = excluded.sanitized_filename,
    content_type = excluded.content_type,
    size_bytes = excluded.size_bytes,
    uploaded_at = excluded.uploaded_at,
    uploaded_by_user_id = excluded.uploaded_by_user_id,
    uploaded_by_person_id = excluded.uploaded_by_person_id,
    verification_status = 'unverified',
    verifier_user_id = null,
    verification_at = null,
    verification_note = null,
    retention_class = excluded.retention_class
  returning id into v_slot_id;

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
    v_person_id,
    'document.uploaded',
    'admissions_registration_document',
    v_slot_id,
    jsonb_build_object(
      'registration_id', v_registration.id,
      'offer_id', v_registration.application_offer_id,
      'application_id', v_registration.application_id,
      'admission_lead_id', v_registration.admission_lead_id,
      'slot_key', p_slot_key,
      'required', v_required,
      'bucket', v_bucket,
      'retention_class', v_retention_class,
      'content_type', v_content_type,
      'size_bytes', p_size_bytes,
      'managed_file_id', v_managed_file_id,
      'replaced_managed_file_id', v_previous_managed_file_id
    )
  );

  return v_slot_id;
end;
$$;

create or replace function public.submit_admissions_registration(
  p_registration_id uuid,
  p_terms_accepted boolean,
  p_terms_version text,
  p_terms_hash text,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_person_id uuid := public.current_person_id();
  v_actor_type public.portal_actor_type := public.current_portal_actor_type();
  v_registration public.admissions_registrations%rowtype;
  v_offer public.application_offers%rowtype;
  v_lead public.admission_leads%rowtype;
  v_terms public.admissions_registration_terms_versions%rowtype;
  v_missing_fields text[] := '{}'::text[];
  v_selected_offering_count integer;
  v_missing_document_slots text[] := '{}'::text[];
  v_user_agent text := nullif(left(trim(coalesce(p_user_agent, '')), 500), '');
begin
  if v_auth_user_id is null or v_person_id is null or v_actor_type <> 'applicant' then
    raise exception 'An authenticated applicant session is required';
  end if;

  if coalesce(p_terms_accepted, false) <> true then
    raise exception 'Registration terms acceptance is required before submission';
  end if;

  select *
  into v_registration
  from public.admissions_registrations
  where id = p_registration_id
    and person_id = v_person_id
  for update;

  if not found then
    raise exception 'Registration was not found for this applicant';
  end if;

  if v_registration.status <> 'in_progress' then
    raise exception 'Only in-progress registrations can be submitted';
  end if;

  select *
  into v_offer
  from public.application_offers
  where id = v_registration.application_offer_id
  for update;

  if not found or v_offer.status <> 'accepted' or v_offer.person_id <> v_person_id then
    raise exception 'Registration is no longer linked to an accepted offer';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = v_registration.admission_lead_id
  for update;

  if not found or v_lead.archived or v_lead.converted_student_id is not null or v_lead.stage not in ('accepted', 'registration_in_progress') then
    raise exception 'Registration lead is not submittable';
  end if;

  select *
  into v_terms
  from public.admissions_registration_terms_versions
  where version = p_terms_version
    and terms_hash = p_terms_hash
    and active = true;

  if not found then
    raise exception 'Registration terms version is not current';
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
    where document_slot.registration_id = v_registration.id
      and document_slot.person_id = v_person_id
      and document_slot.slot_key = required_slot.slot_key
      and document_slot.managed_file_id is not null
      and document_slot.verification_status <> 'rejected'
      and exists (
        select 1
        from public.managed_files managed_file
        join storage.objects storage_object
          on storage_object.bucket_id = managed_file.bucket
          and storage_object.name = managed_file.object_path
        where managed_file.id = document_slot.managed_file_id
          and managed_file.person_id = v_person_id
          and managed_file.bucket in ('id-documents', 'qualification-documents')
      )
  );

  if cardinality(v_missing_document_slots) > 0 then
    v_missing_fields := v_missing_fields || v_missing_document_slots;
  end if;

  if cardinality(v_missing_fields) > 0 then
    raise exception 'Registration cannot be submitted until required fields are complete: %', array_to_string(v_missing_fields, ', ');
  end if;

  update public.admissions_registrations
  set
    status = 'submitted',
    terms_version = v_terms.version,
    terms_hash = v_terms.terms_hash,
    terms_accepted_at = now(),
    terms_accepted_by_auth_user_id = v_auth_user_id,
    terms_accepted_by_person_id = v_person_id,
    terms_acceptance_ip = p_ip_address,
    terms_acceptance_user_agent = v_user_agent,
    submitted_at = now(),
    submitted_by_auth_user_id = v_auth_user_id,
    saved_at = now()
  where id = v_registration.id;

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
    v_person_id,
    'registration.terms_accepted',
    'admissions_registration',
    v_registration.id,
    jsonb_build_object(
      'registration_id', v_registration.id,
      'offer_id', v_registration.application_offer_id,
      'application_id', v_registration.application_id,
      'admission_lead_id', v_registration.admission_lead_id,
      'person_id', v_person_id,
      'terms_version', v_terms.version,
      'terms_hash', v_terms.terms_hash
    )
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
    'applicant',
    v_auth_user_id,
    v_person_id,
    'registration.submitted',
    'admissions_registration',
    v_registration.id,
    jsonb_build_object(
      'registration_id', v_registration.id,
      'offer_id', v_registration.application_offer_id,
      'application_id', v_registration.application_id,
      'admission_lead_id', v_registration.admission_lead_id,
      'person_id', v_person_id,
      'programme', v_registration.programme,
      'intended_start_term_id', v_registration.intended_start_term_id,
      'confirmed_module_offering_count', v_selected_offering_count,
      'required_document_slot_count', 2,
      'terms_version', v_terms.version,
      'terms_hash', v_terms.terms_hash
    )
  );

  return v_registration.id;
end;
$$;

revoke all on function public.begin_admissions_registration(uuid) from public;
revoke all on function public.save_admissions_registration(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
) from public;
revoke all on function public.record_admissions_registration_document_upload(
  uuid,
  public.admissions_registration_document_slot_key,
  text,
  text,
  text,
  text,
  text,
  bigint
) from public;
revoke all on function public.submit_admissions_registration(uuid, boolean, text, text, inet, text) from public;

grant execute on function public.begin_admissions_registration(uuid) to authenticated;
grant execute on function public.save_admissions_registration(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
) to authenticated;
grant execute on function public.record_admissions_registration_document_upload(
  uuid,
  public.admissions_registration_document_slot_key,
  text,
  text,
  text,
  text,
  text,
  bigint
) to authenticated;
grant execute on function public.submit_admissions_registration(uuid, boolean, text, text, inet, text) to authenticated;
