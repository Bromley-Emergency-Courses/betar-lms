create table public.presentation_plans (
  enrolment_id uuid primary key references public.enrolments(id),
  session_id uuid references public.attendance_sessions(id),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid not null references public.staff_profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.presentation_plans enable row level security;
create policy "teachers read presentation plans" on public.presentation_plans for select using (public.is_teacher());
revoke all on public.presentation_plans from public, anon, authenticated, service_role;
grant select on public.presentation_plans to authenticated;

create function public.guard_teaching_plan_context() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name='enrolments' then
    if (new.student_id,new.offering_id) is distinct from (old.student_id,old.offering_id)
      and exists(select 1 from public.presentation_plans where enrolment_id=old.id) then raise exception 'Presentation plan ownership cannot be reassigned'; end if;
  elsif tg_table_name='module_offerings' then
    if (new.module_id,new.term_id) is distinct from (old.module_id,old.term_id)
      and exists(select 1 from public.presentation_plans plan join public.enrolments enrolment on enrolment.id=plan.enrolment_id where enrolment.offering_id=old.id) then raise exception 'Presentation plan module and term cannot be reassigned'; end if;
  elsif new.term_id is distinct from old.term_id and exists(select 1 from public.presentation_plans where session_id=old.id) then
    raise exception 'Cancel presentation plans before moving this session to another term';
  end if;
  return new;
end;
$$;
create trigger guard_enrolment_plan_context before update on public.enrolments for each row execute function public.guard_teaching_plan_context();
create trigger guard_offering_plan_context before update on public.module_offerings for each row execute function public.guard_teaching_plan_context();
create trigger guard_session_plan_context before update on public.attendance_sessions for each row execute function public.guard_teaching_plan_context();
revoke all on function public.guard_teaching_plan_context() from public,anon,authenticated,service_role;

create function public.student_teaching_plan_options(student_key uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with eligible as (
    select enrolment.id, option.value,
      coalesce((public.assessment_evaluate(enrolment.id)->>'presentation_pending')::boolean,false)
        and not exists(select 1 from public.presentation_scores score where score.student_id=student_key and score.offering_id=enrolment.offering_id) as can_present
    from public.active_module_enrolments enrolment
    cross join lateral (select public.student_teaching_offering(student_key,enrolment.offering_id) value) option
    where enrolment.student_id=student_key and option.value is not null
  ), payload as (
    select jsonb_build_object('offerings',coalesce((select jsonb_agg(value || jsonb_build_object('canPresent',can_present,
      'plannedSessionId',(select session_id from public.presentation_plans where enrolment_id=eligible.id),
      'planRevision',coalesce((select revision from public.presentation_plans where enrolment_id=eligible.id),0)) order by value->>'id') from eligible),'[]'::jsonb),
      'sessions',coalesce((select jsonb_agg(session.value order by session.value->>'id')
        from jsonb_array_elements(public.read_student_attendance(student_key)) session(value)
        where exists(select 1 from eligible where eligible.value->>'termId'=session.value->>'termId')),'[]'::jsonb)) value
  ) select value || jsonb_build_object('token',md5(value::text)) from payload;
$$;
revoke all on function public.student_teaching_plan_options(uuid) from public,anon,authenticated,service_role;

create function public.read_student_teaching_plans(student_key uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_teacher() is not true then raise exception 'Active teaching staff required'; end if;
  return public.student_teaching_plan_options(student_key);
end;
$$;

create function public.save_student_teaching_plan(command jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  student_key uuid; offering_key uuid; target_key uuid; source_key uuid; owner_key uuid; term_key uuid;
  snapshot jsonb; option jsonb; before_plan jsonb; after_plan jsonb; wants_expected boolean;
  session_row public.attendance_sessions; actor uuid:=auth.uid();
begin
  if actor is null or public.is_teacher() is not true then raise exception 'Active teaching staff required'; end if;
  perform 1 from public.staff_profiles where id=actor and active and role in ('admin','teacher') for share;
  if not found then raise exception 'Active teaching staff required'; end if;
  if jsonb_typeof(command) is distinct from 'object' or command-array['studentId','offeringId','token','kind','sessionId','fromSessionId','expected']<>'{}'::jsonb
    or not command ?& array['studentId','offeringId','token','kind','sessionId','fromSessionId','expected']
    or jsonb_typeof(command->'kind') is distinct from 'string' or command->>'kind' not in ('attendance','presentation') or jsonb_typeof(command->'expected') is distinct from 'boolean'
    or jsonb_typeof(command->'token') is distinct from 'string' then raise exception 'Invalid teaching plan fields'; end if;
  student_key:=(command->>'studentId')::uuid; offering_key:=(command->>'offeringId')::uuid;
  target_key:=(command->>'sessionId')::uuid; source_key:=(command->>'fromSessionId')::uuid;
  wants_expected:=(command->>'expected')::boolean;
  if student_key is null or offering_key is null then raise exception 'Student and module are required'; end if;
  if command->>'kind'='presentation' and (source_key is not null or wants_expected is not true) then raise exception 'Presentation plans cannot change attendance'; end if;
  if command->>'kind'='attendance' and (target_key is null or (source_key is not null and (source_key=target_key or not wants_expected))) then raise exception 'Select distinct source and destination attendance sessions'; end if;
  perform 1 from public.students where id=student_key and status='active' for share;
  if not found then raise exception 'Active student required'; end if;
  perform 1 from public.enrolments where student_id=student_key order by id for update;
  select enrolment.id,offering.term_id into owner_key,term_key from public.active_module_enrolments enrolment
    join public.module_offerings offering on offering.id=enrolment.offering_id
    join public.course_modules module on module.id=offering.module_id join public.terms term on term.id=offering.term_id
    where enrolment.student_id=student_key and offering.id=offering_key for share of offering,module,term;
  if owner_key is null then raise exception 'Eligible module enrolment required'; end if;
  perform 1 from public.attendance_sessions where term_id=term_key order by id for share;
  insert into public.attendance_workspace_versions(session_id,student_id)
    select id,student_key from public.attendance_sessions where term_id=term_key order by id on conflict do nothing;
  perform 1 from public.attendance_workspace_versions where student_id=student_key order by session_id for update;
  snapshot:=public.student_teaching_plan_options(student_key);
  select value into option from jsonb_array_elements(snapshot->'offerings') where value->>'id'=offering_key::text;
  if option is null then raise exception 'This enrolment is no longer eligible for plans'; end if;
  if snapshot->>'token' is distinct from command->>'token' then raise exception 'Teaching plans or calendar changed. Discard and reopen to review.'; end if;
  if target_key is not null then
    select * into session_row from public.attendance_sessions where id=target_key and term_id=term_key;
    if not found then raise exception 'Choose an existing date in this module''s term'; end if;
    if wants_expected and session_row.session_date < (now() at time zone 'Europe/London')::date then raise exception 'Choose today or a future teaching date'; end if;
  end if;
  if command->>'kind'='presentation' then
    if (option->>'canPresent')::boolean is not true then raise exception 'Presentation is complete, carried, not required or already recorded'; end if;
    select to_jsonb(plan) into before_plan from public.presentation_plans plan where enrolment_id=owner_key;
    if target_key is null and (before_plan is null or before_plan->>'session_id' is null) then raise exception 'No presentation plan to cancel'; end if;
    insert into public.presentation_plans as plan(enrolment_id,session_id,updated_by) values(owner_key,target_key,actor)
      on conflict(enrolment_id) do update set session_id=excluded.session_id,revision=plan.revision+1,updated_by=actor,updated_at=now();
    select to_jsonb(plan) into after_plan from public.presentation_plans plan where enrolment_id=owner_key;
  else
    if exists(select 1 from public.attendance_records where student_id=student_key and session_id in (target_key,source_key)) then raise exception 'Recorded attendance is read-only here; ask an administrator to correct it'; end if;
    if source_key is not null and not exists(select 1 from public.expected_attendance expected join public.attendance_sessions session on session.id=expected.session_id
      where expected.student_id=student_key and session.id=source_key and session.term_id=term_key) then raise exception 'Source attendance plan no longer exists in this term'; end if;
    select coalesce(jsonb_agg(to_jsonb(expected) order by session_id),'[]'::jsonb) into before_plan from public.expected_attendance expected where student_id=student_key and session_id in (target_key,source_key);
    if source_key is not null then delete from public.expected_attendance where student_id=student_key and session_id=source_key; end if;
    if wants_expected then insert into public.expected_attendance(session_id,student_id) values(target_key,student_key) on conflict do nothing;
    else delete from public.expected_attendance where student_id=student_key and session_id=target_key; end if;
    select coalesce(jsonb_agg(to_jsonb(expected) order by session_id),'[]'::jsonb) into after_plan from public.expected_attendance expected where student_id=student_key and session_id in (target_key,source_key);
    if before_plan=after_plan then raise exception 'This attendance plan is already saved. Reopen to review.'; end if;
  end if;
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,reason,metadata)
    values(actor,'teaching.plan_saved','student',student_key,'Teacher updated plan on existing calendar',
      jsonb_build_object('kind',command->>'kind','offering_id',offering_key,'before',before_plan,'after',after_plan));
  return jsonb_build_object('status','saved');
exception when deadlock_detected or serialization_failure then raise exception 'Related records changed while saving. Discard and reopen to review.';
end;
$$;
revoke all on function public.read_student_teaching_plans(uuid),public.save_student_teaching_plan(jsonb) from public,anon,service_role;
grant execute on function public.read_student_teaching_plans(uuid),public.save_student_teaching_plan(jsonb) to authenticated;
