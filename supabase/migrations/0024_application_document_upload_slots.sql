create type public.application_document_slot_key as enum (
  'qualification_evidence',
  'professional_registration_evidence',
  'cv_or_supporting_evidence',
  'funding_evidence'
);

create type public.application_document_verification_status as enum (
  'unverified',
  'verified',
  'rejected'
);

create table public.application_document_slots (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete restrict,
  slot_key public.application_document_slot_key not null,
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
  retention_class text not null default 'application_document'
    check (retention_class in ('application_document', 'qualification_document')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, slot_key)
);

alter table public.application_document_slots enable row level security;

create index application_document_slots_application_idx
  on public.application_document_slots(application_id);

create index application_document_slots_person_idx
  on public.application_document_slots(person_id);

create index application_document_slots_managed_file_idx
  on public.application_document_slots(managed_file_id);

create trigger touch_application_document_slots_updated_at
  before update on public.application_document_slots
  for each row
  execute function public.touch_person_updated_at();

create policy "admins manage application document slots"
  on public.application_document_slots for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own application document slots"
  on public.application_document_slots for select
  using (person_id = public.current_person_id());

create or replace function public.record_application_document_upload(
  p_application_id uuid,
  p_slot_key public.application_document_slot_key,
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
  v_application public.applications%rowtype;
  v_lead public.admission_leads%rowtype;
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
    when 'professional_registration_evidence' then
      v_label := 'Professional registration evidence';
      v_required := true;
      v_bucket := 'application-docs';
      v_retention_class := 'application_document';
      v_file_category := 'other';
      v_max_bytes := 10485760;
      v_allowed_content_types := array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
      v_allowed_extensions := array['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
    when 'cv_or_supporting_evidence' then
      v_label := 'CV or supporting evidence';
      v_required := false;
      v_bucket := 'application-docs';
      v_retention_class := 'application_document';
      v_file_category := 'cv';
      v_max_bytes := 26214400;
      v_allowed_content_types := array[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'image/png',
        'image/jpeg',
        'image/webp'
      ];
      v_allowed_extensions := array['.pdf', '.docx', '.txt', '.png', '.jpg', '.jpeg', '.webp'];
    when 'funding_evidence' then
      v_label := 'Funding or sponsor evidence';
      v_required := false;
      v_bucket := 'application-docs';
      v_retention_class := 'application_document';
      v_file_category := 'other';
      v_max_bytes := 26214400;
      v_allowed_content_types := array[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'image/png',
        'image/jpeg',
        'image/webp'
      ];
      v_allowed_extensions := array['.pdf', '.docx', '.txt', '.png', '.jpg', '.jpeg', '.webp'];
  end case;

  if p_bucket <> v_bucket then
    raise exception 'Document bucket does not match the selected upload slot';
  end if;

  if v_original_filename is null or v_sanitized_filename is null then
    raise exception 'Document filename is required';
  end if;

  if v_sanitized_filename !~ '^[a-z0-9][a-z0-9._-]{0,139}$' then
    raise exception 'Document filename is not valid';
  end if;

  v_extension := lower(substring(v_sanitized_filename from '\.[^.]+$'));

  if v_extension is null or not (v_extension = any(v_allowed_extensions)) then
    raise exception 'Document extension is not accepted for this upload slot';
  end if;

  if v_content_type is null or not (v_content_type = any(v_allowed_content_types)) then
    raise exception 'Document content type is not accepted for this upload slot';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > v_max_bytes then
    raise exception 'Document size is not accepted for this upload slot';
  end if;

  select *
  into v_application
  from public.applications
  where id = p_application_id
    and person_id = v_person_id
  for update;

  if not found then
    raise exception 'Application was not found for this applicant';
  end if;

  if v_application.status <> 'draft' then
    raise exception 'Documents can only be uploaded before application submission';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = v_application.admission_lead_id
    and person_id = v_person_id
  for update;

  if not found then
    raise exception 'Application lead was not found for this applicant';
  end if;

  if v_lead.archived or v_lead.converted_student_id is not null or v_lead.stage <> 'application_invited' then
    raise exception 'Documents can only be uploaded for active invited applications';
  end if;

  if p_object_path is null or position(v_person_id::text || '/' || v_application.id::text || '/' || p_slot_key::text || '/' in p_object_path) <> 1 then
    raise exception 'Document object path is not valid for this applicant application';
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
  from public.application_document_slots
  where application_id = v_application.id
    and slot_key = p_slot_key
  for update;

  insert into public.application_document_slots (
    application_id,
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
    v_application.id,
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
  on conflict (application_id, slot_key)
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
    'application_document',
    v_slot_id,
    jsonb_build_object(
      'application_id',
      v_application.id,
      'admission_lead_id',
      v_application.admission_lead_id,
      'slot_key',
      p_slot_key,
      'required',
      v_required,
      'bucket',
      v_bucket,
      'retention_class',
      v_retention_class,
      'content_type',
      v_content_type,
      'size_bytes',
      p_size_bytes,
      'managed_file_id',
      v_managed_file_id,
      'replaced_managed_file_id',
      v_previous_managed_file_id
    )
  );

  return v_slot_id;
end;
$$;

revoke all on function public.record_application_document_upload(
  uuid,
  public.application_document_slot_key,
  text,
  text,
  text,
  text,
  text,
  bigint
) from public;

grant execute on function public.record_application_document_upload(
  uuid,
  public.application_document_slot_key,
  text,
  text,
  text,
  text,
  text,
  bigint
) to authenticated;

create or replace function public.submit_application(
  p_application_id uuid,
  p_declaration_accepted boolean,
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
  v_application public.applications%rowtype;
  v_lead public.admission_leads%rowtype;
  v_admission_lead_id uuid;
  v_selected_offering_count integer;
  v_missing_fields text[] := '{}'::text[];
  v_missing_document_slots text[] := '{}'::text[];
  v_declaration_version text := 'application-declaration-2026-07-23-v1';
  v_declaration_text_hash text := '71b23b4f1e241df24f6c5d19a67fbe27d0419e58f663794f527e267a7d83986c';
  v_user_agent text := nullif(left(trim(coalesce(p_user_agent, '')), 500), '');
begin
  if v_auth_user_id is null or v_person_id is null or v_actor_type <> 'applicant' then
    raise exception 'An authenticated applicant session is required';
  end if;

  if coalesce(p_declaration_accepted, false) <> true then
    raise exception 'Declaration acceptance is required before submission';
  end if;

  select admission_lead_id
  into v_admission_lead_id
  from public.applications
  where id = p_application_id
    and person_id = v_person_id;

  if not found then
    raise exception 'Application was not found for this applicant';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = v_admission_lead_id
    and person_id = v_person_id
  for update;

  if not found then
    raise exception 'Application lead was not found for this applicant';
  end if;

  if v_lead.archived or v_lead.converted_student_id is not null then
    raise exception 'Archived or converted leads cannot be submitted by applicants';
  end if;

  if v_lead.stage <> 'application_invited' then
    raise exception 'Application can only be submitted from the invited stage';
  end if;

  select *
  into v_application
  from public.applications
  where id = p_application_id
    and admission_lead_id = v_lead.id
    and person_id = v_person_id
  for update;

  if not found then
    raise exception 'Application was not found for this applicant';
  end if;

  if v_application.status <> 'draft' then
    raise exception 'Only draft applications can be submitted';
  end if;

  if v_application.programme not in ('pgcert', 'microcredential') then
    v_missing_fields := array_append(v_missing_fields, 'programme');
  end if;
  if v_application.first_name is null then
    v_missing_fields := array_append(v_missing_fields, 'first_name');
  end if;
  if v_application.last_name is null then
    v_missing_fields := array_append(v_missing_fields, 'last_name');
  end if;
  if v_application.date_of_birth is null then
    v_missing_fields := array_append(v_missing_fields, 'date_of_birth');
  end if;
  if v_application.email is null or position('@' in v_application.email) = 0 then
    v_missing_fields := array_append(v_missing_fields, 'email');
  end if;
  if v_application.phone is null then
    v_missing_fields := array_append(v_missing_fields, 'phone');
  end if;
  if v_application.address_line_1 is null then
    v_missing_fields := array_append(v_missing_fields, 'address_line_1');
  end if;
  if v_application.city is null then
    v_missing_fields := array_append(v_missing_fields, 'city');
  end if;
  if v_application.postcode is null then
    v_missing_fields := array_append(v_missing_fields, 'postcode');
  end if;
  if v_application.country is null then
    v_missing_fields := array_append(v_missing_fields, 'country');
  end if;
  if v_application.clinical_role is null then
    v_missing_fields := array_append(v_missing_fields, 'clinical_role');
  end if;
  if v_application.employer is null then
    v_missing_fields := array_append(v_missing_fields, 'employer');
  end if;
  if v_application.department_specialty is null then
    v_missing_fields := array_append(v_missing_fields, 'department_specialty');
  end if;
  if v_application.professional_registration_body is null then
    v_missing_fields := array_append(v_missing_fields, 'professional_registration_body');
  end if;
  if v_application.professional_registration_number is null then
    v_missing_fields := array_append(v_missing_fields, 'professional_registration_number');
  end if;
  if v_application.work_experience is null then
    v_missing_fields := array_append(v_missing_fields, 'work_experience');
  end if;
  if v_application.highest_qualification is null then
    v_missing_fields := array_append(v_missing_fields, 'highest_qualification');
  end if;
  if v_application.qualification_awarding_body is null then
    v_missing_fields := array_append(v_missing_fields, 'qualification_awarding_body');
  end if;
  if v_application.qualification_year is null then
    v_missing_fields := array_append(v_missing_fields, 'qualification_year');
  end if;
  if v_application.intended_start_term_id is null then
    v_missing_fields := array_append(v_missing_fields, 'intended_start_term_id');
  end if;
  if v_application.nationality is null then
    v_missing_fields := array_append(v_missing_fields, 'nationality');
  end if;
  if v_application.country_of_residence is null then
    v_missing_fields := array_append(v_missing_fields, 'country_of_residence');
  end if;
  if v_application.pocus_previous_experience is null then
    v_missing_fields := array_append(v_missing_fields, 'pocus_previous_experience');
  end if;
  if v_application.pocus_motivation is null then
    v_missing_fields := array_append(v_missing_fields, 'pocus_motivation');
  end if;
  if v_application.pocus_case_improved_management is null then
    v_missing_fields := array_append(v_missing_fields, 'pocus_case_improved_management');
  end if;
  if v_application.pocus_limitations_case is null then
    v_missing_fields := array_append(v_missing_fields, 'pocus_limitations_case');
  end if;

  select count(*)
  into v_selected_offering_count
  from public.application_module_offering_choices
  where application_id = v_application.id;

  if v_selected_offering_count not between 1 and 2 then
    v_missing_fields := array_append(v_missing_fields, 'selected_module_offerings');
  end if;

  select coalesce(array_agg('document:' || required_slot.slot_key::text order by required_slot.slot_key::text), '{}'::text[])
  into v_missing_document_slots
  from (
    values
      ('qualification_evidence'::public.application_document_slot_key),
      ('professional_registration_evidence'::public.application_document_slot_key)
  ) as required_slot(slot_key)
  where not exists (
    select 1
    from public.application_document_slots document_slot
    where document_slot.application_id = v_application.id
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
          and managed_file.bucket in ('application-docs', 'qualification-documents')
      )
  );

  if cardinality(v_missing_document_slots) > 0 then
    v_missing_fields := v_missing_fields || v_missing_document_slots;
  end if;

  if cardinality(v_missing_fields) > 0 then
    raise exception 'Application cannot be submitted until required fields are complete: %', array_to_string(v_missing_fields, ', ');
  end if;

  if v_application.intended_start_term_id is not null and not exists (
    select 1
    from public.terms
    where terms.id = v_application.intended_start_term_id
      and terms.status in ('published', 'active')
      and terms.starts_on >= current_date
  ) then
    raise exception 'Intended start term must be a published or active future term';
  end if;

  if exists (
    select 1
    from public.application_module_offering_choices choice
    where choice.application_id = v_application.id
      and not exists (
        select 1
        from public.module_offerings offering
        join public.course_modules course_module on course_module.id = offering.module_id
        join public.terms term on term.id = offering.term_id
        where offering.id = choice.offering_id
          and offering.term_id = v_application.intended_start_term_id
          and course_module.active = true
          and term.status in ('published', 'active')
          and term.starts_on >= current_date
      )
  ) then
    raise exception 'Selected module offerings must be active offerings for the intended future start term';
  end if;

  update public.applications
  set
    status = 'submitted',
    submitted_at = now(),
    declaration_accepted_at = now(),
    declaration_version = v_declaration_version,
    declaration_text_hash = v_declaration_text_hash,
    declaration_actor_user_id = v_auth_user_id,
    declaration_person_id = v_person_id,
    declaration_ip_address = p_ip_address,
    declaration_user_agent = v_user_agent
  where id = v_application.id;

  update public.admission_leads
  set
    stage = 'submitted'
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
    'application.submitted',
    'application',
    v_application.id,
    jsonb_build_object(
      'admission_lead_id',
      v_lead.id,
      'programme',
      v_application.programme,
      'intended_start_term_id',
      v_application.intended_start_term_id,
      'selected_module_offering_count',
      v_selected_offering_count,
      'required_document_slot_count',
      2,
      'declaration_version',
      v_declaration_version,
      'declaration_text_hash',
      v_declaration_text_hash
    )
  );

  return v_application.id;
end;
$$;

revoke all on function public.submit_application(
  uuid,
  boolean,
  inet,
  text
) from public;

grant execute on function public.submit_application(
  uuid,
  boolean,
  inet,
  text
) to authenticated;
