begin transaction read only;
with result_ownership as (
  select result.*, offering.module_id, offering.term_id,
    (select count(*) from public.enrolments enrolment join public.module_offerings candidate on candidate.id = enrolment.offering_id
      where enrolment.student_id = result.student_id and candidate.module_id = offering.module_id) plausible_enrolments,
    (select count(*) from public.enrolments enrolment where enrolment.student_id = result.student_id and enrolment.offering_id = result.offering_id) direct_enrolments
  from public.exam_results result join public.module_offerings offering on offering.id = result.offering_id
), exceptions as (
  select 'result' entity_type, id entity_id, 'missing_or_ambiguous_ownership' issue, to_jsonb(result_ownership) evidence from result_ownership where plausible_enrolments <> 1 or direct_enrolments <> 1
  union all select 'result', id, 'missing_predecessor_or_inferred_resit', to_jsonb(result_ownership) from result_ownership where prior_attempt_missing or (is_resit and resit_of_result_id is null) or (attempt_number > 1 and resit_of_result_id is null)
  union all select 'result', result.id, 'duplicate_attempt_sequence', to_jsonb(result) from public.exam_results result
    where exists(select 1 from public.exam_results other where other.id <> result.id and other.student_id = result.student_id and other.offering_id = result.offering_id and other.component_type = result.component_type and other.attempt_number = result.attempt_number)
  union all select 'result', result.id, 'source_identity_collision', to_jsonb(result) from public.exam_results result where length(trim(result.source_attempt_id)) = 0
    or exists(select 1 from public.exam_results other where other.id <> result.id and other.source_system = result.source_system and other.source_attempt_id = result.source_attempt_id)
  union all select 'enrolment', enrolment.id, 'legacy_final_mark_or_grade', to_jsonb(enrolment) from public.enrolments enrolment where final_mark is not null or grade is not null
  union all select 'enrolment', enrolment.id, 'legacy_status_requires_review', to_jsonb(enrolment) from public.enrolments enrolment where status::text in ('deferred','resit','did_not_complete')
  union all select 'enrolment', enrolment.id, 'status_credit_or_component_contradiction', to_jsonb(enrolment) from public.enrolments enrolment
    join public.module_offerings offering on offering.id = enrolment.offering_id join public.course_modules module on module.id = offering.module_id
    where (enrolment.status::text = 'completed' and enrolment.credits_awarded <> module.credits)
      or (enrolment.status::text <> 'completed' and enrolment.credits_awarded <> 0)
      or (enrolment.status::text = 'completed' and (not exists(select 1 from public.exam_results result where result.student_id = enrolment.student_id and result.offering_id = enrolment.offering_id and result.component_type = 'theory' and result.passed)
        or exists(select 1 from public.exam_results result where result.student_id = enrolment.student_id and result.offering_id = enrolment.offering_id and not result.passed)))
  union all select 'enrolment', enrolment.id, 'possible_assessment_only_duplicate', to_jsonb(enrolment) from public.enrolments enrolment
    join public.module_offerings offering on offering.id = enrolment.offering_id where exists(select 1 from public.enrolments other join public.module_offerings candidate on candidate.id = other.offering_id
      where other.id <> enrolment.id and other.student_id = enrolment.student_id and candidate.module_id = offering.module_id)
  union all select 'module', module.id, 'assessment_plan_review_required', to_jsonb(module) from public.course_modules module where active
)
select * from exceptions order by entity_type, entity_id, issue;
commit;
