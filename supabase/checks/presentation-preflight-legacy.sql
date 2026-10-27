begin transaction isolation level repeatable read read only;

with rubric_keys as (
  select array['content_material_accurate_up_to_date','content_questions_encouraged_handled_well',
    'content_reference_slide_key_papers','content_critical_reflection','content_title_slide_details','delivery_engages_audience',
    'delivery_clear_audible_pace','organisation_logical_sequence','organisation_slides_prepared_effective',
    'global_impression_information_communicated_well'] as expected
), owners as (
  select score.id,count(enrolment.id) as owner_count
  from public.presentation_scores score left join public.enrolments enrolment
    on enrolment.student_id=score.student_id and enrolment.offering_id=score.offering_id group by score.id
), event_groups as (
  select student_id,offering_id,count(*) as submissions,count(distinct staff_user_id) as authors,
    count(distinct occurred_on)>1 or count(distinct presentation_type)>1 or count(distinct duration_minutes)>1 as conflicting_metadata,
    bool_or(presentation_type is null or duration_minutes is null or not isfinite(occurred_on)) as incomplete_metadata
  from public.presentation_scores group by student_id,offering_id
), rubrics as (
  select score.id,score.total_score,
    case when jsonb_typeof(score.scores)='object' then score.scores else '{}'::jsonb end as rubric
  from public.presentation_scores score
), checked as (
  select rubrics.*,rubric ?& expected and rubric-expected='{}'::jsonb and not exists(
    select 1 from jsonb_each(rubric) item where case when jsonb_typeof(item.value)<>'number' then true
      else (item.value #>> '{}')::numeric not between 1 and 5
        or (item.value #>> '{}')::numeric<>trunc((item.value #>> '{}')::numeric) end) as valid_rubric,
    (select sum(case when jsonb_typeof(item.value)='number' then (item.value #>> '{}')::numeric end) from jsonb_each(rubric) item) as subtotal
  from rubrics cross join rubric_keys
)
select jsonb_pretty(jsonb_build_object(
  'schema_scope','Legacy baseline before migration 0067; no cancellation or presentation event schema assumed',
  'score_rows',(select count(*) from checked),
  'presentation_groups',(select count(*) from event_groups),
  'duplicate_author_groups',(select count(*) from event_groups where submissions<>authors),
  'scores_without_exactly_one_owner',(select count(*) from owners where owner_count<>1),
  'scores_on_cancelled_enrolments',null,
  'cancellation_check','Not applicable before migration 0067; use presentation-preflight.sql after that migration',
  'conflicting_metadata_groups',(select count(*) from event_groups where conflicting_metadata),
  'incomplete_metadata_groups',(select count(*) from event_groups where incomplete_metadata),
  'invalid_rubrics',(select count(*) from checked where not valid_rubric),
  'legacy_total_differences',(select count(*) from checked where valid_rubric and total_score is distinct from subtotal),
  'unlinked_scores',(select count(*) from checked),
  'policy','Read-only screening. Preserve original scores and metadata; review discrepancies without inferring, merging or rewriting evidence. Event links are absent on this legacy baseline.'
)) as report;

rollback;
