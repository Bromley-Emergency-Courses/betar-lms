create function public.student_teaching_offering(student_key uuid, offering_key uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', offering.id, 'moduleId', module.id, 'termId', term.id,
    'label', module.code || ' · ' || module.title || ' · ' || term.name,
    'token', md5((to_jsonb(enrolment) || jsonb_build_object('offering', to_jsonb(offering), 'module', to_jsonb(module), 'term', to_jsonb(term)))::text))
  from public.enrolments enrolment join public.module_offerings offering on offering.id = enrolment.offering_id
  join public.course_modules module on module.id = offering.module_id join public.terms term on term.id = offering.term_id
  where enrolment.student_id = student_key and offering.id = offering_key;
$$;

create function public.read_student_teaching_options(student_key uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_teacher() is not true then raise exception 'Active teaching staff required'; end if;
  if not exists(select 1 from public.students where id = student_key) then raise exception 'Student not found'; end if;
  return jsonb_build_object('offerings', coalesce((select jsonb_agg(public.student_teaching_offering(student_key, offering.id) order by term.starts_on desc, module.code)
    from public.enrolments enrolment join public.module_offerings offering on offering.id = enrolment.offering_id
    join public.course_modules module on module.id = offering.module_id join public.terms term on term.id = offering.term_id
    where enrolment.student_id = student_key), '[]'::jsonb),
    'definitions', coalesce((select jsonb_agg(jsonb_build_object('id', definition.id, 'moduleId', definition.module_id, 'name', definition.name,
      'domains', definition.domains, 'scoreMin', definition.score_min, 'scoreMax', definition.score_max, 'token', md5(to_jsonb(definition)::text)) order by definition.name, definition.id)
      from public.assessment_definitions definition where definition.active and exists(select 1 from public.enrolments enrolment
      join public.module_offerings offering on offering.id = enrolment.offering_id where enrolment.student_id = student_key and offering.module_id = definition.module_id)), '[]'::jsonb));
end;
$$;

create function public.create_student_teaching_record(command jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid(); record_key uuid; student_key uuid; offering_key uuid; entry_kind text := command->>'kind';
  offering_snapshot jsonb; definition_row public.assessment_definitions; entry_date date; saved_record jsonb;
  allowed_keys text[] := array['id','student_id','offering_id','offering_token','occurred_on','kind'];
  item_ids text[]; rubric_total integer; rubric_keys text[] := array[
    'content_material_accurate_up_to_date','content_questions_encouraged_handled_well','content_reference_slide_key_papers',
    'content_critical_reflection','content_title_slide_details','delivery_engages_audience','delivery_clear_audible_pace',
    'organisation_logical_sequence','organisation_slides_prepared_effective','global_impression_information_communicated_well'];
begin
  if actor is null or public.is_teacher() is not true then raise exception 'Active teaching staff required'; end if;
  if entry_kind = 'observation' then allowed_keys := allowed_keys || array['summary','concern_level'];
  elsif entry_kind = 'formative' then allowed_keys := allowed_keys || array['definition_id','definition_token','assessed_item_ids','overall_score','comments'];
  elsif entry_kind = 'presentation' then allowed_keys := allowed_keys || array['presentation_type','duration_minutes','scores','comments'];
  else raise exception 'Choose an observation, formative assessment or presentation'; end if;
  if jsonb_typeof(command) is distinct from 'object' or not command ?& allowed_keys or (command - allowed_keys) <> '{}'::jsonb then raise exception 'Invalid teaching record fields'; end if;
  record_key := (command->>'id')::uuid; student_key := (command->>'student_id')::uuid; offering_key := (command->>'offering_id')::uuid;
  entry_date := (command->>'occurred_on')::date;
  if record_key is null or student_key is null or offering_key is null or entry_date is null then raise exception 'Student, offering, record identifier and date are required'; end if;
  perform 1 from public.enrolments enrolment join public.module_offerings offering on offering.id = enrolment.offering_id
    join public.course_modules module on module.id = offering.module_id join public.terms term on term.id = offering.term_id
    where enrolment.student_id = student_key and offering.id = offering_key for update of enrolment for share of offering, module, term;
  offering_snapshot := public.student_teaching_offering(student_key, offering_key);
  if offering_snapshot is null then raise exception 'This student is not enrolled in the selected teaching offering'; end if;
  if command->>'offering_token' is distinct from offering_snapshot->>'token' then raise exception 'Teaching or enrolment details changed. Discard and reopen before saving.'; end if;
  if exists(select 1 from public.encounter_logs where id = record_key) or exists(select 1 from public.assessment_attempts where id = record_key)
    or exists(select 1 from public.presentation_scores where id = record_key) then raise exception 'This teaching record was already saved. Reopen the timeline to review it.'; end if;
  if command ? 'comments' and (jsonb_typeof(command->'comments') not in ('string','null') or length(command->>'comments') > 10000) then raise exception 'Comments must be text up to 10000 characters'; end if;
  if entry_kind = 'observation' then
    if jsonb_typeof(command->'summary') is distinct from 'string' or nullif(btrim(command->>'summary'),'') is null or length(command->>'summary') > 10000 then raise exception 'Enter observation details up to 10000 characters'; end if;
    if coalesce(command->>'concern_level','') not in ('none','watch','support_needed') then raise exception 'Choose a valid concern level'; end if;
    insert into public.encounter_logs(id,student_id,offering_id,staff_user_id,occurred_on,summary,concern_level)
      values(record_key,student_key,offering_key,actor,entry_date,btrim(command->>'summary'),command->>'concern_level') returning to_jsonb(encounter_logs.*) into saved_record;
  elsif entry_kind = 'formative' then
    select * into definition_row from public.assessment_definitions where id = (command->>'definition_id')::uuid for share;
    if not found or not definition_row.active or definition_row.module_id::text is distinct from offering_snapshot->>'moduleId' then raise exception 'Choose an active formative assessment for this module'; end if;
    if command->>'definition_token' is distinct from md5(to_jsonb(definition_row)::text) then raise exception 'Formative assessment configuration changed. Discard and reopen before saving.'; end if;
    if jsonb_typeof(command->'assessed_item_ids') is distinct from 'array' then raise exception 'Select at least one configured assessed item'; end if;
    select array_agg(value) into item_ids from jsonb_array_elements_text(command->'assessed_item_ids');
    if coalesce(cardinality(item_ids),0) = 0 or cardinality(item_ids) <> (select count(distinct value) from unnest(item_ids) value)
      or exists(select 1 from unnest(item_ids) selected where not exists(select 1 from jsonb_array_elements(definition_row.domains) domain where domain->>'id' = selected)) then raise exception 'Select distinct configured assessed items for this assessment'; end if;
    if jsonb_typeof(command->'overall_score') is distinct from 'number' or (command->>'overall_score')::numeric <> trunc((command->>'overall_score')::numeric)
      or (command->>'overall_score')::numeric not between definition_row.score_min and definition_row.score_max then raise exception 'Overall score must be a whole number between % and %', definition_row.score_min, definition_row.score_max; end if;
    insert into public.assessment_attempts(id,student_id,offering_id,staff_user_id,occurred_on,definition_id,assessed_item_ids,overall_score,scores,comments)
      values(record_key,student_key,offering_key,actor,entry_date,definition_row.id,item_ids,(command->>'overall_score')::integer,'{}'::jsonb,nullif(btrim(command->>'comments'),'')) returning to_jsonb(assessment_attempts.*) into saved_record;
  else
    if coalesce(command->>'presentation_type','') not in ('case_presentation','journal_club') then raise exception 'Choose a presentation type'; end if;
    if jsonb_typeof(command->'duration_minutes') is distinct from 'number' or (command->>'duration_minutes')::numeric <= 0
      or (command->>'duration_minutes')::numeric <> trunc((command->>'duration_minutes')::numeric) then raise exception 'Duration must be a positive whole number of minutes'; end if;
    if jsonb_typeof(command->'scores') is distinct from 'object' or not (command->'scores') ?& rubric_keys or ((command->'scores') - rubric_keys) <> '{}'::jsonb then raise exception 'Score every presentation rubric criterion'; end if;
    if exists(select 1 from jsonb_each(command->'scores') score where jsonb_typeof(score.value) <> 'number' or (score.value #>> '{}')::numeric not between 1 and 5
      or (score.value #>> '{}')::numeric <> trunc((score.value #>> '{}')::numeric)) then raise exception 'Each rubric score must be a whole number from 1 to 5'; end if;
    select sum((value #>> '{}')::integer) into rubric_total from jsonb_each(command->'scores');
    insert into public.presentation_scores(id,student_id,offering_id,staff_user_id,occurred_on,presentation_type,duration_minutes,scores,total_score,comments)
      values(record_key,student_key,offering_key,actor,entry_date,command->>'presentation_type',(command->>'duration_minutes')::integer,command->'scores',rubric_total,nullif(btrim(command->>'comments'),'')) returning to_jsonb(presentation_scores.*) into saved_record;
  end if;
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,reason,metadata)
    values(actor,'teaching.record_created','student_teaching',record_key,'Teaching record entered',jsonb_build_object('kind',entry_kind,'student_id',student_key,'record',saved_record,
      'definition',case when entry_kind = 'formative' then to_jsonb(definition_row) end));
  return jsonb_build_object('id',record_key,'kind',entry_kind);
exception when unique_violation then raise exception 'This teaching record was already saved. Reopen the timeline to review it.';
when deadlock_detected or serialization_failure then raise exception 'Related teaching records changed while saving. Discard and reopen before saving.';
end;
$$;

revoke all on function public.student_teaching_offering(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.read_student_teaching_options(uuid), public.create_student_teaching_record(jsonb) from public, anon, service_role;
grant execute on function public.read_student_teaching_options(uuid), public.create_student_teaching_record(jsonb) to authenticated;
