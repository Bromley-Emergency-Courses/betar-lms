create function public.student_teaching_plan_ready(enrolment_key uuid, projection jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select (
    (coalesce((projection->>'needs_plan')::boolean,false) is false
      and projection->'plan' is not null and projection->'plan'<>'null'::jsonb)
    or (projection->'historical'->>'protected'='true'
      and exists(select 1 from public.assessment_historical_outcomes where enrolment_id=enrolment_key))
  )
    and (select event.disposition from public.enrolment_disposition_events event
      where event.enrolment_id=enrolment_key order by event.event_order desc limit 1) is null
    and not exists(select 1 from public.assessment_current_arrangements arrangement
      where arrangement.enrolment_id=enrolment_key and arrangement.kind='assessment_deferral' and arrangement.state='active');
$$;

create function public.student_teaching_presentation_pending(enrolment_key uuid, projection jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((projection->>'presentation_pending')::boolean,
    projection->'historical'->>'protected'='true' and exists(
      select 1 from public.active_module_enrolments enrolment
      join public.module_offerings offering on offering.id=enrolment.offering_id
      join public.course_modules module on module.id=offering.module_id
      join public.terms term on term.id=offering.term_id
      where enrolment.id=enrolment_key and module.mode='practical'
        and coalesce(enrolment.presentation_required_override,offering.presentation_required)
        and not exists(select 1 from public.presentation_scores score
          where score.student_id=enrolment.student_id and score.offering_id=offering.id)
        and not exists(select 1 from public.active_module_enrolments prior
          join public.module_offerings prior_offering on prior_offering.id=prior.offering_id
          join public.terms prior_term on prior_term.id=prior_offering.term_id
          join public.presentation_scores score on score.offering_id=prior_offering.id and score.student_id=prior.student_id
          where prior.student_id=enrolment.student_id and prior_offering.module_id=module.id and prior_term.starts_on<term.starts_on
            and case when prior.assessment_plan_id is null then prior.status::text in ('deferred','did_not_complete','failed')
              else public.assessment_evaluate(prior.id)->>'effective_status' in ('Fail','Module deferred','Abandoned') end)
    ), false);
$$;

revoke all on function public.student_teaching_plan_ready(uuid,jsonb), public.student_teaching_presentation_pending(uuid,jsonb)
  from public,anon,authenticated,service_role;

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
    and public.student_teaching_plan_ready(enrolment.id,assessment.projection)
    and assessment.projection->>'effective_status' in ('Planned', 'In progress', 'Fail')
    and assessment.projection->>'disposition' is null
    and not exists(select 1 from jsonb_each(coalesce(assessment.projection->'components', '{}'::jsonb)) component
      where component.value->>'arrangement_kind' = 'assessment_deferral' and component.value->>'arrangement_state' = 'active');
$$;

create or replace function public.student_presentation_offering(student_key uuid, offering_key uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id',offering.id,'moduleId',module.id,'termId',term.id,
    'label',module.code || ' · ' || module.title || ' · ' || term.name,
    'token',case when event.id is null then public.student_teaching_offering(student_key,offering_key)->>'token'
      else md5((to_jsonb(enrolment) || jsonb_build_object('offering',to_jsonb(offering),'module',to_jsonb(module),
        'term',to_jsonb(term),'student_status',student.status,'assessment',assessment.projection,'event',to_jsonb(event)))::text) end,
    'event',case when event.id is not null then jsonb_build_object('id',event.id,'date',event.occurred_on,
      'presentationType',event.presentation_type,'durationMinutes',event.duration_minutes) end,
    'ownScore',(select jsonb_build_object('id',score.id,'revision',score.revision,'scores',score.scores,
      'timePenalty',score.time_penalty,'totalScore',score.total_score,'comments',score.comments,
      'requiresReview',coalesce(public.presentation_rubric_subtotal(score.scores)-score.time_penalty<>score.total_score,true))
      from public.presentation_scores score where score.event_id=event.id and score.staff_user_id=auth.uid()))
  from public.active_module_enrolments enrolment
  join public.module_offerings offering on offering.id=enrolment.offering_id
  join public.course_modules module on module.id=offering.module_id
  join public.terms term on term.id=offering.term_id
  join public.students student on student.id=enrolment.student_id
  left join public.presentation_events event on event.enrolment_id=enrolment.id
  cross join lateral (select public.assessment_evaluate(enrolment.id) as projection) assessment
  where enrolment.student_id=student_key and offering.id=offering_key
    and student.status='active' and module.active and term.status='active'
    and public.student_teaching_plan_ready(enrolment.id,assessment.projection)
    and assessment.projection->>'disposition' is null
    and not exists(select 1 from jsonb_each(coalesce(assessment.projection->'components','{}'::jsonb)) component
      where component.value->>'arrangement_kind'='assessment_deferral' and component.value->>'arrangement_state'='active')
    and (assessment.projection->>'effective_status' in ('Planned','In progress','Fail')
      or (event.id is not null and assessment.projection->>'effective_status'='Pass'))
    and not exists(select 1 from public.presentation_scores score where score.student_id=student_key
      and score.offering_id=offering_key and score.event_id is null)
    and (event.id is not null or not coalesce(enrolment.presentation_required_override,offering.presentation_required)
      or public.student_teaching_presentation_pending(enrolment.id,assessment.projection));
$$;

create or replace function public.student_teaching_plan_options(student_key uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with eligible as (
    select enrolment.id, option.value,
      public.student_teaching_presentation_pending(enrolment.id,public.assessment_evaluate(enrolment.id))
        and not exists(select 1 from public.presentation_scores score where score.student_id=student_key and score.offering_id=enrolment.offering_id) as can_present
    from public.active_module_enrolments enrolment
    cross join lateral (select public.student_teaching_offering(student_key,enrolment.offering_id) value) option
    where enrolment.student_id=student_key and option.value is not null
  ), payload as (
    select jsonb_build_object('offerings',coalesce((select jsonb_agg(value || jsonb_build_object('canPresent',can_present,
      'plannedSessionId',(select session_id from public.presentation_plans where enrolment_id=eligible.id),
      'planRevision',coalesce((select revision from public.presentation_plans where enrolment_id=eligible.id),0)) order by value->>'id') from eligible),'[]'::jsonb),
      'sessions',coalesce((select jsonb_agg(session.value order by session.value->>'id')
        from jsonb_array_elements(public.read_student_attendance(student_key)) session(value)
        where exists(select 1 from eligible where eligible.value->>'termId'=session.value->>'termId')),'[]'::jsonb)) value
  ) select value || jsonb_build_object('token',md5(value::text)) from payload;
$$;
