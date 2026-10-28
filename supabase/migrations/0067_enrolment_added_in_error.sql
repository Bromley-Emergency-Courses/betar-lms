create table public.enrolment_cancellations (
  enrolment_id uuid primary key references public.enrolments(id),
  actor_id uuid not null references public.staff_profiles(id),
  reason text not null check (length(btrim(reason)) between 1 and 4000),
  created_at timestamptz not null default now(),
  before_record jsonb not null
);
alter table public.enrolment_cancellations enable row level security;
revoke all on public.enrolment_cancellations from public, anon, authenticated, service_role;
create trigger cancellation_immutable before update or delete on public.enrolment_cancellations
  for each row execute function public.assessment_immutable();

create function public.enrolment_is_cancelled(enrolment_key uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.enrolment_cancellations where enrolment_id = enrolment_key);
$$;
revoke all on function public.enrolment_is_cancelled(uuid) from public, anon;
grant execute on function public.enrolment_is_cancelled(uuid) to authenticated, service_role;

create view public.active_module_enrolments with (security_invoker = true) as
  select * from public.enrolments where not public.enrolment_is_cancelled(id);
grant select on public.active_module_enrolments to authenticated, service_role;

create function public.student_enrolment_cancellation_reasons(enrolment_key uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare reasons text[]; enrolment_row public.enrolments;
begin
  select * into strict enrolment_row from public.enrolments where id = enrolment_key;
  if public.enrolment_is_cancelled(enrolment_key) then return array['This enrolment is already cancelled as added in error.']; end if;
  reasons := array_remove(array_remove(public.student_enrolment_removal_reasons(enrolment_key),
    'Calculated assessment history is retained, even when no exam score has been entered.'),
    'Module participation decisions must be retained.');
  if exists(select 1 from public.finance_records record join public.module_offerings offering on offering.term_id = record.term_id
    where record.student_id = enrolment_row.student_id and offering.id = enrolment_row.offering_id) then
    reasons := array_append(reasons, 'Finance records exist in this teaching term. Separate review is required; no invoices or payments will be changed.');
  end if;
  if exists(select 1 from public.audit_events event where event.action = 'teaching.record_created'
    and event.metadata->>'student_id' = enrolment_row.student_id::text
    and event.metadata->'record'->>'offering_id' = enrolment_row.offering_id::text)
    or exists(select 1 from public.audit_events event join public.module_offerings offering on offering.id = enrolment_row.offering_id
      where event.action in ('create_student_finance','update_student_finance') and (
        (event.metadata->'before'->>'student_id' = enrolment_row.student_id::text and event.metadata->'before'->>'term_id' = offering.term_id::text)
        or (event.metadata->'after'->>'student_id' = enrolment_row.student_id::text and event.metadata->'after'->>'term_id' = offering.term_id::text)))
    or exists(select 1 from public.attendance_workspace_versions version join public.attendance_sessions session on session.id = version.session_id
      join public.module_offerings offering on offering.term_id = session.term_id
      where version.student_id = enrolment_row.student_id and version.revision > 0 and offering.id = enrolment_row.offering_id) then
    reasons := array_append(reasons, 'Historical teaching, attendance or finance evidence requires separate review, even if its current record has been cleared.');
  end if;
  return reasons;
end;
$$;
revoke all on function public.student_enrolment_cancellation_reasons(uuid) from public, anon, authenticated, service_role;

create function public.guard_cancelled_enrolment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.enrolment_is_cancelled(old.id) then raise exception 'This enrolment was added in error and is retained read-only for audit.'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_cancelled_enrolment before update or delete on public.enrolments
  for each row execute function public.guard_cancelled_enrolment();

create function public.guard_cancelled_enrolment_evidence() returns trigger
language plpgsql security definer set search_path = public as $$
declare row_data jsonb := to_jsonb(new); student_key uuid; offering_key uuid; term_key uuid;
begin
  if row_data ? 'enrolment_id' then
    if public.enrolment_is_cancelled((row_data->>'enrolment_id')::uuid) then
      raise exception 'Cannot attach evidence or decisions to an enrolment cancelled as added in error.';
    end if;
  else
    student_key := (row_data->>'student_id')::uuid;
    offering_key := (row_data->>'offering_id')::uuid;
    if row_data ? 'session_id' then
      select offering_id, term_id into offering_key, term_key from public.attendance_sessions where id = (row_data->>'session_id')::uuid;
    else term_key := (row_data->>'term_id')::uuid; end if;
    if exists(select 1 from public.enrolments enrolment where enrolment.student_id = student_key
      and enrolment.offering_id = offering_key and public.enrolment_is_cancelled(enrolment.id)) then
      raise exception 'Cannot attach evidence to an enrolment cancelled as added in error.';
    end if;
    if term_key is not null and exists(select 1 from public.enrolments enrolment
      join public.module_offerings offering on offering.id = enrolment.offering_id
      where enrolment.student_id = student_key and offering.term_id = term_key and public.enrolment_is_cancelled(enrolment.id))
      and not exists(select 1 from public.active_module_enrolments enrolment join public.module_offerings offering on offering.id = enrolment.offering_id
        where enrolment.student_id = student_key and offering.term_id = term_key) then
      raise exception 'This student has only cancelled enrolments in this term. Review enrolment before recording new evidence or finance.';
    end if;
  end if;
  return new;
end;
$$;
do $$
declare table_name text;
begin
  foreach table_name in array array['module_assessment_attempts','module_assessment_arrangements','enrolment_assessment_overrides',
    'enrolment_disposition_events','exam_results','encounter_logs','assessment_attempts','presentation_scores',
    'attendance_records','expected_attendance','finance_records'] loop
    execute format('create trigger guard_cancelled_enrolment_evidence before insert or update on public.%I for each row execute function public.guard_cancelled_enrolment_evidence()', table_name);
  end loop;
end;
$$;
revoke all on function public.guard_cancelled_enrolment(), public.guard_cancelled_enrolment_evidence() from public, anon, authenticated, service_role;

alter function public.execute_assessment_command(jsonb,integer) rename to execute_assessment_command_v5;
revoke all on function public.execute_assessment_command_v5(jsonb,integer) from public, anon, authenticated, service_role;
create function public.execute_assessment_command(command jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare actor uuid := public.assessment_require_admin(); enrolment_key uuid := (command->>'enrolment_id')::uuid;
  enrolment_row public.enrolments; reasons text[]; peer_key uuid;
begin
  if command->>'type' = 'CancelMistakenEnrolment' then
    if jsonb_typeof(command) is distinct from 'object'
      or not command ?& array['type','enrolment_id','student_id','expected_token','confirmed','reason']
      or command - array['type','enrolment_id','student_id','expected_token','confirmed','reason'] <> '{}'::jsonb
      or command->'confirmed' is distinct from 'true'::jsonb
      or jsonb_typeof(command->'reason') is distinct from 'string'
      or length(btrim(command->>'reason')) not between 1 and 4000 then
      raise exception 'Confirm the mistaken enrolment and enter an administrator reason.';
    end if;
    lock table public.enrolments in share row exclusive mode;
    lock table public.module_assessment_attempts, public.module_assessment_arrangements, public.enrolment_assessment_overrides,
      public.enrolment_disposition_events, public.exam_results, public.encounter_logs, public.assessment_attempts,
      public.presentation_scores, public.attendance_records, public.expected_attendance, public.attendance_sessions,
      public.finance_records, public.module_offerings in share mode;
    select * into enrolment_row from public.enrolments where id = enrolment_key for update;
    if enrolment_row.id is null or enrolment_row.student_id is distinct from (command->>'student_id')::uuid then
      raise exception 'Enrolment not found for this student.';
    end if;
    if expected_revision is distinct from enrolment_row.assessment_revision
      or command->>'expected_token' is distinct from md5(to_jsonb(enrolment_row)::text) then
      raise exception 'Enrolment changed. Discard and reopen before saving.';
    end if;
    reasons := public.student_enrolment_cancellation_reasons(enrolment_key);
    if cardinality(reasons) > 0 then raise exception 'Cancellation blocked: %', array_to_string(reasons, ' '); end if;
    insert into public.enrolment_cancellations(enrolment_id, actor_id, reason, before_record)
      values(enrolment_key, actor, btrim(command->>'reason'), to_jsonb(enrolment_row));
    insert into public.audit_events(actor_user_id, action, entity_type, entity_id, reason, metadata)
      values(actor, 'enrolment.added_in_error', 'enrolment', enrolment_key, btrim(command->>'reason'),
        jsonb_build_object('before', to_jsonb(enrolment_row), 'student_id', enrolment_row.student_id, 'cancelled', true));
    for peer_key in select id from public.active_module_enrolments where student_id = enrolment_row.student_id
      and assessment_plan_id is not null order by id loop
      perform public.assessment_recalculate(peer_key, 'Mistaken enrolment cancelled: ' || btrim(command->>'reason'));
    end loop;
    return jsonb_build_object('assessment', null, 'source_id', null, 'pass_reversed', false);
  end if;
  if enrolment_key is not null then
    perform 1 from public.enrolments where id = enrolment_key for update;
    if public.enrolment_is_cancelled(enrolment_key) then
      raise exception 'This enrolment is cancelled as added in error. Its history is read-only.';
    end if;
  end if;
  return public.execute_assessment_command_v5(command, expected_revision);
exception when deadlock_detected or serialization_failure then
  raise exception 'Related records changed while saving. Discard and reopen to review the latest evidence.';
end;
$$;
revoke all on function public.execute_assessment_command(jsonb,integer) from public, anon, service_role;
grant execute on function public.execute_assessment_command(jsonb,integer) to authenticated;

create or replace function public.read_student_enrolments(student_key uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assessment_require_admin();
  if not exists(select 1 from public.students where id = student_key) then raise exception 'Student not found'; end if;
  return jsonb_build_object('enrolments', coalesce((select jsonb_agg(jsonb_build_object(
    'id', enrolment.id, 'offeringId', enrolment.offering_id, 'offering', public.student_offering_snapshot(enrolment.offering_id),
    'revision', enrolment.assessment_revision, 'token', md5(to_jsonb(enrolment)::text),
    'attendanceDays', enrolment.attendance_days_required_override, 'presentationRequired', enrolment.presentation_required_override,
    'assessment', case when cancellation.enrolment_id is null and enrolment.assessment_plan_id is not null then public.assessment_evaluate(enrolment.id) end,
    'removalReasons', public.student_enrolment_removal_reasons(enrolment.id),
    'cancellationReasons', public.student_enrolment_cancellation_reasons(enrolment.id),
    'cancellation', case when cancellation.enrolment_id is not null then jsonb_build_object(
      'reason', cancellation.reason, 'createdAt', cancellation.created_at, 'actorName', actor.full_name) end
    ) order by enrolment.created_at, enrolment.id)
    from public.enrolments enrolment left join public.enrolment_cancellations cancellation on cancellation.enrolment_id = enrolment.id
    left join public.staff_profiles actor on actor.id = cancellation.actor_id where enrolment.student_id = student_key), '[]'::jsonb),
    'offerings', coalesce((select jsonb_agg(public.student_offering_snapshot(offering.id) order by term.starts_on desc, module.code)
    from public.module_offerings offering join public.terms term on term.id = offering.term_id join public.course_modules module on module.id = offering.module_id
    where not exists(select 1 from public.enrolments where student_id = student_key and offering_id = offering.id)), '[]'::jsonb));
end;
$$;

create or replace function public.assessment_evaluate(enrolment_key uuid, evaluation_date date default current_date, plan_override uuid default null)
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
  if public.enrolment_is_cancelled(enrolment_key) then return null; end if;
  select * into strict enrolment_row from public.active_module_enrolments where id = enrolment_key;
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
    select exists(select 1 from public.active_module_enrolments prior
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
      from public.active_module_enrolments candidate join public.module_offerings offering on offering.id = candidate.offering_id
      join public.course_modules module on module.id = offering.module_id
      where candidate.student_id = enrolment_row.student_id and offering.term_id = term_row.id and coalesce((select mode from public.module_assessment_plans where id = candidate.assessment_plan_id), module.mode) = 'practical'
        and coalesce((select event.disposition from public.enrolment_disposition_events event where event.enrolment_id = candidate.id order by event.event_order desc limit 1), '') not in ('Abandoned', 'Module deferred')
        and (candidate.assessment_plan_id is not null or candidate.status::text in ('planned','in_progress','completed','resit'));
    if not prior_practical then attendance_required := attendance_required + premium; end if;
    select count(distinct session.session_date) into attendance_actual from public.attendance_records record
      join public.attendance_sessions session on session.id = record.session_id
      where record.student_id = enrolment_row.student_id and session.term_id = term_row.id and record.status in ('attended','partial') and session.session_date <= evaluation_date;
    select attendance_actual + coalesce(sum(carried.days), 0) into attendance_actual
      from public.active_module_enrolments current_enrolment join public.module_offerings current_offering on current_offering.id = current_enrolment.offering_id
      join public.course_modules current_module on current_module.id = current_offering.module_id
      join public.active_module_enrolments prior on prior.student_id = current_enrolment.student_id and prior.id <> current_enrolment.id
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
      and not exists(select 1 from public.active_module_enrolments prior join public.module_offerings prior_offering on prior_offering.id = prior.offering_id
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

create or replace function public.assessment_recalculate(enrolment_key uuid, change_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare before_projection jsonb; after_projection jsonb; next_revision integer;
begin
  if public.enrolment_is_cancelled(enrolment_key) then return null; end if;
  select assessment_projection, assessment_revision + 1 into before_projection, next_revision from public.enrolments where id = enrolment_key for update;
  after_projection := public.assessment_evaluate(enrolment_key) || jsonb_build_object('revision', next_revision);
  after_projection := after_projection || jsonb_build_object('pass_reversed', coalesce(before_projection->>'calculated_status' = 'Pass' and after_projection->>'calculated_status' <> 'Pass', false));
  update public.enrolments set assessment_revision = next_revision, assessment_projection = after_projection where id = enrolment_key;
  insert into public.enrolment_assessment_history(enrolment_id, revision, projection, reason, actor_id)
    values(enrolment_key, next_revision, after_projection, change_reason, auth.uid());
  return after_projection;
end;
$$;

create or replace function public.read_enrolment_assessment(enrolment_key uuid, as_of timestamptz default null) returns jsonb
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

create or replace function public.ingest_assessment_source(batch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := public.assessment_require_admin(); input jsonb; item jsonb; source_row public.module_assessment_source_results;
  previous_version public.module_assessment_source_versions; version_key uuid; attempt_row public.module_assessment_attempts;
  candidate_ids uuid[]; candidate_id uuid; source_payload_hash text; is_new boolean; current_projection jsonb;
  created_count integer := 0; unchanged_count integer := 0; updated_count integer := 0; matched_count integer := 0;
  unmatched_count integer := 0; rejected_count integer := 0; errors jsonb := '[]'::jsonb; result_error text;
begin
  if jsonb_typeof(batch) <> 'array' or jsonb_array_length(batch) > 500 then raise exception 'Provide at most 500 source rows per batch'; end if;
  for input in select value from jsonb_array_elements(batch) loop
    begin
      if length(trim(coalesce(input->>'reason',''))) = 0 then raise exception 'Ingestion reason required'; end if;
      if input->>'sitting_date' is null or input->>'student_identifier' is null or input->'raw_payload' is null then raise exception 'Source identity, sitting date and raw evidence are required'; end if;
      perform (input->>'sitting_date')::date;
      if input->>'score' is not null and (input->>'score')::numeric not between 0 and 100 then raise exception 'Source score outside 0..100'; end if;
      if input->>'pass_mark' is not null and (input->>'pass_mark')::numeric not between 0 and 100 then raise exception 'Source pass mark outside 0..100'; end if;
      if jsonb_typeof(coalesce(input->'items','[]'::jsonb)) <> 'array' then raise exception 'Source items must be an array'; end if;
      for item in select value from jsonb_array_elements(coalesce(input->'items','[]'::jsonb)) loop
        if item->>'kind' is null or item->>'kind' not in ('mcq','physics','coursework','viva') or item->>'score' is null or (item->>'score')::numeric not between 0 and 100 then
          raise exception 'Malformed assessment item';
        end if;
      end loop;
      perform pg_advisory_xact_lock(hashtextextended((input->>'source_system') || ':' || (input->>'source_key'),0));
      select * into source_row from public.module_assessment_source_results where source_system = input->>'source_system' and source_key = input->>'source_key' for update;
      is_new := not found;
      source_payload_hash := md5((input - 'reason')::text);
      if is_new then
        insert into public.module_assessment_source_results(source_system, source_key, student_identifier, student_name, module_id, component)
        values(input->>'source_system',input->>'source_key',input->>'student_identifier',coalesce(input->>'student_name',''),nullif(input->>'module_id','')::uuid,input->>'component') returning * into source_row;
      else
        select * into previous_version from public.module_assessment_source_versions where source_id = source_row.id order by revision desc limit 1;
        if exists(select 1 from public.module_assessment_source_versions version where version.source_id = source_row.id and version.payload_hash = source_payload_hash) then unchanged_count := unchanged_count + 1; continue; end if;
      end if;
      insert into public.module_assessment_source_versions(source_id,revision,payload_hash,payload)
      values(source_row.id, coalesce((select max(revision) from public.module_assessment_source_versions where source_id = source_row.id),0)+1,source_payload_hash,input)
      returning id into version_key;
      result_error := null;
      if source_row.student_identifier <> input->>'student_identifier' or source_row.module_id is distinct from nullif(input->>'module_id','')::uuid or source_row.component <> input->>'component' then
        result_error := 'Source identity/module/component changed; administrator reconciliation required';
      elsif is_new then
        select array_agg(enrolment.id order by enrolment.id) into candidate_ids from public.active_module_enrolments enrolment
          join public.students student on student.id = enrolment.student_id
          join public.module_offerings offering on offering.id = enrolment.offering_id
          join public.module_assessment_plans plan on plan.id = enrolment.assessment_plan_id
          join public.terms term on term.id = offering.term_id
          where source_row.student_identifier in (student.cccu_student_id,student.temporary_id) and offering.module_id = source_row.module_id
            and term.starts_on <= (input->>'sitting_date')::date and (source_row.component = 'theory' or plan.mode = 'practical');
        if cardinality(candidate_ids) = 1 then
          candidate_id := candidate_ids[1];
          begin
            perform public.assessment_new_attempt(candidate_id,source_row.component,input,source_row.source_system,source_row.id,version_key);
            update public.module_assessment_source_results set state = 'Matched' where id = source_row.id;
            current_projection := public.assessment_recalculate(candidate_id,input->>'reason');
            matched_count := matched_count + 1;
          exception when others then result_error := sqlerrm;
          end;
        else result_error := 'Missing or ambiguous enrolment ownership';
        end if;
      elsif source_row.state = 'Matched' and not source_row.administratively_displaced then
        select * into strict attempt_row from public.module_assessment_attempts where source_id = source_row.id and active;
        begin
          perform 1 from public.active_module_enrolments where id = attempt_row.enrolment_id for update;
          perform public.assessment_write_revision(attempt_row.id,input,input->>'reason',version_key);
          current_projection := public.assessment_recalculate(attempt_row.enrolment_id,input->>'reason');
        exception when others then result_error := sqlerrm;
        end;
      end if;
      update public.module_assessment_source_results set revision = revision + 1, conflict = result_error where id = source_row.id;
      insert into public.audit_events(actor_user_id,action,entity_type,entity_id,reason,metadata)
      values(actor,'assessment.source_ingested','assessment_source',source_row.id,input->>'reason',jsonb_build_object('source_version_id',version_key,'before',to_jsonb(source_row),'assessment',current_projection,'conflict',result_error));
      if is_new then created_count := created_count + 1; else updated_count := updated_count + 1; end if;
      if exists(select 1 from public.module_assessment_source_results where id = source_row.id and state = 'Unmatched') then unmatched_count := unmatched_count + 1; end if;
    exception when others then
      rejected_count := rejected_count + 1;
      errors := errors || jsonb_build_array(jsonb_build_object('source_key',input->>'source_key','error',sqlerrm));
    end;
  end loop;
  return jsonb_build_object('created',created_count,'unchanged',unchanged_count,'source_updated',updated_count,'auto_matched',matched_count,'unmatched',unmatched_count,'rejected',rejected_count,'errors',errors);
end;
$$;

create or replace function public.assessment_recalculate_teaching() returns trigger language plpgsql security definer set search_path = public as $$
declare enrolment_key uuid;
begin
  for enrolment_key in select id from public.active_module_enrolments where assessment_plan_id is not null
    and student_id in (case when tg_op <> 'DELETE' then new.student_id end, case when tg_op <> 'INSERT' then old.student_id end) order by id loop
    perform public.assessment_recalculate(enrolment_key, 'Teaching evidence changed: ' || tg_table_name);
  end loop;
  return null;
end;
$$;

create or replace view public.assessment_outcomes with (security_invoker = true) as
select enrolment.id enrolment_id, student.id student_id, coalesce(student.cccu_student_id,student.temporary_id) student_identifier,
  student.first_name || ' ' || student.last_name student_name, module.code module_code, module.title module_title,
  term.name original_cohort, public.read_enrolment_assessment(enrolment.id) assessment,
  enrolment.status legacy_status, enrolment.final_mark legacy_final_mark, enrolment.grade legacy_grade, enrolment.credits_awarded legacy_credits,
  student.temporary_id temporary_identifier
from public.active_module_enrolments enrolment join public.students student on student.id = enrolment.student_id
join public.module_offerings offering on offering.id = enrolment.offering_id join public.course_modules module on module.id = offering.module_id
join public.terms term on term.id = offering.term_id;

create or replace function public.assessment_recalculate_requirements() returns trigger
language plpgsql security definer set search_path = public as $$
declare enrolment_key uuid; old_values jsonb; new_values jsonb;
begin
  old_values := case when tg_op <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  new_values := case when tg_op <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  if tg_table_name = 'enrolments' and tg_op = 'UPDATE' and
    (old_values->'attendance_days_required_override',old_values->'presentation_required_override')
    is not distinct from (new_values->'attendance_days_required_override',new_values->'presentation_required_override') then return null; end if;
  for enrolment_key in
    select enrolment.id from public.active_module_enrolments enrolment join public.module_offerings offering on offering.id = enrolment.offering_id
    where enrolment.assessment_plan_id is not null and (
      (tg_table_name = 'enrolments' and enrolment.student_id::text in (old_values->>'student_id',new_values->>'student_id'))
      or (tg_table_name = 'attendance_sessions' and offering.term_id::text in (old_values->>'term_id',new_values->>'term_id'))
      or (tg_table_name = 'terms' and offering.term_id::text in (old_values->>'id',new_values->>'id'))
      or (tg_table_name = 'course_modules' and offering.module_id::text in (old_values->>'id',new_values->>'id'))
      or (tg_table_name = 'module_offerings' and offering.term_id::text in (old_values->>'term_id',new_values->>'term_id'))
    ) order by enrolment.id
  loop
    perform public.assessment_recalculate(enrolment_key,'Completion requirements changed: ' || tg_table_name);
  end loop;
  return null;
end;
$$;

create or replace function public.read_student_attendance(student_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_teacher() is not true then raise exception 'Active teaching staff required'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id',session.id,'termId',term.id,'term',term.name,'date',session.session_date,'startsAt',session.starts_at,'endsAt',session.ends_at,'location',session.location,
    'sessionRevision',session.workspace_revision,'revision',coalesce(version.revision,0),'canEdit',enrolled.present,
    'status',coalesce(record.status::text,case when expected.student_id is not null then 'expected' else 'not_recorded' end),
    'expected',expected.student_id is not null,'hasRecord',record.id is not null,'note',record.admin_note,'checkedInAt',record.checked_in_at,'checkedOutAt',record.checked_out_at
  ) order by session.session_date desc,session.starts_at),'[]'::jsonb)
  from public.attendance_sessions session join public.terms term on term.id=session.term_id
  left join public.attendance_records record on record.session_id=session.id and record.student_id=student_key
  left join public.expected_attendance expected on expected.session_id=session.id and expected.student_id=student_key
  left join public.attendance_workspace_versions version on version.session_id=session.id and version.student_id=student_key
  cross join lateral (select exists(select 1 from public.active_module_enrolments enrolment join public.module_offerings offering on offering.id=enrolment.offering_id
    where enrolment.student_id=student_key and offering.term_id=session.term_id) present) enrolled
  where enrolled.present or record.id is not null or expected.student_id is not null);
end;
$$;

create or replace function public.save_student_attendance(command jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare session_row public.attendance_sessions; current_version integer; before_record jsonb; before_expected boolean;
  student_key uuid := (command->>'studentId')::uuid; session_key uuid := (command->>'sessionId')::uuid;
  requested_status text := command->>'status'; expected_value boolean; after_record jsonb;
begin
  if auth.uid() is null or public.is_admin() is not true then raise exception 'Active administrator required'; end if;
  if command - array['studentId','sessionId','expectedRevision','expectedSessionRevision','status','expected','note','reason','confirmClear'] <> '{}'::jsonb
    or not (command ?& array['studentId','sessionId','expectedRevision','expectedSessionRevision','status','expected','note','reason','confirmClear']) then raise exception 'Invalid attendance command fields'; end if;
  if requested_status is null or requested_status not in ('not_recorded','expected','attended','partial','missed') then raise exception 'Select a valid attendance status'; end if;
  if jsonb_typeof(command->'reason') <> 'string' or length(trim(coalesce(command->>'reason',''))) not between 1 and 4000 then raise exception 'An administrator reason is required'; end if;
  if jsonb_typeof(command->'note') not in ('string','null') or length(coalesce(command->>'note','')) > 500
    or jsonb_typeof(command->'expected') <> 'boolean' or jsonb_typeof(command->'confirmClear') <> 'boolean' then raise exception 'Invalid attendance details'; end if;
  select * into session_row from public.attendance_sessions where id=session_key for share;
  if session_row.id is null then raise exception 'Teaching session no longer exists'; end if;
  if session_row.workspace_revision is distinct from (command->>'expectedSessionRevision')::integer then raise exception 'Session details changed. Discard and reopen to review.'; end if;
  if not exists(select 1 from public.active_module_enrolments enrolment join public.module_offerings offering on offering.id=enrolment.offering_id
    where enrolment.student_id=student_key and offering.term_id=session_row.term_id) then raise exception 'Attendance can only be edited in this student''s enrolled terms'; end if;
  insert into public.attendance_workspace_versions(session_id,student_id) values(session_key,student_key) on conflict do nothing;
  select revision into current_version from public.attendance_workspace_versions where session_id=session_key and student_id=student_key for update;
  if current_version is distinct from (command->>'expectedRevision')::integer then raise exception 'Attendance changed. Discard and reopen to review.'; end if;
  select to_jsonb(record) into before_record from public.attendance_records record where session_id=session_key and student_id=student_key for update;
  select exists(select 1 from public.expected_attendance where session_id=session_key and student_id=student_key) into before_expected;
  if requested_status in ('not_recorded','expected') and before_record is not null and (command->>'confirmClear')::boolean is not true then
    raise exception 'Confirm clearing the recorded attendance and check-in/out details';
  end if;
  expected_value := case when requested_status in ('missed','expected') then true when requested_status='not_recorded' then false else (command->>'expected')::boolean end;
  if expected_value then
    insert into public.expected_attendance(session_id,student_id) values(session_key,student_key) on conflict do nothing;
  else
    delete from public.expected_attendance where session_id=session_key and student_id=student_key;
  end if;
  if requested_status in ('not_recorded','expected') then
    delete from public.attendance_records where session_id=session_key and student_id=student_key;
  else
    insert into public.attendance_records as record(session_id,student_id,status,admin_note,recorded_by_user_id)
      values(session_key,student_key,requested_status::public.attendance_status,nullif(trim(command->>'note'),''),auth.uid())
      on conflict(session_id,student_id) do update set status=excluded.status,admin_note=excluded.admin_note,recorded_by_user_id=excluded.recorded_by_user_id;
  end if;
  select to_jsonb(record) into after_record from public.attendance_records record where session_id=session_key and student_id=student_key;
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,metadata,reason)
    values(auth.uid(),'save_student_attendance','student',student_key,jsonb_build_object('session_id',session_key,'before',before_record,'after',after_record,
      'before_expected',before_expected,'after_expected',expected_value),trim(command->>'reason'));
  return jsonb_build_object('studentId',student_key,'sessionId',session_key);
end;
$$;

create or replace function public.create_student_term_session(command jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare term_key uuid := (command->>'termId')::uuid; session_key uuid := (command->>'sessionId')::uuid; new_session public.attendance_sessions;
begin
  if auth.uid() is null or public.is_admin() is not true then raise exception 'Active administrator required'; end if;
  if command - array['studentId','sessionId','termId','date','startsAt','endsAt','location','reason'] <> '{}'::jsonb
    or not (command ?& array['studentId','sessionId','termId','date','startsAt','endsAt','location','reason']) then raise exception 'Invalid shared session fields'; end if;
  if length(trim(coalesce(command->>'reason',''))) not between 1 and 4000 or length(trim(coalesce(command->>'location',''))) not between 2 and 160 then raise exception 'Enter a location and administrator reason'; end if;
  perform 1 from public.terms where id=term_key for update;
  if not found then raise exception 'Term no longer exists'; end if;
  if not exists(select 1 from public.active_module_enrolments enrolment join public.module_offerings offering on offering.id=enrolment.offering_id
    where enrolment.student_id=(command->>'studentId')::uuid and offering.term_id=term_key and
      (case when enrolment.assessment_plan_id is not null then coalesce(public.assessment_evaluate(enrolment.id)->>'disposition','') not in ('Abandoned','Module deferred')
       else enrolment.status::text not in ('deferred','did_not_complete') end)) then raise exception 'Select a term with a participating module enrolment'; end if;
  if exists(select 1 from public.attendance_sessions where id=session_key or (term_id=term_key and session_date=(command->>'date')::date
    and starts_at=(command->>'startsAt')::time and ends_at=(command->>'endsAt')::time and location=trim(command->>'location'))) then
    raise exception 'This shared session already exists. Review the term register before adding another.';
  end if;
  insert into public.attendance_sessions(id,term_id,offering_id,session_date,starts_at,ends_at,location)
    values(session_key,term_key,null,(command->>'date')::date,(command->>'startsAt')::time,(command->>'endsAt')::time,trim(command->>'location')) returning * into new_session;
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,metadata,reason)
    values(auth.uid(),'create_shared_teaching_session','attendance_session',session_key,jsonb_build_object('from_student_id',command->>'studentId','session',to_jsonb(new_session)),trim(command->>'reason'));
  return session_key;
end;
$$;

create or replace function public.student_teaching_offering(student_key uuid, offering_key uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', offering.id, 'moduleId', module.id, 'termId', term.id,
    'label', module.code || ' · ' || module.title || ' · ' || term.name,
    'token', md5((to_jsonb(enrolment) || jsonb_build_object('offering', to_jsonb(offering), 'module', to_jsonb(module), 'term', to_jsonb(term)))::text))
  from public.active_module_enrolments enrolment join public.module_offerings offering on offering.id = enrolment.offering_id
  join public.course_modules module on module.id = offering.module_id join public.terms term on term.id = offering.term_id
  join public.students student on student.id = enrolment.student_id
  where enrolment.student_id = student_key and offering.id = offering_key and student.status = 'active'
    and term.id = (select id from public.terms where status = 'active' order by starts_on desc, id limit 1);
$$;

create or replace function public.student_finance_term_token(student_key uuid, term_key uuid) returns text
language sql stable set search_path = public as $$
  select md5(coalesce(jsonb_agg(jsonb_build_array(enrolment.id,enrolment.status,offering.id,offering.price_pence)
    order by enrolment.id)::text,'[]'))
  from public.active_module_enrolments enrolment join public.module_offerings offering on offering.id=enrolment.offering_id
  where enrolment.student_id=student_key and offering.term_id=term_key;
$$;

create or replace function public.save_student_finance(command jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  fields text[] := array['id','student_id','term_id','expected_version','term_token','expected_amount_pence','invoice_amount_pence','paid_amount_pence','invoice_status','payment_status','notes'];
  field_name text;
  student_key uuid;
  term_key uuid;
  record_key uuid;
  previous public.finance_records;
  saved public.finance_records;
begin
  if auth.uid() is null or public.is_admin() is not true then raise exception 'An active administrator is required'; end if;
  if jsonb_typeof(command) is distinct from 'object' or not(command ?& fields) or command-fields <> '{}'::jsonb then raise exception 'Invalid finance fields'; end if;
  foreach field_name in array fields loop
    if field_name in ('expected_amount_pence','invoice_amount_pence','paid_amount_pence') then
      if not (field_name <> 'expected_amount_pence' and command->field_name='null'::jsonb) then
        if jsonb_typeof(command->field_name) <> 'number' or (command->>field_name) !~ '^[0-9]+$' or (command->>field_name)::numeric > 2147483647 then raise exception 'Enter non-negative whole pence amounts'; end if;
      end if;
    elsif jsonb_typeof(command->field_name) <> 'string' and not(field_name in ('expected_version','term_token','notes') and command->field_name='null'::jsonb) then
      raise exception 'Invalid finance field: %',field_name;
    end if;
  end loop;
  if length(command->>'notes') > 10000 then raise exception 'Finance notes are too long'; end if;
  student_key := (command->>'student_id')::uuid; term_key := (command->>'term_id')::uuid; record_key := (command->>'id')::uuid;
  perform 1 from public.students where id=student_key for key share;
  if not found then raise exception 'Student not found'; end if;
  if command->>'expected_version' is null then
    if exists(select 1 from public.finance_records where id=record_key or (student_id=student_key and term_id=term_key)) then raise exception 'A finance record already exists. Discard this draft and reopen to review it.'; end if;
    perform 1 from public.active_module_enrolments enrolment join public.module_offerings offering on offering.id=enrolment.offering_id
      where enrolment.student_id=student_key and offering.term_id=term_key order by enrolment.id for share of enrolment,offering;
    if not found then raise exception 'Finance records can only be created for this student''s enrolled terms'; end if;
    if command->>'term_token' is distinct from public.student_finance_term_token(student_key,term_key) then
      raise exception 'Enrolments or offering prices changed. Discard this draft and reopen to review the expected fees.';
    end if;
    insert into public.finance_records(id,student_id,term_id,expected_amount_pence,invoice_amount_pence,paid_amount_pence,invoice_status,payment_status,notes)
      values(record_key,student_key,term_key,(command->>'expected_amount_pence')::integer,(command->>'invoice_amount_pence')::integer,
        (command->>'paid_amount_pence')::integer,(command->>'invoice_status')::public.invoice_status,(command->>'payment_status')::public.payment_status,nullif(trim(command->>'notes'),'')) returning * into saved;
  else
    if command->>'term_token' is not null then raise exception 'Term selection is fixed for existing finance records'; end if;
    select * into previous from public.finance_records where id=record_key for update;
    if previous.id is null or previous.student_id <> student_key or previous.term_id <> term_key or previous.workspace_version <> (command->>'expected_version')::uuid then
      raise exception 'Finance record changed, moved or was deleted. Discard this draft and reopen to review the latest record.';
    end if;
    update public.finance_records set expected_amount_pence=(command->>'expected_amount_pence')::integer,
      invoice_amount_pence=(command->>'invoice_amount_pence')::integer,paid_amount_pence=(command->>'paid_amount_pence')::integer,
      invoice_status=(command->>'invoice_status')::public.invoice_status,payment_status=(command->>'payment_status')::public.payment_status,
      notes=nullif(trim(command->>'notes'),'') where id=record_key returning * into saved;
  end if;
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),case when previous.id is null then 'create_student_finance' else 'update_student_finance' end,'finance_record',record_key,
      jsonb_build_object('before',case when previous.id is null then null else to_jsonb(previous) end,'after',to_jsonb(saved)));
  return saved.id;
end;
$$;

create or replace function public.read_student_finance_workspace(student_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() is not true then raise exception 'An active administrator is required'; end if;
  if not exists(select 1 from public.students where id=student_key) then raise exception 'Student not found'; end if;
  return jsonb_build_object(
    'records',coalesce((select jsonb_agg(jsonb_build_object(
      'id',record.id,'term_id',record.term_id,'term',term.name,'version',record.workspace_version,
      'expected_amount_pence',record.expected_amount_pence,'invoice_amount_pence',record.invoice_amount_pence,
      'paid_amount_pence',record.paid_amount_pence,'invoice_status',record.invoice_status,'payment_status',record.payment_status,'notes',record.notes)
      order by term.starts_on desc,record.id)
      from public.finance_records record join public.terms term on term.id=record.term_id where record.student_id=student_key),'[]'::jsonb),
    'terms',coalesce((select jsonb_agg(jsonb_build_object('id',eligible.id,'label',eligible.name,
      'suggestedAmountPence',eligible.amount,'token',public.student_finance_term_token(student_key,eligible.id)) order by eligible.starts_on desc,eligible.id)
      from (select term.id,term.name,term.starts_on,sum(case when enrolment.status='deferred' then 0 else offering.price_pence end) amount
        from public.active_module_enrolments enrolment join public.module_offerings offering on offering.id=enrolment.offering_id
        join public.terms term on term.id=offering.term_id
        where enrolment.student_id=student_key and not exists(select 1 from public.finance_records record where record.student_id=student_key and record.term_id=term.id)
        group by term.id) eligible),'[]'::jsonb));
end;
$$;
