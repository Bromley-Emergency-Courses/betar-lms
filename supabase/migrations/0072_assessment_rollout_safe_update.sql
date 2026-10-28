create or replace function public.set_assessment_rollout(requested_mode text, evidence jsonb, change_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare actor uuid := public.assessment_require_admin(); gate text;
begin
  perform 1 from public.assessment_rollout where singleton = true for update;
  if not found then raise exception 'Assessment rollout state is missing'; end if;
  if requested_mode not in ('shadow','live') or length(trim(coalesce(change_reason,''))) = 0 then raise exception 'Valid rollout mode and reason required'; end if;
  if requested_mode = 'live' then
    foreach gate in array array['reconciliation_review','sanitized_rehearsal','pilot_signoff','backup_restore','module_plans_review'] loop
      if length(trim(coalesce(evidence->>gate,''))) = 0 then raise exception 'Missing rollout sign-off: %',gate; end if;
    end loop;
    if exists(select 1 from public.course_modules where active and assessment_plan_id is null)
      or exists(select 1 from public.enrolments where assessment_plan_id is null) then raise exception 'Every module and enrolment needs a reviewed assessment plan'; end if;
  end if;
  update public.assessment_rollout set mode = requested_mode, signoff_reference = evidence::text where singleton = true;
  insert into public.audit_events(actor_user_id,action,entity_type,reason,metadata)
  values(actor,'assessment.rollout_changed','assessment_rollout',change_reason,jsonb_build_object('mode',requested_mode,'evidence',evidence));
end;
$$;
