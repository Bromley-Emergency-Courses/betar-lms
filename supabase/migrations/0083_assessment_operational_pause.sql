create table public.assessment_operational_controls (
  singleton boolean primary key default true check (singleton),
  writes_paused boolean not null default false
);
insert into public.assessment_operational_controls(singleton) values (true);
alter table public.assessment_operational_controls enable row level security;
revoke all on public.assessment_operational_controls from public, anon, authenticated, service_role;

create function public.guard_paused_assessment_writes() returns trigger
language plpgsql security definer set search_path = public as $$
declare expected_projection jsonb;
begin
  if coalesce((select writes_paused from public.assessment_operational_controls where singleton),true) then
    if tg_table_name='enrolments' and tg_op='UPDATE' then
      if (to_jsonb(new)-array['assessment_projection','assessment_revision','updated_at'])
        is not distinct from (to_jsonb(old)-array['assessment_projection','assessment_revision','updated_at']) then
        if (new.assessment_projection,new.assessment_revision) is not distinct from (old.assessment_projection,old.assessment_revision) then return new; end if;
        expected_projection := public.assessment_evaluate(old.id) || jsonb_build_object('revision',old.assessment_revision+1);
        expected_projection := expected_projection || jsonb_build_object('pass_reversed',
          not coalesce((expected_projection->'historical'->>'protected')::boolean,false)
          and coalesce(old.assessment_projection->>'calculated_status'='Pass' and expected_projection->>'calculated_status'<>'Pass',false));
        if new.assessment_revision=old.assessment_revision+1 and new.assessment_projection=expected_projection then return new; end if;
      end if;
    end if;
    raise exception 'Assessment changes are temporarily paused. Observations, presentation scoring and attendance remain available for eligible current enrolments.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_paused_assessment_writes() from public, anon, authenticated, service_role;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'exam_results','exam_portal_mappings','exam_portal_submissions',
    'module_assessment_plans','module_assessment_source_results','module_assessment_source_versions',
    'module_assessment_attempts','module_assessment_attempt_revisions','module_assessment_items',
    'module_assessment_arrangements','enrolment_disposition_events','enrolment_assessment_overrides',
    'assessment_legacy_backfill','assessment_attempt_events','assessment_historical_outcomes',
    'assessment_current_activations','assessment_rollout','enrolment_cancellations',
    'course_modules','module_offerings','terms'
  ] loop
    if to_regclass('public.'||table_name) is not null then
      execute format('create trigger assessment_operational_pause before insert or update or delete or truncate on public.%I for each statement execute function public.guard_paused_assessment_writes()',table_name);
    end if;
  end loop;
end;
$$;
create trigger assessment_operational_pause before insert or update or delete on public.enrolments
  for each row execute function public.guard_paused_assessment_writes();
create trigger assessment_operational_pause_truncate before truncate on public.enrolments
  for each statement execute function public.guard_paused_assessment_writes();
