alter table public.students add column profile_revision integer not null default 0;

create function public.advance_student_profile_revision() returns trigger
language plpgsql set search_path = public as $$
begin
  new.profile_revision := old.profile_revision + 1;
  return new;
end;
$$;
revoke all on function public.advance_student_profile_revision() from public, anon, authenticated, service_role;
create trigger students_profile_revision before update on public.students
  for each row execute function public.advance_student_profile_revision();

create function public.save_student_profile(student_key uuid, expected_revision integer, details jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  previous public.students;
  saved public.students;
  field_name text;
  fields text[] := array['first_name','last_name','temporary_id','cccu_student_id','email','phone','programme','start_term_id','status','admission_stage','notes'];
begin
  if auth.uid() is null or public.is_admin() is not true then raise exception 'An active administrator is required'; end if;
  if jsonb_typeof(details) is distinct from 'object' or not (details ?& fields) or details - fields <> '{}'::jsonb then
    raise exception 'Supply only the editable student profile fields';
  end if;
  foreach field_name in array fields loop
    if jsonb_typeof(details->field_name) <> 'string' and not (field_name in ('cccu_student_id','phone','start_term_id','notes') and details->field_name = 'null'::jsonb) then
      raise exception 'Invalid student profile field: %', field_name;
    end if;
  end loop;
  if length(trim(details->>'first_name')) not between 1 and 80 or length(trim(details->>'last_name')) not between 1 and 80
    or length(trim(details->>'temporary_id')) not between 2 and 80 or trim(details->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter valid names, identifier and email';
  end if;
  select * into previous from public.students where id = student_key for update;
  if previous.id is null then raise exception 'Student not found'; end if;
  if expected_revision is null or previous.profile_revision <> expected_revision then
    raise exception 'Student details changed. Discard this draft and reopen the editor to review the latest record.';
  end if;
  update public.students set
    first_name = trim(details->>'first_name'), last_name = trim(details->>'last_name'), temporary_id = trim(details->>'temporary_id'),
    cccu_student_id = nullif(trim(details->>'cccu_student_id'),''), email = trim(details->>'email'), phone = nullif(trim(details->>'phone'),''),
    programme = details->>'programme', start_term_id = nullif(details->>'start_term_id','')::uuid,
    status = (details->>'status')::public.student_status, admission_stage = (details->>'admission_stage')::public.admission_stage,
    notes = nullif(trim(details->>'notes'),'')
  where id = student_key returning * into saved;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, metadata)
    values(auth.uid(), 'update_student_details', 'student', student_key,
      jsonb_build_object('before',(select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(previous)) where key = any(fields)),
        'after',(select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(saved)) where key = any(fields)),
        'before_revision',previous.profile_revision,'after_revision',saved.profile_revision));
  return saved.profile_revision;
end;
$$;
revoke all on function public.save_student_profile(uuid,integer,jsonb) from public, anon, service_role;
grant execute on function public.save_student_profile(uuid,integer,jsonb) to authenticated;
