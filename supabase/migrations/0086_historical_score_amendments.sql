create table public.assessment_historical_score_changes (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references public.assessment_historical_outcomes(enrolment_id) on delete restrict,
  result_id uuid not null,
  original_result_id uuid references public.exam_results(id) on delete restrict,
  revision integer not null check (revision > 0),
  component text not null check (component in ('theory','practical')),
  score numeric not null check (score between 0 and 100),
  pass_mark numeric not null check (pass_mark between 0 and 100),
  taken_on date not null,
  attempt_number integer not null check (attempt_number > 0),
  is_resit boolean not null,
  previous_result_id uuid,
  plan_id uuid references public.module_assessment_plans(id) on delete restrict,
  items jsonb not null default '[]'::jsonb,
  calculation jsonb not null,
  reason text not null check (length(btrim(reason)) between 1 and 4000),
  actor_id uuid not null references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  event_order bigint generated always as identity unique,
  unique (result_id, revision)
);
create index historical_score_changes_enrolment on public.assessment_historical_score_changes(enrolment_id,event_order desc);
alter table public.assessment_historical_score_changes enable row level security;
create policy historical_score_changes_read on public.assessment_historical_score_changes for select using (public.is_teacher());
revoke all on public.assessment_historical_score_changes from public, anon, authenticated, service_role;
grant select on public.assessment_historical_score_changes to authenticated;
create trigger historical_score_changes_immutable before update or delete on public.assessment_historical_score_changes
  for each row execute function public.assessment_immutable();
create trigger assessment_operational_pause before insert or update or delete or truncate on public.assessment_historical_score_changes
  for each statement execute function public.guard_paused_assessment_writes();
create trigger retain_enrolment_evidence after insert on public.assessment_historical_score_changes
  for each row execute function public.retain_enrolment_evidence_trigger();
create trigger guard_cancelled_enrolment_evidence before insert on public.assessment_historical_score_changes
  for each row execute function public.guard_cancelled_enrolment_evidence();

create function public.guard_historical_score_workflow() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.assessment_historical_score_changes where enrolment_id=new.enrolment_id) then
    raise exception 'This enrolment has audited historical score amendments. Use the historical result editor; do not activate or backfill it into another workflow.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_historical_score_workflow() from public,anon,authenticated,service_role;
create trigger guard_historical_score_workflow before insert on public.module_assessment_attempts
  for each row execute function public.guard_historical_score_workflow();
create trigger guard_historical_score_workflow before insert on public.assessment_current_activations
  for each row execute function public.guard_historical_score_workflow();

alter view public.assessment_historical_results rename to assessment_historical_original_results;
create view public.assessment_historical_results with (security_invoker=true) as
with latest as (
  select distinct on (result_id) * from public.assessment_historical_score_changes order by result_id, revision desc
), effective as (
  select (jsonb_populate_record(null::public.assessment_historical_original_results,
    to_jsonb(original) || case when change.id is null then '{}'::jsonb else jsonb_build_object(
      'score',change.score,'passed',change.score>=change.pass_mark,'resit_required',change.score<change.pass_mark) end)).*
  from public.assessment_historical_original_results original left join latest change on change.original_result_id=original.id and change.enrolment_id=original.enrolment_id
  union all
  select (jsonb_populate_record(null::public.assessment_historical_original_results,jsonb_build_object(
    'id',change.result_id,'enrolment_id',enrolment.id,'student_id',student.id,'offering_id',offering.id,
    'student_identifier',coalesce(student.cccu_student_id,student.temporary_id),'student_name',concat_ws(' ',student.first_name,student.last_name),
    'module_code',module.code,'module_title',module.title,'original_cohort',term.name,'original_term_id',term.id,
    'component',change.component,'score',change.score,'pass_mark',change.pass_mark,'passed',change.score>=change.pass_mark,
    'resit_required',change.score<change.pass_mark,'attempt_number',change.attempt_number,'is_resit',change.is_resit,
    'prior_attempt_missing',false,'resit_of_result_id',change.previous_result_id,'taken_on',change.taken_on,
    'source_system','manual','source_attempt_id',change.result_id::text,'reviewed_backfill',false))).*
  from latest change join public.active_module_enrolments enrolment on enrolment.id=change.enrolment_id
  join public.students student on student.id=enrolment.student_id
  join public.module_offerings offering on offering.id=enrolment.offering_id
  join public.course_modules module on module.id=offering.module_id join public.terms term on term.id=offering.term_id
  where change.original_result_id is null
)
select effective.*, change.revision amendment_revision, original.score original_score,
  coalesce((select jsonb_agg(jsonb_build_object('revision',history.revision,'score',history.score,'reason',history.reason,
    'created_at',history.created_at,'actor_name',staff.full_name,'items',history.items) order by history.revision)
    from public.assessment_historical_score_changes history join public.staff_profiles staff on staff.id=history.actor_id
    where history.result_id=effective.id),'[]'::jsonb) amendment_history,
  change.plan_id amendment_plan_id, change.items amendment_items,
  (select to_jsonb(plan) from public.module_assessment_plans plan where plan.id=change.plan_id) amendment_plan
from effective left join latest change on change.result_id=effective.id and change.enrolment_id=effective.enrolment_id
left join public.exam_results original on original.id=effective.id;
revoke all on public.assessment_historical_results from public,anon;
grant select on public.assessment_historical_results to authenticated;

create function public.historical_exam_calculation(results jsonb, practical_required boolean, module_credits integer) returns jsonb
language plpgsql immutable set search_path=public as $$
declare component_name text; latest jsonb; components jsonb:='{}'; indicators jsonb:='[]'; failed boolean:=false; complete boolean:=true; outcome text;
begin
  foreach component_name in array array['theory','practical'] loop
    select value into latest from jsonb_array_elements(results) where value->>'component'=component_name
      order by (value->>'taken_on')::date desc,(value->>'attempt_number')::integer desc limit 1;
    if latest is not null and (select count(*) from jsonb_array_elements(results) where value->>'component'=component_name
      and value->>'taken_on'=latest->>'taken_on' and value->>'attempt_number'=latest->>'attempt_number')>1 then
      raise exception 'Multiple results identify the latest sitting. Review ambiguous history before amending.';
    end if;
    components:=components || jsonb_build_object(component_name,jsonb_build_object('component',component_name,
      'id',latest->'id','sequence',latest->'attempt_number','score',latest->'score','pass_mark',latest->'pass_mark',
      'passed',latest->'passed','origin','Historical record','revision',latest->'amendment_revision',
      'attempt_count',(select count(*) from jsonb_array_elements(results) where value->>'component'=component_name),
      'arrangement_kind',null,'arrangement_state',null,'note',null));
    if component_name='theory' or practical_required then
      if latest is null then complete:=false;
      elsif (latest->>'passed')::boolean is false then
        failed:=true; indicators:=indicators || jsonb_build_array(component_name||':Resit required');
      end if;
    end if;
  end loop;
  outcome:=case when failed then 'Fail' when complete then 'Pass' else 'In progress' end;
  return jsonb_build_object('components',components,'calculated_status',outcome,'calculated_indicators',indicators,
    'calculated_credits',case when outcome='Pass' then module_credits else 0 end,'module_credits',module_credits);
end;
$$;
revoke all on function public.historical_exam_calculation(jsonb,boolean,integer) from public,anon,authenticated,service_role;

alter function public.assessment_evaluate(uuid,date,uuid) rename to assessment_evaluate_before_historical_edits;
revoke all on function public.assessment_evaluate_before_historical_edits(uuid,date,uuid) from public,anon,authenticated,service_role;
create function public.assessment_evaluate(enrolment_key uuid,evaluation_date date default current_date,plan_override uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare projection jsonb; change public.assessment_historical_score_changes; plan_row public.module_assessment_plans;
  effective_status text; credits integer; recommended integer; indicators jsonb; decision jsonb;
begin
  projection:=public.assessment_evaluate_before_historical_edits(enrolment_key,evaluation_date,plan_override);
  if projection->'historical'->>'protected' is distinct from 'true' then return projection; end if;
  select plan.* into plan_row from public.enrolments enrolment join public.module_offerings offering on offering.id=enrolment.offering_id
    join public.course_modules module on module.id=offering.module_id join public.module_assessment_plans plan on plan.id=module.assessment_plan_id
    where enrolment.id=enrolment_key;
  projection:=jsonb_set(projection,'{historical}',projection->'historical'||jsonb_build_object('editable_scores',true,'score_plan',to_jsonb(plan_row)));
  select * into change from public.assessment_historical_score_changes where enrolment_id=enrolment_key order by event_order desc limit 1;
  if not found then return projection; end if;
  effective_status:=change.calculation->>'calculated_status';
  indicators:=change.calculation->'calculated_indicators';
  for decision in select value from jsonb_array_elements(projection->'overrides') loop
    if decision->>'kind'='status' then effective_status:=decision->>'value';
    elsif decision->>'kind'='indicator' then
      select coalesce(jsonb_agg(value),'[]'::jsonb) into indicators from jsonb_array_elements(indicators) where value#>>'{}'<>decision->>'indicator';
      if decision->'value'='true'::jsonb then
        if decision->>'indicator' like '%:Resit %' then
          select coalesce(jsonb_agg(value),'[]'::jsonb) into indicators from jsonb_array_elements(indicators)
            where value#>>'{}' not in (split_part(decision->>'indicator',':',1)||':Resit required',split_part(decision->>'indicator',':',1)||':Resit scheduled');
        end if;
        indicators:=indicators||jsonb_build_array(decision->>'indicator');
      end if;
    end if;
  end loop;
  recommended:=case when effective_status='Pass' then (change.calculation->>'module_credits')::integer else 0 end;
  credits:=case when (projection->'historical'->>'credits')::integer>0 then (projection->'historical'->>'credits')::integer else recommended end;
  for decision in select value from jsonb_array_elements(projection->'overrides') where value->>'kind'='credits' loop credits:=(decision->>'value')::integer; end loop;
  return projection || (change.calculation-'module_credits') || jsonb_build_object('effective_status',effective_status,
    'effective_indicators',indicators,'awarded_credits',credits,'recommended_credits',recommended,
    'historical',projection->'historical'||jsonb_build_object('scores_amended',true,'teaching_requirements_ignored',true));
end;
$$;
revoke all on function public.assessment_evaluate(uuid,date,uuid) from public,anon,authenticated,service_role;

alter function public.execute_assessment_command(jsonb,integer) rename to execute_assessment_command_before_historical_edits;
revoke all on function public.execute_assessment_command_before_historical_edits(jsonb,integer) from public,anon,authenticated,service_role;
create function public.execute_assessment_command(command jsonb,expected_revision integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.assessment_require_admin(); enrolment_key uuid:=(command->>'enrolment_id')::uuid;
  enrolment_row public.enrolments; module_row public.course_modules; plan_row public.module_assessment_plans;
  target public.assessment_historical_results; previous public.assessment_historical_results;
  result_key uuid; original_key uuid; component_name text:=command->>'component'; revision_number integer;
  score_value numeric; pass_mark_value numeric; sitting date; number_value integer; resit boolean; predecessor uuid;
  result_rows jsonb; calculation jsonb; before_projection jsonb; after_projection jsonb; inputs jsonb:='[]';
  required_items text[]:='{}'; supplied_items text[]:='{}'; item jsonb; values_by_kind jsonb:='{}'; uses_plan boolean:=false;
begin
  if command->>'type' not in ('RecordHistoricalScore','CorrectHistoricalScore') then
    return public.execute_assessment_command_before_historical_edits(command,expected_revision);
  end if;
  if length(btrim(coalesce(command->>'reason',''))) not between 1 and 4000 then raise exception 'An administrator reason is required'; end if;
  select * into strict enrolment_row from public.enrolments where id=enrolment_key for update;
  if expected_revision is distinct from enrolment_row.assessment_revision then raise exception 'Assessment changed. Reload before saving.'; end if;
  if public.enrolment_is_cancelled(enrolment_key) or not exists(select 1 from public.assessment_historical_outcomes where enrolment_id=enrolment_key)
    or exists(select 1 from public.assessment_current_activations where enrolment_id=enrolment_key) then raise exception 'Use the current assessment workflow for this enrolment'; end if;
  if exists(select 1 from public.module_assessment_attempts where enrolment_id=enrolment_key)
    or exists(select 1 from public.assessment_historical_results where enrolment_id=enrolment_key and represented_by_attempt_id is not null) then
    raise exception 'This history already has linked current-workflow attempts. Review those before amending historical scores.';
  end if;
  select module.* into strict module_row from public.module_offerings offering join public.course_modules module on module.id=offering.module_id where offering.id=enrolment_row.offering_id;
  select * into plan_row from public.module_assessment_plans where id=module_row.assessment_plan_id;
  before_projection:=public.assessment_evaluate(enrolment_key);
  if command->>'type'='CorrectHistoricalScore' then
    select * into target from public.assessment_historical_results where id=(command->>'result_id')::uuid and enrolment_id=enrolment_key;
    if not found or target.represented_by_attempt_id is not null then raise exception 'Choose a historical result from this enrolment'; end if;
    result_key:=target.id; component_name:=target.component; pass_mark_value:=target.pass_mark; sitting:=target.taken_on;
    number_value:=target.attempt_number; resit:=target.is_resit; predecessor:=target.resit_of_result_id;
    select id into original_key from public.exam_results where id=result_key;
    if original_key is not null and (select count(*) from public.assessment_historical_original_results where id=original_key)<>1 then raise exception 'Historical enrolment ownership is ambiguous; review ownership first'; end if;
    if target.amendment_plan_id is not null then select * into plan_row from public.module_assessment_plans where id=target.amendment_plan_id; end if;
    uses_plan:=original_key is null and resit;
  else
    if component_name is null or component_name not in ('theory','practical') then raise exception 'Choose Theory or Practical'; end if;
    if plan_row.id is null or plan_row.module_id<>module_row.id or plan_row.mode<>module_row.mode then raise exception 'Review the global module assessment plan first'; end if;
    if (command->>'expected_plan_id')::uuid is distinct from plan_row.id then raise exception 'The global assessment plan changed. Reload before saving.'; end if;
    if component_name='practical' and plan_row.mode<>'practical' then raise exception 'The global plan has no Practical component'; end if;
    if command->>'entry_kind' is null or command->>'entry_kind' not in ('missing','resit') then raise exception 'Choose missing result or resit'; end if;
    sitting:=(command->>'sitting_date')::date;
    select * into previous from public.assessment_historical_results where enrolment_id=enrolment_key and component::text=component_name order by taken_on desc,attempt_number desc limit 1;
    resit:=command->>'entry_kind'='resit'; uses_plan:=resit;
    if resit then
      if (select count(*) from public.assessment_historical_results where enrolment_id=enrolment_key and component::text=component_name
        and taken_on=previous.taken_on and attempt_number=previous.attempt_number)>1 then
        raise exception 'Multiple results identify the latest sitting. Review ambiguous history before amending.';
      end if;
      if previous.id is null or previous.passed is distinct from false then raise exception 'A resit requires an existing failed component result'; end if;
      if sitting<previous.taken_on then raise exception 'A resit cannot precede its previous sitting'; end if;
      predecessor:=previous.id; number_value:=previous.attempt_number+1;
    else
      if previous.id is not null then raise exception 'A result already exists: correct it or record a resit'; end if;
      number_value:=1;
    end if;
    result_key:=gen_random_uuid();
    pass_mark_value:=case when component_name='theory' then plan_row.theory_pass_mark else plan_row.practical_pass_mark end;
  end if;
  if sitting is null or sitting>current_date then raise exception 'Enter a completed sitting date, not a future date'; end if;
  score_value:=(command->>'score')::numeric;
  if uses_plan then
    inputs:=coalesce(command->'items','[]'::jsonb);
    if component_name='theory' then
      if plan_row.theory_scheme='mcq' then required_items:=array['mcq']; if plan_row.physics_weighting then required_items:=array_append(required_items,'physics'); end if;
      else if plan_row.requires_coursework then required_items:=array_append(required_items,'coursework'); end if; if plan_row.requires_viva then required_items:=array_append(required_items,'viva'); end if; end if;
    end if;
    for item in select value from jsonb_array_elements(inputs) loop
      if item->>'kind' is null or not (item->>'kind'=any(required_items)) or item->>'kind'=any(supplied_items)
        or item->>'score' is null or (item->>'score')::numeric not between 0 and 100 then raise exception 'Every required assessment item needs a valid score'; end if;
      supplied_items:=array_append(supplied_items,item->>'kind'); values_by_kind:=values_by_kind||jsonb_build_object(item->>'kind',(item->>'score')::numeric);
    end loop;
    if cardinality(required_items)<>cardinality(supplied_items) then raise exception 'Required assessment items are missing'; end if;
    if component_name='theory' and plan_row.theory_scheme='mcq' then
      score_value:=(values_by_kind->>'mcq')::numeric;
      if plan_row.physics_weighting then score_value:=(score_value+(values_by_kind->>'physics')::numeric)/2; end if;
    end if;
  end if;
  if score_value is null or score_value not between 0 and 100 then raise exception 'Enter a score from 0 to 100'; end if;
  select coalesce(max(revision),0)+1 into revision_number from public.assessment_historical_score_changes where result_id=result_key;
  select coalesce(jsonb_agg(to_jsonb(result)),'[]'::jsonb) into result_rows from public.assessment_historical_results result where enrolment_id=enrolment_key and id<>result_key;
  result_rows:=result_rows||jsonb_build_array(jsonb_build_object('id',result_key,'component',component_name,'score',score_value,'pass_mark',pass_mark_value,
    'passed',score_value>=pass_mark_value,'taken_on',sitting,'attempt_number',number_value,'amendment_revision',revision_number));
  calculation:=public.historical_exam_calculation(result_rows,module_row.mode='practical' or exists(select 1 from jsonb_array_elements(result_rows) where value->>'component'='practical'),module_row.credits);
  insert into public.assessment_historical_score_changes(enrolment_id,result_id,original_result_id,revision,component,score,pass_mark,taken_on,attempt_number,is_resit,previous_result_id,plan_id,items,calculation,reason,actor_id)
    values(enrolment_key,result_key,original_key,revision_number,component_name,score_value,pass_mark_value,sitting,number_value,resit,predecessor,plan_row.id,inputs,calculation,command->>'reason',actor);
  after_projection:=public.assessment_recalculate(enrolment_key,command->>'reason');
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,reason,metadata)
    values(actor,'assessment.'||(command->>'type'),'enrolment_assessment',enrolment_key,command->>'reason',jsonb_build_object('command',command,'before',before_projection,'after',after_projection,'original_result_id',original_key));
  return jsonb_build_object('assessment',after_projection,'pass_reversed',before_projection->>'effective_status'='Pass' and after_projection->>'effective_status'<>'Pass',
    'change',jsonb_build_object('before_status',before_projection->>'effective_status','after_status',after_projection->>'effective_status','before_credits',before_projection->'awarded_credits','after_credits',after_projection->'awarded_credits'));
end;
$$;
revoke all on function public.execute_assessment_command(jsonb,integer) from public,anon,service_role;
grant execute on function public.execute_assessment_command(jsonb,integer) to authenticated;
