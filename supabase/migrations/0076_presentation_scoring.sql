create table public.presentation_events (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null unique references public.enrolments(id),
  occurred_on date not null check (isfinite(occurred_on)),
  presentation_type text not null check (presentation_type in ('case_presentation','journal_club')),
  duration_minutes integer not null check (duration_minutes > 0),
  created_at timestamptz not null default now()
);
alter table public.presentation_events enable row level security;
revoke all on public.presentation_events from public, anon, authenticated, service_role;
grant select on public.presentation_events to authenticated;
create policy presentation_events_staff_read on public.presentation_events for select to authenticated using (public.is_teacher());
create trigger presentation_events_immutable before update or delete on public.presentation_events
  for each row execute function public.assessment_immutable();

alter table public.presentation_scores
  add column event_id uuid references public.presentation_events(id),
  add column time_penalty integer not null default 0 check (time_penalty between 0 and 50),
  add column revision integer not null default 1 check (revision > 0);
create unique index presentation_scores_event_author on public.presentation_scores(event_id,staff_user_id) where event_id is not null;

insert into public.presentation_events(enrolment_id,occurred_on,presentation_type,duration_minutes)
select enrolment.id, min(score.occurred_on), min(score.presentation_type), min(score.duration_minutes)
from public.active_module_enrolments enrolment join public.presentation_scores score
  on score.student_id=enrolment.student_id and score.offering_id=enrolment.offering_id
group by enrolment.id
having count(*)=count(distinct score.staff_user_id) and count(distinct score.occurred_on)=1
  and bool_and(isfinite(score.occurred_on)) and count(score.presentation_type)=count(*) and count(distinct score.presentation_type)=1
  and count(score.duration_minutes)=count(*) and count(distinct score.duration_minutes)=1;

alter table public.presentation_scores disable trigger assessment_presentation_change;
update public.presentation_scores score set event_id=event.id
from public.presentation_events event join public.enrolments enrolment on enrolment.id=event.enrolment_id
where score.student_id=enrolment.student_id and score.offering_id=enrolment.offering_id;
alter table public.presentation_scores enable trigger assessment_presentation_change;

create function public.guard_presentation_event_score() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op='UPDATE' and old.event_id is not null and
    (new.event_id,new.staff_user_id,new.student_id,new.offering_id) is distinct from
    (old.event_id,old.staff_user_id,old.student_id,old.offering_id) then
    raise exception 'Presentation ownership and event identity are immutable';
  end if;
  if new.event_id is not null and not exists(select 1 from public.presentation_events event
    join public.enrolments enrolment on enrolment.id=event.enrolment_id
    where event.id=new.event_id and enrolment.student_id=new.student_id and enrolment.offering_id=new.offering_id
      and (event.occurred_on,event.presentation_type,event.duration_minutes) is not distinct from
        (new.occurred_on,new.presentation_type,new.duration_minutes)) then
    raise exception 'Presentation metadata must match its existing event';
  end if;
  return new;
end;
$$;
create trigger guard_presentation_event_score before insert or update on public.presentation_scores
  for each row execute function public.guard_presentation_event_score();

create function public.guard_presentation_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name='enrolments' then
    if (new.student_id,new.offering_id) is distinct from (old.student_id,old.offering_id)
      and exists(select 1 from public.presentation_events where enrolment_id=old.id) then
      raise exception 'A recorded presentation cannot be reassigned to another student or offering';
    end if;
  elsif (new.module_id,new.term_id) is distinct from (old.module_id,old.term_id)
    and exists(select 1 from public.presentation_events event join public.enrolments enrolment on enrolment.id=event.enrolment_id where enrolment.offering_id=old.id) then
    raise exception 'A recorded presentation cannot be reassigned to another module or term';
  end if;
  return new;
end;
$$;
create trigger guard_presentation_owner before update of student_id,offering_id on public.enrolments
  for each row execute function public.guard_presentation_owner();
create trigger guard_presentation_offering before update of module_id,term_id on public.module_offerings
  for each row execute function public.guard_presentation_owner();

create function public.presentation_rubric_subtotal(scores jsonb) returns integer
language plpgsql immutable set search_path = public as $$
declare rubric_keys text[]:=array['content_material_accurate_up_to_date','content_questions_encouraged_handled_well',
  'content_reference_slide_key_papers','content_critical_reflection','content_title_slide_details','delivery_engages_audience',
  'delivery_clear_audible_pace','organisation_logical_sequence','organisation_slides_prepared_effective',
  'global_impression_information_communicated_well'];
begin
  if jsonb_typeof(scores) is distinct from 'object' or not scores ?& rubric_keys or scores-rubric_keys<>'{}'::jsonb then return null; end if;
  if exists(select 1 from jsonb_each(scores) score where case when jsonb_typeof(score.value)<>'number' then true
    else (score.value #>> '{}')::numeric not between 1 and 5 or (score.value #>> '{}')::numeric<>trunc((score.value #>> '{}')::numeric) end) then return null; end if;
  return (select sum((value #>> '{}')::numeric)::integer from jsonb_each(scores));
end;
$$;

create function public.student_presentation_offering(student_key uuid, offering_key uuid) returns jsonb
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
    and coalesce((assessment.projection->>'needs_plan')::boolean,false) is false
    and assessment.projection->'plan' is not null and assessment.projection->'plan'<>'null'::jsonb
    and assessment.projection->>'disposition' is null
    and not exists(select 1 from jsonb_each(coalesce(assessment.projection->'components','{}'::jsonb)) component
      where component.value->>'arrangement_kind'='assessment_deferral' and component.value->>'arrangement_state'='active')
    and (assessment.projection->>'effective_status' in ('Planned','In progress','Fail')
      or (event.id is not null and assessment.projection->>'effective_status'='Pass'))
    and not exists(select 1 from public.presentation_scores score where score.student_id=student_key
      and score.offering_id=offering_key and score.event_id is null)
    and (event.id is not null or not coalesce(enrolment.presentation_required_override,offering.presentation_required)
      or (assessment.projection->>'presentation_pending')::boolean);
$$;

alter function public.read_student_teaching_options(uuid) rename to read_student_teaching_options_v2;
create function public.read_student_teaching_options(student_key uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  result := public.read_student_teaching_options_v2(student_key);
  return result || jsonb_build_object('presentations',coalesce((select jsonb_agg(option.value order by option.value->>'label')
    from public.active_module_enrolments enrolment
    cross join lateral (select public.student_presentation_offering(student_key,enrolment.offering_id) value) option
    where enrolment.student_id=student_key and option.value is not null),'[]'::jsonb));
end;
$$;

create function public.save_student_presentation(command jsonb, editing boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actor uuid:=auth.uid(); record_key uuid; student_key uuid; offering_key uuid; owner_key uuid;
  snapshot jsonb; event_row public.presentation_events; previous public.presentation_scores; saved public.presentation_scores;
  entry_date date; duration integer; penalty integer; subtotal integer; expected_revision integer;
  fields text[]:=array['id','kind','student_id','offering_id','offering_token','scores','comments'];
begin
  if actor is null or public.is_teacher() is not true then raise exception 'Active teaching staff required'; end if;
  perform 1 from public.staff_profiles where id=actor and active and role in ('admin','teacher') for share;
  if not found then raise exception 'Active teaching staff required'; end if;
  if editing then fields:=fields || array['expected_revision','time_penalty'];
  else fields:=fields || array['occurred_on','presentation_type','duration_minutes']; end if;
  if jsonb_typeof(command) is distinct from 'object' or not command ?& fields
    or command-(fields || array['time_penalty'])<>'{}'::jsonb or command->>'kind' is distinct from 'presentation' then
    raise exception 'Invalid presentation fields';
  end if;
  record_key:=(command->>'id')::uuid; student_key:=(command->>'student_id')::uuid; offering_key:=(command->>'offering_id')::uuid;
  if record_key is null or student_key is null or offering_key is null then raise exception 'Student, offering and record identifier are required'; end if;
  if jsonb_typeof(command->'comments') not in ('string','null') or length(command->>'comments')>10000 then raise exception 'Comments must be text up to 10000 characters'; end if;
  subtotal:=public.presentation_rubric_subtotal(command->'scores');
  if subtotal is null then raise exception 'Score every presentation rubric criterion with a whole number from 1 to 5'; end if;
  if command ? 'time_penalty' and (case when jsonb_typeof(command->'time_penalty') is distinct from 'number' then true
    else (command->>'time_penalty')::numeric not between 0 and subtotal
      or (command->>'time_penalty')::numeric<>trunc((command->>'time_penalty')::numeric) end) then
    raise exception 'Time penalty must be a whole number from zero to the rubric subtotal';
  end if;
  penalty:=coalesce((command->>'time_penalty')::numeric::integer,0);
  perform 1 from public.students where id=student_key and status='active' for share;
  if not found then raise exception 'Presentation scoring requires an active student'; end if;
  select enrolment.id into owner_key from public.enrolments enrolment
    join public.module_offerings offering on offering.id=enrolment.offering_id
    join public.course_modules module on module.id=offering.module_id join public.terms term on term.id=offering.term_id
    where enrolment.student_id=student_key and offering.id=offering_key
    for update of enrolment for share of offering,module,term;
  snapshot:=public.student_presentation_offering(student_key,offering_key);
  if snapshot is null then raise exception 'Presentation scoring is unavailable for this enrolment. Reopen the workspace; historical, carried or unreconciled evidence remains read-only.'; end if;
  select * into event_row from public.presentation_events where enrolment_id=owner_key;
  if editing then
    select * into previous from public.presentation_scores where id=record_key for update;
    if not found or previous.staff_user_id<>actor or previous.event_id is distinct from event_row.id or event_row.id is null then
      raise exception 'Only the original author may edit this presentation submission';
    end if;
    if public.presentation_rubric_subtotal(previous.scores) is null
      or public.presentation_rubric_subtotal(previous.scores)-previous.time_penalty<>previous.total_score then
      raise exception 'This legacy presentation score needs reconciliation before editing. Its recorded total has not been changed';
    end if;
    if (case when jsonb_typeof(command->'expected_revision') is distinct from 'number' then true
      else (command->>'expected_revision')::numeric not between 1 and 2147483647
        or (command->>'expected_revision')::numeric<>trunc((command->>'expected_revision')::numeric) end) then raise exception 'A valid score revision is required'; end if;
    expected_revision:=(command->>'expected_revision')::numeric::integer;
    if previous.revision<>expected_revision then raise exception 'This presentation score changed or was already saved. Review your existing submission before editing again.'; end if;
  else
    select * into previous from public.presentation_scores where event_id=event_row.id and staff_user_id=actor;
    if found then return jsonb_build_object('id',previous.id,'kind','presentation','status','duplicate','revision',previous.revision); end if;
  end if;
  if command->>'offering_token' is distinct from snapshot->>'token' then raise exception 'Teaching or enrolment details changed. Discard and reopen before saving.'; end if;
  if editing then
    update public.presentation_scores set scores=command->'scores',time_penalty=penalty,total_score=subtotal-penalty,
      comments=nullif(btrim(command->>'comments'),''),revision=revision+1 where id=record_key returning * into saved;
  else
    if coalesce(command->>'occurred_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Enter a calendar date'; end if;
    entry_date:=(command->>'occurred_on')::date;
    if (case when jsonb_typeof(command->'duration_minutes') is distinct from 'number' then true
      else (command->>'duration_minutes')::numeric not between 1 and 2147483647
        or (command->>'duration_minutes')::numeric<>trunc((command->>'duration_minutes')::numeric) end) then raise exception 'Duration must be a positive whole number of minutes'; end if;
    duration:=(command->>'duration_minutes')::numeric::integer;
    if coalesce(command->>'presentation_type','') not in ('case_presentation','journal_club') then raise exception 'Choose a presentation type'; end if;
    if event_row.id is not null and (event_row.occurred_on,event_row.presentation_type,event_row.duration_minutes)
      is distinct from (entry_date,command->>'presentation_type',duration) then raise exception 'Use the existing presentation date, type and duration; shared event metadata cannot be changed'; end if;
    if exists(select 1 from public.encounter_logs where id=record_key) or exists(select 1 from public.assessment_attempts where id=record_key)
      or exists(select 1 from public.presentation_scores where id=record_key) then raise exception 'This teaching record was already saved. Reopen the timeline to review it.'; end if;
    if event_row.id is null then
      insert into public.presentation_events(enrolment_id,occurred_on,presentation_type,duration_minutes)
        values(owner_key,entry_date,command->>'presentation_type',duration) returning * into event_row;
    end if;
    insert into public.presentation_scores(id,student_id,offering_id,staff_user_id,event_id,occurred_on,presentation_type,duration_minutes,scores,time_penalty,total_score,comments)
      values(record_key,student_key,offering_key,actor,event_row.id,event_row.occurred_on,event_row.presentation_type,event_row.duration_minutes,
        command->'scores',penalty,subtotal-penalty,nullif(btrim(command->>'comments'),'')) returning * into saved;
  end if;
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,reason,metadata)
    values(actor,case when editing then 'teaching.presentation_edited' else 'teaching.record_created' end,'student_teaching',record_key,
      case when editing then 'Author edited presentation score' else 'Teaching record entered' end,
      jsonb_build_object('kind','presentation','student_id',student_key,'event',to_jsonb(event_row),'record',to_jsonb(saved),
        'before',case when editing then to_jsonb(previous) end));
  return jsonb_build_object('id',saved.id,'kind','presentation','status','saved','revision',saved.revision);
exception when deadlock_detected or serialization_failure then raise exception 'Related teaching records changed while saving. Discard and reopen before saving.';
end;
$$;

alter function public.create_student_teaching_record(jsonb) rename to create_student_teaching_record_v2;
create function public.create_student_teaching_record(command jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if command->>'kind'='presentation' then return public.save_student_presentation(command,false); end if;
  return public.create_student_teaching_record_v2(command);
end;
$$;
create function public.edit_student_presentation_score(command jsonb) returns jsonb
language sql security definer set search_path = public as $$
  select public.save_student_presentation(command,true);
$$;

revoke all on function public.guard_presentation_event_score(), public.guard_presentation_owner(), public.presentation_rubric_subtotal(jsonb), public.student_presentation_offering(uuid,uuid),
  public.read_student_teaching_options_v2(uuid), public.save_student_presentation(jsonb,boolean),
  public.create_student_teaching_record_v2(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.read_student_teaching_options(uuid), public.create_student_teaching_record(jsonb),
  public.edit_student_presentation_score(jsonb) from public,anon,service_role;
grant execute on function public.read_student_teaching_options(uuid), public.create_student_teaching_record(jsonb),
  public.edit_student_presentation_score(jsonb) to authenticated;
