create table public.assessment_historical_outcomes (
  enrolment_id uuid primary key references public.enrolments(id) on delete restrict,
  recorded_status text not null,
  recorded_credits integer not null,
  recorded_final_mark numeric,
  recorded_grade text,
  captured_at timestamptz not null default now(),
  capture_reference text not null default '0079: pre-existing legacy academic record'
);

alter table public.assessment_historical_outcomes enable row level security;
create policy historical_outcomes_staff_read on public.assessment_historical_outcomes for select using (public.is_teacher());
revoke all on public.assessment_historical_outcomes from public, anon, authenticated, service_role;
grant select on public.assessment_historical_outcomes to authenticated;
create trigger historical_outcomes_immutable before update or delete on public.assessment_historical_outcomes
  for each row execute function public.assessment_immutable();

alter function public.assessment_evaluate(uuid,date,uuid) rename to assessment_evaluate_current_rules;
revoke all on function public.assessment_evaluate_current_rules(uuid,date,uuid) from public, anon, authenticated, service_role;

create function public.assessment_evaluate(enrolment_key uuid, evaluation_date date default current_date, plan_override uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  baseline public.assessment_historical_outcomes;
  projection jsonb;
  preserved_status text;
  effective_status text;
  effective_credits integer;
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
  effective_status := preserved_status;
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
      'capture_reference', baseline.capture_reference, 'review_flags', '[]'::jsonb),
    'calculated_status', 'Historical', 'effective_status', effective_status,
    'calculated_credits', baseline.recorded_credits, 'recommended_credits', baseline.recorded_credits, 'awarded_credits', effective_credits,
    'calculated_indicators', '[]'::jsonb, 'effective_indicators', to_jsonb(indicators), 'overrides', decisions,
    'components', coalesce(projection->'components', '{}'::jsonb),
    'original_term_id', (select offering.term_id from public.enrolments enrolment join public.module_offerings offering on offering.id = enrolment.offering_id where enrolment.id = enrolment_key));
end;
$$;
revoke all on function public.assessment_evaluate(uuid,date,uuid) from public, anon, authenticated, service_role;

create or replace function public.assessment_recalculate(enrolment_key uuid, change_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare before_projection jsonb; after_projection jsonb; next_revision integer; dependent_key uuid;
begin
  if public.enrolment_is_cancelled(enrolment_key) then return null; end if;
  select assessment_projection, assessment_revision + 1 into before_projection, next_revision from public.enrolments where id = enrolment_key for update;
  after_projection := public.assessment_evaluate(enrolment_key) || jsonb_build_object('revision', next_revision);
  after_projection := after_projection || jsonb_build_object('pass_reversed',
    not coalesce((after_projection->'historical'->>'protected')::boolean,false)
    and coalesce(before_projection->>'calculated_status' = 'Pass' and after_projection->>'calculated_status' <> 'Pass', false));
  update public.enrolments set assessment_revision = next_revision, assessment_projection = after_projection where id = enrolment_key;
  insert into public.enrolment_assessment_history(enrolment_id, revision, projection, reason, actor_id)
    values(enrolment_key, next_revision, after_projection, change_reason, auth.uid());
  if coalesce(before_projection->>'effective_status' in ('Fail','Module deferred','Abandoned'), false)
    is distinct from coalesce(after_projection->>'effective_status' in ('Fail','Module deferred','Abandoned'), false) then
    for dependent_key in
      select dependent.id from public.active_module_enrolments current_enrolment
      join public.module_offerings current_offering on current_offering.id = current_enrolment.offering_id
      join public.terms current_term on current_term.id = current_offering.term_id
      join public.active_module_enrolments dependent on dependent.student_id = current_enrolment.student_id
      join public.module_offerings dependent_offering on dependent_offering.id = dependent.offering_id
      join public.terms dependent_term on dependent_term.id = dependent_offering.term_id
      where current_enrolment.id = enrolment_key and dependent.assessment_plan_id is not null
        and dependent_term.starts_on > current_term.starts_on
      order by dependent_term.starts_on, dependent.id
    loop
      perform public.assessment_recalculate(dependent_key, 'Earlier teaching carryover eligibility changed: ' || change_reason);
    end loop;
  end if;
  return after_projection;
end;
$$;

create function public.protect_historical_outcome_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.student_id, new.offering_id, new.status, new.credits_awarded, new.final_mark, new.grade)
    is distinct from (old.student_id, old.offering_id, old.status, old.credits_awarded, old.final_mark, old.grade)
    and exists(select 1 from public.assessment_historical_outcomes where enrolment_id = old.id) then
    raise exception 'Historical academic baseline is preserved. Use an audited Exceptional decision for outcome or credit amendments; source corrections require separate reconciliation.';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_historical_outcome_fields() from public, anon, authenticated, service_role;
create trigger protect_historical_outcome_fields before update on public.enrolments
  for each row execute function public.protect_historical_outcome_fields();

alter function public.execute_assessment_command(jsonb,integer) rename to execute_assessment_command_v7;
revoke all on function public.execute_assessment_command_v7(jsonb,integer) from public, anon, authenticated, service_role;

create function public.execute_assessment_command(command jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := public.assessment_require_admin();
  enrolment_key uuid := (command->>'enrolment_id')::uuid;
  command_type text := command->>'type';
  change_reason text := command->>'reason';
  override_kind text := command->>'kind';
  override_value jsonb;
  indicator_name text := coalesce(command->>'indicator','');
  current_revision integer;
  before_projection jsonb;
  after_projection jsonb;
begin
  select assessment_revision into current_revision from public.enrolments where id = enrolment_key for update;
  if command_type not in ('SetAssessmentOverride','ClearAssessmentOverride')
    or not exists(select 1 from public.assessment_historical_outcomes where enrolment_id = enrolment_key) then
    return public.execute_assessment_command_v7(command, expected_revision);
  end if;
  if public.enrolment_is_cancelled(enrolment_key) then raise exception 'Cancelled enrolments cannot be amended'; end if;
  if length(trim(coalesce(change_reason,''))) = 0 then raise exception 'An administrator reason is required'; end if;
  if expected_revision is distinct from current_revision then raise exception 'Assessment changed. Reload before saving.'; end if;
  if override_kind is null or override_kind not in ('status','credits','indicator') then
    raise exception 'Invalid historical decision kind';
  end if;
  if override_kind <> 'indicator' and indicator_name <> '' then raise exception 'Unexpected indicator'; end if;
  if override_kind = 'indicator' and indicator_name not in ('Attendance non-compliance','Presentation incomplete','theory:Resit required','theory:Resit scheduled','practical:Resit required','practical:Resit scheduled') then raise exception 'Invalid indicator'; end if;
  if command_type = 'SetAssessmentOverride' then
    override_value := command->'value';
    if override_value is null or override_value = 'null'::jsonb then raise exception 'Override value required'; end if;
    if override_kind = 'status' and (jsonb_typeof(override_value) <> 'string' or (override_value #>> '{}') not in ('Planned','In progress','Abandoned','Pass','Fail','Module deferred','Assessment deferred')) then raise exception 'Invalid status'; end if;
    if override_kind = 'credits' and (jsonb_typeof(override_value) <> 'number' or (override_value #>> '{}')::numeric < 0 or (override_value #>> '{}')::numeric <> trunc((override_value #>> '{}')::numeric)) then raise exception 'Credits must be a nonnegative integer'; end if;
    if override_kind = 'indicator' and jsonb_typeof(override_value) <> 'boolean' then raise exception 'Indicator value must be boolean'; end if;
  end if;
  before_projection := public.assessment_evaluate(enrolment_key);
  if override_kind = 'indicator' and override_value = 'true'::jsonb and indicator_name like '%:Resit %' then
    insert into public.enrolment_assessment_overrides(enrolment_id,kind,indicator,value,reason,actor_id)
    values(enrolment_key,'indicator',split_part(indicator_name, ':', 1) || case when indicator_name like '%required' then ':Resit scheduled' else ':Resit required' end,null,change_reason,actor);
  end if;
  insert into public.enrolment_assessment_overrides(enrolment_id,kind,indicator,value,reason,actor_id)
  values(enrolment_key,override_kind,indicator_name,override_value,change_reason,actor);
  after_projection := public.assessment_recalculate(enrolment_key,change_reason);
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,reason,metadata)
  values(actor,'assessment.' || command_type,'enrolment_assessment',enrolment_key,change_reason,
    jsonb_build_object('command',command,'before',before_projection,'after',after_projection,'historical_amendment',true));
  return jsonb_build_object('assessment',after_projection,'pass_reversed',false);
end;
$$;
revoke all on function public.execute_assessment_command(jsonb,integer) from public, anon;
grant execute on function public.execute_assessment_command(jsonb,integer) to authenticated;

do $$
begin
  lock table public.enrolments, public.exam_results in share row exclusive mode;
  insert into public.assessment_historical_outcomes(enrolment_id, recorded_status, recorded_credits, recorded_final_mark, recorded_grade)
  select enrolment.id, enrolment.status::text, enrolment.credits_awarded, enrolment.final_mark, enrolment.grade
  from public.active_module_enrolments enrolment
  where enrolment.assessment_plan_id is null
    or exists(select 1 from public.exam_results result where result.student_id = enrolment.student_id and result.offering_id = enrolment.offering_id)
    or enrolment.status::text <> 'planned' or enrolment.credits_awarded <> 0 or enrolment.final_mark is not null or enrolment.grade is not null;
end;
$$;
