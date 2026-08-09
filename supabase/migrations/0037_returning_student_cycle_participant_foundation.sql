do $$
begin
  create type public.returning_student_cycle_phase as enum (
    'setup',
    'collecting_responses',
    'review_confirmation',
    'complete'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.returning_student_participant_membership_state as enum ('included', 'removed');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.returning_student_participant_inclusion_basis as enum ('status_group', 'individual');
exception
  when duplicate_object then null;
end;
$$;

create table public.returning_student_cycles (
  id uuid primary key default gen_random_uuid(),
  target_term_id uuid not null unique references public.terms(id) on delete restrict,
  phase public.returning_student_cycle_phase not null default 'setup',
  created_by_user_id uuid references public.staff_profiles(id) on delete set null,
  opened_at timestamptz,
  opened_by_user_id uuid references public.staff_profiles(id) on delete set null,
  review_started_at timestamptz,
  review_started_by_user_id uuid references public.staff_profiles(id) on delete set null,
  completed_at timestamptz,
  completed_by_user_id uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (phase = 'setup' and opened_at is null and review_started_at is null and completed_at is null)
    or (phase = 'collecting_responses' and opened_at is not null and review_started_at is null and completed_at is null)
    or (phase = 'review_confirmation' and opened_at is not null and review_started_at is not null and completed_at is null)
    or (phase = 'complete' and opened_at is not null and review_started_at is not null and completed_at is not null)
  )
);

create unique index returning_student_cycles_one_underway_idx
  on public.returning_student_cycles ((true))
  where phase <> 'complete';

create index returning_student_cycles_phase_created_idx
  on public.returning_student_cycles(phase, created_at desc);

create table public.returning_student_cycle_status_groups (
  cycle_id uuid not null references public.returning_student_cycles(id) on delete cascade,
  student_status public.student_status not null,
  created_at timestamptz not null default now(),
  primary key (cycle_id, student_status),
  check (student_status in ('active', 'deferred', 'interrupted'))
);

create table public.returning_student_cycle_offerings (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.returning_student_cycles(id) on delete cascade,
  offering_id uuid not null references public.module_offerings(id) on delete restrict,
  module_code_snapshot text not null,
  module_title_snapshot text not null,
  module_credits_snapshot integer not null check (module_credits_snapshot > 0),
  planned_capacity integer not null check (planned_capacity > 0),
  source_capacity_snapshot integer not null check (source_capacity_snapshot > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, offering_id)
);

create index returning_student_cycle_offerings_cycle_idx
  on public.returning_student_cycle_offerings(cycle_id, module_code_snapshot);

create table public.returning_student_cycle_participants (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.returning_student_cycles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  person_id uuid references public.persons(id) on delete restrict,
  membership_state public.returning_student_participant_membership_state not null default 'included',
  inclusion_basis public.returning_student_participant_inclusion_basis not null,
  included_at timestamptz not null default now(),
  included_by_user_id uuid references public.staff_profiles(id) on delete set null,
  inclusion_reason text,
  excluded_from_group_refresh boolean not null default false,
  removed_at timestamptz,
  removed_by_user_id uuid references public.staff_profiles(id) on delete set null,
  removal_reason text,
  snapshot_programme text not null,
  snapshot_status public.student_status not null,
  snapshot_awarded_credits integer not null check (snapshot_awarded_credits >= 0),
  snapshot_email text,
  additional_study_confirmed_at timestamptz,
  additional_study_confirmed_by_user_id uuid references public.staff_profiles(id) on delete set null,
  additional_study_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, student_id),
  check (
    inclusion_basis = 'status_group'
    or length(trim(coalesce(inclusion_reason, ''))) > 0
  ),
  check (
    (membership_state = 'included' and removed_at is null and removal_reason is null)
    or (
      membership_state = 'removed'
      and removed_at is not null
      and length(trim(coalesce(removal_reason, ''))) > 0
    )
  ),
  check (
    additional_study_confirmed_at is null
    or length(trim(coalesce(additional_study_reason, ''))) > 0
  )
);

create index returning_student_cycle_participants_cycle_state_idx
  on public.returning_student_cycle_participants(cycle_id, membership_state, snapshot_status);

create index returning_student_cycle_participants_student_idx
  on public.returning_student_cycle_participants(student_id, created_at desc);

create table public.returning_student_participant_membership_events (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.returning_student_cycle_participants(id) on delete cascade,
  cycle_id uuid not null references public.returning_student_cycles(id) on delete cascade,
  event_type text not null check (event_type in (
    'initial_included',
    'individual_added',
    'readded',
    'removed',
    'refresh_added',
    'refresh_removed',
    'snapshot_refreshed',
    'additional_study_confirmed'
  )),
  reason text,
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),
  actor_user_id uuid references public.staff_profiles(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index returning_student_participant_events_participant_idx
  on public.returning_student_participant_membership_events(participant_id, occurred_at desc);

alter table public.returning_student_cycles enable row level security;
alter table public.returning_student_cycle_status_groups enable row level security;
alter table public.returning_student_cycle_offerings enable row level security;
alter table public.returning_student_cycle_participants enable row level security;
alter table public.returning_student_participant_membership_events enable row level security;

create policy "admins manage returning student cycles"
  on public.returning_student_cycles for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins manage returning student cycle status groups"
  on public.returning_student_cycle_status_groups for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins manage returning student cycle offerings"
  on public.returning_student_cycle_offerings for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins manage returning student cycle participants"
  on public.returning_student_cycle_participants for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins manage returning student participant events"
  on public.returning_student_participant_membership_events for all
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.formally_awarded_credits(p_student_id uuid)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(sum(enrolment.credits_awarded), 0)::integer
  from public.enrolments enrolment
  where enrolment.student_id = p_student_id;
$$;

create or replace function public.guard_single_current_term_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('published', 'active') then
    perform pg_advisory_xact_lock(hashtext('betar-single-term-' || new.status::text));

    if exists (
      select 1
      from public.terms term
      where term.status = new.status
        and term.id <> new.id
    ) then
      raise exception 'Only one % term may exist at a time', new.status;
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_single_current_term_status
  before insert or update of status on public.terms
  for each row
  execute function public.guard_single_current_term_status();

create or replace view public.returning_student_cycle_participant_work_items
with (security_invoker = true)
as
with credit_totals as (
  select
    student.id as student_id,
    public.formally_awarded_credits(student.id) as awarded_credits
  from public.students student
),
portal_identities as (
  select distinct on (identity.person_id)
    identity.person_id,
    identity.id as identity_id,
    identity.email
  from public.person_auth_identities identity
  where identity.active
    and identity.actor_type = 'student'
  order by identity.person_id, identity.created_at desc
)
select
  participant.id as participant_id,
  participant.cycle_id,
  participant.student_id,
  participant.person_id,
  participant.membership_state,
  participant.inclusion_basis,
  participant.snapshot_programme,
  participant.snapshot_status,
  participant.snapshot_awarded_credits,
  participant.snapshot_email,
  student.programme as current_programme,
  student.status as current_status,
  credit_totals.awarded_credits as current_awarded_credits,
  coalesce(nullif(trim(person.email), ''), nullif(trim(student.email), '')) as current_email,
  portal_identities.identity_id as portal_identity_id,
  portal_identities.email as portal_identity_email,
  participant.snapshot_programme is distinct from student.programme
    or participant.snapshot_status is distinct from student.status
    or participant.snapshot_awarded_credits is distinct from credit_totals.awarded_credits
    or participant.snapshot_email is distinct from coalesce(nullif(trim(person.email), ''), nullif(trim(student.email), ''))
    as has_eligibility_change,
  student.status = 'withdrawn' as is_withdrawn,
  student.programme <> 'pgcert' as is_wrong_programme,
  credit_totals.awarded_credits >= 60
    and participant.additional_study_confirmed_at is null
    as needs_additional_study_confirmation,
  case
    when participant.membership_state = 'removed' then 'removed'
    when student.status = 'withdrawn' then 'withdrawn'
    when student.programme <> 'pgcert' then 'not_pgcert'
    when participant.person_id is null then 'missing_person'
    when portal_identities.identity_id is null
      or position('@' in coalesce(portal_identities.email, '')) = 0 then 'missing_portal_identity'
    when credit_totals.awarded_credits >= 60
      and participant.additional_study_confirmed_at is null then 'confirm_additional_study'
    else null
  end as blocking_reason
from public.returning_student_cycle_participants participant
join public.students student on student.id = participant.student_id
join credit_totals on credit_totals.student_id = student.id
left join public.persons person on person.id = participant.person_id
left join portal_identities on portal_identities.person_id = participant.person_id;

create or replace function public.create_returning_student_cycle(
  p_target_term_id uuid,
  p_status_groups public.student_status[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_cycle_id uuid;
  v_status_groups public.student_status[] := coalesce(p_status_groups, array[]::public.student_status[]);
  v_distinct_status_count integer;
  v_participant_count integer;
  v_offering_count integer;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can create returning-student cycles'
      using errcode = '42501';
  end if;

  select count(distinct selected_status)
  into v_distinct_status_count
  from unnest(v_status_groups) selected_status;

  if v_distinct_status_count = 0
    or v_distinct_status_count <> cardinality(v_status_groups)
    or exists (
      select 1 from unnest(v_status_groups) selected_status
      where selected_status not in ('active', 'deferred', 'interrupted')
    ) then
    raise exception 'Choose one or more distinct active, deferred, or interrupted status groups';
  end if;

  if (select count(*) from public.terms where status = 'published') <> 1
    or not exists (
      select 1 from public.terms
      where id = p_target_term_id
        and status = 'published'
        and starts_on >= current_date
    ) then
    raise exception 'The returning-student cycle requires the single upcoming Published target term';
  end if;

  if exists (select 1 from public.returning_student_cycles where phase <> 'complete') then
    raise exception 'A returning-student cycle is already underway';
  end if;

  select count(*) into v_offering_count
  from public.module_offerings offering
  join public.course_modules module on module.id = offering.module_id
  where offering.term_id = p_target_term_id
    and module.active;

  if v_offering_count = 0 then
    raise exception 'The Published target term requires at least one active module offering';
  end if;

  insert into public.returning_student_cycles (
    target_term_id,
    created_by_user_id
  )
  values (p_target_term_id, v_actor_user_id)
  returning id into v_cycle_id;

  insert into public.returning_student_cycle_status_groups (cycle_id, student_status)
  select v_cycle_id, selected_status
  from unnest(v_status_groups) selected_status;

  insert into public.returning_student_cycle_offerings (
    cycle_id,
    offering_id,
    module_code_snapshot,
    module_title_snapshot,
    module_credits_snapshot,
    planned_capacity,
    source_capacity_snapshot
  )
  select
    v_cycle_id,
    offering.id,
    module.code,
    module.title,
    module.credits,
    offering.capacity,
    offering.capacity
  from public.module_offerings offering
  join public.course_modules module on module.id = offering.module_id
  where offering.term_id = p_target_term_id
    and module.active
  order by module.code;

  with inserted_participants as (
    insert into public.returning_student_cycle_participants (
      cycle_id,
      student_id,
      person_id,
      inclusion_basis,
      included_by_user_id,
      snapshot_programme,
      snapshot_status,
      snapshot_awarded_credits,
      snapshot_email
    )
    select
      v_cycle_id,
      student.id,
      student.person_id,
      'status_group',
      v_actor_user_id,
      student.programme,
      student.status,
      public.formally_awarded_credits(student.id),
      coalesce(nullif(trim(person.email), ''), nullif(trim(student.email), ''))
    from public.students student
    left join public.persons person on person.id = student.person_id
    where student.programme = 'pgcert'
      and student.status = any(v_status_groups)
      and public.formally_awarded_credits(student.id) < 60
    returning *
  ),
  inserted_events as (
    insert into public.returning_student_participant_membership_events (
      participant_id,
      cycle_id,
      event_type,
      snapshot,
      actor_user_id
    )
    select
      participant.id,
      participant.cycle_id,
      'initial_included',
      jsonb_build_object(
        'student_id', participant.student_id,
        'programme', participant.snapshot_programme,
        'status', participant.snapshot_status,
        'awarded_credits', participant.snapshot_awarded_credits,
        'inclusion_basis', participant.inclusion_basis
      ),
      v_actor_user_id
    from inserted_participants participant
    returning id
  )
  select count(*) into v_participant_count from inserted_participants;

  insert into public.audit_events (
    actor_type,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    'staff',
    v_actor_user_id,
    'returning_student_cycle.created',
    'returning_student_cycle',
    v_cycle_id,
    jsonb_build_object(
      'target_term_id', p_target_term_id,
      'status_groups', to_jsonb(v_status_groups),
      'participant_count', v_participant_count,
      'offering_count', v_offering_count
    )
  );

  return v_cycle_id;
end;
$$;

create or replace function public.configure_returning_student_cycle_status_groups(
  p_cycle_id uuid,
  p_status_groups public.student_status[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_cycle public.returning_student_cycles%rowtype;
  v_status_groups public.student_status[] := coalesce(p_status_groups, array[]::public.student_status[]);
  v_distinct_status_count integer;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can configure returning-student cycles'
      using errcode = '42501';
  end if;

  select * into v_cycle
  from public.returning_student_cycles
  where id = p_cycle_id
  for update;

  if not found or v_cycle.phase <> 'setup' then
    raise exception 'Status groups can only be changed during cycle Setup';
  end if;

  select count(distinct selected_status)
  into v_distinct_status_count
  from unnest(v_status_groups) selected_status;

  if v_distinct_status_count = 0
    or v_distinct_status_count <> cardinality(v_status_groups)
    or exists (
      select 1 from unnest(v_status_groups) selected_status
      where selected_status not in ('active', 'deferred', 'interrupted')
    ) then
    raise exception 'Choose one or more distinct active, deferred, or interrupted status groups';
  end if;

  delete from public.returning_student_cycle_status_groups where cycle_id = v_cycle.id;
  insert into public.returning_student_cycle_status_groups (cycle_id, student_status)
  select v_cycle.id, selected_status from unnest(v_status_groups) selected_status;

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    'staff', v_actor_user_id, 'returning_student_cycle.status_groups_configured',
    'returning_student_cycle', v_cycle.id,
    jsonb_build_object('status_groups', to_jsonb(v_status_groups), 'membership_changed', false)
  );

  return v_cycle.id;
end;
$$;

create or replace function public.preview_returning_student_cycle_eligibility(p_cycle_id uuid)
returns table (
  change_type text,
  student_id uuid,
  participant_id uuid,
  current_status public.student_status,
  current_awarded_credits integer,
  detail text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admissions admins can preview returning-student eligibility'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.returning_student_cycles where id = p_cycle_id) then
    raise exception 'Returning-student cycle was not found';
  end if;

  return query
  with current_students as (
    select
      student.id,
      student.person_id,
      student.programme,
      student.status,
      coalesce(nullif(trim(person.email), ''), nullif(trim(student.email), '')) as email,
      public.formally_awarded_credits(student.id) as awarded_credits,
      exists (
        select 1
        from public.returning_student_cycle_status_groups status_group
        where status_group.cycle_id = p_cycle_id
          and status_group.student_status = student.status
      ) as status_group_selected
    from public.students student
    left join public.persons person on person.id = student.person_id
  ),
  candidates as (
    select
      current_student.*,
      participant.id as participant_id,
      participant.membership_state,
      participant.inclusion_basis,
      participant.excluded_from_group_refresh,
      participant.snapshot_programme,
      participant.snapshot_status,
      participant.snapshot_awarded_credits,
      participant.snapshot_email,
      (
        current_student.programme = 'pgcert'
        and current_student.status_group_selected
        and current_student.awarded_credits < 60
      ) as normally_eligible,
      (
        current_student.programme = 'pgcert'
        and current_student.status <> 'withdrawn'
        and (
          current_student.status in ('active', 'deferred', 'interrupted')
          or current_student.awarded_credits >= 60
        )
      ) as individually_valid
    from current_students current_student
    left join public.returning_student_cycle_participants participant
      on participant.cycle_id = p_cycle_id
      and participant.student_id = current_student.id
  )
  select
    case
      when candidate.normally_eligible
        and (candidate.participant_id is null or (
          candidate.membership_state = 'removed'
          and not candidate.excluded_from_group_refresh
        )) then 'add_eligible'
      when candidate.membership_state = 'included'
        and candidate.inclusion_basis = 'status_group'
        and not candidate.normally_eligible then 'remove_ineligible'
      when candidate.membership_state = 'included'
        and candidate.inclusion_basis = 'individual'
        and not candidate.individually_valid then 'remove_ineligible'
      else 'facts_changed'
    end,
    candidate.id,
    candidate.participant_id,
    candidate.status,
    candidate.awarded_credits,
    case
      when candidate.programme <> 'pgcert' then 'Student is no longer on PGCert.'
      when candidate.status = 'withdrawn' then 'Withdrawn students cannot participate.'
      when candidate.awarded_credits >= 60 then 'Student now has 60 or more formally awarded credits.'
      when not candidate.status_group_selected then 'Current status is not in a selected group.'
      else 'Eligibility facts changed.'
    end
  from candidates candidate
  where (
      candidate.normally_eligible
      and (candidate.participant_id is null or (
        candidate.membership_state = 'removed'
        and not candidate.excluded_from_group_refresh
      ))
    )
    or (
      candidate.membership_state = 'included'
      and (
        (candidate.inclusion_basis = 'status_group' and not candidate.normally_eligible)
        or (candidate.inclusion_basis = 'individual' and not candidate.individually_valid)
        or candidate.snapshot_programme is distinct from candidate.programme
        or candidate.snapshot_status is distinct from candidate.status
        or candidate.snapshot_awarded_credits is distinct from candidate.awarded_credits
        or candidate.snapshot_email is distinct from candidate.email
      )
    )
  order by 1, candidate.id;
end;
$$;

create or replace function public.apply_returning_student_cycle_eligibility_refresh(p_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_cycle public.returning_student_cycles%rowtype;
  v_added_count integer := 0;
  v_removed_count integer := 0;
  v_refreshed_count integer := 0;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can refresh returning-student eligibility'
      using errcode = '42501';
  end if;

  select * into v_cycle
  from public.returning_student_cycles
  where id = p_cycle_id
  for update;

  if not found or v_cycle.phase <> 'setup' then
    raise exception 'Eligibility can only be refreshed during cycle Setup';
  end if;

  with eligible_students as (
    select
      student.id,
      student.person_id,
      student.programme,
      student.status,
      public.formally_awarded_credits(student.id) as awarded_credits,
      coalesce(nullif(trim(person.email), ''), nullif(trim(student.email), '')) as email
    from public.students student
    join public.returning_student_cycle_status_groups status_group
      on status_group.cycle_id = v_cycle.id
      and status_group.student_status = student.status
    left join public.persons person on person.id = student.person_id
    where student.programme = 'pgcert'
      and public.formally_awarded_credits(student.id) < 60
  ),
  inserted as (
    insert into public.returning_student_cycle_participants (
      cycle_id, student_id, person_id, inclusion_basis, included_by_user_id,
      snapshot_programme, snapshot_status, snapshot_awarded_credits, snapshot_email
    )
    select
      v_cycle.id, eligible.id, eligible.person_id, 'status_group', v_actor_user_id,
      eligible.programme, eligible.status, eligible.awarded_credits, eligible.email
    from eligible_students eligible
    where not exists (
      select 1 from public.returning_student_cycle_participants participant
      where participant.cycle_id = v_cycle.id and participant.student_id = eligible.id
    )
    returning *
  ),
  inserted_events as (
    insert into public.returning_student_participant_membership_events (
      participant_id, cycle_id, event_type, snapshot, actor_user_id
    )
    select
      inserted.id, inserted.cycle_id, 'refresh_added',
      jsonb_build_object(
        'student_id', inserted.student_id,
        'programme', inserted.snapshot_programme,
        'status', inserted.snapshot_status,
        'awarded_credits', inserted.snapshot_awarded_credits
      ),
      v_actor_user_id
    from inserted
    returning id
  )
  select count(*) into v_added_count from inserted;

  with eligible_students as (
    select
      student.id,
      student.person_id,
      student.programme,
      student.status,
      public.formally_awarded_credits(student.id) as awarded_credits,
      coalesce(nullif(trim(person.email), ''), nullif(trim(student.email), '')) as email
    from public.students student
    join public.returning_student_cycle_status_groups status_group
      on status_group.cycle_id = v_cycle.id
      and status_group.student_status = student.status
    left join public.persons person on person.id = student.person_id
    where student.programme = 'pgcert'
      and public.formally_awarded_credits(student.id) < 60
  ),
  readded as (
    update public.returning_student_cycle_participants participant
    set
      person_id = eligible.person_id,
      membership_state = 'included',
      inclusion_basis = 'status_group',
      included_at = now(),
      included_by_user_id = v_actor_user_id,
      inclusion_reason = null,
      removed_at = null,
      removed_by_user_id = null,
      removal_reason = null,
      snapshot_programme = eligible.programme,
      snapshot_status = eligible.status,
      snapshot_awarded_credits = eligible.awarded_credits,
      snapshot_email = eligible.email,
      updated_at = now()
    from eligible_students eligible
    where participant.cycle_id = v_cycle.id
      and participant.student_id = eligible.id
      and participant.membership_state = 'removed'
      and not participant.excluded_from_group_refresh
    returning participant.*
  ),
  readded_events as (
    insert into public.returning_student_participant_membership_events (
      participant_id, cycle_id, event_type, snapshot, actor_user_id
    )
    select
      readded.id, readded.cycle_id, 'readded',
      jsonb_build_object(
        'student_id', readded.student_id,
        'programme', readded.snapshot_programme,
        'status', readded.snapshot_status,
        'awarded_credits', readded.snapshot_awarded_credits
      ),
      v_actor_user_id
    from readded
    returning id
  )
  select v_added_count + count(*) into v_added_count from readded;

  with current_facts as (
    select
      student.id,
      student.person_id,
      student.programme,
      student.status,
      public.formally_awarded_credits(student.id) as awarded_credits,
      coalesce(nullif(trim(person.email), ''), nullif(trim(student.email), '')) as email,
      exists (
        select 1 from public.returning_student_cycle_status_groups status_group
        where status_group.cycle_id = v_cycle.id and status_group.student_status = student.status
      ) as status_group_selected
    from public.students student
    left join public.persons person on person.id = student.person_id
  ),
  removed as (
    update public.returning_student_cycle_participants participant
    set
      membership_state = 'removed',
      removed_at = now(),
      removed_by_user_id = v_actor_user_id,
      removal_reason = case
        when current_fact.programme <> 'pgcert' then 'Eligibility refresh: student is no longer on PGCert.'
        when current_fact.status = 'withdrawn' then 'Eligibility refresh: student is withdrawn.'
        when participant.inclusion_basis = 'status_group' and current_fact.awarded_credits >= 60
          then 'Eligibility refresh: student has 60 or more formally awarded credits.'
        else 'Eligibility refresh: current status is no longer in a selected group.'
      end,
      excluded_from_group_refresh = false,
      updated_at = now()
    from current_facts current_fact
    where participant.cycle_id = v_cycle.id
      and participant.student_id = current_fact.id
      and participant.membership_state = 'included'
      and (
        (participant.inclusion_basis = 'status_group' and not (
          current_fact.programme = 'pgcert'
          and current_fact.status_group_selected
          and current_fact.awarded_credits < 60
        ))
        or (participant.inclusion_basis = 'individual' and not (
          current_fact.programme = 'pgcert'
          and current_fact.status <> 'withdrawn'
          and (
            current_fact.status in ('active', 'deferred', 'interrupted')
            or current_fact.awarded_credits >= 60
          )
        ))
      )
    returning participant.*
  ),
  removed_events as (
    insert into public.returning_student_participant_membership_events (
      participant_id, cycle_id, event_type, reason, snapshot, actor_user_id
    )
    select
      removed.id, removed.cycle_id, 'refresh_removed', removed.removal_reason,
      jsonb_build_object(
        'student_id', removed.student_id,
        'programme', removed.snapshot_programme,
        'status', removed.snapshot_status,
        'awarded_credits', removed.snapshot_awarded_credits
      ),
      v_actor_user_id
    from removed
    returning id
  )
  select count(*) into v_removed_count from removed;

  with current_facts as (
    select
      student.id,
      student.person_id,
      student.programme,
      student.status,
      public.formally_awarded_credits(student.id) as awarded_credits,
      coalesce(nullif(trim(person.email), ''), nullif(trim(student.email), '')) as email
    from public.students student
    left join public.persons person on person.id = student.person_id
  ),
  refreshed as (
    update public.returning_student_cycle_participants participant
    set
      person_id = current_fact.person_id,
      snapshot_programme = current_fact.programme,
      snapshot_status = current_fact.status,
      snapshot_awarded_credits = current_fact.awarded_credits,
      snapshot_email = current_fact.email,
      updated_at = now()
    from current_facts current_fact
    where participant.cycle_id = v_cycle.id
      and participant.student_id = current_fact.id
      and participant.membership_state = 'included'
      and (
        participant.snapshot_programme is distinct from current_fact.programme
        or participant.snapshot_status is distinct from current_fact.status
        or participant.snapshot_awarded_credits is distinct from current_fact.awarded_credits
        or participant.snapshot_email is distinct from current_fact.email
      )
    returning participant.*
  ),
  refreshed_events as (
    insert into public.returning_student_participant_membership_events (
      participant_id, cycle_id, event_type, snapshot, actor_user_id
    )
    select
      refreshed.id, refreshed.cycle_id, 'snapshot_refreshed',
      jsonb_build_object(
        'student_id', refreshed.student_id,
        'programme', refreshed.snapshot_programme,
        'status', refreshed.snapshot_status,
        'awarded_credits', refreshed.snapshot_awarded_credits
      ),
      v_actor_user_id
    from refreshed
    returning id
  )
  select count(*) into v_refreshed_count from refreshed;

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    'staff', v_actor_user_id, 'returning_student_cycle.eligibility_refreshed',
    'returning_student_cycle', v_cycle.id,
    jsonb_build_object(
      'added_count', v_added_count,
      'removed_count', v_removed_count,
      'refreshed_count', v_refreshed_count
    )
  );

  return jsonb_build_object(
    'cycle_id', v_cycle.id,
    'added_count', v_added_count,
    'removed_count', v_removed_count,
    'refreshed_count', v_refreshed_count
  );
end;
$$;

create or replace function public.add_returning_student_cycle_participant(
  p_cycle_id uuid,
  p_student_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_cycle public.returning_student_cycles%rowtype;
  v_student public.students%rowtype;
  v_participant public.returning_student_cycle_participants%rowtype;
  v_awarded_credits integer;
  v_email text;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 4000), '');
  v_event_type text := 'individual_added';
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can add returning-student participants'
      using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'An individual inclusion reason is required';
  end if;

  select * into v_cycle from public.returning_student_cycles where id = p_cycle_id for update;
  if not found or v_cycle.phase = 'complete' then
    raise exception 'Participants cannot be added to this cycle';
  end if;

  select * into v_student from public.students where id = p_student_id for update;
  if not found then
    raise exception 'Student was not found';
  end if;

  v_awarded_credits := public.formally_awarded_credits(v_student.id);

  if v_student.programme <> 'pgcert'
    or v_student.status = 'withdrawn'
    or (
      v_student.status not in ('active', 'deferred', 'interrupted')
      and v_awarded_credits < 60
    ) then
    raise exception 'Only a non-withdrawn PGCert learner in an eligible status or with additional-study credit can be added';
  end if;

  select coalesce(nullif(trim(person.email), ''), nullif(trim(v_student.email), ''))
  into v_email
  from (select 1) seed
  left join public.persons person on person.id = v_student.person_id;

  select * into v_participant
  from public.returning_student_cycle_participants
  where cycle_id = v_cycle.id and student_id = v_student.id
  for update;

  if found and v_participant.membership_state = 'included' then
    raise exception 'Student is already included in this cycle';
  end if;

  if found then
    v_event_type := 'readded';
    update public.returning_student_cycle_participants
    set
      person_id = v_student.person_id,
      membership_state = 'included',
      inclusion_basis = 'individual',
      included_at = now(),
      included_by_user_id = v_actor_user_id,
      inclusion_reason = v_reason,
      excluded_from_group_refresh = false,
      removed_at = null,
      removed_by_user_id = null,
      removal_reason = null,
      snapshot_programme = v_student.programme,
      snapshot_status = v_student.status,
      snapshot_awarded_credits = v_awarded_credits,
      snapshot_email = v_email,
      additional_study_confirmed_at = case when v_awarded_credits >= 60 then now() else null end,
      additional_study_confirmed_by_user_id = case when v_awarded_credits >= 60 then v_actor_user_id else null end,
      additional_study_reason = case when v_awarded_credits >= 60 then v_reason else null end,
      updated_at = now()
    where id = v_participant.id
    returning * into v_participant;
  else
    insert into public.returning_student_cycle_participants (
      cycle_id, student_id, person_id, inclusion_basis, included_by_user_id, inclusion_reason,
      snapshot_programme, snapshot_status, snapshot_awarded_credits, snapshot_email,
      additional_study_confirmed_at, additional_study_confirmed_by_user_id, additional_study_reason
    )
    values (
      v_cycle.id, v_student.id, v_student.person_id, 'individual', v_actor_user_id, v_reason,
      v_student.programme, v_student.status, v_awarded_credits, v_email,
      case when v_awarded_credits >= 60 then now() else null end,
      case when v_awarded_credits >= 60 then v_actor_user_id else null end,
      case when v_awarded_credits >= 60 then v_reason else null end
    )
    returning * into v_participant;
  end if;

  insert into public.returning_student_participant_membership_events (
    participant_id, cycle_id, event_type, reason, snapshot, actor_user_id
  )
  values (
    v_participant.id,
    v_cycle.id,
    v_event_type,
    v_reason,
    jsonb_build_object(
      'student_id', v_student.id,
      'programme', v_student.programme,
      'status', v_student.status,
      'awarded_credits', v_awarded_credits,
      'additional_study', v_awarded_credits >= 60
    ),
    v_actor_user_id
  );

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, reason, metadata
  )
  values (
    'staff', v_actor_user_id, 'returning_student_cycle.participant_added',
    'returning_student_cycle_participant', v_participant.id, v_reason,
    jsonb_build_object(
      'cycle_id', v_cycle.id,
      'student_id', v_student.id,
      'awarded_credits', v_awarded_credits,
      'additional_study', v_awarded_credits >= 60
    )
  );

  return v_participant.id;
end;
$$;

create or replace function public.remove_returning_student_cycle_participant(
  p_participant_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_participant public.returning_student_cycle_participants%rowtype;
  v_cycle public.returning_student_cycles%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 4000), '');
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can remove returning-student participants'
      using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'A removal reason is required';
  end if;

  select * into v_participant
  from public.returning_student_cycle_participants
  where id = p_participant_id
  for update;

  if not found or v_participant.membership_state <> 'included' then
    raise exception 'An included participant is required';
  end if;

  select * into v_cycle from public.returning_student_cycles where id = v_participant.cycle_id for update;
  if v_cycle.phase = 'complete' then
    raise exception 'Complete cycles are read-only';
  end if;

  update public.returning_student_cycle_participants
  set
    membership_state = 'removed',
    removed_at = now(),
    removed_by_user_id = v_actor_user_id,
    removal_reason = v_reason,
    excluded_from_group_refresh = true,
    updated_at = now()
  where id = v_participant.id;

  insert into public.returning_student_participant_membership_events (
    participant_id, cycle_id, event_type, reason, snapshot, actor_user_id
  )
  values (
    v_participant.id, v_cycle.id, 'removed', v_reason,
    jsonb_build_object(
      'student_id', v_participant.student_id,
      'programme', v_participant.snapshot_programme,
      'status', v_participant.snapshot_status,
      'awarded_credits', v_participant.snapshot_awarded_credits
    ),
    v_actor_user_id
  );

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, reason, metadata
  )
  values (
    'staff', v_actor_user_id, 'returning_student_cycle.participant_removed',
    'returning_student_cycle_participant', v_participant.id, v_reason,
    jsonb_build_object('cycle_id', v_cycle.id, 'student_id', v_participant.student_id)
  );

  return v_participant.id;
end;
$$;

create or replace function public.confirm_returning_student_additional_study(
  p_participant_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_participant public.returning_student_cycle_participants%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 4000), '');
  v_awarded_credits integer;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can confirm additional study'
      using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'An additional-study reason is required';
  end if;

  select * into v_participant
  from public.returning_student_cycle_participants
  where id = p_participant_id
  for update;

  if not found or v_participant.membership_state <> 'included' then
    raise exception 'An included participant is required';
  end if;

  if exists (
    select 1 from public.returning_student_cycles cycle
    where cycle.id = v_participant.cycle_id and cycle.phase = 'complete'
  ) then
    raise exception 'Complete cycles are read-only';
  end if;

  v_awarded_credits := public.formally_awarded_credits(v_participant.student_id);
  if v_awarded_credits < 60 then
    raise exception 'Additional-study confirmation is only required at 60 or more awarded credits';
  end if;

  update public.returning_student_cycle_participants
  set
    additional_study_confirmed_at = now(),
    additional_study_confirmed_by_user_id = v_actor_user_id,
    additional_study_reason = v_reason,
    updated_at = now()
  where id = v_participant.id;

  insert into public.returning_student_participant_membership_events (
    participant_id, cycle_id, event_type, reason, snapshot, actor_user_id
  )
  values (
    v_participant.id, v_participant.cycle_id, 'additional_study_confirmed', v_reason,
    jsonb_build_object('student_id', v_participant.student_id, 'awarded_credits', v_awarded_credits),
    v_actor_user_id
  );

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, reason, metadata
  )
  values (
    'staff', v_actor_user_id, 'returning_student_cycle.additional_study_confirmed',
    'returning_student_cycle_participant', v_participant.id, v_reason,
    jsonb_build_object(
      'cycle_id', v_participant.cycle_id,
      'student_id', v_participant.student_id,
      'awarded_credits', v_awarded_credits
    )
  );

  return v_participant.id;
end;
$$;

create or replace function public.set_returning_cycle_offering_planned_capacity(
  p_cycle_offering_id uuid,
  p_planned_capacity integer,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_cycle_offering public.returning_student_cycle_offerings%rowtype;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 4000), '');
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can change planned capacity'
      using errcode = '42501';
  end if;

  if p_planned_capacity is null or p_planned_capacity <= 0 or v_reason is null then
    raise exception 'A positive planned capacity and reason are required';
  end if;

  select cycle_offering.* into v_cycle_offering
  from public.returning_student_cycle_offerings cycle_offering
  join public.returning_student_cycles cycle on cycle.id = cycle_offering.cycle_id
  where cycle_offering.id = p_cycle_offering_id
    and cycle.phase <> 'complete'
  for update of cycle_offering;

  if not found then
    raise exception 'An offering from an incomplete returning-student cycle is required';
  end if;

  update public.returning_student_cycle_offerings
  set planned_capacity = p_planned_capacity, updated_at = now()
  where id = v_cycle_offering.id;

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, reason, metadata
  )
  values (
    'staff', v_actor_user_id, 'returning_student_cycle.planned_capacity_changed',
    'returning_student_cycle_offering', v_cycle_offering.id, v_reason,
    jsonb_build_object(
      'cycle_id', v_cycle_offering.cycle_id,
      'offering_id', v_cycle_offering.offering_id,
      'previous_capacity', v_cycle_offering.planned_capacity,
      'planned_capacity', p_planned_capacity
    )
  );

  return v_cycle_offering.id;
end;
$$;

create or replace function public.refresh_returning_student_cycle_offerings(p_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_cycle public.returning_student_cycles%rowtype;
  v_added_count integer := 0;
  v_removed_count integer := 0;
  v_updated_count integer := 0;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can refresh returning-student offerings'
      using errcode = '42501';
  end if;

  select * into v_cycle
  from public.returning_student_cycles
  where id = p_cycle_id
  for update;

  if not found or v_cycle.phase <> 'setup' then
    raise exception 'Offerings can only be refreshed during cycle Setup';
  end if;

  delete from public.returning_student_cycle_offerings cycle_offering
  where cycle_offering.cycle_id = v_cycle.id
    and not exists (
      select 1
      from public.module_offerings offering
      join public.course_modules module on module.id = offering.module_id
      where offering.id = cycle_offering.offering_id
        and offering.term_id = v_cycle.target_term_id
        and module.active
    );
  get diagnostics v_removed_count = row_count;

  update public.returning_student_cycle_offerings cycle_offering
  set
    module_code_snapshot = module.code,
    module_title_snapshot = module.title,
    module_credits_snapshot = module.credits,
    source_capacity_snapshot = offering.capacity,
    updated_at = now()
  from public.module_offerings offering
  join public.course_modules module on module.id = offering.module_id
  where cycle_offering.cycle_id = v_cycle.id
    and cycle_offering.offering_id = offering.id
    and offering.term_id = v_cycle.target_term_id
    and module.active
    and (
      cycle_offering.module_code_snapshot is distinct from module.code
      or cycle_offering.module_title_snapshot is distinct from module.title
      or cycle_offering.module_credits_snapshot is distinct from module.credits
      or cycle_offering.source_capacity_snapshot is distinct from offering.capacity
    );
  get diagnostics v_updated_count = row_count;

  insert into public.returning_student_cycle_offerings (
    cycle_id,
    offering_id,
    module_code_snapshot,
    module_title_snapshot,
    module_credits_snapshot,
    planned_capacity,
    source_capacity_snapshot
  )
  select
    v_cycle.id,
    offering.id,
    module.code,
    module.title,
    module.credits,
    offering.capacity,
    offering.capacity
  from public.module_offerings offering
  join public.course_modules module on module.id = offering.module_id
  where offering.term_id = v_cycle.target_term_id
    and module.active
    and not exists (
      select 1 from public.returning_student_cycle_offerings cycle_offering
      where cycle_offering.cycle_id = v_cycle.id
        and cycle_offering.offering_id = offering.id
    );
  get diagnostics v_added_count = row_count;

  if not exists (
    select 1 from public.returning_student_cycle_offerings where cycle_id = v_cycle.id
  ) then
    raise exception 'The Published target term requires at least one active module offering';
  end if;

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    'staff', v_actor_user_id, 'returning_student_cycle.offerings_refreshed',
    'returning_student_cycle', v_cycle.id,
    jsonb_build_object(
      'added_count', v_added_count,
      'removed_count', v_removed_count,
      'updated_count', v_updated_count
    )
  );

  return jsonb_build_object(
    'cycle_id', v_cycle.id,
    'added_count', v_added_count,
    'removed_count', v_removed_count,
    'updated_count', v_updated_count
  );
end;
$$;

create or replace function public.open_returning_student_cycle(p_cycle_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_cycle public.returning_student_cycles%rowtype;
  v_participant_count integer;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can open returning-student cycles'
      using errcode = '42501';
  end if;

  select * into v_cycle
  from public.returning_student_cycles
  where id = p_cycle_id
  for update;

  if not found or v_cycle.phase <> 'setup' then
    raise exception 'Only a cycle in Setup can open for responses';
  end if;

  if not exists (
    select 1 from public.terms
    where id = v_cycle.target_term_id and status = 'published'
  ) then
    raise exception 'The target term must remain Published when the cycle opens';
  end if;

  if exists (select 1 from public.preview_returning_student_cycle_eligibility(v_cycle.id)) then
    raise exception 'Review and apply the current eligibility preview before opening the cycle';
  end if;

  select count(*) into v_participant_count
  from public.returning_student_cycle_participants
  where cycle_id = v_cycle.id and membership_state = 'included';

  if v_participant_count = 0 then
    raise exception 'At least one included participant is required';
  end if;

  if exists (
    select 1
    from public.returning_student_cycle_participant_work_items participant
    where participant.cycle_id = v_cycle.id
      and participant.membership_state = 'included'
      and participant.blocking_reason is not null
  ) then
    raise exception 'Resolve participant setup blockers before opening the cycle';
  end if;

  if exists (
    select 1
    from public.module_offerings offering
    join public.course_modules module on module.id = offering.module_id
    where offering.term_id = v_cycle.target_term_id
      and module.active
      and not exists (
        select 1 from public.returning_student_cycle_offerings cycle_offering
        where cycle_offering.cycle_id = v_cycle.id
          and cycle_offering.offering_id = offering.id
      )
  ) or exists (
    select 1
    from public.returning_student_cycle_offerings cycle_offering
    where cycle_offering.cycle_id = v_cycle.id
      and not exists (
        select 1
        from public.module_offerings offering
        join public.course_modules module on module.id = offering.module_id
        where offering.id = cycle_offering.offering_id
          and offering.term_id = v_cycle.target_term_id
          and module.active
      )
  ) then
    raise exception 'Target-term offerings changed after cycle creation';
  end if;

  update public.returning_student_cycles
  set
    phase = 'collecting_responses',
    opened_at = now(),
    opened_by_user_id = v_actor_user_id,
    updated_at = now()
  where id = v_cycle.id;

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    'staff', v_actor_user_id, 'returning_student_cycle.opened',
    'returning_student_cycle', v_cycle.id,
    jsonb_build_object(
      'target_term_id', v_cycle.target_term_id,
      'participant_count', v_participant_count,
      'correspondence_created', false,
      'email_sent', false
    )
  );

  return v_cycle.id;
end;
$$;

create or replace function public.begin_returning_student_cycle_review(p_cycle_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_cycle public.returning_student_cycles%rowtype;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can advance returning-student cycles'
      using errcode = '42501';
  end if;

  select * into v_cycle
  from public.returning_student_cycles
  where id = p_cycle_id
  for update;

  if not found or v_cycle.phase <> 'collecting_responses' then
    raise exception 'Only a cycle collecting responses can begin review';
  end if;

  update public.returning_student_cycles
  set
    phase = 'review_confirmation',
    review_started_at = now(),
    review_started_by_user_id = v_actor_user_id,
    updated_at = now()
  where id = v_cycle.id;

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    'staff', v_actor_user_id, 'returning_student_cycle.review_started',
    'returning_student_cycle', v_cycle.id,
    jsonb_build_object('correspondence_created', false, 'email_sent', false)
  );

  return v_cycle.id;
end;
$$;

revoke all on function public.formally_awarded_credits(uuid) from public;
revoke all on function public.create_returning_student_cycle(uuid, public.student_status[]) from public;
revoke all on function public.configure_returning_student_cycle_status_groups(uuid, public.student_status[]) from public;
revoke all on function public.preview_returning_student_cycle_eligibility(uuid) from public;
revoke all on function public.apply_returning_student_cycle_eligibility_refresh(uuid) from public;
revoke all on function public.add_returning_student_cycle_participant(uuid, uuid, text) from public;
revoke all on function public.remove_returning_student_cycle_participant(uuid, text) from public;
revoke all on function public.confirm_returning_student_additional_study(uuid, text) from public;
revoke all on function public.set_returning_cycle_offering_planned_capacity(uuid, integer, text) from public;
revoke all on function public.refresh_returning_student_cycle_offerings(uuid) from public;
revoke all on function public.open_returning_student_cycle(uuid) from public;
revoke all on function public.begin_returning_student_cycle_review(uuid) from public;

grant execute on function public.create_returning_student_cycle(uuid, public.student_status[]) to authenticated;
grant execute on function public.configure_returning_student_cycle_status_groups(uuid, public.student_status[]) to authenticated;
grant execute on function public.preview_returning_student_cycle_eligibility(uuid) to authenticated;
grant execute on function public.apply_returning_student_cycle_eligibility_refresh(uuid) to authenticated;
grant execute on function public.add_returning_student_cycle_participant(uuid, uuid, text) to authenticated;
grant execute on function public.remove_returning_student_cycle_participant(uuid, text) to authenticated;
grant execute on function public.confirm_returning_student_additional_study(uuid, text) to authenticated;
grant execute on function public.set_returning_cycle_offering_planned_capacity(uuid, integer, text) to authenticated;
grant execute on function public.refresh_returning_student_cycle_offerings(uuid) to authenticated;
grant execute on function public.open_returning_student_cycle(uuid) to authenticated;
grant execute on function public.begin_returning_student_cycle_review(uuid) to authenticated;

grant execute on function public.formally_awarded_credits(uuid) to authenticated;

revoke insert, update, delete on public.returning_student_cycles from authenticated;
revoke insert, update, delete on public.returning_student_cycle_status_groups from authenticated;
revoke insert, update, delete on public.returning_student_cycle_offerings from authenticated;
revoke insert, update, delete on public.returning_student_cycle_participants from authenticated;
revoke insert, update, delete on public.returning_student_participant_membership_events from authenticated;
