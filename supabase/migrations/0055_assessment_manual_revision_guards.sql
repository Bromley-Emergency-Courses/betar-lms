alter function public.assessment_write_revision(uuid,jsonb,text,uuid) rename to assessment_write_revision_v1;
revoke all on function public.assessment_write_revision_v1(uuid,jsonb,text,uuid) from public, anon, authenticated, service_role;

create function public.assessment_write_revision(attempt_key uuid, input jsonb, change_reason text, source_version uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  attempt_row public.module_assessment_attempts;
  current_revision public.module_assessment_attempt_revisions;
  configured_mark numeric;
begin
  select * into strict attempt_row from public.module_assessment_attempts where id = attempt_key;
  perform 1 from public.enrolments where id = attempt_row.enrolment_id for update;
  if source_version is null then
    select * into current_revision from public.assessment_current_revisions where attempt_id = attempt_key;
    select case when attempt_row.component = 'theory' then plan.theory_pass_mark else plan.practical_pass_mark end
      into configured_mark from public.module_assessment_plans plan
      join public.enrolments enrolment on enrolment.assessment_plan_id = plan.id where enrolment.id = attempt_row.enrolment_id;
    configured_mark := coalesce(current_revision.pass_mark, configured_mark);
    if input ? 'pass_mark' and (input->>'pass_mark')::numeric is distinct from configured_mark then
      raise exception 'Pass marks belong to Course configuration; corrections preserve the recorded pass mark';
    end if;
    if current_revision.id is not null then
      if exists(select 1 from public.module_assessment_attempts where enrolment_id = attempt_row.enrolment_id
        and component = attempt_row.component and active and ordinal > attempt_row.ordinal) then
        raise exception 'A later attempt exists. Review dependent results before correcting this earlier sitting.';
      end if;
      if (input->>'sitting_date')::date is distinct from current_revision.sitting_date
        or nullif(input->>'sitting_term_id','')::uuid is distinct from current_revision.sitting_term_id then
        raise exception 'A correction must retain the original sitting date and term';
      end if;
    end if;
    input := input || jsonb_build_object('pass_mark', configured_mark);
  end if;
  return public.assessment_write_revision_v1(attempt_key, input, change_reason, source_version);
end;
$$;
revoke all on function public.assessment_write_revision(uuid,jsonb,text,uuid) from public, anon, authenticated, service_role;
