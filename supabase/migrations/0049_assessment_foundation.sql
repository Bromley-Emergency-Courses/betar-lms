create table public.assessment_rollout (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'shadow' check (mode in ('shadow', 'live')),
  signoff_reference text,
  check (mode <> 'live' or length(trim(signoff_reference)) > 0)
);
insert into public.assessment_rollout(singleton) values (true);
alter table public.assessment_rollout enable row level security;
create policy assessment_rollout_read on public.assessment_rollout for select using (public.is_teacher());

create table public.module_assessment_plans (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.course_modules(id),
  version integer not null check (version > 0),
  mode public.module_mode not null,
  theory_scheme text not null check (theory_scheme in ('mcq', 'coursework_viva')),
  requires_coursework boolean not null default false,
  requires_viva boolean not null default false,
  physics_weighting boolean not null default false,
  theory_pass_mark numeric not null check (theory_pass_mark between 0 and 100),
  practical_pass_mark numeric check (practical_pass_mark between 0 and 100),
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid not null references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  unique(module_id, version),
  check ((mode = 'online' and practical_pass_mark is null) or (mode = 'practical' and practical_pass_mark is not null)),
  check ((theory_scheme = 'mcq' and not requires_coursework and not requires_viva)
    or (theory_scheme = 'coursework_viva' and not physics_weighting and (requires_coursework or requires_viva)))
);
alter table public.course_modules add column assessment_plan_id uuid references public.module_assessment_plans(id);
alter table public.enrolments
  add column assessment_plan_id uuid references public.module_assessment_plans(id),
  add column assessment_revision integer not null default 0,
  add column assessment_projection jsonb;

create table public.module_assessment_source_results (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check (source_system in ('Portal', 'Practical CSV')),
  source_key text not null check (length(trim(source_key)) > 0),
  student_identifier text not null,
  student_name text not null default '',
  module_id uuid references public.course_modules(id),
  component text not null check (component in ('theory', 'practical')),
  state text not null default 'Unmatched' check (state in ('Matched', 'Unmatched', 'Replaced manually', 'Voided')),
  revision integer not null default 0,
  administratively_displaced boolean not null default false,
  identity_override_reason text,
  conflict text,
  created_at timestamptz not null default now(),
  unique(source_system, source_key)
);
create table public.module_assessment_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.module_assessment_source_results(id),
  revision integer not null,
  payload_hash text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  observed_at timestamptz not null default now(),
  unique(source_id, revision),
  unique(source_id, payload_hash)
);
create index assessment_source_hash on public.module_assessment_source_versions(source_id, payload_hash);

create table public.module_assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references public.enrolments(id),
  component text not null check (component in ('theory', 'practical')),
  ordinal integer not null check (ordinal > 0),
  sequence integer check (sequence > 0),
  predecessor_id uuid references public.module_assessment_attempts(id),
  previous_result_unavailable text check (previous_result_unavailable is null or length(trim(previous_result_unavailable)) > 0),
  origin text not null check (origin in ('Manual', 'Portal', 'Practical CSV')),
  source_id uuid references public.module_assessment_source_results(id),
  active boolean not null default true,
  created_by uuid not null references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  unique(enrolment_id, component, ordinal)
);
create unique index assessment_accepted_source on public.module_assessment_attempts(source_id) where active;
create unique index assessment_accepted_sequence on public.module_assessment_attempts(enrolment_id, component, sequence) where active;

create table public.module_assessment_attempt_revisions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.module_assessment_attempts(id),
  revision integer not null check (revision > 0),
  plan_id uuid not null references public.module_assessment_plans(id),
  score numeric not null check (score between 0 and 100),
  pass_mark numeric not null check (pass_mark between 0 and 100),
  passed boolean generated always as (score >= pass_mark) stored,
  sitting_date date not null,
  sitting_term_id uuid references public.terms(id),
  source_version_id uuid references public.module_assessment_source_versions(id),
  reason text not null check (length(trim(reason)) > 0),
  actor_id uuid not null references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  unique(attempt_id, revision)
);
create table public.module_assessment_items (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.module_assessment_attempt_revisions(id),
  kind text not null check (kind in ('mcq', 'physics', 'coursework', 'viva')),
  score numeric not null check (score between 0 and 100),
  carried_from_item_id uuid references public.module_assessment_items(id),
  unique(revision_id, kind)
);
create table public.module_assessment_arrangements (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references public.enrolments(id),
  component text not null check (component in ('theory', 'practical')),
  kind text not null check (kind in ('resit_schedule', 'assessment_deferral')),
  state text not null check (state in ('active', 'completed', 'cancelled')),
  note text not null,
  completing_attempt_id uuid references public.module_assessment_attempts(id),
  reason text not null check (length(trim(reason)) > 0),
  actor_id uuid not null references public.staff_profiles(id),
  event_order bigint generated always as identity,
  created_at timestamptz not null default now()
);
create table public.enrolment_disposition_events (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references public.enrolments(id),
  disposition text check (disposition in ('Abandoned', 'Module deferred')),
  reason text not null check (length(trim(reason)) > 0),
  actor_id uuid not null references public.staff_profiles(id),
  event_order bigint generated always as identity,
  created_at timestamptz not null default now()
);
create table public.enrolment_assessment_overrides (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references public.enrolments(id),
  kind text not null check (kind in ('status', 'credits', 'indicator')),
  indicator text not null default '',
  value jsonb,
  reason text not null check (length(trim(reason)) > 0),
  actor_id uuid not null references public.staff_profiles(id),
  event_order bigint generated always as identity,
  created_at timestamptz not null default now()
);
create table public.enrolment_assessment_history (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references public.enrolments(id),
  revision integer not null,
  projection jsonb not null,
  reason text not null,
  actor_id uuid references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  unique(enrolment_id, revision)
);

create function public.assessment_immutable() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Assessment history is immutable';
end;
$$;
do $$
declare table_name text;
begin
  foreach table_name in array array['module_assessment_plans', 'module_assessment_source_results',
    'module_assessment_source_versions', 'module_assessment_attempts', 'module_assessment_attempt_revisions',
    'module_assessment_items', 'module_assessment_arrangements', 'enrolment_disposition_events',
    'enrolment_assessment_overrides', 'enrolment_assessment_history'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy assessment_staff_read on public.%I for select using (public.is_teacher())', table_name);
    execute format('revoke all on public.%I from anon, authenticated, service_role', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    if table_name not in ('module_assessment_source_results', 'module_assessment_attempts') then
      execute format('create trigger assessment_immutable before update or delete on public.%I for each row execute function public.assessment_immutable()', table_name);
    end if;
  end loop;
end;
$$;

create function public.assessment_require_admin() returns uuid language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() is not true then raise exception 'Active administrator required'; end if;
  return auth.uid();
end;
$$;

create function public.save_module_assessment_plan(input jsonb, expected_plan_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare actor uuid := public.assessment_require_admin(); module_row public.course_modules; plan_id uuid;
begin
  select * into strict module_row from public.course_modules where id = (input->>'module_id')::uuid for update;
  if module_row.assessment_plan_id is distinct from expected_plan_id then raise exception 'Plan changed. Reload before saving.'; end if;
  insert into public.module_assessment_plans(module_id, version, mode, theory_scheme, requires_coursework,
    requires_viva, physics_weighting, theory_pass_mark, practical_pass_mark, reason, created_by)
  values (module_row.id, (select coalesce(max(version), 0) + 1 from public.module_assessment_plans where module_id = module_row.id),
    module_row.mode, input->>'theory_scheme', coalesce((input->>'requires_coursework')::boolean, false),
    coalesce((input->>'requires_viva')::boolean, false), coalesce((input->>'physics_weighting')::boolean, false),
    (input->>'theory_pass_mark')::numeric, (input->>'practical_pass_mark')::numeric, input->>'reason', actor) returning id into plan_id;
  update public.course_modules set assessment_plan_id = plan_id where id = module_row.id;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, reason, metadata)
  values(actor, 'assessment.plan_created', 'course_module', module_row.id, input->>'reason', jsonb_build_object('before', expected_plan_id, 'after', plan_id));
  return plan_id;
end;
$$;

create function public.assessment_inherit_plan() returns trigger language plpgsql security definer set search_path = public as $$
begin
  select module.assessment_plan_id into new.assessment_plan_id
    from public.module_offerings offering join public.course_modules module on module.id = offering.module_id
    where offering.id = new.offering_id;
  if new.assessment_plan_id is null and exists(select 1 from public.assessment_rollout where mode = 'live') then
    raise exception 'Review the module assessment plan before enrolling students';
  end if;
  if exists(select 1 from public.module_assessment_plans plan join public.course_modules module on module.id = plan.module_id where plan.id = new.assessment_plan_id and plan.mode <> module.mode) then
    raise exception 'Review a new assessment plan after changing module mode';
  end if;
  if exists(select 1 from public.assessment_rollout where mode = 'live') and
    (new.status::text <> 'planned' or new.credits_awarded <> 0 or new.final_mark is not null or new.grade is not null) then
    raise exception 'New enrolment outcomes are calculated by the assessment workflow';
  end if;
  return new;
end;
$$;
create trigger assessment_inherit_plan before insert on public.enrolments for each row execute function public.assessment_inherit_plan();

create view public.assessment_current_revisions with (security_invoker = true) as
select distinct on (attempt_id) * from public.module_assessment_attempt_revisions order by attempt_id, revision desc;
create view public.assessment_current_arrangements with (security_invoker = true) as
select distinct on (enrolment_id, component) * from public.module_assessment_arrangements order by enrolment_id, component, event_order desc;
create view public.assessment_current_overrides with (security_invoker = true) as
select distinct on (enrolment_id, kind, indicator) * from public.enrolment_assessment_overrides order by enrolment_id, kind, indicator, event_order desc;

revoke all on function public.assessment_require_admin(), public.assessment_inherit_plan(), public.assessment_immutable() from public, anon, authenticated;
revoke all on function public.save_module_assessment_plan(jsonb, uuid) from public, anon;
grant execute on function public.save_module_assessment_plan(jsonb, uuid) to authenticated;
grant select on public.assessment_current_revisions, public.assessment_current_arrangements, public.assessment_current_overrides to authenticated;
