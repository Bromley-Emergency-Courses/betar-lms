do $$
begin
  create type public.admissions_workspace as enum ('new_students', 'returning_students');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.admissions_action_scope as enum ('one', 'selected', 'all_matching');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.admissions_operational_action as enum (
    'invite_application',
    'send_reminder',
    'send_general_communication',
    'close_abandoned',
    'lapse_offer',
    'lapse_registration',
    'contact_returning_student',
    'confirm_returning_selection',
    'resolve_returning_no_response'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.admissions_operational_batch_status as enum (
    'queued',
    'running',
    'completed',
    'cancelled'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.admissions_operational_target_status as enum (
    'queued',
    'running',
    'succeeded',
    'failed',
    'excluded'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.admissions_email_test_record_type as enum ('new_applicant', 'returning_student');
exception
  when duplicate_object then null;
end;
$$;

create table public.admissions_email_test_records (
  id uuid primary key default gen_random_uuid(),
  record_type public.admissions_email_test_record_type not null,
  person_id uuid not null references public.persons(id) on delete restrict,
  admission_lead_id uuid unique references public.admission_leads(id) on delete restrict,
  student_id uuid unique references public.students(id) on delete restrict,
  label text not null,
  reason text not null,
  active boolean not null default true,
  marked_by_user_id uuid references public.staff_profiles(id) on delete set null,
  marked_at timestamptz not null default now(),
  unmarked_by_user_id uuid references public.staff_profiles(id) on delete set null,
  unmarked_at timestamptz,
  unmark_reason text,
  updated_at timestamptz not null default now(),
  check (length(trim(label)) between 1 and 160),
  check (length(trim(reason)) between 1 and 2000),
  check (
    (record_type = 'new_applicant' and admission_lead_id is not null and student_id is null)
    or (record_type = 'returning_student' and student_id is not null and admission_lead_id is null)
  ),
  check (
    (active and unmarked_at is null and unmarked_by_user_id is null and unmark_reason is null)
    or (
      not active
      and unmarked_at is not null
      and unmark_reason is not null
      and length(trim(unmark_reason)) between 1 and 2000
    )
  )
);

create or replace function public.guard_admissions_email_test_record_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.record_type = 'new_applicant' and not exists (
    select 1
    from public.admission_leads lead
    where lead.id = new.admission_lead_id
      and lead.person_id = new.person_id
  ) then
    raise exception 'The fake applicant marker must match the admission record person';
  end if;

  if new.record_type = 'returning_student' and not exists (
    select 1
    from public.students student
    where student.id = new.student_id
      and student.person_id = new.person_id
  ) then
    raise exception 'The fake student marker must match the student record person';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create trigger guard_admissions_email_test_record_identity
  before insert or update on public.admissions_email_test_records
  for each row
  execute function public.guard_admissions_email_test_record_identity();

create index admissions_email_test_records_active_person_idx
  on public.admissions_email_test_records(person_id, record_type)
  where active;

create table public.admissions_operational_batches (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  workspace public.admissions_workspace not null,
  action public.admissions_operational_action not null,
  scope public.admissions_action_scope not null,
  status public.admissions_operational_batch_status not null default 'queued',
  initiated_by_user_id uuid not null references public.staff_profiles(id) on delete restrict,
  reviewed_filters jsonb not null default '{}'::jsonb,
  reviewed_count integer not null check (reviewed_count between 1 and 500),
  correspondence_template_id uuid references public.correspondence_templates(id) on delete restrict,
  correspondence_template_key text,
  correspondence_template_version integer check (correspondence_template_version is null or correspondence_template_version > 0),
  rendered_subject text,
  rendered_body text,
  retry_of_batch_id uuid references public.admissions_operational_batches(id) on delete restrict,
  root_batch_id uuid references public.admissions_operational_batches(id) on delete restrict,
  queued_count integer not null default 0 check (queued_count >= 0),
  running_count integer not null default 0 check (running_count >= 0),
  succeeded_count integer not null default 0 check (succeeded_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  excluded_count integer not null default 0 check (excluded_count >= 0),
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_progress_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(reviewed_filters) = 'object'),
  check (
    (correspondence_template_key is null and correspondence_template_version is null and rendered_subject is null and rendered_body is null)
    or (
      correspondence_template_key is not null
      and correspondence_template_version is not null
      and rendered_subject is not null
      and rendered_body is not null
    )
  )
);

create table public.admissions_operational_batch_targets (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.admissions_operational_batches(id) on delete restrict,
  ordinal integer not null check (ordinal > 0),
  entity_type text not null,
  entity_id uuid not null,
  person_id uuid references public.persons(id) on delete restrict,
  recipient_email text,
  recipient_name text,
  status public.admissions_operational_target_status not null default 'queued',
  exclusion_reason text,
  failure_reason text,
  source_snapshot jsonb not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  last_progress_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (batch_id, ordinal),
  unique (batch_id, entity_type, entity_id),
  check (length(trim(entity_type)) between 1 and 80),
  check (recipient_email is null or length(trim(recipient_email)) > 3),
  check (jsonb_typeof(source_snapshot) = 'object'),
  check (
    (status = 'excluded' and exclusion_reason is not null and completed_at is not null)
    or (status <> 'excluded' and exclusion_reason is null)
  ),
  check (
    (status = 'failed' and failure_reason is not null and completed_at is not null)
    or (status <> 'failed' and failure_reason is null)
  )
);

alter table public.correspondence_logs
  add column if not exists rendered_body text,
  add column if not exists delivery_provider text,
  add column if not exists operational_batch_id uuid references public.admissions_operational_batches(id) on delete restrict,
  add column if not exists operational_batch_target_id uuid references public.admissions_operational_batch_targets(id) on delete restrict,
  add column if not exists attempt_number integer not null default 1 check (attempt_number > 0);

create index admissions_operational_batches_status_progress_idx
  on public.admissions_operational_batches(status, last_progress_at desc);

create index admissions_operational_batches_workspace_created_idx
  on public.admissions_operational_batches(workspace, created_at desc);

create index admissions_operational_batch_targets_status_idx
  on public.admissions_operational_batch_targets(batch_id, status, ordinal);

create index correspondence_logs_operational_batch_idx
  on public.correspondence_logs(operational_batch_id, operational_batch_target_id, created_at desc);

create unique index correspondence_logs_batch_target_attempt_idx
  on public.correspondence_logs(operational_batch_target_id, attempt_number)
  where operational_batch_target_id is not null;

alter table public.admissions_email_test_records enable row level security;
alter table public.admissions_operational_batches enable row level security;
alter table public.admissions_operational_batch_targets enable row level security;

create policy "admins read admissions email test records"
  on public.admissions_email_test_records for select
  using (public.is_admin());

create policy "admins read admissions operational batches"
  on public.admissions_operational_batches for select
  using (public.is_admin());

create policy "admins read admissions operational batch targets"
  on public.admissions_operational_batch_targets for select
  using (public.is_admin());

create or replace function public.mark_fake_admission_lead_for_email_pilot(
  p_admission_lead_id uuid,
  p_label text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_person_id uuid;
  v_record_id uuid;
  v_label text := nullif(left(trim(coalesce(p_label, '')), 160), '');
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 2000), '');
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can mark fake pilot records' using errcode = '42501';
  end if;

  if v_label is null or v_reason is null then
    raise exception 'A label and reason are required';
  end if;

  select lead.person_id
  into v_person_id
  from public.admission_leads lead
  where lead.id = p_admission_lead_id;

  if v_person_id is null then
    raise exception 'The admission record must be linked to a person before it can be marked as fake';
  end if;

  insert into public.admissions_email_test_records (
    record_type,
    person_id,
    admission_lead_id,
    label,
    reason,
    active,
    marked_by_user_id,
    marked_at,
    unmarked_by_user_id,
    unmarked_at,
    unmark_reason
  )
  values (
    'new_applicant',
    v_person_id,
    p_admission_lead_id,
    v_label,
    v_reason,
    true,
    v_actor_user_id,
    now(),
    null,
    null,
    null
  )
  on conflict (admission_lead_id) do update
  set
    person_id = excluded.person_id,
    label = excluded.label,
    reason = excluded.reason,
    active = true,
    marked_by_user_id = excluded.marked_by_user_id,
    marked_at = now(),
    unmarked_by_user_id = null,
    unmarked_at = null,
    unmark_reason = null
  returning id into v_record_id;

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, reason, metadata
  )
  values (
    'staff', v_actor_user_id, 'admissions_email_test_record.marked',
    'admission_lead', p_admission_lead_id, v_reason,
    jsonb_build_object('test_record_id', v_record_id, 'record_type', 'new_applicant', 'label', v_label)
  );

  return v_record_id;
end;
$$;

create or replace function public.mark_fake_student_for_email_pilot(
  p_student_id uuid,
  p_label text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_person_id uuid;
  v_record_id uuid;
  v_label text := nullif(left(trim(coalesce(p_label, '')), 160), '');
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 2000), '');
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can mark fake pilot records' using errcode = '42501';
  end if;

  if v_label is null or v_reason is null then
    raise exception 'A label and reason are required';
  end if;

  select student.person_id
  into v_person_id
  from public.students student
  where student.id = p_student_id;

  if v_person_id is null then
    raise exception 'The student must be linked to a person before it can be marked as fake';
  end if;

  insert into public.admissions_email_test_records (
    record_type,
    person_id,
    student_id,
    label,
    reason,
    active,
    marked_by_user_id,
    marked_at,
    unmarked_by_user_id,
    unmarked_at,
    unmark_reason
  )
  values (
    'returning_student',
    v_person_id,
    p_student_id,
    v_label,
    v_reason,
    true,
    v_actor_user_id,
    now(),
    null,
    null,
    null
  )
  on conflict (student_id) do update
  set
    person_id = excluded.person_id,
    label = excluded.label,
    reason = excluded.reason,
    active = true,
    marked_by_user_id = excluded.marked_by_user_id,
    marked_at = now(),
    unmarked_by_user_id = null,
    unmarked_at = null,
    unmark_reason = null
  returning id into v_record_id;

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, reason, metadata
  )
  values (
    'staff', v_actor_user_id, 'admissions_email_test_record.marked',
    'student', p_student_id, v_reason,
    jsonb_build_object('test_record_id', v_record_id, 'record_type', 'returning_student', 'label', v_label)
  );

  return v_record_id;
end;
$$;

create or replace function public.unmark_admissions_email_test_record(
  p_test_record_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_record public.admissions_email_test_records%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 2000), '');
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can unmark fake pilot records' using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'An unmark reason is required';
  end if;

  select * into v_record
  from public.admissions_email_test_records
  where id = p_test_record_id
  for update;

  if not found then
    raise exception 'Admissions email test record was not found';
  end if;

  if not v_record.active then
    return;
  end if;

  update public.admissions_email_test_records
  set
    active = false,
    unmarked_by_user_id = v_actor_user_id,
    unmarked_at = now(),
    unmark_reason = v_reason
  where id = p_test_record_id;

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, reason, metadata
  )
  values (
    'staff', v_actor_user_id, 'admissions_email_test_record.unmarked',
    case when v_record.record_type = 'new_applicant' then 'admission_lead' else 'student' end,
    coalesce(v_record.admission_lead_id, v_record.student_id),
    v_reason,
    jsonb_build_object('test_record_id', v_record.id, 'record_type', v_record.record_type)
  );
end;
$$;

create or replace function public.create_admissions_operational_batch(
  p_request_key uuid,
  p_workspace public.admissions_workspace,
  p_action public.admissions_operational_action,
  p_scope public.admissions_action_scope,
  p_targets jsonb,
  p_reviewed_filters jsonb default '{}'::jsonb,
  p_template_key text default null,
  p_template_version integer default null,
  p_rendered_subject text default null,
  p_rendered_body text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_batch_id uuid;
  v_target_id uuid;
  v_target jsonb;
  v_ordinal integer;
  v_count integer;
  v_is_correspondence boolean;
  v_template_id uuid;
  v_eligible boolean;
  v_existing_batch_id uuid;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can create operational batches' using errcode = '42501';
  end if;

  select id into v_existing_batch_id
  from public.admissions_operational_batches
  where request_key = p_request_key;

  if v_existing_batch_id is not null then
    return v_existing_batch_id;
  end if;

  if p_workspace = 'new_students' and p_action not in (
    'invite_application', 'send_reminder', 'send_general_communication',
    'close_abandoned', 'lapse_offer', 'lapse_registration'
  ) then
    raise exception 'This action is not valid in the new-student workspace';
  end if;

  if p_workspace = 'returning_students' and p_action not in (
    'contact_returning_student', 'send_reminder', 'send_general_communication',
    'confirm_returning_selection', 'resolve_returning_no_response'
  ) then
    raise exception 'This action is not valid in the returning-student workspace';
  end if;

  if jsonb_typeof(coalesce(p_reviewed_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'Reviewed filters must be a JSON object';
  end if;

  if jsonb_typeof(p_targets) <> 'array' then
    raise exception 'Batch targets must be a JSON array';
  end if;

  v_count := jsonb_array_length(p_targets);
  if v_count < 1 or v_count > 500 then
    raise exception 'Operational batches require between 1 and 500 reviewed targets';
  end if;

  if p_scope = 'one' and v_count <> 1 then
    raise exception 'One-record scope requires exactly one reviewed target';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_targets) target
    where jsonb_typeof(target) <> 'object'
      or nullif(trim(target->>'entity_type'), '') is null
      or nullif(target->>'entity_id', '') is null
      or (target->>'entity_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(target->'eligible') is distinct from 'boolean'
  ) then
    raise exception 'Every batch target requires an entity type, UUID entity ID, and eligible boolean';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_targets) target
    group by target->>'entity_type', target->>'entity_id'
    having count(*) > 1
  ) then
    raise exception 'A reviewed target may appear only once in a batch';
  end if;

  if p_workspace = 'new_students' and exists (
    select 1
    from jsonb_array_elements(p_targets) target
    left join public.admission_leads lead
      on lead.id = (target->>'entity_id')::uuid
    where target->>'entity_type' <> 'admission_lead'
      or lead.id is null
      or (
        nullif(target->>'person_id', '') is not null
        and lead.person_id is distinct from (target->>'person_id')::uuid
      )
  ) then
    raise exception 'New-student batch targets must match admission records and their linked people';
  end if;

  if p_workspace = 'returning_students' and exists (
    select 1
    from jsonb_array_elements(p_targets) target
    left join public.returning_student_cycle_participants participant
      on participant.id = (target->>'entity_id')::uuid
    where target->>'entity_type' <> 'returning_student_cycle_participant'
      or participant.id is null
      or (
        nullif(target->>'person_id', '') is not null
        and participant.person_id is distinct from (target->>'person_id')::uuid
      )
      or (
        (target->>'eligible')::boolean
        and nullif(target->'source_snapshot'->>'student_id', '')::uuid is distinct from participant.student_id
      )
  ) then
    raise exception 'Returning-student batch targets must match cycle participants, people, and students';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_targets) target
    where (target->>'eligible')::boolean = false
      and nullif(trim(target->>'exclusion_reason'), '') is null
  ) then
    raise exception 'Every excluded target requires a plain-language reason';
  end if;

  v_is_correspondence := p_action in (
    'invite_application', 'send_reminder', 'send_general_communication', 'contact_returning_student'
  );

  if v_is_correspondence then
    if nullif(trim(coalesce(p_template_key, '')), '') is null
      or p_template_version is null
      or p_template_version < 1
      or nullif(trim(coalesce(p_rendered_subject, '')), '') is null
      or nullif(trim(coalesce(p_rendered_body, '')), '') is null then
      raise exception 'Correspondence batches require a template version and reviewed subject/body snapshots';
    end if;

    select id into v_template_id
    from public.correspondence_templates
    where template_key = p_template_key
      and version = p_template_version
      and channel = 'email'
    limit 1;

    if v_template_id is null then
      raise exception 'The selected correspondence template version was not found';
    end if;

    if p_action = 'invite_application' and p_template_key <> 'application_invitation' then
      raise exception 'Application invitations require the application invitation template';
    end if;

    if p_action = 'contact_returning_student' and p_template_key <> 'module_preference_window_opened' then
      raise exception 'Returning-student contact requires the returning access template';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_targets) target
      where (target->>'eligible')::boolean
        and (
          nullif(target->>'person_id', '') is null
          or nullif(trim(target->>'recipient_email'), '') is null
          or position('@' in target->>'recipient_email') = 0
        )
    ) then
      raise exception 'Eligible correspondence targets require a person and valid recipient address';
    end if;
  elsif p_template_key is not null
    or p_template_version is not null
    or p_rendered_subject is not null
    or p_rendered_body is not null then
    raise exception 'Non-correspondence batches cannot include message snapshots';
  end if;

  insert into public.admissions_operational_batches (
    request_key,
    workspace,
    action,
    scope,
    initiated_by_user_id,
    reviewed_filters,
    reviewed_count,
    correspondence_template_id,
    correspondence_template_key,
    correspondence_template_version,
    rendered_subject,
    rendered_body
  )
  values (
    p_request_key,
    p_workspace,
    p_action,
    p_scope,
    v_actor_user_id,
    coalesce(p_reviewed_filters, '{}'::jsonb),
    v_count,
    v_template_id,
    p_template_key,
    p_template_version,
    p_rendered_subject,
    p_rendered_body
  )
  returning id into v_batch_id;

  for v_target, v_ordinal in
    select value, ordinality::integer
    from jsonb_array_elements(p_targets) with ordinality
  loop
    v_eligible := (v_target->>'eligible')::boolean;

    insert into public.admissions_operational_batch_targets (
      batch_id,
      ordinal,
      entity_type,
      entity_id,
      person_id,
      recipient_email,
      recipient_name,
      status,
      exclusion_reason,
      source_snapshot,
      completed_at
    )
    values (
      v_batch_id,
      v_ordinal,
      trim(v_target->>'entity_type'),
      (v_target->>'entity_id')::uuid,
      nullif(v_target->>'person_id', '')::uuid,
      lower(nullif(trim(v_target->>'recipient_email'), '')),
      nullif(trim(v_target->>'recipient_name'), ''),
      case
        when v_eligible then 'queued'::public.admissions_operational_target_status
        else 'excluded'::public.admissions_operational_target_status
      end,
      case when v_eligible then null else left(trim(v_target->>'exclusion_reason'), 2000) end,
      coalesce(v_target->'source_snapshot', '{}'::jsonb),
      case when v_eligible then null else now() end
    )
    returning id into v_target_id;

    if v_is_correspondence and v_eligible then
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
        rendered_body,
        delivery_status,
        metadata,
        created_by_user_id,
        operational_batch_id,
        operational_batch_target_id,
        attempt_number
      )
      values (
        (v_target->>'person_id')::uuid,
        lower(trim(v_target->>'recipient_email')),
        nullif(trim(v_target->>'recipient_name'), ''),
        trim(v_target->>'entity_type'),
        (v_target->>'entity_id')::uuid,
        v_template_id,
        p_template_key,
        p_template_version,
        'email',
        trim(p_rendered_subject),
        p_rendered_body,
        'queued',
        coalesce(v_target->'source_snapshot', '{}'::jsonb) ||
        case
          when p_workspace = 'new_students' then jsonb_build_object('admission_lead_id', v_target->>'entity_id')
          else jsonb_build_object('student_id', v_target->'source_snapshot'->>'student_id')
        end || jsonb_build_object(
          'operational_batch_id', v_batch_id,
          'operational_batch_target_id', v_target_id
        ),
        v_actor_user_id,
        v_batch_id,
        v_target_id,
        1
      );
    end if;
  end loop;

  update public.admissions_operational_batches batch
  set
    queued_count = counts.queued_count,
    excluded_count = counts.excluded_count,
    status = case
      when counts.queued_count = 0 then 'completed'::public.admissions_operational_batch_status
      else 'queued'::public.admissions_operational_batch_status
    end,
    completed_at = case when counts.queued_count = 0 then now() else null end,
    last_progress_at = now()
  from (
    select
      count(*) filter (where status = 'queued')::integer as queued_count,
      count(*) filter (where status = 'excluded')::integer as excluded_count
    from public.admissions_operational_batch_targets
    where batch_id = v_batch_id
  ) counts
  where batch.id = v_batch_id;

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    'staff', v_actor_user_id, 'admissions_operational_batch.created',
    'admissions_operational_batch', v_batch_id,
    jsonb_build_object(
      'workspace', p_workspace,
      'batch_action', p_action,
      'scope', p_scope,
      'reviewed_count', v_count,
      'request_key', p_request_key
    )
  );

  return v_batch_id;
end;
$$;

create or replace function public.claim_admissions_operational_batch_targets(
  p_batch_id uuid,
  p_limit integer default 25
)
returns table (
  target_id uuid,
  workspace public.admissions_workspace,
  batch_action public.admissions_operational_action,
  entity_type text,
  entity_id uuid,
  person_id uuid,
  recipient_email text,
  source_snapshot jsonb,
  correspondence_log_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can claim operational batch targets' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.admissions_operational_batches
    where id = p_batch_id and status in ('queued', 'running')
  ) then
    raise exception 'Operational batch is not available for execution';
  end if;

  update public.admissions_operational_batches
  set
    status = 'running',
    started_at = coalesce(started_at, now()),
    last_progress_at = now()
  where id = p_batch_id;

  return query
  with claimable as (
    select target.id
    from public.admissions_operational_batch_targets target
    where target.batch_id = p_batch_id
      and target.status = 'queued'
    order by target.ordinal
    for update skip locked
    limit v_limit
  ), claimed as (
    update public.admissions_operational_batch_targets target
    set
      status = 'running',
      attempt_count = target.attempt_count + 1,
      started_at = coalesce(target.started_at, now()),
      last_progress_at = now()
    from claimable
    where target.id = claimable.id
    returning target.*
  )
  select
    claimed.id,
    batch.workspace,
    batch.action,
    claimed.entity_type,
    claimed.entity_id,
    claimed.person_id,
    claimed.recipient_email,
    claimed.source_snapshot,
    correspondence.id
  from claimed
  join public.admissions_operational_batches batch on batch.id = claimed.batch_id
  left join public.correspondence_logs correspondence
    on correspondence.operational_batch_target_id = claimed.id
   and correspondence.attempt_number = 1
  order by claimed.ordinal;

  update public.admissions_operational_batches batch
  set
    queued_count = counts.queued_count,
    running_count = counts.running_count,
    last_progress_at = now()
  from (
    select
      count(*) filter (where status = 'queued')::integer as queued_count,
      count(*) filter (where status = 'running')::integer as running_count
    from public.admissions_operational_batch_targets
    where batch_id = p_batch_id
  ) counts
  where batch.id = p_batch_id;
end;
$$;

create or replace function public.finish_admissions_operational_batch_target(
  p_target_id uuid,
  p_status public.admissions_operational_target_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_target public.admissions_operational_batch_targets%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 2000), '');
  v_remaining integer;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can finish operational batch targets' using errcode = '42501';
  end if;

  if p_status not in ('succeeded', 'failed', 'excluded') then
    raise exception 'A target may finish only as succeeded, failed, or excluded';
  end if;

  if p_status in ('failed', 'excluded') and v_reason is null then
    raise exception 'Failed or excluded targets require a plain-language reason';
  end if;

  select * into v_target
  from public.admissions_operational_batch_targets
  where id = p_target_id
  for update;

  if not found then
    raise exception 'Operational batch target was not found';
  end if;

  if v_target.status in ('succeeded', 'failed', 'excluded') then
    if v_target.status = p_status then
      return;
    end if;
    raise exception 'A completed operational batch target cannot change outcome';
  end if;

  if v_target.status <> 'running' then
    raise exception 'Operational batch target must be claimed before it can finish';
  end if;

  update public.admissions_operational_batch_targets
  set
    status = p_status,
    exclusion_reason = case when p_status = 'excluded' then v_reason else null end,
    failure_reason = case when p_status = 'failed' then v_reason else null end,
    completed_at = now(),
    last_progress_at = now()
  where id = p_target_id;

  select count(*) into v_remaining
  from public.admissions_operational_batch_targets
  where batch_id = v_target.batch_id
    and status in ('queued', 'running');

  update public.admissions_operational_batches batch
  set
    queued_count = counts.queued_count,
    running_count = counts.running_count,
    succeeded_count = counts.succeeded_count,
    failed_count = counts.failed_count,
    excluded_count = counts.excluded_count,
    status = case
      when v_remaining = 0 then 'completed'::public.admissions_operational_batch_status
      else 'running'::public.admissions_operational_batch_status
    end,
    completed_at = case when v_remaining = 0 then now() else null end,
    last_progress_at = now()
  from (
    select
      count(*) filter (where status = 'queued')::integer as queued_count,
      count(*) filter (where status = 'running')::integer as running_count,
      count(*) filter (where status = 'succeeded')::integer as succeeded_count,
      count(*) filter (where status = 'failed')::integer as failed_count,
      count(*) filter (where status = 'excluded')::integer as excluded_count
    from public.admissions_operational_batch_targets
    where batch_id = v_target.batch_id
  ) counts
  where batch.id = v_target.batch_id;
end;
$$;

create or replace function public.retry_failed_admissions_operational_batch(
  p_batch_id uuid,
  p_request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_original public.admissions_operational_batches%rowtype;
  v_retry_batch_id uuid;
  v_existing_batch_id uuid;
  v_target record;
  v_retry_target_id uuid;
  v_failed_count integer;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can retry operational batches' using errcode = '42501';
  end if;

  select id into v_existing_batch_id
  from public.admissions_operational_batches
  where request_key = p_request_key;

  if v_existing_batch_id is not null then
    return v_existing_batch_id;
  end if;

  select * into v_original
  from public.admissions_operational_batches
  where id = p_batch_id
  for update;

  if not found or v_original.status <> 'completed' then
    raise exception 'Only a completed operational batch can be retried';
  end if;

  select count(*) into v_failed_count
  from public.admissions_operational_batch_targets
  where batch_id = p_batch_id and status = 'failed';

  if v_failed_count = 0 then
    raise exception 'The operational batch has no failed targets to retry';
  end if;

  insert into public.admissions_operational_batches (
    request_key,
    workspace,
    action,
    scope,
    initiated_by_user_id,
    reviewed_filters,
    reviewed_count,
    correspondence_template_id,
    correspondence_template_key,
    correspondence_template_version,
    rendered_subject,
    rendered_body,
    retry_of_batch_id,
    root_batch_id,
    queued_count
  )
  values (
    p_request_key,
    v_original.workspace,
    v_original.action,
    'selected',
    v_actor_user_id,
    v_original.reviewed_filters,
    v_failed_count,
    v_original.correspondence_template_id,
    v_original.correspondence_template_key,
    v_original.correspondence_template_version,
    v_original.rendered_subject,
    v_original.rendered_body,
    v_original.id,
    coalesce(v_original.root_batch_id, v_original.id),
    v_failed_count
  )
  returning id into v_retry_batch_id;

  for v_target in
    select
      target.*,
      row_number() over (order by target.ordinal)::integer as retry_ordinal
    from public.admissions_operational_batch_targets target
    where target.batch_id = p_batch_id
      and target.status = 'failed'
    order by target.ordinal
  loop
    insert into public.admissions_operational_batch_targets (
      batch_id,
      ordinal,
      entity_type,
      entity_id,
      person_id,
      recipient_email,
      recipient_name,
      source_snapshot
    )
    values (
      v_retry_batch_id,
      v_target.retry_ordinal,
      v_target.entity_type,
      v_target.entity_id,
      v_target.person_id,
      v_target.recipient_email,
      v_target.recipient_name,
      v_target.source_snapshot || jsonb_build_object(
        'retry_of_batch_id', p_batch_id,
        'retry_of_target_id', v_target.id
      )
    )
    returning id into v_retry_target_id;

    if v_original.correspondence_template_key is not null then
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
        rendered_body,
        delivery_status,
        metadata,
        created_by_user_id,
        operational_batch_id,
        operational_batch_target_id,
        attempt_number
      )
      values (
        v_target.person_id,
        v_target.recipient_email,
        v_target.recipient_name,
        v_target.entity_type,
        v_target.entity_id,
        v_original.correspondence_template_id,
        v_original.correspondence_template_key,
        v_original.correspondence_template_version,
        'email',
        v_original.rendered_subject,
        v_original.rendered_body,
        'queued',
        v_target.source_snapshot || jsonb_build_object(
          'operational_batch_id', v_retry_batch_id,
          'operational_batch_target_id', v_retry_target_id,
          'retry_of_batch_id', p_batch_id,
          'retry_of_target_id', v_target.id
        ),
        v_actor_user_id,
        v_retry_batch_id,
        v_retry_target_id,
        v_target.attempt_count + 1
      );
    end if;
  end loop;

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    'staff', v_actor_user_id, 'admissions_operational_batch.retry_created',
    'admissions_operational_batch', v_retry_batch_id,
    jsonb_build_object(
      'retry_of_batch_id', p_batch_id,
      'root_batch_id', coalesce(v_original.root_batch_id, v_original.id),
      'failed_target_count', v_failed_count,
      'request_key', p_request_key
    )
  );

  return v_retry_batch_id;
end;
$$;

revoke all on table public.admissions_email_test_records from public, authenticated;
revoke all on table public.admissions_operational_batches from public, authenticated;
revoke all on table public.admissions_operational_batch_targets from public, authenticated;

grant select on table public.admissions_email_test_records to authenticated;
grant select on table public.admissions_operational_batches to authenticated;
grant select on table public.admissions_operational_batch_targets to authenticated;

revoke all on function public.mark_fake_admission_lead_for_email_pilot(uuid, text, text) from public;
revoke all on function public.mark_fake_student_for_email_pilot(uuid, text, text) from public;
revoke all on function public.unmark_admissions_email_test_record(uuid, text) from public;
revoke all on function public.create_admissions_operational_batch(
  uuid,
  public.admissions_workspace,
  public.admissions_operational_action,
  public.admissions_action_scope,
  jsonb,
  jsonb,
  text,
  integer,
  text,
  text
) from public;
revoke all on function public.claim_admissions_operational_batch_targets(uuid, integer) from public;
revoke all on function public.finish_admissions_operational_batch_target(
  uuid,
  public.admissions_operational_target_status,
  text
) from public;
revoke all on function public.retry_failed_admissions_operational_batch(uuid, uuid) from public;

grant execute on function public.mark_fake_admission_lead_for_email_pilot(uuid, text, text) to authenticated;
grant execute on function public.mark_fake_student_for_email_pilot(uuid, text, text) to authenticated;
grant execute on function public.unmark_admissions_email_test_record(uuid, text) to authenticated;
grant execute on function public.create_admissions_operational_batch(
  uuid,
  public.admissions_workspace,
  public.admissions_operational_action,
  public.admissions_action_scope,
  jsonb,
  jsonb,
  text,
  integer,
  text,
  text
) to authenticated;
grant execute on function public.claim_admissions_operational_batch_targets(uuid, integer) to authenticated;
grant execute on function public.finish_admissions_operational_batch_target(
  uuid,
  public.admissions_operational_target_status,
  text
) to authenticated;
grant execute on function public.retry_failed_admissions_operational_batch(uuid, uuid) to authenticated;
