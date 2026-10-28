create function public.assessment_evaluate(enrolment_key uuid, evaluation_date date default current_date, plan_override uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  enrolment_row public.enrolments; plan_row public.module_assessment_plans; offering_row public.module_offerings;
  term_row public.terms; module_row public.course_modules; component_row record; override_row record;
  calculated_status text; effective_status text; disposition text; indicators text[] := '{}'; effective_indicators text[];
  components jsonb := '{}'::jsonb; overrides jsonb := '[]'::jsonb;
  all_pass boolean := true; any_fail boolean := false; deferred boolean := false; evidence boolean := false;
  attendance_required integer := 0; attendance_actual integer := 0; premium integer := 0; prior_practical boolean;
  presentation_pending boolean := false; calculated_credits integer; effective_credits integer; recommended_credits integer;
begin
  select * into strict enrolment_row from public.enrolments where id = enrolment_key;
  select * into plan_row from public.module_assessment_plans where id = coalesce(plan_override, enrolment_row.assessment_plan_id);
  select * into strict offering_row from public.module_offerings where id = enrolment_row.offering_id;
  if plan_row.id is null then return jsonb_build_object('enrolment_id', enrolment_key, 'revision', enrolment_row.assessment_revision, 'needs_plan', true, 'student_id', enrolment_row.student_id, 'module_id', offering_row.module_id); end if;
  select * into strict term_row from public.terms where id = offering_row.term_id;
  select * into strict module_row from public.course_modules where id = offering_row.module_id;
  select event.disposition into disposition from public.enrolment_disposition_events event
    where event.enrolment_id = enrolment_key order by event.event_order desc limit 1;
  for component_row in
    select required.component, attempt.id, attempt.sequence, attempt.ordinal, revision.score, revision.pass_mark, revision.passed,
      revision.id revision_id, revision.revision, attempt.origin,
      (select count(*) from public.module_assessment_attempts counted where counted.enrolment_id = enrolment_key and counted.component = required.component and counted.active) attempt_count,
      arrangement.kind arrangement_kind, arrangement.state arrangement_state, arrangement.note
    from (select 'theory' component union all select 'practical' where plan_row.mode = 'practical') required
    left join lateral (select * from public.module_assessment_attempts candidate
      where candidate.enrolment_id = enrolment_key and candidate.component = required.component and candidate.active
      order by candidate.ordinal desc limit 1) attempt on true
    left join public.assessment_current_revisions revision on revision.attempt_id = attempt.id
    left join public.assessment_current_arrangements arrangement on arrangement.enrolment_id = enrolment_key and arrangement.component = required.component
  loop
    components := components || jsonb_build_object(component_row.component, to_jsonb(component_row));
    all_pass := all_pass and coalesce(component_row.passed, false);
    evidence := evidence or component_row.id is not null or component_row.arrangement_kind is not null;
    if component_row.passed = false then
      any_fail := true;
      indicators := array_append(indicators, component_row.component || ':' || case when component_row.arrangement_kind = 'resit_schedule' and component_row.arrangement_state = 'active' then 'Resit scheduled' else 'Resit required' end);
    end if;
    deferred := deferred or (coalesce(component_row.arrangement_kind = 'assessment_deferral' and component_row.arrangement_state = 'active', false));
  end loop;
  if plan_row.mode = 'practical' and not exists(select 1 from public.students where id = enrolment_row.student_id and status = 'withdrawn') then
    select exists(select 1 from public.enrolments prior
      join public.module_offerings offering on offering.id = prior.offering_id
      join public.course_modules module on module.id = offering.module_id
      join public.terms term on term.id = offering.term_id
      where prior.student_id = enrolment_row.student_id and coalesce((select mode from public.module_assessment_plans where id = prior.assessment_plan_id), module.mode) = 'practical' and term.starts_on < term_row.starts_on
        and coalesce((select event.disposition from public.enrolment_disposition_events event where event.enrolment_id = prior.id order by event.event_order desc limit 1), '') not in ('Abandoned', 'Module deferred')
        and (prior.assessment_plan_id is not null or prior.status::text in ('planned','in_progress','completed','resit'))) into prior_practical;
    select coalesce(sum(case when candidate.assessment_plan_id is null and candidate.status::text = 'resit' then coalesce(candidate.attendance_days_required_override, 0)
      else coalesce(candidate.attendance_days_required_override, offering.attendance_days_required_subsequent_practical) end), 0),
      coalesce(max(case when candidate.attendance_days_required_override is null and candidate.status::text <> 'resit' then greatest(0, offering.attendance_days_required_first_practical - offering.attendance_days_required_subsequent_practical) else 0 end), 0)
      into attendance_required, premium
      from public.enrolments candidate join public.module_offerings offering on offering.id = candidate.offering_id
      join public.course_modules module on module.id = offering.module_id
      where candidate.student_id = enrolment_row.student_id and offering.term_id = term_row.id and coalesce((select mode from public.module_assessment_plans where id = candidate.assessment_plan_id), module.mode) = 'practical'
        and coalesce((select event.disposition from public.enrolment_disposition_events event where event.enrolment_id = candidate.id order by event.event_order desc limit 1), '') not in ('Abandoned', 'Module deferred')
        and (candidate.assessment_plan_id is not null or candidate.status::text in ('planned','in_progress','completed','resit'));
    if not prior_practical then attendance_required := attendance_required + premium; end if;
    select count(distinct session.session_date) into attendance_actual from public.attendance_records record
      join public.attendance_sessions session on session.id = record.session_id
      where record.student_id = enrolment_row.student_id and session.term_id = term_row.id and record.status in ('attended','partial') and session.session_date <= evaluation_date;
    select attendance_actual + coalesce(sum(carried.days), 0) into attendance_actual
      from public.enrolments current_enrolment join public.module_offerings current_offering on current_offering.id = current_enrolment.offering_id
      join public.course_modules current_module on current_module.id = current_offering.module_id
      join public.enrolments prior on prior.student_id = current_enrolment.student_id and prior.id <> current_enrolment.id
      join public.module_offerings prior_offering on prior_offering.id = prior.offering_id and prior_offering.module_id = current_offering.module_id
      join public.terms prior_term on prior_term.id = prior_offering.term_id and prior_term.starts_on < term_row.starts_on
      cross join lateral (select count(distinct session.session_date) days from public.attendance_records record
        join public.attendance_sessions session on session.id = record.session_id
        where record.student_id = enrolment_row.student_id and session.term_id = prior_term.id
          and (session.offering_id is null or session.offering_id = prior_offering.id) and record.status in ('attended','partial')) carried
      where current_enrolment.student_id = enrolment_row.student_id and current_offering.term_id = term_row.id and coalesce((select mode from public.module_assessment_plans where id = current_enrolment.assessment_plan_id), current_module.mode) = 'practical'
        and prior.status::text in ('deferred','did_not_complete','failed');
    presentation_pending := coalesce(enrolment_row.presentation_required_override, offering_row.presentation_required)
      and not exists(select 1 from public.presentation_scores score where score.student_id = enrolment_row.student_id and score.offering_id = offering_row.id and score.occurred_on <= evaluation_date)
      and not exists(select 1 from public.enrolments prior join public.module_offerings prior_offering on prior_offering.id = prior.offering_id
        join public.terms prior_term on prior_term.id = prior_offering.term_id join public.presentation_scores score on score.offering_id = prior_offering.id and score.student_id = prior.student_id
        where prior.student_id = enrolment_row.student_id and prior_offering.module_id = module_row.id and prior_term.starts_on < term_row.starts_on and prior.status::text in ('deferred','did_not_complete','failed'));
    if evaluation_date > term_row.ends_on then
      if attendance_actual < attendance_required then indicators := array_append(indicators, 'Attendance non-compliance'); any_fail := true; end if;
      if presentation_pending then indicators := array_append(indicators, 'Presentation incomplete'); any_fail := true; end if;
    end if;
  end if;
  evidence := evidence or exists(select 1 from public.attendance_records record join public.attendance_sessions session on session.id = record.session_id where record.student_id = enrolment_row.student_id and session.term_id = term_row.id and record.status <> 'expected')
    or exists(select 1 from public.presentation_scores where student_id = enrolment_row.student_id and offering_id = offering_row.id)
    or exists(select 1 from public.encounter_logs where student_id = enrolment_row.student_id and offering_id = offering_row.id)
    or exists(select 1 from public.assessment_attempts where student_id = enrolment_row.student_id and offering_id = offering_row.id);
  calculated_status := case when disposition is not null then disposition when any_fail then 'Fail'
    when deferred then 'Assessment deferred' when all_pass and attendance_actual >= attendance_required and not presentation_pending then 'Pass'
    when term_row.starts_on <= evaluation_date or evidence then 'In progress' else 'Planned' end;
  calculated_credits := case when calculated_status = 'Pass' then module_row.credits else 0 end;
  effective_status := calculated_status; effective_indicators := indicators;
  for override_row in select * from public.assessment_current_overrides where enrolment_id = enrolment_key and value is not null loop
    overrides := overrides || jsonb_build_array(to_jsonb(override_row));
    if override_row.kind = 'status' then effective_status := override_row.value #>> '{}';
    elsif override_row.kind = 'indicator' then
      effective_indicators := array_remove(effective_indicators, override_row.indicator);
      if override_row.value = 'true'::jsonb then
        if override_row.indicator like '%:Resit %' then
          effective_indicators := array_remove(array_remove(effective_indicators, split_part(override_row.indicator, ':', 1) || ':Resit required'), split_part(override_row.indicator, ':', 1) || ':Resit scheduled');
        end if;
        effective_indicators := array_append(effective_indicators, override_row.indicator);
      end if;
    end if;
  end loop;
  recommended_credits := case when effective_status = 'Pass' then module_row.credits else 0 end;
  select (value #>> '{}')::integer into effective_credits from public.assessment_current_overrides where enrolment_id = enrolment_key and kind = 'credits' and value is not null;
  return jsonb_build_object('enrolment_id', enrolment_key, 'revision', enrolment_row.assessment_revision, 'plan', to_jsonb(plan_row),
    'components', components, 'calculated_status', calculated_status, 'effective_status', effective_status,
    'calculated_indicators', to_jsonb(indicators), 'effective_indicators', to_jsonb(effective_indicators),
    'calculated_credits', calculated_credits, 'recommended_credits', recommended_credits, 'awarded_credits', coalesce(effective_credits, recommended_credits),
    'overrides', overrides, 'disposition', disposition, 'attendance_required', attendance_required, 'attendance_actual', attendance_actual,
    'presentation_pending', presentation_pending, 'original_term_id', term_row.id, 'student_id', enrolment_row.student_id, 'module_id', module_row.id);
end;
$$;

create function public.assessment_recalculate(enrolment_key uuid, change_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare before_projection jsonb; after_projection jsonb; next_revision integer;
begin
  select assessment_projection, assessment_revision + 1 into before_projection, next_revision from public.enrolments where id = enrolment_key for update;
  after_projection := public.assessment_evaluate(enrolment_key) || jsonb_build_object('revision', next_revision);
  after_projection := after_projection || jsonb_build_object('pass_reversed', coalesce(before_projection->>'calculated_status' = 'Pass' and after_projection->>'calculated_status' <> 'Pass', false));
  update public.enrolments set assessment_revision = next_revision, assessment_projection = after_projection where id = enrolment_key;
  insert into public.enrolment_assessment_history(enrolment_id, revision, projection, reason, actor_id)
    values(enrolment_key, next_revision, after_projection, change_reason, auth.uid());
  return after_projection;
end;
$$;

create function public.read_enrolment_assessment(enrolment_key uuid, as_of timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare projection jsonb;
begin
  if public.is_teacher() is not true then raise exception 'Staff access required'; end if;
  if as_of is not null then
    select history.projection into projection from public.enrolment_assessment_history history where history.enrolment_id = enrolment_key and history.created_at <= as_of order by revision desc limit 1;
    return projection;
  end if;
  return public.assessment_evaluate(enrolment_key);
end;
$$;
revoke all on function public.assessment_evaluate(uuid,date,uuid), public.assessment_recalculate(uuid,text) from public, anon, authenticated;
revoke all on function public.read_enrolment_assessment(uuid,timestamptz) from public, anon;
grant execute on function public.read_enrolment_assessment(uuid,timestamptz) to authenticated;
