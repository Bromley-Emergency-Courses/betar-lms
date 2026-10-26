create or replace function public.student_teaching_offering(student_key uuid, offering_key uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', offering.id, 'moduleId', module.id, 'termId', term.id,
    'label', module.code || ' · ' || module.title || ' · ' || term.name,
    'token', md5((to_jsonb(enrolment) || jsonb_build_object('offering', to_jsonb(offering),
      'module', to_jsonb(module), 'term', to_jsonb(term), 'student_status', student.status,
      'assessment', assessment.projection))::text))
  from public.active_module_enrolments enrolment
  join public.module_offerings offering on offering.id = enrolment.offering_id
  join public.course_modules module on module.id = offering.module_id
  join public.terms term on term.id = offering.term_id
  join public.students student on student.id = enrolment.student_id
  cross join lateral (select public.assessment_evaluate(enrolment.id) as projection) assessment
  where enrolment.student_id = student_key and offering.id = offering_key
    and student.status = 'active' and module.active and term.status = 'active'
    and coalesce((assessment.projection->>'needs_plan')::boolean, false) is false
    and assessment.projection->'plan' is not null and assessment.projection->'plan' <> 'null'::jsonb
    and assessment.projection->>'effective_status' in ('Planned', 'In progress', 'Fail')
    and assessment.projection->>'disposition' is null
    and not exists(select 1 from jsonb_each(coalesce(assessment.projection->'components', '{}'::jsonb)) component
      where component.value->>'arrangement_kind' = 'assessment_deferral' and component.value->>'arrangement_state' = 'active');
$$;

revoke all on function public.student_teaching_offering(uuid,uuid) from public, anon, authenticated, service_role;

revoke insert, update, delete, truncate, references, trigger on public.encounter_logs, public.assessment_attempts, public.presentation_scores from public, anon, authenticated;
grant select on public.encounter_logs, public.assessment_attempts, public.presentation_scores to authenticated;
