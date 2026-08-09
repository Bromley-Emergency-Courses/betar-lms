create or replace view public.staff_new_student_admissions_operations
with (security_invoker = true)
as
select
  work_item.*,
  trim(concat_ws(' ', work_item.first_name, work_item.last_name)) as applicant_name,
  lower(concat_ws(' ', work_item.first_name, work_item.last_name, work_item.email, work_item.admission_lead_id::text)) as search_text,
  coalesce(cardinality(work_item.attention_indicators), 0) > 0 as needs_staff_attention,
  work_item.primary_next_action in (
    'record_decision',
    'review_application',
    'resolve_information_request',
    'reissue_offer',
    'lapse_offer',
    'reopen_registration',
    'convert_registration'
  ) as is_ready_to_progress,
  work_item.primary_next_action in (
    'await_application_submission',
    'await_offer_response',
    'await_registration'
  ) as is_awaiting_applicant,
  work_item.attention_indicators[1] as leading_attention_indicator
from public.staff_new_student_admissions_work_items work_item;

create or replace view public.staff_returning_student_admissions_operations
with (security_invoker = true)
as
select
  work_item.*,
  student.temporary_id as student_reference,
  student.first_name,
  student.last_name,
  trim(concat_ws(' ', student.first_name, student.last_name)) as student_name,
  cycle.phase as cycle_phase,
  cycle.target_term_id,
  term.name as target_term_name,
  term.starts_on as target_term_starts_on,
  latest_contact.delivery_status as latest_contact_delivery_status,
  latest_contact.recipient_email as latest_contact_recipient_email,
  latest_contact.created_at as latest_contact_attempted_at,
  coalesce(contact_totals.attempt_count, 0) as contact_attempt_count,
  case
    when work_item.membership_state = 'removed' then 'not_contacted'
    when latest_contact.id is null then 'not_contacted'
    when latest_contact.delivery_status = 'queued' then 'queued'
    when latest_contact.delivery_status in ('sent', 'delivered') then 'sent'
    else 'failed'
  end as contact_state,
  case
    when work_item.membership_state = 'removed' then 'removed'
    else 'awaiting_response'
  end as response_state,
  work_item.membership_state = 'included'
    and (work_item.blocking_reason is not null or work_item.has_eligibility_change)
    as needs_staff_attention,
  case
    when work_item.membership_state = 'removed' then 'none'
    when work_item.blocking_reason is not null then 'resolve_eligibility_blocker'
    when cycle.phase = 'setup' then 'review_participant'
    when cycle.phase = 'collecting_responses' and latest_contact.id is null then 'contact_student'
    when cycle.phase = 'collecting_responses' then 'await_response'
    when cycle.phase = 'review_confirmation' then 'resolve_no_response'
    else 'none'
  end as primary_next_action,
  lower(concat_ws(
    ' ',
    student.first_name,
    student.last_name,
    student.temporary_id,
    work_item.current_email,
    work_item.student_id::text
  )) as search_text
from public.returning_student_cycle_participant_work_items work_item
join public.students student on student.id = work_item.student_id
join public.returning_student_cycles cycle on cycle.id = work_item.cycle_id
join public.terms term on term.id = cycle.target_term_id
left join lateral (
  select correspondence.*
  from public.correspondence_logs correspondence
  where correspondence.related_entity_type = 'returning_student_cycle_participant'
    and correspondence.related_entity_id = work_item.participant_id
  order by correspondence.created_at desc, correspondence.id desc
  limit 1
) latest_contact on true
left join lateral (
  select count(*)::integer as attempt_count
  from public.correspondence_logs correspondence
  where correspondence.related_entity_type = 'returning_student_cycle_participant'
    and correspondence.related_entity_id = work_item.participant_id
) contact_totals on true;

revoke all on table public.staff_new_student_admissions_operations from public;
revoke all on table public.staff_returning_student_admissions_operations from public;

grant select on table public.staff_new_student_admissions_operations to authenticated;
grant select on table public.staff_returning_student_admissions_operations to authenticated;
