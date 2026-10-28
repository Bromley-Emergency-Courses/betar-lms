create or replace function public.student_teaching_offering(student_key uuid, offering_key uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', offering.id, 'moduleId', module.id, 'termId', term.id,
    'label', module.code || ' · ' || module.title || ' · ' || term.name,
    'token', md5((to_jsonb(enrolment) || jsonb_build_object('offering', to_jsonb(offering), 'module', to_jsonb(module), 'term', to_jsonb(term)))::text))
  from public.enrolments enrolment join public.module_offerings offering on offering.id = enrolment.offering_id
  join public.course_modules module on module.id = offering.module_id join public.terms term on term.id = offering.term_id
  join public.students student on student.id = enrolment.student_id
  where enrolment.student_id = student_key and offering.id = offering_key and student.status = 'active'
    and term.id = (select id from public.terms where status = 'active' order by starts_on desc, id limit 1);
$$;

create or replace function public.read_student_teaching_options(student_key uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_teacher() is not true then raise exception 'Active teaching staff required'; end if;
  if not exists(select 1 from public.students where id = student_key) then raise exception 'Student not found'; end if;
  return jsonb_build_object('offerings', coalesce((select jsonb_agg(public.student_teaching_offering(student_key, offering.id) order by module.code)
    from public.enrolments enrolment join public.module_offerings offering on offering.id = enrolment.offering_id
    join public.course_modules module on module.id = offering.module_id
    where enrolment.student_id = student_key and public.student_teaching_offering(student_key, offering.id) is not null), '[]'::jsonb),
    'definitions', coalesce((select jsonb_agg(jsonb_build_object('id', definition.id, 'moduleId', definition.module_id, 'name', definition.name,
      'domains', definition.domains, 'scoreMin', definition.score_min, 'scoreMax', definition.score_max, 'token', md5(to_jsonb(definition)::text)) order by definition.name, definition.id)
      from public.assessment_definitions definition where definition.active and exists(select 1 from public.enrolments enrolment
      join public.module_offerings offering on offering.id = enrolment.offering_id where enrolment.student_id = student_key and offering.module_id = definition.module_id
        and public.student_teaching_offering(student_key, offering.id) is not null)), '[]'::jsonb));
end;
$$;

alter function public.create_student_teaching_record(jsonb) rename to create_student_teaching_record_v1;
revoke all on function public.create_student_teaching_record_v1(jsonb) from public, anon, authenticated, service_role;

create function public.create_student_teaching_record(command jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_teacher() is not true then raise exception 'Active teaching staff required'; end if;
  perform 1 from public.students where id = (command->>'student_id')::uuid and status = 'active' for share;
  if not found or public.student_teaching_offering((command->>'student_id')::uuid, (command->>'offering_id')::uuid) is null then
    raise exception 'Teaching records require an active student enrolled in the current active teaching term. Reopen the workspace; historical records remain readable.';
  end if;
  if coalesce(command->>'occurred_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Enter a calendar date'; end if;
  return public.create_student_teaching_record_v1(command);
end;
$$;
revoke all on function public.create_student_teaching_record(jsonb) from public, anon, service_role;
grant execute on function public.create_student_teaching_record(jsonb) to authenticated;
