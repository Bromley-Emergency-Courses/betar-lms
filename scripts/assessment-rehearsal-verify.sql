begin;
select set_config('request.jwt.claim.sub','49000000-0000-4000-8000-000000000001',false);
select public.backfill_assessment_results((select jsonb_agg(jsonb_build_object('legacy_result_id',legacy_result_id,'legacy_hash',legacy_hash)) from public.assessment_backfill_candidates where review_reason is null),'Reviewed synthetic rehearsal');
do $$
declare projection jsonb; result jsonb; revision_number integer; current_attempt uuid;
  enrolment_count integer := (select count(*) from public.enrolments);
  legacy_count integer := (select count(*) from public.exam_results);
begin
  if (select count(*) from public.assessment_legacy_backfill) <> 3 then raise exception 'Unexpected backfill eligibility'; end if;
  if (select count(*) from public.assessment_backfill_candidates where review_reason='duplicate_sequence') <> 2 then raise exception 'Duplicate sequence was not retained for review'; end if;
  if (select count(distinct status) from public.enrolments) <> 7 then raise exception 'Legacy status coverage incomplete'; end if;
  result := public.backfill_assessment_results((select jsonb_agg(jsonb_build_object('legacy_result_id',legacy_result_id,'legacy_hash',legacy_hash)) from public.assessment_legacy_backfill),'Synthetic idempotent retry');
  if (result->>'imported')::integer <> 0 or (result->>'already_backfilled')::integer <> 3 then raise exception 'Backfill retry duplicated evidence'; end if;
  projection := public.read_enrolment_assessment('49000000-0000-4000-8000-000000000012');
  if projection->>'effective_status' <> 'Pass' or (projection->>'awarded_credits')::integer <> 10 then raise exception 'Backfill failed'; end if;
  revision_number := (projection->>'revision')::integer;
  result := public.execute_assessment_command(jsonb_build_object('type','CorrectImportedAttempt','enrolment_id','49000000-0000-4000-8000-000000000012',
    'attempt_id',projection->'components'->'theory'->>'id',
    'source_id',(select id from public.module_assessment_source_results where source_key='synthetic-portal-1'),
    'expected_source_revision',(select revision from public.module_assessment_source_results where source_key='synthetic-portal-1'),
    'items',jsonb_build_array(jsonb_build_object('kind','mcq','score',40)),'reason','Synthetic Manual replacement'),revision_number);
  if (result->>'pass_reversed')::boolean is true or (result->'assessment'->>'awarded_credits')::integer <> 10 then raise exception 'Historical credit protection failed'; end if;
  if result->'assessment'->>'effective_status' <> 'Pass' or result->'assessment'->'historical'->>'protected' <> 'true' then raise exception 'Historical outcome protection failed'; end if;
  if (result->'assessment'->'components'->'theory'->>'score')::numeric <> 40 then raise exception 'Replacement evidence failed'; end if;
  result := public.execute_assessment_command('{"type":"ScheduleResit","component":"theory","enrolment_id":"49000000-0000-4000-8000-000000000012","note":"Arranged next term","reason":"Synthetic schedule"}',revision_number+1);
  result := public.execute_assessment_command('{"type":"AddManualAttempt","component":"theory","enrolment_id":"49000000-0000-4000-8000-000000000012","items":[{"kind":"mcq","score":80}],"sitting_date":"2025-10-01","sitting_term_id":"49000000-0000-4000-8000-000000000004","reason":"Synthetic passing resit"}',revision_number+2);
  if result->'assessment'->>'effective_status' <> 'Pass' or jsonb_array_length(result->'assessment'->'effective_indicators') <> 0 then raise exception 'Passing resit failed'; end if;
  current_attempt := (result->'assessment'->'components'->'theory'->>'id')::uuid;
  if (select count(*) from public.enrolments) <> enrolment_count then raise exception 'Resit created a teaching enrolment'; end if;
  if (select count(*) from public.exam_results) <> legacy_count then raise exception 'Legacy evidence changed'; end if;
  raise notice 'Verified backfill, protected historical outcomes, Manual replacement evidence, scheduled resit, passing resit, credits, original teaching ownership and preserved legacy evidence';
end;
$$;
commit;
