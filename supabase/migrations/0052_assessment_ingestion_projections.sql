create function public.ingest_assessment_source(batch jsonb) returns jsonb
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
        select array_agg(enrolment.id order by enrolment.id) into candidate_ids from public.enrolments enrolment
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
          perform 1 from public.enrolments where id = attempt_row.enrolment_id for update;
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

create view public.assessment_outcomes with (security_invoker = true) as
select enrolment.id enrolment_id, student.id student_id, coalesce(student.cccu_student_id,student.temporary_id) student_identifier,
  student.first_name || ' ' || student.last_name student_name, module.code module_code, module.title module_title,
  term.name original_cohort, public.read_enrolment_assessment(enrolment.id) assessment,
  enrolment.status legacy_status, enrolment.final_mark legacy_final_mark, enrolment.grade legacy_grade, enrolment.credits_awarded legacy_credits,
  student.temporary_id temporary_identifier
from public.enrolments enrolment join public.students student on student.id = enrolment.student_id
join public.module_offerings offering on offering.id = enrolment.offering_id join public.course_modules module on module.id = offering.module_id
join public.terms term on term.id = offering.term_id;

create view public.assessment_attempt_history with (security_invoker = true) as
select attempt.*, revision.id revision_id, revision.revision, revision.score, revision.pass_mark, revision.passed,
  revision.sitting_date, revision.sitting_term_id, term.name sitting_term, revision.reason, revision.source_version_id,
  coalesce(public.read_enrolment_assessment(attempt.enrolment_id)->'components'->attempt.component->>'id' = attempt.id::text,false) and attempt.active is_current,
  coalesce((select jsonb_agg(to_jsonb(item) order by item.kind) from public.module_assessment_items item where item.revision_id = revision.id),'[]'::jsonb) items
from public.module_assessment_attempts attempt join public.assessment_current_revisions revision on revision.attempt_id = attempt.id
left join public.terms term on term.id = revision.sitting_term_id;

create view public.assessment_import_reconciliation with (security_invoker = true) as
select source.*, version.id version_id, version.payload, version.payload_hash,
  attempt.id attempt_id, attempt.enrolment_id,
  case when source.state = 'Replaced manually' then coalesce(revision.score = case when attempt.component = 'theory' and plan.theory_scheme = 'mcq' then
      (select case when plan.physics_weighting then sum((item->>'score')::numeric) / 2 else max((item->>'score')::numeric) end
        from jsonb_array_elements(version.payload->'items') item where item->>'kind' in ('mcq','physics')) else (version.payload->>'score')::numeric end
    and revision.sitting_date = (version.payload->>'sitting_date')::date and attempt.component = source.component
    and (version.payload->>'pass_mark' is null or revision.pass_mark = (version.payload->>'pass_mark')::numeric)
    and (select coalesce(jsonb_object_agg(item.kind,item.score),'{}'::jsonb) from public.module_assessment_items item where item.revision_id = revision.id)
      = (select coalesce(jsonb_object_agg(item->>'kind',(item->>'score')::numeric),'{}'::jsonb) from jsonb_array_elements(version.payload->'items') item),false) end replacement_agrees,
  module.code module_code, module.title module_title
from public.module_assessment_source_results source
join lateral (select * from public.module_assessment_source_versions candidate where candidate.source_id = source.id order by candidate.revision desc limit 1) version on true
left join public.module_assessment_attempts attempt on attempt.source_id = source.id and attempt.active
left join public.assessment_current_revisions revision on revision.attempt_id = attempt.id
left join public.module_assessment_plans plan on plan.id = revision.plan_id
left join public.course_modules module on module.id = source.module_id;

create view public.assessment_revision_history with (security_invoker = true) as
select revision.*, coalesce((select jsonb_agg(to_jsonb(item) order by item.kind) from public.module_assessment_items item where item.revision_id = revision.id),'[]'::jsonb) items
from public.module_assessment_attempt_revisions revision;

create function public.assessment_recalculate_teaching() returns trigger language plpgsql security definer set search_path = public as $$
declare enrolment_key uuid;
begin
  for enrolment_key in select id from public.enrolments where assessment_plan_id is not null
    and student_id in (case when tg_op <> 'DELETE' then new.student_id end, case when tg_op <> 'INSERT' then old.student_id end) order by id loop
    perform public.assessment_recalculate(enrolment_key, 'Teaching evidence changed: ' || tg_table_name);
  end loop;
  return null;
end;
$$;
create trigger assessment_attendance_change after insert or update or delete on public.attendance_records for each row execute function public.assessment_recalculate_teaching();
create trigger assessment_presentation_change after insert or update or delete on public.presentation_scores for each row execute function public.assessment_recalculate_teaching();
create trigger assessment_encounter_change after insert or update or delete on public.encounter_logs for each row execute function public.assessment_recalculate_teaching();
create trigger assessment_formative_change after insert or update or delete on public.assessment_attempts for each row execute function public.assessment_recalculate_teaching();

create function public.assessment_guard_enrolment() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated','anon','service_role') and (new.assessment_plan_id is distinct from old.assessment_plan_id
    or new.assessment_revision is distinct from old.assessment_revision or new.assessment_projection is distinct from old.assessment_projection) then
    raise exception 'Use the Assessment Recording Module';
  end if;
  if exists(select 1 from public.assessment_rollout where mode = 'live') and
    (new.status is distinct from old.status or new.credits_awarded is distinct from old.credits_awarded or new.final_mark is distinct from old.final_mark or new.grade is distinct from old.grade) then
    raise exception 'Legacy outcome fields are read-only after assessment cutover';
  end if;
  if new.offering_id <> old.offering_id and old.assessment_plan_id is not null then raise exception 'An assessment enrolment cannot change teaching ownership'; end if;
  return new;
end;
$$;
create trigger assessment_guard_enrolment before update on public.enrolments for each row execute function public.assessment_guard_enrolment();

create function public.assessment_guard_legacy_results() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from public.assessment_rollout where mode = 'live') then raise exception 'Legacy exam results are read-only after assessment cutover'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger assessment_guard_legacy_results before insert or update or delete on public.exam_results for each row execute function public.assessment_guard_legacy_results();

revoke all on function public.ingest_assessment_source(jsonb) from public, anon;
grant execute on function public.ingest_assessment_source(jsonb) to authenticated;
revoke all on function public.assessment_recalculate_teaching(), public.assessment_guard_enrolment(), public.assessment_guard_legacy_results() from public, anon, authenticated;
grant select on public.assessment_outcomes, public.assessment_attempt_history, public.assessment_import_reconciliation, public.assessment_revision_history to authenticated;
