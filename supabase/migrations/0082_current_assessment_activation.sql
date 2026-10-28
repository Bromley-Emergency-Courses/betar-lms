create table public.assessment_current_activations (
  enrolment_id uuid primary key references public.assessment_historical_outcomes(enrolment_id) on delete restrict,
  plan_id uuid not null references public.module_assessment_plans(id) on delete restrict,
  expected_revision integer not null,
  reviewed_preview jsonb not null,
  actor_id uuid not null references public.staff_profiles(id),
  reason text not null check (length(btrim(reason)) between 1 and 4000),
  activated_at timestamptz not null default now()
);
alter table public.assessment_current_activations enable row level security;
create policy current_activations_admin_read on public.assessment_current_activations for select using (public.is_admin());
revoke all on public.assessment_current_activations from public, anon, authenticated, service_role;
grant select on public.assessment_current_activations to authenticated;
create trigger current_activations_immutable before update or delete on public.assessment_current_activations
  for each row execute function public.assessment_immutable();

alter function public.assessment_evaluate(uuid,date,uuid) rename to assessment_evaluate_preserved;
revoke all on function public.assessment_evaluate_preserved(uuid,date,uuid) from public, anon, authenticated, service_role;

create function public.assessment_evaluate(enrolment_key uuid, evaluation_date date default current_date, plan_override uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  activation public.assessment_current_activations;
  baseline public.assessment_historical_outcomes;
  projection jsonb;
  decided_credits integer;
begin
  select * into activation from public.assessment_current_activations where enrolment_id = enrolment_key;
  if not found then return public.assessment_evaluate_preserved(enrolment_key, evaluation_date, plan_override); end if;
  projection := public.assessment_evaluate_current_rules(enrolment_key, evaluation_date, plan_override);
  if projection is null then return null; end if;
  select * into strict baseline from public.assessment_historical_outcomes where enrolment_id = enrolment_key;
  if baseline.recorded_credits > 0 then
    select (value #>> '{}')::integer into decided_credits from public.assessment_current_overrides
      where enrolment_id = enrolment_key and kind = 'credits' and value is not null;
    projection := projection || jsonb_build_object('awarded_credits', coalesce(decided_credits, baseline.recorded_credits));
  end if;
  return projection || jsonb_build_object('activation', jsonb_build_object(
    'activated_at', activation.activated_at, 'plan_id', activation.plan_id,
    'preserved_credits', case when baseline.recorded_credits > 0 then baseline.recorded_credits end,
    'original_record', jsonb_build_object('status', baseline.recorded_status, 'credits', baseline.recorded_credits,
      'final_mark', baseline.recorded_final_mark, 'grade', baseline.recorded_grade, 'captured_at', baseline.captured_at)));
end;
$$;
revoke all on function public.assessment_evaluate(uuid,date,uuid) from public, anon, authenticated, service_role;

create function public.preview_current_assessment_activation(enrolment_keys uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  actor uuid := public.assessment_require_admin();
  enrolment_key uuid;
  enrolment_row public.enrolments;
  baseline public.assessment_historical_outcomes;
  offering_row public.module_offerings;
  module_row public.course_modules;
  term_row public.terms;
  plan_row public.module_assessment_plans;
  proposed jsonb;
  context_token text;
  reviewed jsonb := '[]'::jsonb;
begin
  if coalesce(cardinality(enrolment_keys),0) not between 1 and 200
    or exists(select 1 from unnest(enrolment_keys) candidate where candidate is null)
    or cardinality(enrolment_keys) <> (select count(distinct candidate) from unnest(enrolment_keys) candidate) then
    raise exception 'Choose an explicit, unique batch of 1 to 200 enrolments';
  end if;
  for enrolment_key in select candidate from unnest(enrolment_keys) candidate order by candidate loop
    select * into strict enrolment_row from public.enrolments where id = enrolment_key;
    if exists(select 1 from public.assessment_current_activations where enrolment_id = enrolment_key) then
      raise exception 'Enrolment already activated; reload the reviewed scope';
    end if;
    select * into baseline from public.assessment_historical_outcomes where enrolment_id = enrolment_key;
    if not found or baseline.recorded_status not in ('planned','in_progress')
      or baseline.recorded_final_mark is not null or baseline.recorded_grade is not null
      or enrolment_row.assessment_plan_id is not null or public.enrolment_is_cancelled(enrolment_key)
      or (enrolment_row.status::text, enrolment_row.credits_awarded, enrolment_row.final_mark, enrolment_row.grade)
        is distinct from (baseline.recorded_status, baseline.recorded_credits, baseline.recorded_final_mark, baseline.recorded_grade) then
      raise exception 'Only preserved ongoing enrolments without an assigned plan are eligible';
    end if;
    select * into strict offering_row from public.module_offerings where id = enrolment_row.offering_id;
    select * into strict module_row from public.course_modules where id = offering_row.module_id;
    select * into strict term_row from public.terms where id = offering_row.term_id;
    if not module_row.active or term_row.status <> 'active' or current_date not between term_row.starts_on and term_row.ends_on
      or not exists(select 1 from public.students where id = enrolment_row.student_id and status = 'active') then
      raise exception 'Activation requires an active student and module in an active current term';
    end if;
    select * into plan_row from public.module_assessment_plans where id = module_row.assessment_plan_id;
    if not found or plan_row.module_id <> module_row.id or plan_row.mode <> module_row.mode then
      raise exception 'Review the global module assessment plan before activation';
    end if;
    if exists(select 1 from public.exam_results where student_id = enrolment_row.student_id and offering_id = enrolment_row.offering_id)
      or exists(select 1 from public.module_assessment_attempts where enrolment_id = enrolment_key)
      or exists(select 1 from public.enrolment_assessment_overrides where enrolment_id = enrolment_key)
      or exists(select 1 from public.module_assessment_arrangements where enrolment_id = enrolment_key)
      or exists(select 1 from public.enrolment_disposition_events where enrolment_id = enrolment_key)
      or exists(select 1 from public.enrolment_evidence_retention where enrolment_id = enrolment_key
        and source_table in ('exam_results','module_assessment_attempts','enrolment_assessment_overrides','module_assessment_arrangements','enrolment_disposition_events')) then
      raise exception 'Existing academic evidence requires separate reconciliation before activation';
    end if;
    proposed := public.assessment_evaluate_current_rules(enrolment_key, current_date, plan_row.id);
    if baseline.recorded_credits > 0 then proposed := proposed || jsonb_build_object('awarded_credits', baseline.recorded_credits); end if;
    select md5(jsonb_build_object(
      'enrolment', to_jsonb(enrolment_row), 'baseline', to_jsonb(baseline), 'offering', to_jsonb(offering_row),
      'module', to_jsonb(module_row), 'term', to_jsonb(term_row),
      'participation', (select jsonb_agg(jsonb_build_array(to_jsonb(peer),to_jsonb(offering),to_jsonb(module),to_jsonb(term)) order by peer.id)
        from public.enrolments peer join public.module_offerings offering on offering.id = peer.offering_id
        join public.course_modules module on module.id = offering.module_id join public.terms term on term.id = offering.term_id
        where peer.student_id = enrolment_row.student_id),
      'attendance', (select jsonb_agg(jsonb_build_array(to_jsonb(record),to_jsonb(session)) order by record.id)
        from public.attendance_records record join public.attendance_sessions session on session.id = record.session_id
        where record.student_id = enrolment_row.student_id),
      'presentations', (select jsonb_agg(to_jsonb(score) order by score.id) from public.presentation_scores score where score.student_id = enrolment_row.student_id)
    )::text) into context_token;
    reviewed := reviewed || jsonb_build_array(jsonb_build_object('enrolment_id', enrolment_key,
      'expected_revision', enrolment_row.assessment_revision, 'plan_id', plan_row.id, 'context_token', context_token,
      'original_record', to_jsonb(baseline), 'before', public.assessment_evaluate(enrolment_key), 'after', proposed));
  end loop;
  return jsonb_build_object('actor_id', actor, 'review_date', current_date, 'enrolments', reviewed);
end;
$$;
revoke all on function public.preview_current_assessment_activation(uuid[]) from public, anon, service_role;
grant execute on function public.preview_current_assessment_activation(uuid[]) to authenticated;

create function public.activate_current_assessments(enrolment_keys uuid[], reviewed_preview jsonb, change_reason text, confirmed boolean)
returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '5s' as $$
declare
  actor uuid := public.assessment_require_admin();
  fresh_preview jsonb;
  reviewed_row jsonb;
  enrolment_key uuid;
  projection jsonb;
  activated jsonb := '[]'::jsonb;
begin
  if confirmed is distinct from true then raise exception 'Confirm the reviewed activation batch'; end if;
  if length(btrim(coalesce(change_reason,''))) not between 1 and 4000 then raise exception 'An administrator reason is required (1 to 4000 characters)'; end if;
  lock table public.enrolments in share row exclusive mode;
  lock table public.assessment_current_activations, public.assessment_historical_outcomes, public.course_modules,
    public.module_offerings, public.terms, public.students, public.module_assessment_plans,
    public.module_assessment_attempts, public.module_assessment_attempt_revisions, public.module_assessment_items,
    public.enrolment_assessment_overrides, public.module_assessment_arrangements, public.enrolment_disposition_events,
    public.exam_results, public.enrolment_evidence_retention, public.enrolment_cancellations,
    public.attendance_records, public.attendance_sessions, public.presentation_scores,
    public.encounter_logs, public.assessment_attempts in share row exclusive mode;
  fresh_preview := public.preview_current_assessment_activation(enrolment_keys);
  if reviewed_preview is distinct from fresh_preview then raise exception 'Related records changed. Generate and review a fresh preview before activation.'; end if;
  for reviewed_row in select value from jsonb_array_elements(fresh_preview->'enrolments') loop
    enrolment_key := (reviewed_row->>'enrolment_id')::uuid;
    insert into public.assessment_current_activations(enrolment_id, plan_id, expected_revision, reviewed_preview, actor_id, reason)
      values(enrolment_key, (reviewed_row->>'plan_id')::uuid, (reviewed_row->>'expected_revision')::integer, reviewed_row, actor, change_reason);
    update public.enrolments set assessment_plan_id = (reviewed_row->>'plan_id')::uuid where id = enrolment_key;
  end loop;
  for reviewed_row in select value from jsonb_array_elements(fresh_preview->'enrolments') loop
    enrolment_key := (reviewed_row->>'enrolment_id')::uuid;
    projection := public.assessment_recalculate(enrolment_key, change_reason);
    insert into public.audit_events(actor_user_id, action, entity_type, entity_id, reason, metadata)
      values(actor, 'assessment.ActivateCurrentEnrolment', 'enrolment_assessment', enrolment_key, change_reason,
        jsonb_build_object('reviewed_preview', reviewed_row, 'after', projection));
    activated := activated || jsonb_build_array(projection);
  end loop;
  return jsonb_build_object('activated', activated);
exception when deadlock_detected or serialization_failure or lock_not_available then
  raise exception 'Related records changed while saving. Review a fresh activation preview.';
end;
$$;
revoke all on function public.activate_current_assessments(uuid[],jsonb,text,boolean) from public, anon, service_role;
grant execute on function public.activate_current_assessments(uuid[],jsonb,text,boolean) to authenticated;

alter function public.execute_assessment_command(jsonb,integer) rename to execute_assessment_command_v8;
revoke all on function public.execute_assessment_command_v8(jsonb,integer) from public, anon, authenticated, service_role;
create function public.execute_assessment_command(command jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assessment_require_admin();
  perform 1 from public.enrolments where id = (command->>'enrolment_id')::uuid for update;
  if exists(select 1 from public.assessment_current_activations where enrolment_id = (command->>'enrolment_id')::uuid) then
    return public.execute_assessment_command_v6(command, expected_revision);
  end if;
  return public.execute_assessment_command_v8(command, expected_revision);
end;
$$;
revoke all on function public.execute_assessment_command(jsonb,integer) from public, anon, service_role;
grant execute on function public.execute_assessment_command(jsonb,integer) to authenticated;
