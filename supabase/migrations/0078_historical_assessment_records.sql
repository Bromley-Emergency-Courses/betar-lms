create view public.assessment_historical_results with (security_invoker = true) as
select result.id, enrolment.id enrolment_id, result.student_id, result.offering_id,
  coalesce(student.cccu_student_id, student.temporary_id) student_identifier,
  concat_ws(' ', student.first_name, student.last_name) student_name,
  module.code module_code, module.title module_title, term.name original_cohort,
  term.id original_term_id, result.component_type component, result.score, result.pass_mark,
  result.passed, result.resit_required, result.attempt_number, result.is_resit,
  result.prior_attempt_missing, result.resit_of_result_id, result.taken_on,
  result.source_system, result.source_attempt_id,
  coalesce(ledger.attempt_id, linked.id) represented_by_attempt_id,
  coalesce(ledger.legacy_hash = md5(to_jsonb(result)::text), false) reviewed_backfill
from public.exam_results result
join public.students student on student.id = result.student_id
join public.module_offerings offering on offering.id = result.offering_id
join public.course_modules module on module.id = offering.module_id
join public.terms term on term.id = offering.term_id
left join public.enrolments enrolment on enrolment.student_id = result.student_id and enrolment.offering_id = result.offering_id
left join public.assessment_legacy_backfill ledger on ledger.legacy_result_id = result.id
left join lateral (
  select attempt.id from public.module_assessment_source_results source
  join public.module_assessment_attempts attempt on attempt.source_id = source.id
  where source.source_key = result.source_attempt_id
    and source.source_system = case result.source_system::text when 'theory_portal' then 'Portal' when 'practical_osce' then 'Practical CSV' end
    and attempt.enrolment_id = enrolment.id and attempt.component = result.component_type::text
  order by attempt.created_at, attempt.id limit 1
) linked on true
where enrolment.id is null or not public.enrolment_is_cancelled(enrolment.id);

revoke all on public.assessment_historical_results from public, anon;
grant select on public.assessment_historical_results to authenticated;

create or replace view public.assessment_outcomes with (security_invoker = true) as
select enrolment.id enrolment_id, student.id student_id, coalesce(student.cccu_student_id,student.temporary_id) student_identifier,
  student.first_name || ' ' || student.last_name student_name, module.code module_code, module.title module_title,
  term.name original_cohort, public.read_enrolment_assessment(enrolment.id) assessment,
  enrolment.status legacy_status, enrolment.final_mark legacy_final_mark, enrolment.grade legacy_grade, enrolment.credits_awarded legacy_credits,
  student.temporary_id temporary_identifier, term.id original_term_id, module.credits module_credits
from public.active_module_enrolments enrolment join public.students student on student.id = enrolment.student_id
join public.module_offerings offering on offering.id = enrolment.offering_id join public.course_modules module on module.id = offering.module_id
join public.terms term on term.id = offering.term_id;

alter function public.execute_assessment_command(jsonb,integer) rename to execute_assessment_command_v6;
revoke all on function public.execute_assessment_command_v6(jsonb,integer) from public, anon, authenticated, service_role;

create function public.execute_assessment_command(command jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assessment_require_admin();
  perform 1 from public.enrolments where id = (command->>'enrolment_id')::uuid for update;
  if command->>'type' not in ('CreateModuleEnrolment','CancelMistakenEnrolment','SetEnrolmentRequirements','ChangeEnrolmentAssessmentPlan')
    and (exists(select 1 from public.assessment_historical_results where enrolment_id = (command->>'enrolment_id')::uuid and not reviewed_backfill)
      or exists(select 1 from public.enrolments enrolment where enrolment.id = (command->>'enrolment_id')::uuid
        and (enrolment.status::text <> 'planned' or enrolment.credits_awarded <> 0 or enrolment.final_mark is not null or enrolment.grade is not null)
        and not exists(select 1 from public.exam_results result where result.student_id = enrolment.student_id and result.offering_id = enrolment.offering_id)
        and not exists(select 1 from public.module_assessment_attempts attempt where attempt.enrolment_id = enrolment.id)
        and not exists(select 1 from public.enrolment_assessment_overrides decision where decision.enrolment_id = enrolment.id)
        and not exists(select 1 from public.enrolment_disposition_events disposition where disposition.enrolment_id = enrolment.id))) then
    raise exception 'Historical records are retained read-only. Reconcile the existing evidence before recording new assessment decisions.';
  end if;
  return public.execute_assessment_command_v6(command, expected_revision);
end;
$$;
revoke all on function public.execute_assessment_command(jsonb,integer) from public, anon;
grant execute on function public.execute_assessment_command(jsonb,integer) to authenticated;
