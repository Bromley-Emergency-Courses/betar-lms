create function public.assessment_recalculate_requirements() returns trigger
language plpgsql security definer set search_path = public as $$
declare enrolment_key uuid; old_values jsonb; new_values jsonb;
begin
  old_values := case when tg_op <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  new_values := case when tg_op <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  if tg_table_name = 'enrolments' and tg_op = 'UPDATE' and
    (old_values->'attendance_days_required_override',old_values->'presentation_required_override')
    is not distinct from (new_values->'attendance_days_required_override',new_values->'presentation_required_override') then return null; end if;
  for enrolment_key in
    select enrolment.id from public.enrolments enrolment join public.module_offerings offering on offering.id = enrolment.offering_id
    where enrolment.assessment_plan_id is not null and (
      (tg_table_name = 'enrolments' and enrolment.student_id::text in (old_values->>'student_id',new_values->>'student_id'))
      or (tg_table_name = 'attendance_sessions' and offering.term_id::text in (old_values->>'term_id',new_values->>'term_id'))
      or (tg_table_name = 'terms' and offering.term_id::text in (old_values->>'id',new_values->>'id'))
      or (tg_table_name = 'course_modules' and offering.module_id::text in (old_values->>'id',new_values->>'id'))
      or (tg_table_name = 'module_offerings' and offering.term_id::text in (old_values->>'term_id',new_values->>'term_id'))
    ) order by enrolment.id
  loop
    perform public.assessment_recalculate(enrolment_key,'Completion requirements changed: ' || tg_table_name);
  end loop;
  return null;
end;
$$;
create trigger assessment_enrolment_requirements after insert or update or delete on public.enrolments for each row execute function public.assessment_recalculate_requirements();
create trigger assessment_session_requirements after update or delete on public.attendance_sessions for each row execute function public.assessment_recalculate_requirements();
create trigger assessment_term_requirements after update on public.terms for each row execute function public.assessment_recalculate_requirements();
create trigger assessment_module_requirements after update on public.course_modules for each row execute function public.assessment_recalculate_requirements();
create trigger assessment_offering_requirements after update on public.module_offerings for each row execute function public.assessment_recalculate_requirements();
revoke all on function public.assessment_recalculate_requirements() from public, anon, authenticated;
