alter table public.attendance_sessions add column workspace_revision integer not null default 0;
create function public.advance_attendance_session_revision() returns trigger
language plpgsql set search_path = public as $$
begin
  new.workspace_revision := old.workspace_revision + 1;
  return new;
end;
$$;
create trigger attendance_session_revision before update on public.attendance_sessions
  for each row execute function public.advance_attendance_session_revision();
revoke all on function public.advance_attendance_session_revision() from public, anon, authenticated, service_role;

create table public.attendance_workspace_versions (
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  revision integer not null default 0,
  primary key(session_id, student_id)
);
alter table public.attendance_workspace_versions enable row level security;
revoke all on public.attendance_workspace_versions from public, anon, authenticated, service_role;
insert into public.attendance_workspace_versions(session_id,student_id,revision)
  select session_id,student_id,1 from public.attendance_records union select session_id,student_id,1 from public.expected_attendance;

create function public.advance_attendance_workspace_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare previous jsonb; following jsonb; target record;
begin
  previous := case when tg_op <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  following := case when tg_op <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  for target in select distinct session_id,student_id from (values
    ((previous->>'session_id')::uuid,(previous->>'student_id')::uuid),
    ((following->>'session_id')::uuid,(following->>'student_id')::uuid)) pairs(session_id,student_id)
    where session_id is not null and student_id is not null order by session_id,student_id loop
    if exists(select 1 from public.attendance_sessions where id=target.session_id) and exists(select 1 from public.students where id=target.student_id) then
      insert into public.attendance_workspace_versions as version(session_id,student_id,revision) values(target.session_id,target.student_id,1)
        on conflict(session_id,student_id) do update set revision = version.revision + 1;
    end if;
  end loop;
  return null;
end;
$$;
create trigger attendance_workspace_record_version after insert or update or delete on public.attendance_records for each row execute function public.advance_attendance_workspace_version();
create trigger attendance_workspace_expected_version after insert or update or delete on public.expected_attendance for each row execute function public.advance_attendance_workspace_version();
revoke all on function public.advance_attendance_workspace_version() from public, anon, authenticated, service_role;

create function public.read_student_attendance(student_key uuid) returns jsonb
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
  cross join lateral (select exists(select 1 from public.enrolments enrolment join public.module_offerings offering on offering.id=enrolment.offering_id
    where enrolment.student_id=student_key and offering.term_id=session.term_id) present) enrolled
  where enrolled.present or record.id is not null or expected.student_id is not null);
end;
$$;

create function public.save_student_attendance(command jsonb) returns jsonb
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
  if not exists(select 1 from public.enrolments enrolment join public.module_offerings offering on offering.id=enrolment.offering_id
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

create function public.create_student_term_session(command jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare term_key uuid := (command->>'termId')::uuid; session_key uuid := (command->>'sessionId')::uuid; new_session public.attendance_sessions;
begin
  if auth.uid() is null or public.is_admin() is not true then raise exception 'Active administrator required'; end if;
  if command - array['studentId','sessionId','termId','date','startsAt','endsAt','location','reason'] <> '{}'::jsonb
    or not (command ?& array['studentId','sessionId','termId','date','startsAt','endsAt','location','reason']) then raise exception 'Invalid shared session fields'; end if;
  if length(trim(coalesce(command->>'reason',''))) not between 1 and 4000 or length(trim(coalesce(command->>'location',''))) not between 2 and 160 then raise exception 'Enter a location and administrator reason'; end if;
  perform 1 from public.terms where id=term_key for update;
  if not found then raise exception 'Term no longer exists'; end if;
  if not exists(select 1 from public.enrolments enrolment join public.module_offerings offering on offering.id=enrolment.offering_id
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
revoke all on function public.read_student_attendance(uuid), public.save_student_attendance(jsonb), public.create_student_term_session(jsonb) from public, anon, service_role;
grant execute on function public.read_student_attendance(uuid), public.save_student_attendance(jsonb), public.create_student_term_session(jsonb) to authenticated;
