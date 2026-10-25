alter function public.execute_assessment_command(jsonb,integer) rename to execute_assessment_command_v1;
revoke all on function public.execute_assessment_command_v1(jsonb,integer) from public, anon, authenticated, service_role;

create function public.execute_assessment_command(command jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := public.assessment_require_admin();
  change_reason text := command->>'reason';
  source_row public.module_assessment_source_results;
  enrolment_row public.enrolments;
  attempt_row public.module_assessment_attempts;
  current_revision public.module_assessment_attempt_revisions;
  before_projection jsonb;
  after_projection jsonb;
begin
  if command->>'type' is distinct from 'CorrectImportedAttempt' then
    return public.execute_assessment_command_v1(command, expected_revision);
  end if;
  if command - array['type','enrolment_id','attempt_id','source_id','expected_source_revision','reason','items','score'] <> '{}'::jsonb then
    raise exception 'An imported correction cannot change identity, component, sitting or assessment configuration';
  end if;
  if length(trim(coalesce(change_reason,''))) = 0 then raise exception 'An administrator reason is required'; end if;
  select * into source_row from public.module_assessment_source_results where id = (command->>'source_id')::uuid for update;
  if source_row.id is null then raise exception 'Imported evidence was not found'; end if;
  if source_row.revision is distinct from (command->>'expected_source_revision')::integer then raise exception 'Source changed. Reload before saving.'; end if;
  select * into enrolment_row from public.enrolments where id = (command->>'enrolment_id')::uuid for update;
  if enrolment_row.id is null then raise exception 'Enrolment was not found'; end if;
  if enrolment_row.assessment_revision is distinct from expected_revision then raise exception 'Assessment changed. Reload before saving.'; end if;
  select * into attempt_row from public.module_assessment_attempts where id = (command->>'attempt_id')::uuid
    and enrolment_id = enrolment_row.id and source_id = source_row.id and active and origin <> 'Manual';
  if attempt_row.id is null or source_row.state <> 'Matched' then
    raise exception 'Only an accepted imported result owned by this enrolment can be corrected';
  end if;
  if source_row.conflict is not null then raise exception 'The source has an unresolved conflict. Review its evidence before correction.'; end if;
  if enrolment_row.assessment_plan_id is null then raise exception 'Review and assign an assessment plan first'; end if;
  select * into strict current_revision from public.assessment_current_revisions where attempt_id = attempt_row.id;
  before_projection := public.assessment_evaluate(enrolment_row.id);
  perform public.assessment_write_revision(attempt_row.id, command || jsonb_build_object(
    'sitting_date', current_revision.sitting_date, 'sitting_term_id', current_revision.sitting_term_id), change_reason);
  update public.module_assessment_attempts set origin = 'Manual' where id = attempt_row.id;
  update public.module_assessment_source_results set state = 'Replaced manually', administratively_displaced = true,
    revision = revision + 1 where id = source_row.id;
  after_projection := public.assessment_recalculate(enrolment_row.id, change_reason);
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, reason, metadata)
    values(actor, 'assessment.CorrectImportedAttempt', 'enrolment_assessment', enrolment_row.id, change_reason,
      jsonb_build_object('command',command,'before',before_projection,'after',after_projection,'source_before',to_jsonb(source_row)));
  return jsonb_build_object('assessment',after_projection,'source_id',source_row.id,
    'pass_reversed',coalesce((after_projection->>'pass_reversed')::boolean,false),
    'change',jsonb_build_object('before_status',before_projection->>'effective_status','after_status',after_projection->>'effective_status',
      'before_credits',before_projection->'awarded_credits','after_credits',after_projection->'awarded_credits'));
end;
$$;
revoke all on function public.execute_assessment_command(jsonb,integer) from public, anon, service_role;
grant execute on function public.execute_assessment_command(jsonb,integer) to authenticated;
