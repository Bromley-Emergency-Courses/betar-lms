alter table public.terms
  add column if not exists application_deadline_at timestamptz;

alter table public.terms
  drop constraint if exists terms_application_deadline_before_start_check;

alter table public.terms
  add constraint terms_application_deadline_before_start_check check (
    application_deadline_at is null
    or application_deadline_at < (starts_on::timestamp at time zone 'Europe/London')
  );

insert into public.correspondence_templates (
  template_key,
  version,
  channel,
  description,
  subject_template,
  body_template
)
values (
  'application_submission_reminder',
  1,
  'email',
  'Reminds an invited applicant that their application has not been submitted.',
  'Reminder to complete your BETAR application',
  'Applicant receives the cohort deadline and the stable application sign-in page.'
)
on conflict (template_key, channel, version) do nothing;

create or replace function public.set_published_term_application_deadline(
  p_deadline_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_term public.terms%rowtype;
  v_deadline_at timestamptz;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can set the application deadline'
      using errcode = '42501';
  end if;

  if p_deadline_date is null then
    raise exception 'An application deadline date is required';
  end if;

  select * into v_term
  from public.terms
  where status = 'published'
  for update;

  if not found then
    raise exception 'A published target term is required before setting the application deadline';
  end if;

  if p_deadline_date >= v_term.starts_on then
    raise exception 'The application deadline must be before the target term starts';
  end if;

  v_deadline_at := ((p_deadline_date + 1)::timestamp at time zone 'Europe/London') - interval '1 millisecond';

  update public.terms
  set application_deadline_at = v_deadline_at,
      updated_at = now()
  where id = v_term.id;

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
    'new_student_application_deadline.updated',
    'term',
    v_term.id,
    jsonb_build_object(
      'previous_deadline_at', v_term.application_deadline_at,
      'application_deadline_at', v_deadline_at,
      'deadline_date', p_deadline_date,
      'timezone', 'Europe/London'
    )
  );

  return jsonb_build_object(
    'term_id', v_term.id,
    'term_name', v_term.name,
    'application_deadline_at', v_deadline_at
  );
end;
$$;

revoke all on function public.set_published_term_application_deadline(date) from public;
grant execute on function public.set_published_term_application_deadline(date) to authenticated;

create or replace function public.enforce_new_student_application_deadline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deadline_at timestamptz;
begin
  if old.status = 'draft' and new.status = 'submitted' then
    select term.application_deadline_at
    into v_deadline_at
    from public.terms term
    where term.id = new.intended_start_term_id;

    if v_deadline_at is null then
      raise exception 'The application deadline has not been configured for this intake';
    end if;

    if now() > v_deadline_at then
      raise exception 'The application submission deadline has passed';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_new_student_application_deadline() from public;

drop trigger if exists enforce_new_student_application_deadline on public.applications;
create trigger enforce_new_student_application_deadline
before update of status on public.applications
for each row execute function public.enforce_new_student_application_deadline();

create or replace function public.prevent_application_invitation_outside_deadline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deadline_at timestamptz;
begin
  select term.application_deadline_at
  into v_deadline_at
  from public.terms term
  where term.status = 'published';

  if v_deadline_at is null then
    raise exception 'Set the published target term application deadline before inviting applicants';
  end if;

  if now() > v_deadline_at then
    raise exception 'The application deadline has passed; extend it before inviting applicants';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_application_invitation_outside_deadline() from public;

drop trigger if exists prevent_application_invitation_outside_deadline on public.application_invitations;
create trigger prevent_application_invitation_outside_deadline
before insert on public.application_invitations
for each row execute function public.prevent_application_invitation_outside_deadline();

create or replace view public.staff_new_student_admissions_operations
with (security_invoker = true)
as
select
  work_item.*,
  trim(concat_ws(' ', work_item.first_name, work_item.last_name)) as applicant_name,
  lower(concat_ws(' ', work_item.first_name, work_item.last_name, work_item.email, work_item.admission_lead_id::text)) as search_text,
  (
    coalesce(cardinality(work_item.attention_indicators), 0) > 0
    or duplicate_record.admission_lead_id is not null
    or (
      work_item.journey_stage = 'application'
      and work_item.application_status is distinct from 'submitted'
      and target_term.application_deadline_at < now()
    )
  ) as needs_staff_attention,
  (
    duplicate_record.admission_lead_id is null
    and work_item.primary_next_action in (
      'record_decision',
      'review_application',
      'resolve_information_request',
      'reissue_offer',
      'lapse_offer',
      'reopen_registration',
      'convert_registration'
    )
  ) as is_ready_to_progress,
  (
    duplicate_record.admission_lead_id is null
    and work_item.primary_next_action in (
      'await_application_submission',
      'await_offer_response',
      'await_registration'
    )
  ) as is_awaiting_applicant,
  case
    when duplicate_record.admission_lead_id is not null then 'duplicate_email'
    when work_item.journey_stage = 'application'
      and work_item.application_status is distinct from 'submitted'
      and target_term.application_deadline_at < now()
      then 'application_overdue'
    else work_item.attention_indicators[1]
  end as leading_attention_indicator,
  duplicate_record.admission_lead_id as duplicate_open_admission_lead_id,
  duplicate_record.applicant_name as duplicate_open_applicant_name,
  duplicate_record.journey_stage::text as duplicate_open_journey_stage,
  duplicate_record.admission_lead_id is not null as has_open_email_duplicate,
  target_term.id as application_target_term_id,
  target_term.name as application_target_term_name,
  target_term.application_deadline_at,
  case
    when work_item.application_status = 'submitted' then 'submitted'
    when work_item.journey_stage not in ('enquiry', 'application') then 'not_applicable'
    when target_term.application_deadline_at is null then 'not_configured'
    when target_term.application_deadline_at < now() then 'overdue'
    else 'due'
  end as application_deadline_state,
  (
    work_item.journey_stage = 'application'
    and work_item.application_status is distinct from 'submitted'
    and work_item.person_id is not null
    and target_term.application_deadline_at is not null
    and duplicate_record.admission_lead_id is null
    and not work_item.has_data_inconsistency
  ) as application_reminder_eligible
from public.staff_new_student_admissions_work_items work_item
left join lateral (
  select
    earlier.admission_lead_id,
    trim(concat_ws(' ', earlier.first_name, earlier.last_name)) as applicant_name,
    earlier.journey_stage
  from public.staff_new_student_admissions_work_items earlier
  where work_item.journey_stage not in ('closed', 'complete')
    and earlier.journey_stage not in ('closed', 'complete')
    and earlier.admission_lead_id <> work_item.admission_lead_id
    and lower(trim(earlier.email)) = lower(trim(work_item.email))
    and (
      earlier.created_at < work_item.created_at
      or (
        earlier.created_at = work_item.created_at
        and earlier.admission_lead_id < work_item.admission_lead_id
      )
    )
  order by earlier.created_at, earlier.admission_lead_id
  limit 1
) duplicate_record on true
left join lateral (
  select term.id, term.name, term.application_deadline_at
  from public.terms term
  where term.id = work_item.target_term_id
    or (work_item.target_term_id is null and term.status = 'published')
  order by (term.id = work_item.target_term_id) desc, term.starts_on
  limit 1
) target_term on true;

revoke all on table public.staff_new_student_admissions_operations from public;
grant select on table public.staff_new_student_admissions_operations to authenticated;

create or replace function public.retry_failed_reviewed_admissions_operational_batch(
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
  v_retry_batch_id uuid;
  v_original public.admissions_operational_batches%rowtype;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can retry reviewed operational batches' using errcode = '42501';
  end if;

  select * into v_original
  from public.admissions_operational_batches
  where id = p_batch_id;
  if not found
    or v_original.workspace <> 'new_students'
    or v_original.action not in ('invite_application', 'send_reminder', 'close_abandoned') then
    raise exception 'This batch action is not available in the current reviewed executor';
  end if;

  v_retry_batch_id := public.retry_failed_admissions_operational_batch(p_batch_id, p_request_key);
  update public.admissions_operational_batches retry
  set action_reason = original.action_reason
  from public.admissions_operational_batches original
  where retry.id = v_retry_batch_id and original.id = p_batch_id;
  return v_retry_batch_id;
end;
$$;

revoke all on function public.retry_failed_reviewed_admissions_operational_batch(uuid, uuid) from public;
grant execute on function public.retry_failed_reviewed_admissions_operational_batch(uuid, uuid) to authenticated;
