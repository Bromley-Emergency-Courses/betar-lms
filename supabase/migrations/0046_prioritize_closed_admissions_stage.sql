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
    when coalesce(p_archived, false)
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
