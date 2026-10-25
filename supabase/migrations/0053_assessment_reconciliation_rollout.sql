create table public.assessment_legacy_backfill (
  legacy_result_id uuid primary key references public.exam_results(id),
  legacy_hash text not null,
  attempt_id uuid references public.module_assessment_attempts(id),
  source_id uuid references public.module_assessment_source_results(id),
  reason text not null check(length(trim(reason)) > 0),
  actor_id uuid not null references public.staff_profiles(id),
  created_at timestamptz not null default now()
);
alter table public.assessment_legacy_backfill enable row level security;
create policy assessment_backfill_read on public.assessment_legacy_backfill for select using(public.is_teacher());
revoke all on public.assessment_legacy_backfill from anon, authenticated, service_role;
grant select on public.assessment_legacy_backfill to authenticated;
create trigger assessment_backfill_immutable before update or delete on public.assessment_legacy_backfill for each row execute function public.assessment_immutable();

create view public.assessment_backfill_candidates with (security_invoker = true) as
select result.id legacy_result_id, md5(to_jsonb(result)::text) legacy_hash, to_jsonb(result) legacy_snapshot,
  enrolment.id enrolment_id, plan.id plan_id,
  case when ledger.legacy_result_id is not null then 'already_backfilled'
    when enrolment.id is null then 'missing_enrolment'
    when plan.id is null then 'unreviewed_plan'
    when enrolment.status::text in ('deferred','resit','did_not_complete') then 'legacy_status_requires_review'
    when exists(select 1 from public.enrolments other join public.module_offerings candidate on candidate.id = other.offering_id
      where other.id <> enrolment.id and other.student_id = result.student_id and candidate.module_id = offering.module_id) then 'ambiguous_teaching_ownership'
    when result.prior_attempt_missing or (result.is_resit and result.resit_of_result_id is null) then 'missing_predecessor'
    when exists(select 1 from public.exam_results other where other.id <> result.id and other.student_id = result.student_id and other.offering_id = result.offering_id
      and other.component_type = result.component_type and other.attempt_number = result.attempt_number) then 'duplicate_sequence'
    when result.attempt_number > 1 and not exists(select 1 from public.exam_results predecessor where predecessor.id = result.resit_of_result_id
      and predecessor.student_id = result.student_id and predecessor.offering_id = result.offering_id and predecessor.component_type = result.component_type
      and predecessor.attempt_number = result.attempt_number - 1 and not predecessor.passed and predecessor.taken_on <= result.taken_on) then 'unsupported_sequence'
    when result.component_type = 'practical' and plan.mode <> 'practical' then 'incompatible_component'
    when result.component_type = 'theory' and (plan.theory_scheme <> 'mcq' or plan.physics_weighting or result.source_system = 'manual') then 'supporting_evidence_review_required'
    when result.passed <> (result.score >= result.pass_mark) or result.resit_required = result.passed then 'contradictory_result'
    when (enrolment.status::text <> 'completed' and enrolment.credits_awarded > 0) or (enrolment.status::text = 'completed' and enrolment.credits_awarded <> module.credits) then 'contradictory_credits'
    else null end review_reason
from public.exam_results result join public.module_offerings offering on offering.id = result.offering_id
join public.course_modules module on module.id = offering.module_id
left join public.enrolments enrolment on enrolment.student_id = result.student_id and enrolment.offering_id = result.offering_id
left join public.module_assessment_plans plan on plan.id = enrolment.assessment_plan_id
left join public.assessment_legacy_backfill ledger on ledger.legacy_result_id = result.id;

create function public.backfill_assessment_results(approvals jsonb, change_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := public.assessment_require_admin(); approval jsonb; candidate record; result_row public.exam_results;
  input jsonb; attempt_key uuid; source_id_value uuid; student_identifier text; module_key uuid; term_key uuid;
  outcome jsonb; imported integer := 0; skipped integer := 0;
begin
  if length(trim(coalesce(change_reason,''))) = 0 then raise exception 'Reviewed backfill reason required'; end if;
  if exists(select 1 from public.assessment_rollout where mode = 'live') then raise exception 'Backfill must complete before cutover'; end if;
  if jsonb_typeof(approvals) <> 'array' or jsonb_array_length(approvals) > 500 then raise exception 'Provide at most 500 reviewed rows'; end if;
  for approval in select value from jsonb_array_elements(approvals) loop
    select * into strict result_row from public.exam_results where id = (approval->>'legacy_result_id')::uuid for share;
    select * into strict candidate from public.assessment_backfill_candidates where legacy_result_id = result_row.id;
    if candidate.legacy_hash is distinct from approval->>'legacy_hash' then raise exception 'Legacy evidence changed. Repeat reconciliation.'; end if;
    if candidate.review_reason = 'already_backfilled' then skipped := skipped + 1; continue; end if;
    if candidate.review_reason is not null then raise exception 'Legacy result requires review: %', candidate.review_reason; end if;
    perform 1 from public.enrolments where id = candidate.enrolment_id for update;
    if result_row.attempt_number > 1 and not exists(select 1 from public.assessment_legacy_backfill where legacy_result_id = result_row.resit_of_result_id) then raise exception 'Backfill the reviewed predecessor first'; end if;
    select coalesce(student.cccu_student_id, student.temporary_id), offering.module_id, offering.term_id into student_identifier, module_key, term_key
      from public.students student join public.module_offerings offering on offering.id = result_row.offering_id where student.id = result_row.student_id;
    select case when count(*) = 1 then (array_agg(id))[1] end into term_key from public.terms
      where result_row.taken_on between coalesce(exam_window_starts_on, starts_on) and coalesce(exam_window_ends_on, ends_on);
    input := jsonb_build_object('component',result_row.component_type,'score',result_row.score,'pass_mark',result_row.pass_mark,
      'sitting_date',result_row.taken_on,'sitting_term_id',term_key,'reason',change_reason,
      'items',case when result_row.component_type = 'theory' then jsonb_build_array(jsonb_build_object('kind','mcq','score',result_row.score)) else '[]'::jsonb end);
    if result_row.source_system = 'manual' then
      attempt_key := public.assessment_new_attempt(candidate.enrolment_id, result_row.component_type::text, input, 'Manual');
      perform public.assessment_recalculate(candidate.enrolment_id,change_reason);
      source_id_value := null;
    else
      input := input || jsonb_build_object('source_system',case when result_row.source_system = 'theory_portal' then 'Portal' else 'Practical CSV' end,
        'source_key',result_row.source_attempt_id,'student_identifier',student_identifier,'module_id',module_key,'raw_payload',to_jsonb(result_row));
      select id into source_id_value from public.module_assessment_source_results where source_system = input->>'source_system' and source_key = input->>'source_key';
      if source_id_value is not null then
        if not exists(select 1 from public.module_assessment_attempts attempt join public.assessment_current_revisions revision on revision.attempt_id = attempt.id
          join public.module_assessment_source_results source on source.id = attempt.source_id
          where attempt.source_id = source_id_value and attempt.enrolment_id = candidate.enrolment_id and attempt.active
            and source.state = 'Matched' and not source.administratively_displaced and source.conflict is null
            and attempt.component = result_row.component_type::text and revision.score = result_row.score and revision.pass_mark = result_row.pass_mark and revision.sitting_date = result_row.taken_on) then
          raise exception 'Existing source differs from legacy evidence; reconcile without overwriting the current source';
        end if;
      else
        outcome := public.ingest_assessment_source(jsonb_build_array(input));
        if (outcome->>'rejected')::integer > 0 or (outcome->>'unmatched')::integer > 0 then raise exception 'Backfill could not safely accept result: %',outcome; end if;
      end if;
      select id into strict source_id_value from public.module_assessment_source_results where source_system = input->>'source_system' and source_key = input->>'source_key';
      select id into strict attempt_key from public.module_assessment_attempts where source_id = source_id_value and active and enrolment_id = candidate.enrolment_id;
    end if;
    if (select sequence from public.module_assessment_attempts where id = attempt_key) is distinct from result_row.attempt_number then
      raise exception 'Legacy sequence conflicts with accepted history; administrator reconciliation required';
    end if;
    insert into public.assessment_legacy_backfill(legacy_result_id,legacy_hash,attempt_id,source_id,reason,actor_id)
    values(result_row.id,candidate.legacy_hash,attempt_key,source_id_value,change_reason,actor);
    insert into public.audit_events(actor_user_id,action,entity_type,entity_id,reason,metadata)
    values(actor,'assessment.legacy_backfill','enrolment_assessment',candidate.enrolment_id,change_reason,jsonb_build_object('legacy_result_id',result_row.id,'legacy_hash',candidate.legacy_hash,'attempt_id',attempt_key));
    imported := imported + 1;
  end loop;
  return jsonb_build_object('imported',imported,'already_backfilled',skipped);
end;
$$;

create view public.assessment_shadow_comparison with (security_invoker = true) as
select outcome.*,
  case when assessment->>'needs_plan' = 'true' then 'plan_review_required'
    when legacy_status::text in ('deferred','resit','did_not_complete') then 'legacy_status_requires_review'
    when (case legacy_status::text when 'planned' then 'Planned' when 'in_progress' then 'In progress' when 'completed' then 'Pass' when 'failed' then 'Fail' end) is distinct from assessment->>'calculated_status' then 'status_difference'
    when legacy_credits is distinct from (assessment->>'awarded_credits')::integer then 'credit_difference'
    else null end difference,
  (select count(*) from public.exam_results legacy join public.enrolments enrolment on enrolment.student_id = legacy.student_id and enrolment.offering_id = legacy.offering_id where enrolment.id = outcome.enrolment_id) legacy_result_count,
  (select count(*) from public.module_assessment_attempts attempt where attempt.enrolment_id = outcome.enrolment_id and active) accepted_attempt_count,
  (select jsonb_agg(jsonb_build_object('legacy_result_id',ledger.legacy_result_id,'legacy_hash',ledger.legacy_hash)) from public.assessment_legacy_backfill ledger join public.module_assessment_attempts attempt on attempt.id = ledger.attempt_id where attempt.enrolment_id = outcome.enrolment_id) legacy_hashes
from public.assessment_outcomes outcome;

create function public.set_assessment_rollout(requested_mode text, evidence jsonb, change_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare actor uuid := public.assessment_require_admin(); gate text;
begin
  perform 1 from public.assessment_rollout for update;
  if requested_mode not in ('shadow','live') or length(trim(coalesce(change_reason,''))) = 0 then raise exception 'Valid rollout mode and reason required'; end if;
  if requested_mode = 'live' then
    foreach gate in array array['reconciliation_review','sanitized_rehearsal','pilot_signoff','backup_restore','module_plans_review'] loop
      if length(trim(coalesce(evidence->>gate,''))) = 0 then raise exception 'Missing rollout sign-off: %',gate; end if;
    end loop;
    if exists(select 1 from public.course_modules where active and assessment_plan_id is null)
      or exists(select 1 from public.enrolments where assessment_plan_id is null) then raise exception 'Every module and enrolment needs a reviewed assessment plan'; end if;
  end if;
  update public.assessment_rollout set mode = requested_mode, signoff_reference = evidence::text;
  insert into public.audit_events(actor_user_id,action,entity_type,reason,metadata)
  values(actor,'assessment.rollout_changed','assessment_rollout',change_reason,jsonb_build_object('mode',requested_mode,'evidence',evidence));
end;
$$;

create function public.assessment_guard_module_plan() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated','anon','service_role') and new.assessment_plan_id is distinct from old.assessment_plan_id then raise exception 'Use the reviewed assessment plan command'; end if;
  return new;
end;
$$;
create trigger assessment_guard_module_plan before update on public.course_modules for each row execute function public.assessment_guard_module_plan();
revoke all on public.assessment_rollout from anon, authenticated, service_role;
grant select on public.assessment_rollout to authenticated;
revoke all on function public.backfill_assessment_results(jsonb,text), public.set_assessment_rollout(text,jsonb,text) from public, anon;
grant execute on function public.backfill_assessment_results(jsonb,text), public.set_assessment_rollout(text,jsonb,text) to authenticated;
revoke all on function public.assessment_guard_module_plan() from public, anon, authenticated;
grant select on public.assessment_backfill_candidates, public.assessment_shadow_comparison to authenticated;
