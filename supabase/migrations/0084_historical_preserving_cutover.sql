create or replace function public.set_assessment_rollout(requested_mode text, evidence jsonb, change_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare actor uuid := public.assessment_require_admin(); gate text;
begin
  perform 1 from public.assessment_rollout where singleton = true for update;
  if not found then raise exception 'Assessment rollout state is missing'; end if;
  if requested_mode is null or requested_mode not in ('shadow','live') or length(trim(coalesce(change_reason,''))) = 0 then raise exception 'Valid rollout mode and reason required'; end if;
  if requested_mode = 'live' then
    foreach gate in array array['reconciliation_review','sanitized_rehearsal','pilot_signoff','backup_restore','module_plans_review','historical_outcomes_review'] loop
      if length(trim(coalesce(evidence->>gate,''))) = 0 then raise exception 'Missing rollout sign-off: %',gate; end if;
    end loop;
    if exists(
      select 1 from public.assessment_historical_outcomes baseline
      join public.enrolments enrolment on enrolment.id=baseline.enrolment_id
      where (baseline.recorded_status,baseline.recorded_credits,baseline.recorded_final_mark,baseline.recorded_grade)
        is distinct from (enrolment.status::text,enrolment.credits_awarded,enrolment.final_mark,enrolment.grade)
    ) then raise exception 'Historical baseline mismatch; reconcile without rewriting original records'; end if;
    if exists(
      select 1 from public.active_module_enrolments enrolment
      join public.assessment_historical_outcomes baseline on baseline.enrolment_id=enrolment.id
      join public.students student on student.id=enrolment.student_id
      join public.module_offerings offering on offering.id=enrolment.offering_id
      join public.course_modules module on module.id=offering.module_id
      join public.terms term on term.id=offering.term_id
      where baseline.recorded_status in ('planned','in_progress')
        and student.status='active' and module.active and term.status='active'
        and current_date between term.starts_on and term.ends_on
        and not exists(select 1 from public.assessment_current_activations where enrolment_id=enrolment.id)
    ) then raise exception 'Current ongoing enrolments require reviewed activation before cutover'; end if;
    if exists(
      select 1 from public.course_modules module
      left join public.module_assessment_plans plan on plan.id=module.assessment_plan_id
      where module.active and (plan.id is null or plan.module_id<>module.id or plan.mode<>module.mode)
    ) or exists(
      select 1 from public.active_module_enrolments enrolment
      join public.module_offerings offering on offering.id=enrolment.offering_id
      join public.course_modules module on module.id=offering.module_id
      left join public.module_assessment_plans plan on plan.id=enrolment.assessment_plan_id
      where (not exists(select 1 from public.assessment_historical_outcomes where enrolment_id=enrolment.id)
        or exists(select 1 from public.assessment_current_activations where enrolment_id=enrolment.id))
        and (plan.id is null or plan.module_id<>module.id)
    ) then raise exception 'Every active module and non-archival enrolment needs a reviewed assessment plan'; end if;
  end if;
  update public.assessment_rollout set mode = requested_mode, signoff_reference = evidence::text where singleton = true;
  insert into public.audit_events(actor_user_id,action,entity_type,reason,metadata)
  values(actor,'assessment.rollout_changed','assessment_rollout',change_reason,jsonb_build_object('mode',requested_mode,'evidence',evidence));
end;
$$;
