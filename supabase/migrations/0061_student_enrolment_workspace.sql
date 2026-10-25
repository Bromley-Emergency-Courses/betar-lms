create function public.student_enrolment_removal_reasons(enrolment_key uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare enrolment_row public.enrolments; reasons text[] := '{}'; reference_row record; referenced boolean;
begin
  select * into strict enrolment_row from public.enrolments where id = enrolment_key;
  for reference_row in
    select relation.relname, attribute.attname from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_attribute attribute on attribute.attrelid = relation.oid and attribute.attnum = constraint_row.conkey[1]
    where constraint_row.contype = 'f' and constraint_row.confrelid = 'public.enrolments'::regclass and namespace.nspname = 'public'
  loop
    execute format('select exists(select 1 from public.%I where %I = $1)', reference_row.relname, reference_row.attname) into referenced using enrolment_key;
    if referenced then reasons := array_append(reasons, case reference_row.relname
      when 'enrolment_assessment_history' then 'Calculated assessment history is retained, even when no exam score has been entered.'
      when 'module_assessment_attempts' then 'Assessment attempts and their complete history must be retained.'
      when 'module_assessment_arrangements' then 'Assessment arrangements must be retained.'
      when 'enrolment_disposition_events' then 'Module participation decisions must be retained.'
      when 'enrolment_assessment_overrides' then 'Exceptional decisions must be retained.'
      else 'Linked assessment records must be retained.' end); end if;
  end loop;
  if exists(select 1 from public.exam_results where student_id = enrolment_row.student_id and offering_id = enrolment_row.offering_id)
    or exists(select 1 from public.encounter_logs where student_id = enrolment_row.student_id and offering_id = enrolment_row.offering_id)
    or exists(select 1 from public.assessment_attempts where student_id = enrolment_row.student_id and offering_id = enrolment_row.offering_id)
    or exists(select 1 from public.presentation_scores where student_id = enrolment_row.student_id and offering_id = enrolment_row.offering_id) then
    reasons := array_append(reasons, 'Exam or teaching evidence is associated with this student and offering.');
  end if;
  if exists(select 1 from public.attendance_records record join public.attendance_sessions session on session.id = record.session_id
    join public.module_offerings offering on offering.term_id = session.term_id where record.student_id = enrolment_row.student_id and offering.id = enrolment_row.offering_id)
    or exists(select 1 from public.expected_attendance record join public.attendance_sessions session on session.id = record.session_id
    join public.module_offerings offering on offering.term_id = session.term_id where record.student_id = enrolment_row.student_id and offering.id = enrolment_row.offering_id) then
    reasons := array_append(reasons, 'Attendance or expected-list evidence exists in this teaching term.');
  end if;
  if enrolment_row.status::text <> 'planned' or enrolment_row.credits_awarded <> 0 or enrolment_row.final_mark is not null or enrolment_row.grade is not null then
    reasons := array_append(reasons, 'Recorded legacy participation or outcome evidence must be retained.');
  end if;
  return reasons;
end;
$$;

create function public.student_offering_snapshot(offering_key uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', offering.id, 'label', module.code || ' · ' || module.title || ' · ' || term.name,
    'mode', module.mode, 'planId', module.assessment_plan_id,
    'ready', module.assessment_plan_id is not null and plan.mode = module.mode,
    'firstDays', offering.attendance_days_required_first_practical,
    'subsequentDays', offering.attendance_days_required_subsequent_practical, 'presentationRequired', offering.presentation_required,
    'token', md5((to_jsonb(offering) || jsonb_build_object('module', to_jsonb(module), 'term', to_jsonb(term)))::text))
  from public.module_offerings offering join public.course_modules module on module.id = offering.module_id
  join public.terms term on term.id = offering.term_id left join public.module_assessment_plans plan on plan.id = module.assessment_plan_id
  where offering.id = offering_key;
$$;

create function public.read_student_enrolments(student_key uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assessment_require_admin();
  if not exists(select 1 from public.students where id = student_key) then raise exception 'Student not found'; end if;
  return jsonb_build_object('enrolments', coalesce((select jsonb_agg(jsonb_build_object(
    'id', enrolment.id, 'offeringId', enrolment.offering_id, 'offering', public.student_offering_snapshot(enrolment.offering_id),
    'revision', enrolment.assessment_revision, 'token', md5(to_jsonb(enrolment)::text),
    'attendanceDays', enrolment.attendance_days_required_override, 'presentationRequired', enrolment.presentation_required_override,
    'assessment', case when enrolment.assessment_plan_id is not null then public.assessment_evaluate(enrolment.id) end,
    'removalReasons', public.student_enrolment_removal_reasons(enrolment.id)) order by enrolment.created_at, enrolment.id)
    from public.enrolments enrolment where enrolment.student_id = student_key), '[]'::jsonb),
    'offerings', coalesce((select jsonb_agg(public.student_offering_snapshot(offering.id) order by term.starts_on desc, module.code)
    from public.module_offerings offering join public.terms term on term.id = offering.term_id join public.course_modules module on module.id = offering.module_id
    where not exists(select 1 from public.enrolments where student_id = student_key and offering_id = offering.id)), '[]'::jsonb));
end;
$$;

alter function public.execute_assessment_command(jsonb,integer) rename to execute_assessment_command_v4;
revoke all on function public.execute_assessment_command_v4(jsonb,integer) from public, anon, authenticated, service_role;

create function public.execute_assessment_command(command jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := public.assessment_require_admin(); command_type text := command->>'type';
  enrolment_key uuid; student_key uuid; offering_key uuid; enrolment_row public.enrolments;
  before_projection jsonb; after_projection jsonb; result jsonb; offering_snapshot jsonb;
  removal_reasons text[]; peer_key uuid; allowed_keys text[]; required_keys text[];
begin
  if command_type not in ('CreateModuleEnrolment','SetEnrolmentRequirements','RemoveModuleEnrolment','SetEnrolmentDisposition','ClearEnrolmentDisposition') then
    return public.execute_assessment_command_v4(command, expected_revision);
  end if;
  required_keys := array['type','enrolment_id','reason'];
  allowed_keys := required_keys || array['student_id','expected_token'];
  if command_type in ('CreateModuleEnrolment','SetEnrolmentRequirements','RemoveModuleEnrolment') then
    required_keys := required_keys || array['student_id'];
    if command_type <> 'CreateModuleEnrolment' then required_keys := required_keys || array['expected_token']; end if;
  end if;
  if command_type = 'CreateModuleEnrolment' then required_keys := required_keys || array['offering_id','offering_token']; end if;
  if command_type in ('CreateModuleEnrolment','SetEnrolmentRequirements') then required_keys := required_keys || array['attendance_days','presentation_required']; end if;
  if command_type = 'RemoveModuleEnrolment' then required_keys := required_keys || array['confirmed']; end if;
  if command_type = 'SetEnrolmentDisposition' then required_keys := required_keys || array['disposition']; end if;
  allowed_keys := allowed_keys || required_keys;
  if jsonb_typeof(command) <> 'object' or not command ?& required_keys or (command - allowed_keys) <> '{}'::jsonb then raise exception 'Invalid enrolment command fields'; end if;
  if nullif(btrim(command->>'reason'),'') is null or length(command->>'reason') > 4000 then raise exception 'Enter an administrator reason'; end if;
  enrolment_key := (command->>'enrolment_id')::uuid;
  student_key := (command->>'student_id')::uuid;
  if enrolment_key is null then raise exception 'Enrolment is required'; end if;
  if command_type in ('CreateModuleEnrolment','SetEnrolmentRequirements') then
    if command->'attendance_days' <> 'null'::jsonb and (jsonb_typeof(command->'attendance_days') <> 'number'
      or (command->>'attendance_days')::numeric < 0 or (command->>'attendance_days')::numeric <> trunc((command->>'attendance_days')::numeric)) then raise exception 'Attendance days must be a nonnegative whole number or inherited'; end if;
    if jsonb_typeof(command->'presentation_required') not in ('boolean','null') then raise exception 'Presentation requirement must be true, false or inherited'; end if;
  end if;
  if command_type = 'RemoveModuleEnrolment' then
    lock table public.exam_results, public.encounter_logs, public.assessment_attempts, public.presentation_scores,
      public.attendance_records, public.expected_attendance, public.attendance_sessions in share mode;
  end if;
  if command_type = 'CreateModuleEnrolment' then
    if student_key is null or expected_revision is distinct from 0 then raise exception 'Invalid new enrolment'; end if;
    perform 1 from public.students where id = student_key for update;
    if not found then raise exception 'Student not found'; end if;
    offering_key := (command->>'offering_id')::uuid;
    perform 1 from public.module_offerings offering join public.course_modules module on module.id = offering.module_id
      join public.terms term on term.id = offering.term_id where offering.id = offering_key for share of offering, module, term;
    offering_snapshot := public.student_offering_snapshot(offering_key);
    if offering_snapshot is null or (offering_snapshot->>'ready')::boolean is not true then raise exception 'Review the module assessment plan in Course configuration before enrolling'; end if;
    if command->>'offering_token' is distinct from offering_snapshot->>'token' then raise exception 'Offering configuration changed. Discard and reopen before saving.'; end if;
    if exists(select 1 from public.enrolments where id = enrolment_key or (student_id = student_key and offering_id = offering_key)) then raise exception 'This teaching enrolment already exists. Review it rather than adding another.'; end if;
    insert into public.enrolments(id, student_id, offering_id, attendance_days_required_override, presentation_required_override)
      values(enrolment_key, student_key, offering_key, (command->>'attendance_days')::integer, (command->>'presentation_required')::boolean);
    after_projection := public.assessment_evaluate(enrolment_key);
  else
    select * into enrolment_row from public.enrolments where id = enrolment_key for update;
    if not found then raise exception 'Enrolment no longer exists. Reopen the workspace.'; end if;
    if command ? 'student_id' and student_key is distinct from enrolment_row.student_id then raise exception 'Enrolment does not belong to this student'; end if;
    student_key := enrolment_row.student_id;
    if expected_revision is distinct from enrolment_row.assessment_revision or
      (command ? 'expected_token' and command->>'expected_token' is distinct from md5(to_jsonb(enrolment_row)::text)) then raise exception 'Enrolment changed. Discard and reopen before saving.'; end if;
    before_projection := case when enrolment_row.assessment_plan_id is not null then public.assessment_evaluate(enrolment_key) end;
    if command_type = 'RemoveModuleEnrolment' then
      if command->'confirmed' is distinct from 'true'::jsonb then raise exception 'Confirm removal of this unused enrolment'; end if;
      removal_reasons := public.student_enrolment_removal_reasons(enrolment_key);
      if cardinality(removal_reasons) > 0 then raise exception 'Cannot remove this enrolment: % Use defer or abandon for participation changes.', array_to_string(removal_reasons, ' '); end if;
      begin
        delete from public.enrolments where id = enrolment_key;
      exception when foreign_key_violation then
        raise exception 'Cannot remove this enrolment: linked records must be retained. Use defer or abandon for participation changes.';
      end;
    else
      if enrolment_row.assessment_plan_id is null then raise exception 'Review this legacy enrolment through Course configuration before changing its requirements or participation'; end if;
      if command_type = 'SetEnrolmentRequirements' then
        update public.enrolments set attendance_days_required_override = (command->>'attendance_days')::integer,
          presentation_required_override = (command->>'presentation_required')::boolean where id = enrolment_key;
        after_projection := public.assessment_evaluate(enrolment_key);
      else
        if command_type = 'SetEnrolmentDisposition' and coalesce(command->>'disposition','') not in ('Abandoned','Module deferred') then raise exception 'Choose abandon or defer module'; end if;
        if command_type = 'ClearEnrolmentDisposition' and before_projection->>'disposition' is null then raise exception 'There is no module participation decision to clear'; end if;
        result := public.execute_assessment_command_v4(command, expected_revision);
        for peer_key in select id from public.enrolments where student_id = student_key and id <> enrolment_key and assessment_plan_id is not null order by id loop
          perform public.assessment_recalculate(peer_key, 'Related module participation changed: ' || (command->>'reason'));
        end loop;
        return result;
      end if;
    end if;
  end if;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, reason, metadata)
    values(actor, 'assessment.' || command_type, 'enrolment_assessment', enrolment_key, btrim(command->>'reason'),
      jsonb_build_object('student_id', student_key, 'before_enrolment', case when enrolment_row.id is not null then to_jsonb(enrolment_row) end,
        'before', before_projection, 'after', after_projection, 'command', command));
  return jsonb_build_object('assessment', after_projection, 'source_id', null,
    'pass_reversed', coalesce(before_projection->>'calculated_status' = 'Pass' and after_projection->>'calculated_status' <> 'Pass', false));
exception when deadlock_detected or serialization_failure then
  raise exception 'Related records changed while saving. Discard and reopen to review the latest enrolment.';
when unique_violation then
  raise exception 'This enrolment or related record already exists. Reopen the workspace to review it.';
end;
$$;

revoke all on function public.student_enrolment_removal_reasons(uuid), public.student_offering_snapshot(uuid) from public, anon, authenticated, service_role;
revoke all on function public.read_student_enrolments(uuid), public.execute_assessment_command(jsonb,integer) from public, anon, service_role;
grant execute on function public.read_student_enrolments(uuid), public.execute_assessment_command(jsonb,integer) to authenticated;
