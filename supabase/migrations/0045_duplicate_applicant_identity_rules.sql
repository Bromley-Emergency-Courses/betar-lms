create index if not exists admission_leads_normalized_email_created_idx
  on public.admission_leads (lower(trim(email)), created_at, id);

create or replace function public.is_open_new_student_admission(
  p_admission_lead_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admission_leads lead
    where lead.id = p_admission_lead_id
      and not lead.archived
      and lead.converted_student_id is null
      and lead.stage::text not in (
        'rejected',
        'offer_declined',
        'registered',
        'abandoned',
        'withdrawn',
        'archived'
      )
      and not exists (
        select 1
        from public.admission_abandonment_periods period
        where period.admission_lead_id = lead.id
          and period.reopened_at is null
      )
  );
$$;

revoke all on function public.is_open_new_student_admission(uuid) from public;
grant execute on function public.is_open_new_student_admission(uuid) to authenticated;

create or replace function public.resolve_historical_admissions_person(
  p_normalized_email text,
  p_first_name text,
  p_last_name text,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_historical_lead_id uuid;
  v_person_id uuid;
begin
  if exists (
    select 1
    from public.admission_leads lead
    where lower(trim(lead.email)) = p_normalized_email
      and public.is_open_new_student_admission(lead.id)
  ) then
    return null;
  end if;

  select lead.id
  into v_historical_lead_id
  from public.admission_leads lead
  where lower(trim(lead.email)) = p_normalized_email
    and not public.is_open_new_student_admission(lead.id)
  order by lead.created_at desc, lead.id desc
  limit 1;

  if v_historical_lead_id is null then
    return null;
  end if;

  select lead.person_id
  into v_person_id
  from public.admission_leads lead
  where lower(trim(lead.email)) = p_normalized_email
    and not public.is_open_new_student_admission(lead.id)
    and lead.person_id is not null
  order by lead.created_at desc, lead.id desc
  limit 1;

  if v_person_id is null then
    insert into public.persons (first_name, last_name, email, phone)
    values (p_first_name, p_last_name, p_normalized_email, p_phone)
    returning id into v_person_id;
  end if;

  update public.admission_leads lead
  set person_id = v_person_id
  where lower(trim(lead.email)) = p_normalized_email
    and not public.is_open_new_student_admission(lead.id)
    and lead.person_id is null;

  return v_person_id;
end;
$$;

revoke all on function public.resolve_historical_admissions_person(text, text, text, text) from public;

create or replace function public.submit_public_admission_enquiry(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text default null,
  p_programme text default 'pgcert',
  p_module_interest_ids uuid[] default '{}'::uuid[],
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text := nullif(trim(p_first_name), '');
  v_last_name text := nullif(trim(p_last_name), '');
  v_email text := lower(nullif(trim(p_email), ''));
  v_phone text := nullif(left(trim(coalesce(p_phone, '')), 40), '');
  v_programme text := coalesce(nullif(trim(p_programme), ''), 'pgcert');
  v_module_interest_ids uuid[] := coalesce(p_module_interest_ids, '{}'::uuid[]);
  v_notes text := nullif(left(trim(coalesce(p_notes, '')), 2000), '');
  v_person_id uuid;
  v_lead_id uuid;
begin
  if v_first_name is null or length(v_first_name) > 80 then
    raise exception 'First name is required and must be 80 characters or fewer';
  end if;

  if v_last_name is null or length(v_last_name) > 80 then
    raise exception 'Last name is required and must be 80 characters or fewer';
  end if;

  if v_email is null or length(v_email) > 254 or v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'A valid email address is required';
  end if;

  if v_programme not in ('pgcert', 'microcredential') then
    raise exception 'Programme must be pgcert or microcredential';
  end if;

  if cardinality(v_module_interest_ids) > 20 then
    raise exception 'Too many module interests supplied';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_email, 0));
  v_person_id := public.resolve_historical_admissions_person(
    v_email,
    v_first_name,
    v_last_name,
    v_phone
  );

  insert into public.admission_leads (
    person_id,
    first_name,
    last_name,
    email,
    phone,
    stage,
    programme,
    module_interest_ids,
    source,
    notes
  )
  values (
    v_person_id,
    v_first_name,
    v_last_name,
    v_email,
    v_phone,
    'interest',
    v_programme,
    v_module_interest_ids,
    'public_apply',
    v_notes
  )
  returning id into v_lead_id;

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
    null,
    v_person_id,
    'enquiry.submitted',
    'admission_lead',
    v_lead_id,
    jsonb_build_object(
      'programme', v_programme,
      'module_interest_count', cardinality(v_module_interest_ids),
      'source', 'public_apply',
      'linked_historical_person', v_person_id is not null
    )
  );

  return v_lead_id;
end;
$$;

revoke all on function public.submit_public_admission_enquiry(text, text, text, text, text, uuid[], text) from public;
grant execute on function public.submit_public_admission_enquiry(text, text, text, text, text, uuid[], text) to anon, authenticated;

create or replace function public.record_staff_admission_enquiry(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text default null,
  p_programme text default 'pgcert',
  p_module_interest_ids uuid[] default '{}'::uuid[],
  p_source text default null,
  p_last_contacted_on date default null,
  p_next_action_on date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_first_name text := nullif(left(trim(coalesce(p_first_name, '')), 80), '');
  v_last_name text := nullif(left(trim(coalesce(p_last_name, '')), 80), '');
  v_email text := lower(nullif(left(trim(coalesce(p_email, '')), 254), ''));
  v_phone text := nullif(left(trim(coalesce(p_phone, '')), 40), '');
  v_programme text := coalesce(nullif(trim(p_programme), ''), 'pgcert');
  v_module_interest_ids uuid[] := coalesce(p_module_interest_ids, '{}'::uuid[]);
  v_source text := nullif(left(trim(coalesce(p_source, '')), 120), '');
  v_notes text := nullif(left(trim(coalesce(p_notes, '')), 6000), '');
  v_person_id uuid;
  v_lead_id uuid;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can record staff enquiries'
      using errcode = '42501';
  end if;

  if v_first_name is null or v_last_name is null then
    raise exception 'First name and last name are required';
  end if;

  if v_email is null or v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'A valid email address is required';
  end if;

  if v_programme not in ('pgcert', 'microcredential') then
    raise exception 'Programme must be pgcert or microcredential';
  end if;

  if cardinality(v_module_interest_ids) > 20 or exists (
    select 1
    from unnest(v_module_interest_ids) selected(module_id)
    where not exists (
      select 1
      from public.course_modules
      where course_modules.id = selected.module_id
        and course_modules.active = true
    )
  ) then
    raise exception 'Module interests must contain no more than 20 active course modules';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_email, 0));
  v_person_id := public.resolve_historical_admissions_person(
    v_email,
    v_first_name,
    v_last_name,
    v_phone
  );

  insert into public.admission_leads (
    person_id,
    first_name,
    last_name,
    email,
    phone,
    stage,
    programme,
    module_interest_ids,
    source,
    last_contacted_on,
    next_action_on,
    notes,
    archived
  )
  values (
    v_person_id,
    v_first_name,
    v_last_name,
    v_email,
    v_phone,
    'interest',
    v_programme,
    v_module_interest_ids,
    v_source,
    p_last_contacted_on,
    p_next_action_on,
    v_notes,
    false
  )
  returning id into v_lead_id;

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
    'enquiry.recorded_by_staff',
    'admission_lead',
    v_lead_id,
    jsonb_build_object(
      'programme', v_programme,
      'source', v_source,
      'module_interest_count', cardinality(v_module_interest_ids),
      'has_notes', v_notes is not null,
      'linked_historical_person', v_person_id is not null
    )
  );

  return v_lead_id;
end;
$$;

revoke all on function public.record_staff_admission_enquiry(text, text, text, text, text, uuid[], text, date, date, text) from public;
grant execute on function public.record_staff_admission_enquiry(text, text, text, text, text, uuid[], text, date, date, text) to authenticated;

create or replace function public.prevent_open_duplicate_application_invitation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead public.admission_leads%rowtype;
begin
  select * into v_lead
  from public.admission_leads
  where id = new.admission_lead_id;

  if public.is_open_new_student_admission(v_lead.id) and exists (
    select 1
    from public.admission_leads earlier
    where lower(trim(earlier.email)) = lower(trim(v_lead.email))
      and public.is_open_new_student_admission(earlier.id)
      and (
        earlier.created_at < v_lead.created_at
        or (earlier.created_at = v_lead.created_at and earlier.id < v_lead.id)
      )
  ) then
    raise exception 'This admissions record duplicates an earlier open record and must be abandoned or otherwise resolved before invitation';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_open_duplicate_application_invitation() from public;

drop trigger if exists prevent_open_duplicate_application_invitation on public.application_invitations;
create trigger prevent_open_duplicate_application_invitation
before insert on public.application_invitations
for each row execute function public.prevent_open_duplicate_application_invitation();

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
    else work_item.attention_indicators[1]
  end as leading_attention_indicator,
  duplicate_record.admission_lead_id as duplicate_open_admission_lead_id,
  duplicate_record.applicant_name as duplicate_open_applicant_name,
  duplicate_record.journey_stage::text as duplicate_open_journey_stage,
  duplicate_record.admission_lead_id is not null as has_open_email_duplicate
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
) duplicate_record on true;

revoke all on table public.staff_new_student_admissions_operations from public;
grant select on table public.staff_new_student_admissions_operations to authenticated;
