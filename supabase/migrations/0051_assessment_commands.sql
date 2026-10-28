create function public.assessment_write_revision(attempt_key uuid, input jsonb, change_reason text, source_version uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  attempt_row public.module_assessment_attempts; plan_row public.module_assessment_plans;
  item jsonb; item_kind text; item_score numeric; carried_item public.module_assessment_items;
  expected_items text[] := '{}'; supplied_items text[] := '{}'; item_values jsonb := '{}'::jsonb;
  result_score numeric; result_pass_mark numeric; revision_id uuid; revision_number integer; current_pass_mark numeric;
begin
  select * into strict attempt_row from public.module_assessment_attempts where id = attempt_key;
  select plan.* into strict plan_row from public.module_assessment_plans plan join public.enrolments enrolment on enrolment.assessment_plan_id = plan.id where enrolment.id = attempt_row.enrolment_id;
  if (input->>'sitting_date')::date > current_date then raise exception 'A future scheduled sitting is not a completed assessment attempt'; end if;
  if attempt_row.component = 'practical' and plan_row.mode <> 'practical' then raise exception 'Online modules have no Practical component'; end if;
  if attempt_row.component = 'theory' then
    if plan_row.theory_scheme = 'mcq' then expected_items := array['mcq'];
      if plan_row.physics_weighting then expected_items := array_append(expected_items, 'physics'); end if;
    else
      if plan_row.requires_coursework then expected_items := array_append(expected_items, 'coursework'); end if;
      if plan_row.requires_viva then expected_items := array_append(expected_items, 'viva'); end if;
    end if;
  end if;
  for item in select value from jsonb_array_elements(coalesce(input->'items', '[]'::jsonb)) loop
    item_kind := item->>'kind';
    if item_kind is null or not item_kind = any(expected_items) or item_kind = any(supplied_items) then raise exception 'Invalid or duplicate assessment item'; end if;
    if item->>'carried_from_item_id' is not null then
      if item_kind = 'mcq' then raise exception 'MCQ must be newly assessed'; end if;
      select carried.* into carried_item from public.module_assessment_items carried
        join public.module_assessment_attempt_revisions revision on revision.id = carried.revision_id
        join public.module_assessment_attempts earlier on earlier.id = revision.attempt_id
        where carried.id = (item->>'carried_from_item_id')::uuid and carried.kind = item_kind
          and earlier.enrolment_id = attempt_row.enrolment_id and earlier.component = attempt_row.component and earlier.ordinal < attempt_row.ordinal
          and earlier.active and revision.id = (select id from public.assessment_current_revisions where attempt_id = earlier.id);
      if not found then raise exception 'Carried item must identify an earlier attempt of this enrolment/component'; end if;
      item_score := carried_item.score;
    else
      item_score := (item->>'score')::numeric;
    end if;
    if item_score is null or item_score not between 0 and 100 then raise exception 'Every required item needs a score from 0 to 100 or an explicit carry-forward'; end if;
    supplied_items := array_append(supplied_items, item_kind);
    item_values := item_values || jsonb_build_object(item_kind, item_score);
  end loop;
  if cardinality(supplied_items) <> cardinality(expected_items) then raise exception 'Required assessment items are missing'; end if;
  if attempt_row.component = 'theory' and plan_row.theory_scheme = 'mcq' then
    result_score := (item_values->>'mcq')::numeric;
    if plan_row.physics_weighting then result_score := (result_score + (item_values->>'physics')::numeric) / 2; end if;
  else result_score := (input->>'score')::numeric;
  end if;
  select pass_mark into current_pass_mark from public.assessment_current_revisions where attempt_id = attempt_key;
  result_pass_mark := coalesce((input->>'pass_mark')::numeric, current_pass_mark,
    case when attempt_row.component = 'theory' then plan_row.theory_pass_mark else plan_row.practical_pass_mark end);
  select coalesce(max(revision), 0) + 1 into revision_number from public.module_assessment_attempt_revisions where attempt_id = attempt_key;
  insert into public.module_assessment_attempt_revisions(attempt_id, revision, plan_id, score, pass_mark, sitting_date, sitting_term_id, source_version_id, reason, actor_id)
  values(attempt_key, revision_number, plan_row.id, result_score, result_pass_mark, (input->>'sitting_date')::date,
    nullif(input->>'sitting_term_id','')::uuid, source_version, change_reason, auth.uid()) returning id into revision_id;
  for item in select value from jsonb_array_elements(coalesce(input->'items', '[]'::jsonb)) loop
    insert into public.module_assessment_items(revision_id, kind, score, carried_from_item_id)
    values(revision_id, item->>'kind', (item_values->>(item->>'kind'))::numeric, nullif(item->>'carried_from_item_id','')::uuid);
  end loop;
  return revision_id;
end;
$$;

create function public.assessment_new_attempt(enrolment_key uuid, component_name text, input jsonb, origin_name text, source_key uuid default null, source_version uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare previous_attempt public.module_assessment_attempts; next_ordinal integer; next_sequence integer; attempt_key uuid;
begin
  perform 1 from public.enrolments where id = enrolment_key for update;
  select * into previous_attempt from public.module_assessment_attempts where enrolment_id = enrolment_key and component = component_name and active order by ordinal desc limit 1;
  if previous_attempt.id is null and coalesce((input->>'known_resit')::boolean,false) and length(trim(coalesce(input->>'previous_result_unavailable',''))) = 0 then
    raise exception 'Known resit requires a Previous result unavailable reason/reference';
  end if;
  if exists(select 1 from public.assessment_current_revisions where attempt_id = previous_attempt.id and passed) then raise exception 'A passed component cannot be resat for improvement'; end if;
  if exists(select 1 from public.assessment_current_revisions where attempt_id = previous_attempt.id and sitting_date > (input->>'sitting_date')::date) then raise exception 'Historical sitting order needs administrator reconciliation'; end if;
  if previous_attempt.id is not null and input->>'previous_result_unavailable' is not null then raise exception 'A preceding result already exists'; end if;
  select coalesce(max(ordinal), 0) + 1 into next_ordinal from public.module_assessment_attempts where enrolment_id = enrolment_key and component = component_name;
  if input->>'previous_result_unavailable' is not null or (previous_attempt.id is not null and previous_attempt.sequence is null) then next_sequence := null;
  else select coalesce(max(sequence), 0) + 1 into next_sequence from public.module_assessment_attempts where enrolment_id = enrolment_key and component = component_name;
  end if;
  insert into public.module_assessment_attempts(enrolment_id, component, ordinal, sequence, predecessor_id, previous_result_unavailable, origin, source_id, created_by)
  values(enrolment_key, component_name, next_ordinal, next_sequence, previous_attempt.id, input->>'previous_result_unavailable', origin_name, source_key, auth.uid()) returning id into attempt_key;
  perform public.assessment_write_revision(attempt_key, input, input->>'reason', source_version);
  insert into public.module_assessment_arrangements(enrolment_id, component, kind, state, note, completing_attempt_id, reason, actor_id)
    select enrolment_id, component, kind, 'completed', note, attempt_key, input->>'reason', auth.uid()
    from public.assessment_current_arrangements where enrolment_id = enrolment_key and component = component_name and state = 'active';
  return attempt_key;
end;
$$;

create function public.preview_enrolment_assessment_plan(enrolment_key uuid, plan_key uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assessment_require_admin();
  if not exists(select 1 from public.enrolments enrolment join public.module_offerings offering on offering.id = enrolment.offering_id
    join public.module_assessment_plans plan on plan.module_id = offering.module_id where enrolment.id = enrolment_key and plan.id = plan_key) then raise exception 'Plan must belong to the enrolment module'; end if;
  return jsonb_build_object('before', public.assessment_evaluate(enrolment_key), 'after', public.assessment_evaluate(enrolment_key, current_date, plan_key),
    'incompatible_attempts', coalesce((select jsonb_agg(attempt.id) from public.module_assessment_attempts attempt
      join public.assessment_current_revisions revision on revision.attempt_id = attempt.id
      cross join public.module_assessment_plans proposed
      where attempt.enrolment_id = enrolment_key and attempt.active and proposed.id = plan_key and
        ((attempt.component = 'practical' and proposed.mode <> 'practical') or (attempt.component = 'theory' and
          (select coalesce(array_agg(item.kind order by item.kind),'{}'::text[]) from public.module_assessment_items item where item.revision_id = revision.id)
          is distinct from (select coalesce(array_agg(kind order by kind),'{}'::text[]) from (
            select 'mcq' kind where proposed.theory_scheme = 'mcq' union all select 'physics' where proposed.physics_weighting
            union all select 'coursework' where proposed.requires_coursework union all select 'viva' where proposed.requires_viva) required)))), '[]'::jsonb),
    'attempts', coalesce((select jsonb_agg(to_jsonb(attempt)) from public.module_assessment_attempts attempt where enrolment_id = enrolment_key), '[]'::jsonb));
end;
$$;

create function public.execute_assessment_command(command jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := public.assessment_require_admin(); command_type text := command->>'type'; change_reason text := command->>'reason';
  enrolment_key uuid := nullif(command->>'enrolment_id','')::uuid; component_name text := command->>'component';
  enrolment_row public.enrolments; source_row public.module_assessment_source_results; version_row public.module_assessment_source_versions;
  attempt_row public.module_assessment_attempts; arrangement_row public.module_assessment_arrangements; plan_row public.module_assessment_plans;
  before_projection jsonb; after_projection jsonb; attempt_key uuid; identity_matches boolean; override_kind text; indicator_name text; override_value jsonb;
begin
  if change_reason is null or length(trim(change_reason)) = 0 then raise exception 'An administrator reason is required'; end if;
  if command->>'source_id' is not null then
    select * into strict source_row from public.module_assessment_source_results where id = (command->>'source_id')::uuid for update;
    if source_row.revision is distinct from (command->>'expected_source_revision')::integer then raise exception 'Source changed. Reload before saving.'; end if;
    select * into version_row from public.module_assessment_source_versions where source_id = source_row.id order by revision desc limit 1;
  end if;
  if enrolment_key is not null then
    select * into strict enrolment_row from public.enrolments where id = enrolment_key for update;
    if expected_revision is distinct from enrolment_row.assessment_revision then raise exception 'Assessment changed. Reload before saving.'; end if;
    before_projection := public.assessment_evaluate(enrolment_key);
    select * into plan_row from public.module_assessment_plans where id = enrolment_row.assessment_plan_id;
    if plan_row.id is null and command_type <> 'ChangeEnrolmentAssessmentPlan' then raise exception 'Review and assign an assessment plan first'; end if;
    if component_name is not null and (component_name not in ('theory','practical') or (component_name = 'practical' and plan_row.mode <> 'practical')) then raise exception 'Invalid component for this plan'; end if;
  elsif command_type not in ('VoidSourceResult','RestoreSourceResult') then raise exception 'Enrolment is required';
  end if;
  case command_type
  when 'AddManualAttempt' then
    attempt_key := public.assessment_new_attempt(enrolment_key, component_name, command, 'Manual');
  when 'CorrectManualAttempt' then
    select * into strict attempt_row from public.module_assessment_attempts where id = (command->>'attempt_id')::uuid and enrolment_id = enrolment_key and active;
    if attempt_row.origin <> 'Manual' then raise exception 'Imported results must be unmatched and replaced manually'; end if;
    perform public.assessment_write_revision(attempt_row.id, command, change_reason);
  when 'MatchSourceResult' then
    if source_row.id is null or source_row.state <> 'Unmatched' then raise exception 'Only Unmatched evidence can be matched'; end if;
    if source_row.module_id is distinct from (select module_id from public.module_offerings where id = enrolment_row.offering_id) then raise exception 'Source module is incompatible'; end if;
    select source_row.student_identifier in (student.cccu_student_id, student.temporary_id) into identity_matches from public.students student where id = enrolment_row.student_id;
    if identity_matches is not true and length(trim(coalesce(command->>'identity_override_reason',''))) = 0 then raise exception 'Source Identity Override reason required for a different student'; end if;
    select * into attempt_row from public.module_assessment_attempts where source_id = source_row.id and enrolment_id = enrolment_key order by ordinal desc limit 1;
    if attempt_row.id is not null then
      if exists(select 1 from public.module_assessment_attempts where enrolment_id = enrolment_key and component = attempt_row.component and active and ordinal > attempt_row.ordinal) then raise exception 'A later attempt exists; review history before restoring this sitting'; end if;
      update public.module_assessment_attempts set active = true where id = attempt_row.id;
      perform public.assessment_write_revision(attempt_row.id, version_row.payload, change_reason, version_row.id);
    else
      attempt_key := public.assessment_new_attempt(enrolment_key, source_row.component, version_row.payload || jsonb_build_object('reason',change_reason,'previous_result_unavailable',command->>'previous_result_unavailable'), source_row.source_system, source_row.id, version_row.id);
    end if;
    update public.module_assessment_source_results set state = 'Matched', administratively_displaced = true,
      identity_override_reason = case when identity_matches is not true then command->>'identity_override_reason' end, conflict = null where id = source_row.id;
  when 'UnmatchSourceResult' then
    if source_row.state <> 'Matched' or source_row.id is null then raise exception 'Only Matched evidence can be unmatched'; end if;
    update public.module_assessment_attempts set active = false where source_id = source_row.id and enrolment_id = enrolment_key and active;
    if not found then raise exception 'Source is not owned by this enrolment'; end if;
    update public.module_assessment_source_results set state = 'Unmatched', administratively_displaced = true where id = source_row.id;
  when 'ReplaceSourceResult' then
    if source_row.id is null or source_row.state <> 'Unmatched' then raise exception 'Unmatch the imported result before replacing it'; end if;
    select * into attempt_row from public.module_assessment_attempts where source_id = source_row.id and enrolment_id = enrolment_key order by ordinal desc limit 1;
    if attempt_row.id is null then
      attempt_key := public.assessment_new_attempt(enrolment_key, component_name, command || jsonb_build_object('known_resit',coalesce((version_row.payload->>'known_resit')::boolean,false)), 'Manual', source_row.id);
    else
      if exists(select 1 from public.module_assessment_attempts where enrolment_id = enrolment_key and component = attempt_row.component and active and ordinal > attempt_row.ordinal) then raise exception 'A later attempt exists; reconcile it before replacing this sitting'; end if;
      if component_name <> attempt_row.component and exists(select 1 from public.module_assessment_attempts where enrolment_id = enrolment_key and component = component_name and id <> attempt_row.id) then raise exception 'Corrected component has existing attempts; reconcile ownership first'; end if;
      update public.module_assessment_attempts set active = true, origin = 'Manual', component = component_name where id = attempt_row.id;
      perform public.assessment_write_revision(attempt_row.id, command, change_reason);
    end if;
    select source_row.student_identifier in (student.cccu_student_id, student.temporary_id) into identity_matches from public.students student where id = enrolment_row.student_id;
    if identity_matches is not true and length(trim(coalesce(command->>'identity_override_reason',''))) = 0 then raise exception 'Source Identity Override reason required'; end if;
    update public.module_assessment_source_results set state = 'Replaced manually', administratively_displaced = true,
      identity_override_reason = case when identity_matches is not true then command->>'identity_override_reason' end where id = source_row.id;
  when 'VoidSourceResult' then
    if source_row.id is null or source_row.state not in ('Unmatched','Matched') then raise exception 'Only Unmatched or Matched evidence can be voided'; end if;
    if source_row.state = 'Matched' then
      update public.module_assessment_attempts set active = false where source_id = source_row.id and enrolment_id = enrolment_key and active;
      if not found then raise exception 'Source is not owned by this enrolment'; end if;
    end if;
    update public.module_assessment_source_results set state = 'Voided', administratively_displaced = true where id = source_row.id;
  when 'RestoreSourceResult' then
    if source_row.id is null or source_row.state <> 'Voided' then raise exception 'Only Voided evidence can be restored'; end if;
    update public.module_assessment_source_results set state = 'Unmatched', administratively_displaced = true where id = source_row.id;
  when 'ScheduleResit', 'DeferAssessment', 'CancelResit', 'ClearAssessmentDeferral' then
    if component_name is null then raise exception 'Component is required'; end if;
    select * into arrangement_row from public.assessment_current_arrangements where enrolment_id = enrolment_key and component = component_name;
    if command_type in ('ScheduleResit','DeferAssessment') then
      if arrangement_row.state = 'active' then raise exception 'Clear the active arrangement first'; end if;
      if command_type = 'ScheduleResit' and (before_projection->'components'->component_name->>'passed')::boolean is distinct from false then raise exception 'Only a failed component can be scheduled for resit'; end if;
      if length(trim(coalesce(command->>'note',''))) = 0 then raise exception 'An arrangement note is required'; end if;
      if command_type = 'DeferAssessment' then
        if exists(select 1 from public.module_offerings offering join public.terms term on term.id = offering.term_id where offering.id = enrolment_row.offering_id and term.ends_on >= current_date) then raise exception 'Assessment deferral applies after teaching is complete'; end if;
        if (before_projection->'components'->component_name->>'passed')::boolean is true then raise exception 'A passed assessment cannot be deferred'; end if;
      end if;
      insert into public.module_assessment_arrangements(enrolment_id, component, kind, state, note, reason, actor_id)
      values(enrolment_key, component_name, case when command_type = 'ScheduleResit' then 'resit_schedule' else 'assessment_deferral' end, 'active', command->>'note', change_reason, actor);
    else
      if arrangement_row.state is distinct from 'active' or arrangement_row.kind <> (case when command_type = 'CancelResit' then 'resit_schedule' else 'assessment_deferral' end) then raise exception 'No matching active arrangement'; end if;
      insert into public.module_assessment_arrangements(enrolment_id, component, kind, state, note, reason, actor_id)
      values(enrolment_key, component_name, arrangement_row.kind, 'cancelled', arrangement_row.note, change_reason, actor);
    end if;
  when 'SetEnrolmentDisposition', 'ClearEnrolmentDisposition' then
    insert into public.enrolment_disposition_events(enrolment_id, disposition, reason, actor_id)
    values(enrolment_key, case when command_type = 'SetEnrolmentDisposition' then command->>'disposition' end, change_reason, actor);
    if command_type = 'SetEnrolmentDisposition' and command->>'disposition' is null then raise exception 'Disposition is required'; end if;
  when 'SetAssessmentOverride', 'ClearAssessmentOverride' then
    override_kind := command->>'kind'; indicator_name := coalesce(command->>'indicator','');
    override_value := case when command_type = 'SetAssessmentOverride' then command->'value' end;
    if command_type = 'SetAssessmentOverride' then
      if override_value is null or override_value = 'null'::jsonb then raise exception 'Override value required'; end if;
      if override_kind = 'status' and (override_value #>> '{}') not in ('Planned','In progress','Abandoned','Pass','Fail','Module deferred','Assessment deferred') then raise exception 'Invalid status'; end if;
      if override_kind = 'credits' and (jsonb_typeof(override_value) <> 'number' or (override_value #>> '{}')::numeric < 0 or (override_value #>> '{}')::numeric <> trunc((override_value #>> '{}')::numeric)) then raise exception 'Credits must be a nonnegative integer'; end if;
      if override_kind = 'indicator' and jsonb_typeof(override_value) <> 'boolean' then raise exception 'Indicator value must be boolean'; end if;
    end if;
    if override_kind = 'indicator' and indicator_name not in ('Attendance non-compliance','Presentation incomplete','theory:Resit required','theory:Resit scheduled','practical:Resit required','practical:Resit scheduled') then raise exception 'Invalid indicator'; end if;
    if override_kind <> 'indicator' and indicator_name <> '' then raise exception 'Unexpected indicator'; end if;
    if indicator_name like 'practical:%' and plan_row.mode <> 'practical' then raise exception 'Online modules have no Practical indicator'; end if;
    if override_kind = 'indicator' and override_value = 'true'::jsonb and indicator_name like '%:Resit %' then
      insert into public.enrolment_assessment_overrides(enrolment_id, kind, indicator, value, reason, actor_id)
      values(enrolment_key, 'indicator', split_part(indicator_name, ':', 1) || case when indicator_name like '%required' then ':Resit scheduled' else ':Resit required' end, null, change_reason, actor);
    end if;
    insert into public.enrolment_assessment_overrides(enrolment_id, kind, indicator, value, reason, actor_id)
    values(enrolment_key, override_kind, indicator_name, override_value, change_reason, actor);
  when 'ChangeEnrolmentAssessmentPlan' then
    if command->'preview' is distinct from public.preview_enrolment_assessment_plan(enrolment_key, (command->>'plan_id')::uuid) then raise exception 'Review the current plan impact preview before saving'; end if;
    if jsonb_array_length(command->'preview'->'incompatible_attempts') > 0 then raise exception 'Existing accepted items are incompatible with the proposed plan; reconcile the listed attempts first'; end if;
    update public.enrolments set assessment_plan_id = (command->>'plan_id')::uuid where id = enrolment_key;
  else raise exception 'Unknown assessment command';
  end case;
  if source_row.id is not null then update public.module_assessment_source_results set revision = revision + 1 where id = source_row.id; end if;
  if enrolment_key is not null then after_projection := public.assessment_recalculate(enrolment_key, change_reason); end if;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, reason, metadata)
  values(actor, 'assessment.' || command_type, 'enrolment_assessment', coalesce(enrolment_key, source_row.id), change_reason,
    jsonb_build_object('command',command, 'before',before_projection, 'after',after_projection, 'source_before',to_jsonb(source_row)));
  return jsonb_build_object('assessment',after_projection,'source_id',source_row.id,'pass_reversed',coalesce((after_projection->>'pass_reversed')::boolean,false));
end;
$$;
revoke all on function public.assessment_write_revision(uuid,jsonb,text,uuid), public.assessment_new_attempt(uuid,text,jsonb,text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.execute_assessment_command(jsonb,integer), public.preview_enrolment_assessment_plan(uuid,uuid) from public, anon;
grant execute on function public.execute_assessment_command(jsonb,integer), public.preview_enrolment_assessment_plan(uuid,uuid) to authenticated;
