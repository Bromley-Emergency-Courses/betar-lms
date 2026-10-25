create table public.assessment_attempt_events (
  id uuid primary key default gen_random_uuid(),
  event_order bigint generated always as identity unique,
  enrolment_id uuid not null references public.enrolments(id),
  attempt_id uuid not null references public.module_assessment_attempts(id),
  attempt_revision_id uuid not null references public.module_assessment_attempt_revisions(id),
  kind text not null check (kind in ('exclude','restore')),
  category text not null check (category in ('invalid','incorrect_ownership')),
  exclusion_id uuid references public.assessment_attempt_events(id),
  source_id uuid references public.module_assessment_source_results(id),
  source_version_id uuid references public.module_assessment_source_versions(id),
  reason text not null check (length(trim(reason)) > 0),
  actor_id uuid not null references public.staff_profiles(id),
  created_at timestamptz not null default now()
);
create index assessment_attempt_events_attempt on public.assessment_attempt_events(attempt_id,event_order desc);
alter table public.assessment_attempt_events enable row level security;
create policy assessment_attempt_events_read on public.assessment_attempt_events for select using (public.is_teacher());
revoke all on public.assessment_attempt_events from public, anon, authenticated, service_role;
grant select on public.assessment_attempt_events to authenticated;
create trigger assessment_attempt_events_immutable before update or delete on public.assessment_attempt_events
  for each row execute function public.assessment_immutable();

alter function public.execute_assessment_command(jsonb,integer) rename to execute_assessment_command_v2;
revoke all on function public.execute_assessment_command_v2(jsonb,integer) from public, anon, authenticated, service_role;

create function public.execute_assessment_command(command jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := public.assessment_require_admin();
  command_type text := command->>'type';
  change_reason text := command->>'reason';
  attempt_row public.module_assessment_attempts;
  source_row public.module_assessment_source_results;
  enrolment_row public.enrolments;
  revision_row public.module_assessment_attempt_revisions;
  plan_row public.module_assessment_plans;
  latest_event public.assessment_attempt_events;
  latest_source_version uuid;
  category_name text;
  before_projection jsonb;
  after_projection jsonb;
begin
  if command_type is null or command_type not in ('ExcludeAttempt','RestoreAttempt') then
    if command_type in ('MatchSourceResult','UnmatchSourceResult','ReplaceSourceResult','VoidSourceResult','RestoreSourceResult')
      and exists(select 1 from public.assessment_attempt_events where source_id = (command->>'source_id')::uuid) then
      raise exception 'This evidence has result exclusion history. Use the guarded result exclusion/restoration workflow.';
    end if;
    return public.execute_assessment_command_v2(command, expected_revision);
  end if;
  if command - array['type','enrolment_id','attempt_id','reason','category','exclusion_id','expected_source_revision','reviewed_source_version_id'] <> '{}'::jsonb then
    raise exception 'Exclusion/restoration cannot edit scores, identity, sitting or assessment configuration';
  end if;
  if length(trim(coalesce(change_reason,''))) = 0 then raise exception 'An administrator reason is required'; end if;
  select * into attempt_row from public.module_assessment_attempts where id = (command->>'attempt_id')::uuid
    and enrolment_id = (command->>'enrolment_id')::uuid;
  if attempt_row.id is null then raise exception 'Result is not owned by this enrolment'; end if;
  if attempt_row.source_id is not null then
    select * into strict source_row from public.module_assessment_source_results where id = attempt_row.source_id for update;
    if source_row.revision is distinct from (command->>'expected_source_revision')::integer then raise exception 'Source changed. Reload before saving.'; end if;
    select id into latest_source_version from public.module_assessment_source_versions where source_id = source_row.id order by revision desc limit 1;
  elsif command ? 'expected_source_revision' or command ? 'reviewed_source_version_id' then
    raise exception 'This result has no imported evidence';
  end if;
  select * into strict enrolment_row from public.enrolments where id = attempt_row.enrolment_id for update;
  if enrolment_row.assessment_revision is distinct from expected_revision then raise exception 'Assessment changed. Reload before saving.'; end if;
  select * into strict attempt_row from public.module_assessment_attempts where id = attempt_row.id for update;
  select * into strict revision_row from public.assessment_current_revisions where attempt_id = attempt_row.id;
  select * into plan_row from public.module_assessment_plans where id = enrolment_row.assessment_plan_id;
  if plan_row.id is null then raise exception 'Review and assign an assessment plan first'; end if;
  select * into latest_event from public.assessment_attempt_events where attempt_id = attempt_row.id order by event_order desc limit 1;
  if exists(select 1 from public.module_assessment_attempts where enrolment_id = attempt_row.enrolment_id
    and component = attempt_row.component and active and ordinal > attempt_row.ordinal) then
    raise exception 'A later active attempt exists. Review dependent results before excluding or restoring this sitting.';
  end if;
  before_projection := public.assessment_evaluate(enrolment_row.id);
  if command_type = 'ExcludeAttempt' then
    if not attempt_row.active then raise exception 'This result is already excluded or withdrawn'; end if;
    category_name := command->>'category';
    if category_name is null or category_name not in ('invalid','incorrect_ownership') then raise exception 'Select an exclusion category'; end if;
    if source_row.id is not null and source_row.state <> (case when attempt_row.origin = 'Manual' then 'Replaced manually' else 'Matched' end) then
      raise exception 'The accepted source association has changed. Reload and review its evidence.';
    end if;
    update public.module_assessment_attempts set active = false where id = attempt_row.id;
    if source_row.id is not null then
      update public.module_assessment_source_results set state = case when category_name = 'incorrect_ownership' then 'Unmatched' else 'Voided' end,
        administratively_displaced = true, revision = revision + 1 where id = source_row.id;
    end if;
  else
    if attempt_row.active then raise exception 'This result is already accepted'; end if;
    if latest_event.id is null or latest_event.kind <> 'exclude' or latest_event.id is distinct from (command->>'exclusion_id')::uuid then
      raise exception 'Review the current exclusion before restoring this result';
    end if;
    if latest_event.attempt_revision_id <> revision_row.id then raise exception 'The excluded score has changed. Review its history before restoration.'; end if;
    category_name := latest_event.category;
    if source_row.id is not null then
      if source_row.state <> (case when category_name = 'incorrect_ownership' then 'Unmatched' else 'Voided' end)
        or exists(select 1 from public.module_assessment_attempts where source_id = source_row.id and active) then
        raise exception 'Source ownership or lifecycle has changed. Reconciliation is required before restoration.';
      end if;
      if source_row.conflict is not null then raise exception 'The source has an unresolved conflict. Reconciliation is required before restoration.'; end if;
      if latest_source_version is distinct from (command->>'reviewed_source_version_id')::uuid then
        raise exception 'Review the latest source evidence and confirm restoration of the original accepted score';
      end if;
    end if;
    if exists(select 1 from public.module_assessment_attempts earlier join public.assessment_current_revisions revision on revision.attempt_id = earlier.id
      where earlier.enrolment_id = attempt_row.enrolment_id and earlier.component = attempt_row.component and earlier.active
        and (earlier.sequence = attempt_row.sequence or (earlier.ordinal < attempt_row.ordinal and (revision.passed or revision.sitting_date > revision_row.sitting_date)))) then
      raise exception 'An earlier accepted result conflicts with this sitting. Review the component history before restoration.';
    end if;
    if (attempt_row.component = 'practical' and plan_row.mode <> 'practical') or (attempt_row.component = 'theory' and
      (select coalesce(array_agg(kind order by kind),'{}'::text[]) from public.module_assessment_items where revision_id = revision_row.id)
      is distinct from (select coalesce(array_agg(kind order by kind),'{}'::text[]) from (
        select 'mcq' kind where plan_row.theory_scheme = 'mcq' union all select 'physics' where plan_row.physics_weighting
        union all select 'coursework' where plan_row.requires_coursework union all select 'viva' where plan_row.requires_viva) required)) then
      raise exception 'The current assessment plan is incompatible with this excluded result. Review Course configuration.';
    end if;
    if exists(select 1 from public.module_assessment_items item where item.revision_id = revision_row.id and item.carried_from_item_id is not null
      and not exists(select 1 from public.module_assessment_items carried join public.assessment_current_revisions current on current.id = carried.revision_id
        join public.module_assessment_attempts earlier on earlier.id = current.attempt_id where carried.id = item.carried_from_item_id and earlier.active)) then
      raise exception 'Carried evidence has changed or been excluded. Review dependent results before restoration.';
    end if;
    update public.module_assessment_attempts set active = true where id = attempt_row.id;
    if source_row.id is not null then
      update public.module_assessment_source_results set state = case when attempt_row.origin = 'Manual' then 'Replaced manually' else 'Matched' end,
        administratively_displaced = true, revision = revision + 1 where id = source_row.id;
    end if;
  end if;
  insert into public.assessment_attempt_events(enrolment_id,attempt_id,attempt_revision_id,kind,category,exclusion_id,source_id,source_version_id,reason,actor_id)
    values(enrolment_row.id,attempt_row.id,revision_row.id,case when command_type = 'ExcludeAttempt' then 'exclude' else 'restore' end,
      category_name,case when command_type = 'RestoreAttempt' then latest_event.id end,source_row.id,latest_source_version,change_reason,actor);
  after_projection := public.assessment_recalculate(enrolment_row.id,change_reason);
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,reason,metadata)
    values(actor,'assessment.' || command_type,'enrolment_assessment',enrolment_row.id,change_reason,
      jsonb_build_object('command',command,'before',before_projection,'after',after_projection,'source_before',to_jsonb(source_row)));
  return jsonb_build_object('assessment',after_projection,'source_id',source_row.id,'pass_reversed',coalesce((after_projection->>'pass_reversed')::boolean,false),
    'change',jsonb_build_object('before_status',before_projection->>'effective_status','after_status',after_projection->>'effective_status',
      'before_credits',before_projection->'awarded_credits','after_credits',after_projection->'awarded_credits'));
end;
$$;
revoke all on function public.execute_assessment_command(jsonb,integer) from public, anon, service_role;
grant execute on function public.execute_assessment_command(jsonb,integer) to authenticated;
