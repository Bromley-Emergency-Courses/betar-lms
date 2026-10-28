create or replace function public.assessment_evaluate(enrolment_key uuid, evaluation_date date default current_date, plan_override uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  baseline public.assessment_historical_outcomes;
  projection jsonb;
  preserved_status text;
  effective_status text;
  effective_credits integer;
  current_term_in_progress boolean := false;
  decision record;
  decisions jsonb := '[]'::jsonb;
  indicators text[] := '{}';
begin
  projection := public.assessment_evaluate_current_rules(enrolment_key, evaluation_date, plan_override);
  if projection is null then return null; end if;
  select * into baseline from public.assessment_historical_outcomes where enrolment_id = enrolment_key;
  if not found then return projection; end if;
  preserved_status := case baseline.recorded_status when 'completed' then 'Pass' when 'failed' then 'Fail'
    when 'planned' then 'Planned' when 'in_progress' then 'In progress' else 'Historical' end;
  current_term_in_progress := baseline.recorded_status in ('planned','in_progress') and exists(
    select 1 from public.active_module_enrolments enrolment
    join public.module_offerings offering on offering.id = enrolment.offering_id
    join public.course_modules module on module.id = offering.module_id
    join public.terms term on term.id = offering.term_id
    join public.students student on student.id = enrolment.student_id
    where enrolment.id = enrolment_key and student.status = 'active' and module.active
      and term.status = 'active' and evaluation_date between term.starts_on and term.ends_on
  );
  effective_status := case when current_term_in_progress then 'In progress' else preserved_status end;
  effective_credits := baseline.recorded_credits;
  for decision in select * from public.assessment_current_overrides where enrolment_id = enrolment_key and value is not null loop
    decisions := decisions || jsonb_build_array(to_jsonb(decision));
    if decision.kind = 'status' then effective_status := decision.value #>> '{}';
    elsif decision.kind = 'credits' then effective_credits := (decision.value #>> '{}')::integer;
    elsif decision.kind = 'indicator' and decision.value = 'true'::jsonb then indicators := array_append(indicators, decision.indicator);
    end if;
  end loop;
  return projection || jsonb_build_object(
    'historical', jsonb_build_object('protected', true, 'status', baseline.recorded_status, 'credits', baseline.recorded_credits,
      'final_mark', baseline.recorded_final_mark, 'grade', baseline.recorded_grade, 'captured_at', baseline.captured_at,
      'capture_reference', baseline.capture_reference, 'review_flags', '[]'::jsonb, 'current_term_in_progress', current_term_in_progress),
    'calculated_status', 'Historical', 'effective_status', effective_status,
    'calculated_credits', baseline.recorded_credits, 'recommended_credits', baseline.recorded_credits, 'awarded_credits', effective_credits,
    'calculated_indicators', '[]'::jsonb, 'effective_indicators', to_jsonb(indicators), 'overrides', decisions,
    'components', coalesce(projection->'components', '{}'::jsonb),
    'original_term_id', (select offering.term_id from public.enrolments enrolment join public.module_offerings offering on offering.id = enrolment.offering_id where enrolment.id = enrolment_key));
end;
$$;
revoke all on function public.assessment_evaluate(uuid,date,uuid) from public, anon, authenticated, service_role;
