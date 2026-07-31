create index if not exists enrolments_offering_status_capacity_idx
  on public.enrolments(offering_id, status);

create or replace function public.module_preference_window_offering_capacity(p_window_ids uuid[])
returns table (
  window_id uuid,
  offering_id uuid,
  capacity integer,
  already_enrolled_count integer,
  preference_selection_count integer,
  remaining_places integer,
  is_full boolean,
  is_unavailable boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with requested_windows as (
    select distinct requested_window_id as id
    from unnest(coalesce(p_window_ids, array[]::uuid[])) as requested_window_id
  ),
  authorized_windows as (
    select preference_window.id
    from public.module_preference_windows preference_window
    join requested_windows on requested_windows.id = preference_window.id
    where public.is_admin()
      or (
        public.current_portal_actor_type() = 'student'
        and preference_window.status = 'open'
        and preference_window.opens_at <= now()
        and preference_window.closes_at > now()
      )
  )
  select
    window_offering.window_id,
    window_offering.offering_id,
    offering.capacity,
    coalesce(enrolment_counts.already_enrolled_count, 0)::integer as already_enrolled_count,
    coalesce(preference_counts.preference_selection_count, 0)::integer as preference_selection_count,
    greatest(
      offering.capacity
        - coalesce(enrolment_counts.already_enrolled_count, 0)
        - coalesce(preference_counts.preference_selection_count, 0),
      0
    )::integer as remaining_places,
    (
      coalesce(enrolment_counts.already_enrolled_count, 0)
        + coalesce(preference_counts.preference_selection_count, 0)
    ) >= offering.capacity as is_full,
    (
      coalesce(enrolment_counts.already_enrolled_count, 0)
        + coalesce(preference_counts.preference_selection_count, 0)
    ) >= offering.capacity as is_unavailable
  from authorized_windows
  join public.module_preference_window_offerings window_offering
    on window_offering.window_id = authorized_windows.id
  join public.module_offerings offering
    on offering.id = window_offering.offering_id
  left join lateral (
    select count(distinct enrolment.student_id)::integer as already_enrolled_count
    from public.enrolments enrolment
    where enrolment.offering_id = window_offering.offering_id
      and enrolment.status in ('planned', 'in_progress')
  ) enrolment_counts on true
  left join lateral (
    select count(*)::integer as preference_selection_count
    from public.module_preference_submissions submission
    join public.module_preference_submission_choices choice
      on choice.submission_id = submission.id
    where submission.window_id = window_offering.window_id
      and choice.offering_id = window_offering.offering_id
  ) preference_counts on true
  order by window_offering.window_id, window_offering.display_order;
$$;

drop function public.submit_module_preferences(uuid, uuid[], text, inet, text);

create function public.submit_module_preferences(
  p_window_id uuid,
  p_offering_ids uuid[],
  p_skip_reason text default null,
  p_submission_ip_address inet default null,
  p_submission_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_person_id uuid := public.current_person_id();
  v_choice_count integer;
  v_student_id uuid;
  v_window public.module_preference_windows;
  v_submission_id uuid;
  v_existing_submission_id uuid;
  v_distinct_choice_count integer;
  v_skip_reason text := nullif(left(trim(coalesce(p_skip_reason, '')), 1000), '');
  v_locked_offering_ids uuid[] := array[]::uuid[];
  v_blocked_offering_id uuid;
  v_blocked_capacity integer;
  v_blocked_already_enrolled_count integer;
  v_blocked_preference_selection_count integer;
begin
  if v_actor_user_id is null
    or v_actor_person_id is null
    or public.current_portal_actor_type() <> 'student' then
    raise exception 'A student portal session is required'
      using errcode = '42501';
  end if;

  select id
  into v_student_id
  from public.students
  where person_id = v_actor_person_id
    and status = 'active'
  order by created_at asc
  limit 1;

  if v_student_id is null then
    raise exception 'Only active students can submit module preferences'
      using errcode = '42501';
  end if;

  select *
  into v_window
  from public.module_preference_windows
  where id = p_window_id
  for update;

  if v_window.id is null then
    raise exception 'Module preference window not found';
  end if;

  if v_window.status <> 'open' or v_window.opens_at > now() or v_window.closes_at <= now() then
    raise exception 'This module preference window is not open for submissions';
  end if;

  select count(distinct offering_id)
  into v_distinct_choice_count
  from unnest(coalesce(p_offering_ids, array[]::uuid[])) as offering_id;

  v_choice_count := cardinality(coalesce(p_offering_ids, array[]::uuid[]));

  if v_choice_count > 2 then
    raise exception 'Students can choose no more than two module offerings';
  end if;

  if v_distinct_choice_count <> v_choice_count then
    raise exception 'Duplicate module preference choices are not allowed';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_offering_ids, array[]::uuid[])) as selected_offering_id
    where not exists (
      select 1
      from public.module_preference_window_offerings window_offering
      join public.module_offerings offering on offering.id = window_offering.offering_id
      join public.course_modules module on module.id = offering.module_id
      where window_offering.window_id = p_window_id
        and window_offering.offering_id = selected_offering_id
        and offering.term_id = v_window.term_id
        and module.active = true
    )
  ) then
    raise exception 'Selected module offerings must be available in this preference window';
  end if;

  select id
  into v_existing_submission_id
  from public.module_preference_submissions
  where window_id = p_window_id
    and student_id = v_student_id
  for update;

  select coalesce(array_agg(distinct candidate.offering_id order by candidate.offering_id), array[]::uuid[])
  into v_locked_offering_ids
  from (
    select selected_offering_id as offering_id
    from unnest(coalesce(p_offering_ids, array[]::uuid[])) as selected_offering_id
    union
    select choice.offering_id
    from public.module_preference_submission_choices choice
    where choice.submission_id = v_existing_submission_id
  ) candidate;

  if cardinality(v_locked_offering_ids) > 0 then
    perform 1
    from public.module_offerings offering
    where offering.id = any(v_locked_offering_ids)
    order by offering.id
    for update;
  end if;

  if v_choice_count > 0 then
    with selected_choices as (
      select distinct selected_offering_id as offering_id
      from unnest(coalesce(p_offering_ids, array[]::uuid[])) as selected_offering_id
    ),
    capacity_checks as (
      select
        selected_choices.offering_id,
        offering.capacity,
        (
          select count(distinct enrolment.student_id)::integer
          from public.enrolments enrolment
          where enrolment.offering_id = selected_choices.offering_id
            and enrolment.status in ('planned', 'in_progress')
        ) as already_enrolled_count,
        (
          select count(*)::integer
          from public.module_preference_submissions submission
          join public.module_preference_submission_choices choice
            on choice.submission_id = submission.id
          where submission.window_id = p_window_id
            and choice.offering_id = selected_choices.offering_id
            and (
              v_existing_submission_id is null
              or submission.id <> v_existing_submission_id
            )
        ) as preference_selection_count
      from selected_choices
      join public.module_offerings offering on offering.id = selected_choices.offering_id
    )
    select
      capacity_checks.offering_id,
      capacity_checks.capacity,
      capacity_checks.already_enrolled_count,
      capacity_checks.preference_selection_count
    into
      v_blocked_offering_id,
      v_blocked_capacity,
      v_blocked_already_enrolled_count,
      v_blocked_preference_selection_count
    from capacity_checks
    where capacity_checks.already_enrolled_count + capacity_checks.preference_selection_count >= capacity_checks.capacity
    order by capacity_checks.offering_id
    limit 1;

    if v_blocked_offering_id is not null then
      insert into public.audit_events (
        actor_type,
        actor_user_id,
        actor_person_id,
        action,
        entity_type,
        entity_id,
        metadata
      )
      values (
        'student',
        v_actor_user_id,
        v_actor_person_id,
        'module_preference.capacity_blocked',
        'module_preference_window',
        p_window_id,
        jsonb_build_object(
          'window_id', p_window_id,
          'term_id', v_window.term_id,
          'student_id', v_student_id,
          'blocked_offering_id', v_blocked_offering_id,
          'capacity', v_blocked_capacity,
          'already_enrolled_count', v_blocked_already_enrolled_count,
          'preference_selection_count', v_blocked_preference_selection_count,
          'requested_offering_ids', coalesce(p_offering_ids, array[]::uuid[])
        )
      );

      return null;
    end if;
  end if;

  insert into public.module_preference_submissions (
    window_id,
    student_id,
    person_id,
    submitted_by_auth_user_id,
    submitted_by_person_id,
    submission_ip_address,
    submission_user_agent,
    skip_reason,
    choice_count
  )
  values (
    p_window_id,
    v_student_id,
    v_actor_person_id,
    v_actor_user_id,
    v_actor_person_id,
    p_submission_ip_address,
    left(p_submission_user_agent, 1000),
    case when v_choice_count = 0 then v_skip_reason else null end,
    v_choice_count
  )
  on conflict (window_id, student_id)
  do update
  set
    person_id = excluded.person_id,
    submitted_at = now(),
    submitted_by_auth_user_id = excluded.submitted_by_auth_user_id,
    submitted_by_person_id = excluded.submitted_by_person_id,
    submission_ip_address = excluded.submission_ip_address,
    submission_user_agent = excluded.submission_user_agent,
    skip_reason = excluded.skip_reason,
    choice_count = excluded.choice_count
  returning id into v_submission_id;

  delete from public.module_preference_submission_choices
  where submission_id = v_submission_id;

  insert into public.module_preference_submission_choices (submission_id, offering_id, preference_order)
  select v_submission_id, selected.offering_id, selected.preference_order
  from unnest(coalesce(p_offering_ids, array[]::uuid[])) with ordinality as selected(offering_id, preference_order);

  insert into public.audit_events (
    actor_type,
    actor_user_id,
    actor_person_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    'student',
    v_actor_user_id,
    v_actor_person_id,
    case
      when v_existing_submission_id is null then 'module_preference.submitted'
      else 'module_preference.updated'
    end,
    'module_preference_submission',
    v_submission_id,
    jsonb_build_object(
      'window_id', p_window_id,
      'term_id', v_window.term_id,
      'student_id', v_student_id,
      'choice_count', v_choice_count,
      'offering_ids', coalesce(p_offering_ids, array[]::uuid[])
    )
  );

  return v_submission_id;
end;
$$;

grant execute on function public.module_preference_window_offering_capacity(uuid[]) to authenticated;
grant execute on function public.submit_module_preferences(uuid, uuid[], text, inet, text) to authenticated;
