create function public.create_workspace_student(student_key uuid, details jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  fields text[] := array['first_name','last_name','temporary_id','cccu_student_id','email','phone','programme','start_term_id','status','admission_stage','notes'];
  field_name text;
  normalized jsonb := '{}'::jsonb;
  previous_audit public.audit_events;
  saved public.students;
begin
  if auth.uid() is null or public.is_admin() is not true then raise exception 'An active administrator is required'; end if;
  if student_key is null then raise exception 'A creation identifier is required'; end if;
  if jsonb_typeof(details) is distinct from 'object' or not(details ?& fields) or details-fields <> '{}'::jsonb then raise exception 'Supply only the student creation fields'; end if;
  foreach field_name in array fields loop
    if jsonb_typeof(details->field_name) <> 'string' and not(field_name in ('temporary_id','cccu_student_id','phone','start_term_id','notes') and details->field_name='null'::jsonb) then raise exception 'Invalid student field: %',field_name; end if;
    normalized := normalized || jsonb_build_object(field_name,nullif(trim(details->>field_name),''));
  end loop;
  if normalized->>'temporary_id' is null then normalized := normalized || jsonb_build_object('temporary_id','BETAR-TMP-' || student_key::text); end if;
  if coalesce(length(normalized->>'first_name'),0) not between 1 and 80 or coalesce(length(normalized->>'last_name'),0) not between 1 and 80
    or length(normalized->>'temporary_id') not between 2 and 80 or coalesce(normalized->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(normalized->>'notes') > 10000 or length(normalized->>'phone') > 100 or length(normalized->>'cccu_student_id') > 80 then raise exception 'Enter valid student names, identifiers and contact details'; end if;
  perform pg_advisory_xact_lock(hashtextextended('student-create:' || student_key::text,0));
  select * into previous_audit from public.audit_events where entity_id=student_key and action='create_workspace_student' order by created_at limit 1;
  if previous_audit.id is not null then
    if previous_audit.actor_user_id is distinct from auth.uid() or previous_audit.metadata->'details' is distinct from normalized then
      raise exception 'This creation request was already used with different details. Review the existing student before starting another record.';
    end if;
    if not exists(select 1 from public.students where id=student_key) then raise exception 'The previously created student was removed. Review the directory before starting another record.'; end if;
    return student_key;
  end if;
  if exists(select 1 from public.students where id=student_key) then raise exception 'This creation identifier is already in use'; end if;
  insert into public.students(id,first_name,last_name,temporary_id,cccu_student_id,email,phone,programme,start_term_id,status,admission_stage,notes)
    values(student_key,normalized->>'first_name',normalized->>'last_name',normalized->>'temporary_id',normalized->>'cccu_student_id',normalized->>'email',normalized->>'phone',
      normalized->>'programme',(normalized->>'start_term_id')::uuid,(normalized->>'status')::public.student_status,(normalized->>'admission_stage')::public.admission_stage,normalized->>'notes') returning * into saved;
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'create_workspace_student','student',saved.id,jsonb_build_object('details',normalized));
  return saved.id;
end;
$$;
revoke all on function public.create_workspace_student(uuid,jsonb) from public, anon, service_role;
grant execute on function public.create_workspace_student(uuid,jsonb) to authenticated;
