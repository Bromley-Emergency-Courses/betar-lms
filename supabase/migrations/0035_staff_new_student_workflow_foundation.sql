do $$
begin
  create type public.new_student_journey_stage as enum (
    'enquiry',
    'application',
    'review',
    'offer',
    'registration',
    'complete',
    'closed'
  );
exception
  when duplicate_object then null;
end;
$$;

create or replace function public.derive_new_student_journey_stage(
  p_application_status text,
  p_decision_outcome text,
  p_offer_status text,
  p_registration_status text,
  p_converted_student_id uuid,
  p_application_invited_at timestamptz,
  p_archived boolean
)
returns public.new_student_journey_stage
language sql
immutable
set search_path = public
as $$
  select case
    when p_registration_status = 'complete' or p_converted_student_id is not null
      then 'complete'::public.new_student_journey_stage
    when p_decision_outcome = 'rejection' or p_offer_status in ('declined', 'withdrawn')
      then 'closed'::public.new_student_journey_stage
    when p_registration_status in ('not_started', 'in_progress', 'submitted', 'lapsed')
      or p_offer_status = 'accepted'
      then 'registration'::public.new_student_journey_stage
    when p_offer_status in ('issued', 'lapsed')
      then 'offer'::public.new_student_journey_stage
    when p_application_status = 'submitted'
      then 'review'::public.new_student_journey_stage
    when p_application_status = 'draft' or p_application_invited_at is not null
      then 'application'::public.new_student_journey_stage
    when coalesce(p_archived, false)
      then 'closed'::public.new_student_journey_stage
    else 'enquiry'::public.new_student_journey_stage
  end;
$$;

revoke all on function public.derive_new_student_journey_stage(
  text,
  text,
  text,
  text,
  uuid,
  timestamptz,
  boolean
) from public;

grant execute on function public.derive_new_student_journey_stage(
  text,
  text,
  text,
  text,
  uuid,
  timestamptz,
  boolean
) to authenticated;

create or replace view public.staff_new_student_admissions_work_items
with (security_invoker = true)
as
with workflow_source as (
  select
    lead.id as admission_lead_id,
    lead.person_id,
    lead.first_name,
    lead.last_name,
    lead.email,
    lead.phone,
    lead.programme,
    lead.stage::text as source_lead_stage,
    lead.archived,
    lead.application_invited_at,
    lead.next_action_on,
    lead.converted_student_id as lead_converted_student_id,
    lead.created_at,
    lead.updated_at as lead_updated_at,
    application.id as application_id,
    application.person_id as application_person_id,
    application.status::text as application_status,
    application.intended_start_term_id as application_target_term_id,
    application.submitted_at,
    application.updated_at as application_updated_at,
    review.readiness_status::text as review_readiness_status,
    review.updated_at as review_updated_at,
    decision.id as decision_id,
    decision.outcome::text as decision_outcome,
    decision.decided_at,
    rejection.id as rejection_id,
    offer.id as offer_id,
    offer.status::text as offer_status,
    offer.intended_start_term_id as offer_target_term_id,
    offer.deadline_at as offer_deadline_at,
    offer.converted_student_id as offer_converted_student_id,
    offer.updated_at as offer_updated_at,
    registration.id as registration_id,
    registration.status::text as registration_status,
    registration.intended_start_term_id as registration_target_term_id,
    registration.registration_deadline_at,
    registration.student_id as registration_student_id,
    registration.converted_at as registration_converted_at,
    registration.updated_at as registration_updated_at,
    coalesce(decision_totals.decision_count, 0) as decision_count,
    coalesce(offer_totals.offer_count, 0) as offer_count,
    coalesce(registration_totals.registration_count, 0) as registration_count
  from public.admission_leads lead
  left join public.applications application
    on application.admission_lead_id = lead.id
  left join public.application_reviews review
    on review.application_id = application.id
  left join lateral (
    select candidate.*
    from public.application_decisions candidate
    where candidate.application_id = application.id
    order by candidate.decided_at desc, candidate.id desc
    limit 1
  ) decision on true
  left join lateral (
    select count(*)::integer as decision_count
    from public.application_decisions candidate
    where candidate.application_id = application.id
  ) decision_totals on true
  left join public.application_rejections rejection
    on rejection.decision_id = decision.id
  left join lateral (
    select candidate.*
    from public.application_offers candidate
    where candidate.application_id = application.id
    order by candidate.issued_at desc, candidate.id desc
    limit 1
  ) offer on true
  left join lateral (
    select count(*)::integer as offer_count
    from public.application_offers candidate
    where candidate.application_id = application.id
  ) offer_totals on true
  left join lateral (
    select candidate.*
    from public.admissions_registrations candidate
    where candidate.application_id = application.id
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) registration on true
  left join lateral (
    select count(*)::integer as registration_count
    from public.admissions_registrations candidate
    where candidate.application_id = application.id
  ) registration_totals on true
), projected as (
  select
    workflow_source.*,
    public.derive_new_student_journey_stage(
      application_status,
      decision_outcome,
      offer_status,
      registration_status,
      coalesce(
        registration_student_id,
        offer_converted_student_id,
        lead_converted_student_id
      ),
      application_invited_at,
      archived
    ) as journey_stage,
    coalesce(
      registration_target_term_id,
      offer_target_term_id,
      application_target_term_id
    ) as target_term_id,
    greatest(
      lead_updated_at,
      application_invited_at,
      application_updated_at,
      review_updated_at,
      decided_at,
      offer_updated_at,
      registration_updated_at,
      registration_converted_at
    ) as last_activity_at
  from workflow_source
), checked as (
  select
    projected.*,
    coalesce((
      (application_person_id is not null and person_id is not null and application_person_id <> person_id)
      or decision_count > 1
      or offer_count > 1
      or registration_count > 1
      or (decision_id is not null and application_status is distinct from 'submitted')
      or (decision_outcome = 'offer' and offer_id is null)
      or (decision_outcome = 'rejection' and rejection_id is null)
      or (offer_id is not null and decision_outcome is distinct from 'offer')
      or (registration_id is not null and offer_status is distinct from 'accepted')
      or (registration_status = 'complete' and registration_student_id is null)
      or (
        registration_student_id is not null
        and lead_converted_student_id is not null
        and registration_student_id <> lead_converted_student_id
      )
      or (
        registration_student_id is not null
        and offer_converted_student_id is not null
        and registration_student_id <> offer_converted_student_id
      )
      or (archived and journey_stage not in ('closed', 'complete'))
      or (source_lead_stage = 'reviewed' and application_status is distinct from 'submitted')
      or (
        source_lead_stage = 'offered'
        and offer_status is distinct from 'issued'
        and offer_status is distinct from 'lapsed'
        and offer_status is distinct from 'accepted'
      )
      or (source_lead_stage = 'rejected' and decision_outcome is distinct from 'rejection')
      or (source_lead_stage = 'accepted' and offer_status is distinct from 'accepted')
      or (source_lead_stage = 'registration_in_progress' and registration_id is null)
      or (source_lead_stage = 'registration_lapsed' and registration_status is distinct from 'lapsed')
      or (source_lead_stage = 'registered' and registration_student_id is null)
      or (source_lead_stage = 'offer_declined' and offer_status is distinct from 'declined')
      or (source_lead_stage = 'offer_lapsed' and offer_status is distinct from 'lapsed')
    ), false) as has_data_inconsistency
  from projected
)
select
  admission_lead_id,
  person_id,
  first_name,
  last_name,
  email,
  phone,
  programme,
  source_lead_stage,
  journey_stage,
  target_term_id,
  application_id,
  application_status,
  review_readiness_status,
  decision_outcome,
  offer_id,
  offer_status,
  registration_id,
  registration_status,
  has_data_inconsistency,
  array_remove(array[
    case when has_data_inconsistency then 'data_inconsistency' end,
    case
      when journey_stage = 'review' and review_readiness_status = 'needs_information'
        then 'needs_information'
    end,
    case
      when journey_stage = 'review' and review_readiness_status = 'ready_for_decision'
        then 'ready_for_decision'
    end,
    case
      when journey_stage = 'offer' and offer_status = 'lapsed'
        then 'offer_lapsed'
    end,
    case
      when journey_stage = 'offer'
        and offer_status = 'issued'
        and offer_deadline_at <= now()
        then 'offer_overdue'
    end,
    case
      when journey_stage = 'registration' and registration_status = 'lapsed'
        then 'registration_lapsed'
    end,
    case
      when journey_stage = 'registration'
        and registration_status in ('not_started', 'in_progress', 'submitted')
        and registration_deadline_at <= now()
        then 'registration_overdue'
    end
  ]::text[], null) as attention_indicators,
  case
    when has_data_inconsistency then 'repair_inconsistency'
    when journey_stage = 'enquiry' then 'invite_applicant'
    when journey_stage = 'application' then 'await_application_submission'
    when journey_stage = 'review' and review_readiness_status = 'ready_for_decision' then 'record_decision'
    when journey_stage = 'review' and review_readiness_status = 'needs_information' then 'resolve_information_request'
    when journey_stage = 'review' then 'review_application'
    when journey_stage = 'offer' and offer_status = 'lapsed' then 'reissue_offer'
    when journey_stage = 'offer' and offer_status = 'issued' and offer_deadline_at <= now() then 'lapse_offer'
    when journey_stage = 'offer' then 'await_offer_response'
    when journey_stage = 'registration' and registration_status = 'lapsed' then 'reopen_registration'
    when journey_stage = 'registration' and registration_status = 'submitted' then 'convert_registration'
    when journey_stage = 'registration' then 'await_registration'
    else 'none'
  end as primary_next_action,
  case
    when journey_stage = 'offer' then offer_deadline_at
    when journey_stage = 'registration' then registration_deadline_at
    else null
  end as current_deadline_at,
  last_activity_at,
  created_at
from checked;

revoke all on table public.staff_new_student_admissions_work_items from public;
grant select on table public.staff_new_student_admissions_work_items to authenticated;

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

  insert into public.admission_leads (
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
      'has_notes', v_notes is not null
    )
  );

  return v_lead_id;
end;
$$;

create or replace function public.update_admission_lead_administrative_details(
  p_lead_id uuid,
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
  v_lead public.admission_leads%rowtype;
  v_first_name text := nullif(left(trim(coalesce(p_first_name, '')), 80), '');
  v_last_name text := nullif(left(trim(coalesce(p_last_name, '')), 80), '');
  v_email text := lower(nullif(left(trim(coalesce(p_email, '')), 254), ''));
  v_phone text := nullif(left(trim(coalesce(p_phone, '')), 40), '');
  v_programme text := coalesce(nullif(trim(p_programme), ''), 'pgcert');
  v_module_interest_ids uuid[] := coalesce(p_module_interest_ids, '{}'::uuid[]);
  v_source text := nullif(left(trim(coalesce(p_source, '')), 120), '');
  v_notes text := nullif(left(trim(coalesce(p_notes, '')), 6000), '');
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can update admission details'
      using errcode = '42501';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Admission record was not found'
      using errcode = 'P0002';
  end if;

  if v_lead.archived or v_lead.converted_student_id is not null then
    raise exception 'Archived or complete admission records are read-only';
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

  update public.admission_leads
  set
    first_name = v_first_name,
    last_name = v_last_name,
    email = v_email,
    phone = v_phone,
    programme = v_programme,
    module_interest_ids = v_module_interest_ids,
    source = v_source,
    last_contacted_on = p_last_contacted_on,
    next_action_on = p_next_action_on,
    notes = v_notes
  where id = p_lead_id;

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
    'staff',
    v_actor_user_id,
    v_lead.person_id,
    'admission_lead.administrative_details_updated',
    'admission_lead',
    p_lead_id,
    jsonb_build_object(
      'person_id', v_lead.person_id,
      'programme', v_programme,
      'source', v_source,
      'module_interest_count', cardinality(v_module_interest_ids),
      'has_notes', v_notes is not null,
      'workflow_stage_unchanged', true
    )
  );

  return p_lead_id;
end;
$$;

revoke all on function public.record_staff_admission_enquiry(
  text,
  text,
  text,
  text,
  text,
  uuid[],
  text,
  date,
  date,
  text
) from public;

revoke all on function public.update_admission_lead_administrative_details(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid[],
  text,
  date,
  date,
  text
) from public;

grant execute on function public.record_staff_admission_enquiry(
  text,
  text,
  text,
  text,
  text,
  uuid[],
  text,
  date,
  date,
  text
) to authenticated;

grant execute on function public.update_admission_lead_administrative_details(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid[],
  text,
  date,
  date,
  text
) to authenticated;

-- Workflow transitions remain inside the existing security-definer functions.
-- Authenticated clients may no longer insert, delete, or directly update lead rows.
revoke insert, update, delete on table public.admission_leads from authenticated;
