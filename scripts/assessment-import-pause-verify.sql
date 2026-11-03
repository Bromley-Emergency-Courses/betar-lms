begin;
update public.assessment_operational_controls set portal_imports_paused=true where singleton=true;
insert into public.students(id,temporary_id,first_name,last_name,email,programme,status)
values('85000000-0000-4000-8000-000000000001','SYN-IMPORT-PAUSE','Synthetic','Manual Entry','import-pause@example.test','pgcert','active');
insert into public.enrolments(id,student_id,offering_id)
values('85000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000001','49000000-0000-4000-8000-000000000008');
set local role authenticated;
select set_config('request.jwt.claim.sub','49000000-0000-4000-8000-000000000001',true);
select public.execute_assessment_command('{"type":"AddManualAttempt","enrolment_id":"85000000-0000-4000-8000-000000000002","component":"theory","items":[{"kind":"mcq","score":40}],"sitting_date":"2025-05-01","reason":"Synthetic paused-import manual result"}',
  (public.read_enrolment_assessment('85000000-0000-4000-8000-000000000002')->>'revision')::integer);
select public.execute_assessment_command('{"type":"ScheduleResit","enrolment_id":"85000000-0000-4000-8000-000000000002","component":"theory","note":"Synthetic later sitting","reason":"Synthetic resit schedule"}',
  (public.read_enrolment_assessment('85000000-0000-4000-8000-000000000002')->>'revision')::integer);
select public.execute_assessment_command('{"type":"AddManualAttempt","enrolment_id":"85000000-0000-4000-8000-000000000002","component":"theory","items":[{"kind":"mcq","score":80}],"sitting_date":"2025-06-01","reason":"Synthetic paused-import resit"}',
  (public.read_enrolment_assessment('85000000-0000-4000-8000-000000000002')->>'revision')::integer);
do $$
declare rejected boolean := false;
begin
  if not public.assessment_portal_imports_paused() then raise exception 'Expected separate Portal pause'; end if;
  begin
    perform public.ingest_assessment_source('[{"source_system":"Portal"}]');
  exception when others then
    if sqlerrm not like 'Automatic exam imports are temporarily paused.%' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Portal ingestion bypassed the pause'; end if;
  if has_function_privilege('authenticated','public.ingest_assessment_source_before_portal_pause(jsonb)','execute')
    or has_function_privilege('service_role','public.ingest_assessment_source_before_portal_pause(jsonb)','execute') then
    raise exception 'Unguarded ingestion function is exposed';
  end if;
  if (select count(*) from public.module_assessment_attempts where enrolment_id='85000000-0000-4000-8000-000000000002')<>2 then
    raise exception 'Manual attempt history was not retained';
  end if;
  if public.read_enrolment_assessment('85000000-0000-4000-8000-000000000002')->'components'->'theory'->>'score'<>'80' then
    raise exception 'Manual resit result is incorrect';
  end if;
end;
$$;
rollback;
