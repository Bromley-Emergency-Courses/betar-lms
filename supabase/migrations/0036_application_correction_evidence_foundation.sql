do $$
begin
  create type public.application_correction_request_status as enum (
    'open',
    'resubmitted',
    'resolved',
    'cancelled'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.application_correction_item_target_type as enum (
    'application_field',
    'document_slot'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.application_correction_item_status as enum (
    'open',
    'resubmitted',
    'accepted'
  );
exception
  when duplicate_object then null;
end;
$$;

create table public.application_correction_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  admission_lead_id uuid not null references public.admission_leads(id) on delete restrict,
  person_id uuid not null references public.persons(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  revision_number integer not null default 0 check (revision_number >= 0),
  status public.application_correction_request_status not null default 'open',
  summary text,
  application_snapshot jsonb not null check (jsonb_typeof(application_snapshot) = 'object'),
  due_at timestamptz not null default (now() + interval '14 days'),
  requested_by_user_id uuid references public.staff_profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  last_resubmitted_at timestamptz,
  resolved_by_user_id uuid references public.staff_profiles(id) on delete set null,
  resolved_at timestamptz,
  cancelled_by_user_id uuid references public.staff_profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text,
  correspondence_log_id uuid references public.correspondence_logs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, version_number),
  check (
    (status = 'resolved' and resolved_at is not null)
    or (status <> 'resolved' and resolved_at is null)
  ),
  check (
    (status = 'cancelled' and cancelled_at is not null and length(trim(cancellation_reason)) > 0)
    or (status <> 'cancelled' and cancelled_at is null and cancellation_reason is null)
  )
);

create unique index application_correction_requests_one_active_idx
  on public.application_correction_requests(application_id)
  where status in ('open', 'resubmitted');

create index application_correction_requests_status_due_idx
  on public.application_correction_requests(status, due_at);

create table public.application_correction_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.application_correction_requests(id) on delete cascade,
  target_type public.application_correction_item_target_type not null,
  target_key text not null,
  instructions text not null check (length(trim(instructions)) > 0),
  status public.application_correction_item_status not null default 'open',
  baseline_value jsonb,
  proposed_value jsonb,
  replacement_managed_file_id uuid references public.managed_files(id) on delete set null,
  applicant_response_note text,
  applicant_saved_at timestamptz,
  staff_review_note text,
  reviewed_by_user_id uuid references public.staff_profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, target_type, target_key),
  check (
    (target_type = 'application_field' and replacement_managed_file_id is null)
    or target_type = 'document_slot'
  )
);

create index application_correction_items_request_status_idx
  on public.application_correction_items(request_id, status);

create table public.application_correction_item_versions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.application_correction_requests(id) on delete cascade,
  item_id uuid not null references public.application_correction_items(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  instructions text not null,
  proposed_value jsonb,
  replacement_managed_file_id uuid references public.managed_files(id) on delete set null,
  applicant_response_note text,
  staff_outcome text check (staff_outcome is null or staff_outcome in ('accepted', 'revise')),
  staff_review_note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (item_id, revision_number)
);

create table public.application_correction_item_drafts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.application_correction_requests(id) on delete cascade,
  item_id uuid not null references public.application_correction_items(id) on delete cascade,
  save_number integer not null check (save_number > 0),
  proposed_value jsonb,
  replacement_managed_file_id uuid references public.managed_files(id) on delete set null,
  applicant_response_note text,
  saved_at timestamptz not null default now(),
  unique (item_id, save_number)
);

create table public.application_document_slot_versions (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.application_document_slots(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  managed_file_id uuid references public.managed_files(id) on delete set null,
  verification_status public.application_document_verification_status not null,
  verifier_user_id uuid references public.staff_profiles(id) on delete set null,
  verification_at timestamptz,
  verification_note text,
  replaced_at timestamptz not null default now()
);

create index application_document_slot_versions_slot_idx
  on public.application_document_slot_versions(slot_id, replaced_at desc);

create table public.application_evidence_overrides (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  slot_id uuid not null references public.application_document_slots(id) on delete restrict,
  decision_id uuid references public.application_decisions(id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0),
  recorded_by_user_id uuid references public.staff_profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.staff_profiles(id) on delete set null,
  revocation_reason text,
  check (
    (revoked_at is null and revocation_reason is null)
    or (revoked_at is not null and length(trim(revocation_reason)) > 0)
  )
);

create unique index application_evidence_overrides_pending_slot_idx
  on public.application_evidence_overrides(application_id, slot_id)
  where decision_id is null and revoked_at is null;

alter table public.application_correction_requests enable row level security;
alter table public.application_correction_items enable row level security;
alter table public.application_correction_item_versions enable row level security;
alter table public.application_correction_item_drafts enable row level security;
alter table public.application_document_slot_versions enable row level security;
alter table public.application_evidence_overrides enable row level security;

create policy "admins manage application correction requests"
  on public.application_correction_requests for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "applicants read own application correction requests"
  on public.application_correction_requests for select
  using (person_id = public.current_person_id());

create policy "admins manage application correction items"
  on public.application_correction_items for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "applicants read own application correction items"
  on public.application_correction_items for select
  using (
    exists (
      select 1
      from public.application_correction_requests request
      where request.id = application_correction_items.request_id
        and request.person_id = public.current_person_id()
    )
  );

create policy "admins manage application correction item versions"
  on public.application_correction_item_versions for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "applicants read own application correction item versions"
  on public.application_correction_item_versions for select
  using (
    exists (
      select 1
      from public.application_correction_requests request
      where request.id = application_correction_item_versions.request_id
        and request.person_id = public.current_person_id()
    )
  );

create policy "admins manage application correction item drafts"
  on public.application_correction_item_drafts for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "applicants read own application correction item drafts"
  on public.application_correction_item_drafts for select
  using (
    exists (
      select 1
      from public.application_correction_requests request
      where request.id = application_correction_item_drafts.request_id
        and request.person_id = public.current_person_id()
    )
  );

create policy "admins manage application document slot versions"
  on public.application_document_slot_versions for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins manage application evidence overrides"
  on public.application_evidence_overrides for all
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.is_application_correction_field_key(p_field_key text)
returns boolean
language sql
immutable
as $$
  select p_field_key = any(array[
    'title',
    'first_name',
    'middle_names',
    'last_name',
    'preferred_name',
    'previous_surname',
    'date_of_birth',
    'previous_study_detail',
    'partner_student_id',
    'email',
    'phone',
    'address_line_1',
    'address_line_2',
    'city',
    'postcode',
    'country',
    'clinical_role',
    'employer',
    'department_specialty',
    'professional_registration_body',
    'professional_registration_number',
    'highest_qualification',
    'qualification_awarding_body',
    'qualification_year',
    'qualification_result',
    'qualification_country',
    'work_experience',
    'nationality',
    'country_of_birth',
    'country_of_residence',
    'needs_visa_check',
    'visa_notes',
    'funding_source',
    'funding_organisation',
    'funding_contact',
    'pocus_previous_experience',
    'pocus_motivation',
    'pocus_case_improved_management',
    'pocus_limitations_case',
    'evidence_summary'
  ]::text[]);
$$;

create or replace function public.preserve_application_document_slot_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.managed_file_id is not null
    and old.managed_file_id is distinct from new.managed_file_id then
    insert into public.application_document_slot_versions (
      slot_id,
      application_id,
      managed_file_id,
      verification_status,
      verifier_user_id,
      verification_at,
      verification_note
    )
    values (
      old.id,
      old.application_id,
      old.managed_file_id,
      old.verification_status,
      old.verifier_user_id,
      old.verification_at,
      old.verification_note
    );
  end if;
  return new;
end;
$$;

create trigger preserve_application_document_slot_version
  before update of managed_file_id on public.application_document_slots
  for each row
  execute function public.preserve_application_document_slot_version();

insert into public.correspondence_templates (
  template_key,
  version,
  channel,
  description,
  subject_template,
  body_template
)
values (
  'application_correction_requested',
  1,
  'email',
  'Notifies an applicant that specific corrections are available in the secure portal.',
  'Action required for your BETAR application',
  'Please use your secure BETAR application link to review the requested corrections. The portal is the source of truth for the requested information and due date.'
)
on conflict (template_key, channel, version) do nothing;

create or replace function public.request_application_corrections(
  p_application_id uuid,
  p_items jsonb,
  p_summary text default null,
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_application public.applications%rowtype;
  v_lead public.admission_leads%rowtype;
  v_request_id uuid;
  v_version_number integer;
  v_due_at timestamptz := coalesce(p_due_at, now() + interval '14 days');
  v_summary text := nullif(left(trim(coalesce(p_summary, '')), 4000), '');
  v_item jsonb;
  v_target_type text;
  v_target_key text;
  v_instructions text;
  v_baseline_value jsonb;
  v_template_id uuid;
  v_correspondence_log_id uuid;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can request application corrections'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'Correction requests require between 1 and 20 specific items';
  end if;

  if v_due_at <= now() then
    raise exception 'Correction due date must be in the future';
  end if;

  select * into v_application
  from public.applications
  where id = p_application_id
  for update;

  if not found or v_application.status <> 'submitted' then
    raise exception 'Corrections can only be requested for submitted applications';
  end if;

  select * into v_lead
  from public.admission_leads
  where id = v_application.admission_lead_id
  for update;

  if not found or v_lead.archived or v_lead.converted_student_id is not null then
    raise exception 'Archived or complete applications cannot receive correction requests';
  end if;

  if exists (
    select 1 from public.application_decisions
    where application_id = v_application.id
  ) then
    raise exception 'Applications with a recorded decision cannot receive correction requests';
  end if;

  if exists (
    select 1 from public.application_correction_requests
    where application_id = v_application.id
      and status in ('open', 'resubmitted')
  ) then
    raise exception 'This application already has an active correction request';
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_version_number
  from public.application_correction_requests
  where application_id = v_application.id;

  insert into public.application_correction_requests (
    application_id,
    admission_lead_id,
    person_id,
    version_number,
    summary,
    application_snapshot,
    due_at,
    requested_by_user_id
  )
  values (
    v_application.id,
    v_application.admission_lead_id,
    v_application.person_id,
    v_version_number,
    v_summary,
    to_jsonb(v_application),
    v_due_at,
    v_actor_user_id
  )
  returning id into v_request_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_target_type := nullif(trim(v_item->>'target_type'), '');
    v_target_key := nullif(trim(v_item->>'target_key'), '');
    v_instructions := nullif(left(trim(coalesce(v_item->>'instructions', '')), 4000), '');

    if v_target_type not in ('application_field', 'document_slot')
      or v_target_key is null
      or v_instructions is null then
      raise exception 'Every correction item requires a valid target and instructions';
    end if;

    if v_target_type = 'application_field' then
      if not public.is_application_correction_field_key(v_target_key) then
        raise exception 'Application field % cannot be targeted for correction', v_target_key;
      end if;
      v_baseline_value := to_jsonb(v_application)->v_target_key;
    else
      if not (v_target_key = any(enum_range(null::public.application_document_slot_key)::text[])) then
        raise exception 'Document slot % cannot be targeted for correction', v_target_key;
      end if;

      select jsonb_build_object(
        'slot_id', slot.id,
        'managed_file_id', slot.managed_file_id,
        'verification_status', slot.verification_status,
        'sanitized_filename', slot.sanitized_filename
      )
      into v_baseline_value
      from public.application_document_slots slot
      where slot.application_id = v_application.id
        and slot.slot_key::text = v_target_key;

      v_baseline_value := coalesce(v_baseline_value, 'null'::jsonb);

      if v_baseline_value = 'null'::jsonb then
        insert into public.application_document_slots (
          application_id,
          person_id,
          slot_key,
          label,
          required,
          retention_class
        )
        values (
          v_application.id,
          v_application.person_id,
          v_target_key::public.application_document_slot_key,
          case v_target_key
            when 'qualification_evidence' then 'Qualification certificate or transcript'
            when 'professional_registration_evidence' then 'Professional registration evidence'
            when 'cv_or_supporting_evidence' then 'CV or supporting evidence'
            when 'funding_evidence' then 'Funding or sponsor evidence'
          end,
          v_target_key in ('qualification_evidence', 'professional_registration_evidence'),
          case
            when v_target_key = 'qualification_evidence' then 'qualification_document'
            else 'application_document'
          end
        )
        on conflict (application_id, slot_key) do nothing;
      end if;
    end if;

    insert into public.application_correction_items (
      request_id,
      target_type,
      target_key,
      instructions,
      baseline_value
    )
    values (
      v_request_id,
      v_target_type::public.application_correction_item_target_type,
      v_target_key,
      v_instructions,
      v_baseline_value
    );
  end loop;

  insert into public.application_reviews (
    application_id,
    reviewed_by_user_id,
    readiness_status,
    last_reviewed_at
  )
  values (v_application.id, v_actor_user_id, 'needs_information', now())
  on conflict (application_id) do update set
    reviewed_by_user_id = excluded.reviewed_by_user_id,
    readiness_status = 'needs_information',
    last_reviewed_at = excluded.last_reviewed_at;

  select id into v_template_id
  from public.correspondence_templates
  where template_key = 'application_correction_requested'
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
    v_application.person_id,
    lower(coalesce(v_application.email, v_lead.email)),
    concat_ws(' ', coalesce(v_application.first_name, v_lead.first_name), coalesce(v_application.last_name, v_lead.last_name)),
    'application_correction_request',
    v_request_id,
    v_template_id,
    'application_correction_requested',
    1,
    'email',
    'Action required for your BETAR application',
    'queued',
    jsonb_build_object(
      'application_id', v_application.id,
      'admission_lead_id', v_application.admission_lead_id,
      'due_at', v_due_at,
      'secure_portal_path', '/apply/application'
    ),
    v_actor_user_id
  )
  returning id into v_correspondence_log_id;

  update public.application_correction_requests
  set correspondence_log_id = v_correspondence_log_id
  where id = v_request_id;

  insert into public.audit_events (
    actor_type,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    'staff',
    v_actor_user_id,
    'application.correction_requested',
    'application_correction_request',
    v_request_id,
    jsonb_build_object(
      'application_id', v_application.id,
      'admission_lead_id', v_application.admission_lead_id,
      'version_number', v_version_number,
      'item_count', jsonb_array_length(p_items),
      'due_at', v_due_at,
      'correspondence_log_id', v_correspondence_log_id
    )
  );

  return jsonb_build_object(
    'request_id', v_request_id,
    'correspondence_log_id', v_correspondence_log_id
  );
end;
$$;

create or replace function public.save_application_correction_response(
  p_item_id uuid,
  p_proposed_value jsonb default null,
  p_replacement_managed_file_id uuid default null,
  p_response_note text default null,
  p_clear_value boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_person_id uuid := public.current_person_id();
  v_item public.application_correction_items%rowtype;
  v_request public.application_correction_requests%rowtype;
  v_application public.applications%rowtype;
  v_candidate public.applications%rowtype;
  v_file public.managed_files%rowtype;
  v_note text := nullif(left(trim(coalesce(p_response_note, '')), 2000), '');
  v_effective_proposed_value jsonb := case when p_clear_value then 'null'::jsonb else p_proposed_value end;
begin
  if v_auth_user_id is null or v_person_id is null or public.current_portal_actor_type() <> 'applicant' then
    raise exception 'An authenticated applicant session is required'
      using errcode = '42501';
  end if;

  select * into v_item
  from public.application_correction_items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'Correction item was not found';
  end if;

  select * into v_request
  from public.application_correction_requests
  where id = v_item.request_id
  for update;

  if v_request.person_id <> v_person_id or v_request.status <> 'open' then
    raise exception 'This correction item is not editable';
  end if;

  select * into v_application
  from public.applications
  where id = v_request.application_id
    and person_id = v_person_id;

  if not found or v_application.status <> 'submitted' then
    raise exception 'Submitted application was not found for this correction';
  end if;

  if v_item.target_type = 'application_field' then
    if (p_proposed_value is null and not p_clear_value)
      or (p_proposed_value is not null and p_clear_value)
      or p_replacement_managed_file_id is not null then
      raise exception 'Application field corrections require a proposed value only';
    end if;

    if jsonb_typeof(v_effective_proposed_value) not in ('string', 'number', 'boolean', 'null')
      or length(coalesce(v_effective_proposed_value #>> '{}', '')) > 10000 then
      raise exception 'Application field corrections require a valid scalar value';
    end if;

    if v_item.target_key = any(array[
      'first_name',
      'last_name',
      'date_of_birth',
      'email',
      'phone',
      'address_line_1',
      'city',
      'postcode',
      'country',
      'clinical_role',
      'employer',
      'department_specialty',
      'professional_registration_body',
      'professional_registration_number',
      'highest_qualification',
      'qualification_awarding_body',
      'qualification_year',
      'work_experience',
      'nationality',
      'country_of_residence',
      'pocus_previous_experience',
      'pocus_motivation',
      'pocus_case_improved_management',
      'pocus_limitations_case'
    ]::text[]) and (
      jsonb_typeof(v_effective_proposed_value) = 'null'
      or length(trim(coalesce(v_effective_proposed_value #>> '{}', ''))) = 0
    ) then
      raise exception 'Required application field % cannot be empty', v_item.target_key;
    end if;

    select * into v_candidate
    from jsonb_populate_record(
      v_application,
      jsonb_build_object(v_item.target_key, v_effective_proposed_value)
    );

    if v_item.target_key = 'email'
      and position('@' in coalesce(v_candidate.email, '')) = 0 then
      raise exception 'Application email must be valid';
    end if;
  else
    if p_replacement_managed_file_id is null or p_proposed_value is not null or p_clear_value then
      raise exception 'Document corrections require a replacement file only';
    end if;

    select * into v_file
    from public.managed_files
    where id = p_replacement_managed_file_id
      and person_id = v_person_id;

    if not found or v_file.bucket not in ('application-docs', 'qualification-documents') then
      raise exception 'Replacement file is not available for this applicant';
    end if;
  end if;

  update public.application_correction_items
  set
    proposed_value = case when v_item.target_type = 'application_field' then v_effective_proposed_value else null end,
    replacement_managed_file_id = case when v_item.target_type = 'document_slot' then p_replacement_managed_file_id else null end,
    applicant_response_note = v_note,
    applicant_saved_at = now(),
    status = 'open',
    staff_review_note = null,
    reviewed_by_user_id = null,
    reviewed_at = null,
    updated_at = now()
  where id = v_item.id;

  insert into public.application_correction_item_drafts (
    request_id,
    item_id,
    save_number,
    proposed_value,
    replacement_managed_file_id,
    applicant_response_note
  )
  values (
    v_request.id,
    v_item.id,
    coalesce((
      select max(draft.save_number) + 1
      from public.application_correction_item_drafts draft
      where draft.item_id = v_item.id
    ), 1),
    case when v_item.target_type = 'application_field' then v_effective_proposed_value else null end,
    case when v_item.target_type = 'document_slot' then p_replacement_managed_file_id else null end,
    v_note
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
    'application.correction_draft_saved',
    'application_correction_item',
    v_item.id,
    jsonb_build_object(
      'request_id', v_request.id,
      'application_id', v_request.application_id,
      'target_type', v_item.target_type,
      'target_key', v_item.target_key,
      'value_cleared', p_clear_value,
      'has_response_note', v_note is not null
    )
  );

  return v_item.id;
end;
$$;

create or replace function public.resubmit_application_corrections(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_person_id uuid := public.current_person_id();
  v_request public.application_correction_requests%rowtype;
  v_revision_number integer;
begin
  if v_auth_user_id is null or v_person_id is null or public.current_portal_actor_type() <> 'applicant' then
    raise exception 'An authenticated applicant session is required'
      using errcode = '42501';
  end if;

  select * into v_request
  from public.application_correction_requests
  where id = p_request_id
  for update;

  if not found or v_request.person_id <> v_person_id or v_request.status <> 'open' then
    raise exception 'This correction request cannot be resubmitted';
  end if;

  if exists (
    select 1
    from public.application_correction_items item
    where item.request_id = v_request.id
      and item.status <> 'accepted'
      and (
        (item.target_type = 'application_field' and item.proposed_value is null)
        or (item.target_type = 'document_slot' and item.replacement_managed_file_id is null)
      )
  ) then
    raise exception 'Every correction item must be addressed before resubmission';
  end if;

  v_revision_number := v_request.revision_number + 1;

  insert into public.application_correction_item_versions (
    request_id,
    item_id,
    revision_number,
    instructions,
    proposed_value,
    replacement_managed_file_id,
    applicant_response_note
  )
  select
    v_request.id,
    item.id,
    v_revision_number,
    item.instructions,
    item.proposed_value,
    item.replacement_managed_file_id,
    item.applicant_response_note
  from public.application_correction_items item
  where item.request_id = v_request.id
    and item.status <> 'accepted';

  update public.application_correction_items
  set status = 'resubmitted', updated_at = now()
  where request_id = v_request.id
    and status <> 'accepted';

  update public.application_correction_requests
  set
    status = 'resubmitted',
    revision_number = v_revision_number,
    last_resubmitted_at = now(),
    updated_at = now()
  where id = v_request.id;

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
    'application.corrections_resubmitted',
    'application_correction_request',
    v_request.id,
    jsonb_build_object(
      'application_id', v_request.application_id,
      'revision_number', v_revision_number
    )
  );

  return v_request.id;
end;
$$;

create or replace function public.record_application_correction_document_upload(
  p_item_id uuid,
  p_bucket text,
  p_object_path text,
  p_original_filename text,
  p_sanitized_filename text,
  p_content_type text,
  p_size_bytes bigint,
  p_response_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_person_id uuid := public.current_person_id();
  v_item public.application_correction_items%rowtype;
  v_request public.application_correction_requests%rowtype;
  v_application public.applications%rowtype;
  v_bucket text;
  v_label text;
  v_retention_class text;
  v_file_category text;
  v_max_bytes bigint;
  v_allowed_content_types text[];
  v_allowed_extensions text[];
  v_extension text;
  v_original_filename text := nullif(left(trim(coalesce(p_original_filename, '')), 255), '');
  v_sanitized_filename text := nullif(left(trim(coalesce(p_sanitized_filename, '')), 140), '');
  v_content_type text := lower(nullif(trim(coalesce(p_content_type, '')), ''));
  v_managed_file_id uuid;
begin
  if v_auth_user_id is null or v_person_id is null or public.current_portal_actor_type() <> 'applicant' then
    raise exception 'An authenticated applicant session is required'
      using errcode = '42501';
  end if;

  select * into v_item
  from public.application_correction_items
  where id = p_item_id
  for update;

  if not found or v_item.target_type <> 'document_slot' then
    raise exception 'A document correction item is required';
  end if;

  select * into v_request
  from public.application_correction_requests
  where id = v_item.request_id
  for update;

  if v_request.person_id <> v_person_id or v_request.status <> 'open' then
    raise exception 'This document correction is not editable';
  end if;

  select * into v_application
  from public.applications
  where id = v_request.application_id
    and person_id = v_person_id;

  if not found or v_application.status <> 'submitted' then
    raise exception 'Submitted application was not found for this correction';
  end if;

  case v_item.target_key
    when 'qualification_evidence' then
      v_label := 'Qualification certificate or transcript';
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
      v_bucket := 'application-docs';
      v_retention_class := 'application_document';
      v_file_category := 'other';
      v_max_bytes := 10485760;
      v_allowed_content_types := array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
      v_allowed_extensions := array['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
    when 'cv_or_supporting_evidence' then
      v_label := 'CV or supporting evidence';
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
    else
      raise exception 'Document correction slot is not supported';
  end case;

  v_extension := lower(substring(v_sanitized_filename from '(\.[^.]+)$'));

  if p_bucket is distinct from v_bucket
    or v_original_filename is null
    or v_sanitized_filename is null
    or v_extension is null
    or not (v_extension = any(v_allowed_extensions))
    or v_content_type is null
    or not (v_content_type = any(v_allowed_content_types))
    or p_size_bytes is null
    or p_size_bytes <= 0
    or p_size_bytes > v_max_bytes then
    raise exception 'Replacement document metadata is not valid for this correction';
  end if;

  if p_object_path is null
    or position(
      v_person_id::text || '/' || v_application.id::text || '/' || v_item.target_key || '/'
      in p_object_path
    ) <> 1 then
    raise exception 'Replacement document path is not valid for this correction';
  end if;

  if not exists (
    select 1
    from storage.objects storage_object
    where storage_object.bucket_id = v_bucket
      and storage_object.name = p_object_path
      and coalesce(storage_object.metadata->>'mimetype', '') = v_content_type
      and coalesce((storage_object.metadata->>'size')::bigint, -1) = p_size_bytes
  ) then
    raise exception 'Uploaded replacement document was not found in private storage';
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

  perform public.save_application_correction_response(
    v_item.id,
    null,
    v_managed_file_id,
    p_response_note
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
    'document.correction_uploaded',
    'application_correction_item',
    v_item.id,
    jsonb_build_object(
      'request_id', v_request.id,
      'application_id', v_application.id,
      'slot_key', v_item.target_key,
      'managed_file_id', v_managed_file_id,
      'content_type', v_content_type,
      'size_bytes', p_size_bytes
    )
  );

  return v_managed_file_id;
end;
$$;

create or replace function public.apply_application_correction_field(
  p_application_id uuid,
  p_field_key text,
  p_proposed_value jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications%rowtype;
  v_candidate public.applications%rowtype;
begin
  if not public.is_application_correction_field_key(p_field_key) then
    raise exception 'Application field % cannot be corrected', p_field_key;
  end if;

  select * into v_application
  from public.applications
  where id = p_application_id
  for update;

  select * into v_candidate
  from jsonb_populate_record(
    v_application,
    jsonb_build_object(p_field_key, p_proposed_value)
  );

  update public.applications set
    title = v_candidate.title,
    first_name = v_candidate.first_name,
    middle_names = v_candidate.middle_names,
    last_name = v_candidate.last_name,
    preferred_name = v_candidate.preferred_name,
    previous_surname = v_candidate.previous_surname,
    date_of_birth = v_candidate.date_of_birth,
    previous_study_detail = v_candidate.previous_study_detail,
    partner_student_id = v_candidate.partner_student_id,
    email = v_candidate.email,
    phone = v_candidate.phone,
    address_line_1 = v_candidate.address_line_1,
    address_line_2 = v_candidate.address_line_2,
    city = v_candidate.city,
    postcode = v_candidate.postcode,
    country = v_candidate.country,
    clinical_role = v_candidate.clinical_role,
    employer = v_candidate.employer,
    department_specialty = v_candidate.department_specialty,
    professional_registration_body = v_candidate.professional_registration_body,
    professional_registration_number = v_candidate.professional_registration_number,
    highest_qualification = v_candidate.highest_qualification,
    qualification_awarding_body = v_candidate.qualification_awarding_body,
    qualification_year = v_candidate.qualification_year,
    qualification_result = v_candidate.qualification_result,
    qualification_country = v_candidate.qualification_country,
    work_experience = v_candidate.work_experience,
    nationality = v_candidate.nationality,
    country_of_birth = v_candidate.country_of_birth,
    country_of_residence = v_candidate.country_of_residence,
    needs_visa_check = v_candidate.needs_visa_check,
    visa_notes = v_candidate.visa_notes,
    funding_source = v_candidate.funding_source,
    funding_organisation = v_candidate.funding_organisation,
    funding_contact = v_candidate.funding_contact,
    pocus_previous_experience = v_candidate.pocus_previous_experience,
    pocus_motivation = v_candidate.pocus_motivation,
    pocus_case_improved_management = v_candidate.pocus_case_improved_management,
    pocus_limitations_case = v_candidate.pocus_limitations_case,
    evidence_summary = v_candidate.evidence_summary,
    updated_at = now()
  where id = p_application_id;
end;
$$;

create or replace function public.review_application_corrections(
  p_request_id uuid,
  p_reviews jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_request public.application_correction_requests%rowtype;
  v_review jsonb;
  v_item public.application_correction_items%rowtype;
  v_outcome text;
  v_note text;
  v_has_revision boolean := false;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can review application corrections'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_reviews) <> 'array' then
    raise exception 'Correction reviews must be an array';
  end if;

  select * into v_request
  from public.application_correction_requests
  where id = p_request_id
  for update;

  if not found or v_request.status <> 'resubmitted' then
    raise exception 'Only resubmitted correction requests can be reviewed';
  end if;

  if jsonb_array_length(p_reviews) <> (
    select count(*) from public.application_correction_items
    where request_id = v_request.id and status = 'resubmitted'
  ) then
    raise exception 'Every resubmitted correction item requires a review outcome';
  end if;

  for v_review in select value from jsonb_array_elements(p_reviews)
  loop
    select * into v_item
    from public.application_correction_items
    where id = (v_review->>'item_id')::uuid
      and request_id = v_request.id
      and status = 'resubmitted'
    for update;

    if not found then
      raise exception 'Correction review contains an unknown or duplicate item';
    end if;

    v_outcome := nullif(trim(v_review->>'outcome'), '');
    v_note := nullif(left(trim(coalesce(v_review->>'review_note', '')), 4000), '');

    if v_outcome not in ('accepted', 'revise') then
      raise exception 'Correction review outcome must be accepted or revise';
    end if;

    if v_outcome = 'revise' and v_note is null then
      raise exception 'Revised correction items require staff instructions';
    end if;

    update public.application_correction_items
    set
      status = case
        when v_outcome = 'accepted' then 'accepted'::public.application_correction_item_status
        else 'open'::public.application_correction_item_status
      end,
      instructions = case when v_outcome = 'revise' then v_note else instructions end,
      staff_review_note = v_note,
      reviewed_by_user_id = v_actor_user_id,
      reviewed_at = now(),
      updated_at = now()
    where id = v_item.id;

    update public.application_correction_item_versions
    set
      staff_outcome = v_outcome,
      staff_review_note = v_note,
      reviewed_at = now()
    where item_id = v_item.id
      and revision_number = v_request.revision_number;

    v_has_revision := v_has_revision or v_outcome = 'revise';
  end loop;

  if v_has_revision then
    update public.application_correction_requests
    set status = 'open', updated_at = now()
    where id = v_request.id;
  else
    for v_item in
      select * from public.application_correction_items
      where request_id = v_request.id
      order by created_at, id
    loop
      if v_item.target_type = 'application_field' then
        perform public.apply_application_correction_field(
          v_request.application_id,
          v_item.target_key,
          v_item.proposed_value
        );
      else
        with revoked_override as (
          update public.application_evidence_overrides evidence_override
          set
            revoked_at = now(),
            revoked_by_user_id = v_actor_user_id,
            revocation_reason = 'Evidence was replaced through an application correction.'
          where evidence_override.application_id = v_request.application_id
            and evidence_override.decision_id is null
            and evidence_override.revoked_at is null
            and evidence_override.slot_id in (
              select slot.id
              from public.application_document_slots slot
              where slot.application_id = v_request.application_id
                and slot.slot_key::text = v_item.target_key
            )
          returning evidence_override.id, evidence_override.slot_id
        )
        insert into public.audit_events (
          actor_type,
          actor_user_id,
          action,
          entity_type,
          entity_id,
          reason,
          metadata
        )
        select
          'staff',
          v_actor_user_id,
          'application.evidence_override_revoked_by_replacement',
          'application_evidence_override',
          revoked_override.id,
          'Evidence was replaced through an application correction.',
          jsonb_build_object(
            'application_id', v_request.application_id,
            'slot_id', revoked_override.slot_id,
            'correction_request_id', v_request.id
          )
        from revoked_override;

        update public.application_document_slots slot
        set
          managed_file_id = v_item.replacement_managed_file_id,
          original_filename = file.original_filename,
          sanitized_filename = file.sanitized_filename,
          content_type = file.content_type,
          size_bytes = file.size_bytes,
          uploaded_at = now(),
          uploaded_by_user_id = file.uploaded_by_user_id,
          uploaded_by_person_id = file.uploaded_by_person_id,
          verification_status = 'unverified',
          verifier_user_id = null,
          verification_at = null,
          verification_note = null,
          updated_at = now()
        from public.managed_files file
        where slot.application_id = v_request.application_id
          and slot.slot_key::text = v_item.target_key
          and file.id = v_item.replacement_managed_file_id;

        if not found then
          raise exception 'Replacement document slot could not be applied';
        end if;
      end if;
    end loop;

    update public.application_correction_requests
    set
      status = 'resolved',
      resolved_by_user_id = v_actor_user_id,
      resolved_at = now(),
      updated_at = now()
    where id = v_request.id;

    update public.application_reviews
    set
      readiness_status = 'not_ready',
      reviewed_by_user_id = v_actor_user_id,
      last_reviewed_at = now()
    where application_id = v_request.application_id;
  end if;

  insert into public.audit_events (
    actor_type,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    'staff',
    v_actor_user_id,
    case when v_has_revision then 'application.corrections_revised' else 'application.corrections_resolved' end,
    'application_correction_request',
    v_request.id,
    jsonb_build_object(
      'application_id', v_request.application_id,
      'revision_number', v_request.revision_number,
      'resolved', not v_has_revision
    )
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', case when v_has_revision then 'open' else 'resolved' end
  );
end;
$$;

create or replace function public.cancel_application_correction_request(
  p_request_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_request public.application_correction_requests%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 4000), '');
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can cancel application corrections'
      using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'Cancellation reason is required';
  end if;

  select * into v_request
  from public.application_correction_requests
  where id = p_request_id
  for update;

  if not found or v_request.status not in ('open', 'resubmitted') then
    raise exception 'Only active correction requests can be cancelled';
  end if;

  update public.application_correction_requests
  set
    status = 'cancelled',
    cancelled_by_user_id = v_actor_user_id,
    cancelled_at = now(),
    cancellation_reason = v_reason,
    updated_at = now()
  where id = v_request.id;

  update public.application_reviews
  set readiness_status = 'not_ready', reviewed_by_user_id = v_actor_user_id, last_reviewed_at = now()
  where application_id = v_request.application_id;

  insert into public.audit_events (
    actor_type,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    reason,
    metadata
  )
  values (
    'staff',
    v_actor_user_id,
    'application.correction_cancelled',
    'application_correction_request',
    v_request.id,
    v_reason,
    jsonb_build_object('application_id', v_request.application_id)
  );

  return v_request.id;
end;
$$;

create or replace function public.record_application_evidence_override(
  p_slot_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_slot public.application_document_slots%rowtype;
  v_application public.applications%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 4000), '');
  v_override_id uuid;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can record evidence overrides'
      using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'Evidence override reason is required';
  end if;

  select * into v_slot
  from public.application_document_slots
  where id = p_slot_id
  for update;

  if not found or not v_slot.required then
    raise exception 'A required evidence slot is required for an override';
  end if;

  if v_slot.verification_status = 'rejected' then
    raise exception 'Rejected evidence cannot be overridden';
  end if;

  if v_slot.verification_status = 'verified' then
    raise exception 'Verified evidence does not require an override';
  end if;

  select * into v_application
  from public.applications
  where id = v_slot.application_id
  for update;

  if not found or v_application.status <> 'submitted' or exists (
    select 1 from public.application_decisions where application_id = v_application.id
  ) then
    raise exception 'Evidence overrides must be recorded before an application decision';
  end if;

  insert into public.application_evidence_overrides (
    application_id,
    slot_id,
    reason,
    recorded_by_user_id
  )
  values (
    v_application.id,
    v_slot.id,
    v_reason,
    v_actor_user_id
  )
  returning id into v_override_id;

  insert into public.audit_events (
    actor_type,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    reason,
    metadata
  )
  values (
    'staff',
    v_actor_user_id,
    'application.evidence_override_recorded',
    'application_evidence_override',
    v_override_id,
    v_reason,
    jsonb_build_object(
      'application_id', v_application.id,
      'slot_id', v_slot.id,
      'slot_key', v_slot.slot_key
    )
  );

  return v_override_id;
end;
$$;

create or replace function public.guard_application_decision_corrections_and_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.outcome = 'offer' then
    if exists (
      select 1
      from public.application_correction_requests request
      where request.application_id = new.application_id
        and request.status in ('open', 'resubmitted')
    ) then
      raise exception 'Offers are blocked while application corrections are active';
    end if;

    if exists (
      select 1
      from public.application_document_slots slot
      where slot.application_id = new.application_id
        and slot.required
        and (
          slot.verification_status = 'rejected'
          or (
            slot.verification_status <> 'verified'
            and not exists (
              select 1
              from public.application_evidence_overrides evidence_override
              where evidence_override.application_id = new.application_id
                and evidence_override.slot_id = slot.id
                and evidence_override.decision_id is null
                and evidence_override.revoked_at is null
            )
          )
        )
    ) then
      raise exception 'Offers require verified evidence or a valid slot-specific override';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_application_decision_corrections_and_evidence
  before insert or update of application_id, outcome on public.application_decisions
  for each row
  execute function public.guard_application_decision_corrections_and_evidence();

create or replace function public.finalize_application_decision_corrections_and_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.outcome = 'offer' then
    update public.application_evidence_overrides
    set decision_id = new.id
    where application_id = new.application_id
      and decision_id is null
      and revoked_at is null;
  else
    with cancelled_request as (
      update public.application_correction_requests
      set
        status = 'cancelled',
        cancelled_by_user_id = new.decided_by_user_id,
        cancelled_at = now(),
        cancellation_reason = 'Application rejected while corrections were outstanding.',
        updated_at = now()
      where application_id = new.application_id
        and status in ('open', 'resubmitted')
      returning id
    )
    insert into public.audit_events (
      actor_type,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      reason,
      metadata
    )
    select
      'staff',
      new.decided_by_user_id,
      'application.correction_cancelled_by_rejection',
      'application_correction_request',
      cancelled_request.id,
      'Application rejected while corrections were outstanding.',
      jsonb_build_object(
        'application_id', new.application_id,
        'decision_id', new.id
      )
    from cancelled_request;
  end if;

  return new;
end;
$$;

create trigger finalize_application_decision_corrections_and_evidence
  after insert on public.application_decisions
  for each row
  execute function public.finalize_application_decision_corrections_and_evidence();

revoke all on function public.is_application_correction_field_key(text) from public;
revoke all on function public.request_application_corrections(uuid, jsonb, text, timestamptz) from public;
revoke all on function public.save_application_correction_response(uuid, jsonb, uuid, text, boolean) from public;
revoke all on function public.resubmit_application_corrections(uuid) from public;
revoke all on function public.record_application_correction_document_upload(uuid, text, text, text, text, text, bigint, text) from public;
revoke all on function public.apply_application_correction_field(uuid, text, jsonb) from public;
revoke all on function public.review_application_corrections(uuid, jsonb) from public;
revoke all on function public.cancel_application_correction_request(uuid, text) from public;
revoke all on function public.record_application_evidence_override(uuid, text) from public;

grant execute on function public.request_application_corrections(uuid, jsonb, text, timestamptz) to authenticated;
grant execute on function public.save_application_correction_response(uuid, jsonb, uuid, text, boolean) to authenticated;
grant execute on function public.resubmit_application_corrections(uuid) to authenticated;
grant execute on function public.record_application_correction_document_upload(uuid, text, text, text, text, text, bigint, text) to authenticated;
grant execute on function public.review_application_corrections(uuid, jsonb) to authenticated;
grant execute on function public.cancel_application_correction_request(uuid, text) to authenticated;
grant execute on function public.record_application_evidence_override(uuid, text) to authenticated;
