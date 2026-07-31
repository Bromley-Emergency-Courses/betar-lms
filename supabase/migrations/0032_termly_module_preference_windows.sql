create type public.module_preference_window_status as enum ('draft', 'open', 'closed', 'confirmed');

create table public.module_preference_windows (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.terms(id) on delete restrict,
  title text not null,
  status public.module_preference_window_status not null default 'draft',
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  notes text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  opened_at timestamptz,
  opened_by_user_id uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  closed_by_user_id uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  confirmed_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(title)) > 0),
  check (opens_at < closes_at)
);

create table public.module_preference_window_offerings (
  window_id uuid not null references public.module_preference_windows(id) on delete cascade,
  offering_id uuid not null references public.module_offerings(id) on delete restrict,
  display_order integer not null default 1 check (display_order > 0),
  created_at timestamptz not null default now(),
  primary key (window_id, offering_id),
  unique (window_id, display_order)
);

create table public.module_preference_submissions (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null references public.module_preference_windows(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_by_auth_user_id uuid references auth.users(id) on delete set null,
  submitted_by_person_id uuid references public.persons(id) on delete set null,
  submission_ip_address inet,
  submission_user_agent text,
  skip_reason text,
  choice_count integer not null default 0 check (choice_count between 0 and 2),
  unique (window_id, student_id)
);

create table public.module_preference_submission_choices (
  submission_id uuid not null references public.module_preference_submissions(id) on delete cascade,
  offering_id uuid not null references public.module_offerings(id) on delete restrict,
  preference_order integer not null check (preference_order between 1 and 2),
  created_at timestamptz not null default now(),
  primary key (submission_id, offering_id),
  unique (submission_id, preference_order)
);

alter table public.module_preference_windows enable row level security;
alter table public.module_preference_window_offerings enable row level security;
alter table public.module_preference_submissions enable row level security;
alter table public.module_preference_submission_choices enable row level security;

create index module_preference_windows_term_status_idx
  on public.module_preference_windows(term_id, status, opens_at, closes_at);

create index module_preference_window_offerings_offering_idx
  on public.module_preference_window_offerings(offering_id);

create index module_preference_submissions_window_idx
  on public.module_preference_submissions(window_id, submitted_at desc);

create index module_preference_submissions_student_idx
  on public.module_preference_submissions(student_id, updated_at desc);

create index module_preference_submission_choices_offering_idx
  on public.module_preference_submission_choices(offering_id);

create trigger touch_module_preference_windows_updated_at
  before update on public.module_preference_windows
  for each row
  execute function public.touch_person_updated_at();

create trigger touch_module_preference_submissions_updated_at
  before update on public.module_preference_submissions
  for each row
  execute function public.touch_person_updated_at();

create policy "admins manage module preference windows"
  on public.module_preference_windows for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "students read open module preference windows"
  on public.module_preference_windows for select
  using (
    status = 'open'
    and opens_at <= now()
    and closes_at > now()
    and public.current_portal_actor_type() = 'student'
  );

create policy "admins manage module preference window offerings"
  on public.module_preference_window_offerings for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "students read available module preference offerings"
  on public.module_preference_window_offerings for select
  using (
    exists (
      select 1
      from public.module_preference_windows preference_window
      where preference_window.id = module_preference_window_offerings.window_id
        and preference_window.status = 'open'
        and preference_window.opens_at <= now()
        and preference_window.closes_at > now()
        and public.current_portal_actor_type() = 'student'
    )
  );

create policy "admins manage module preference submissions"
  on public.module_preference_submissions for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "students read own module preference submissions"
  on public.module_preference_submissions for select
  using (person_id = public.current_person_id());

create policy "admins manage module preference submission choices"
  on public.module_preference_submission_choices for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "students read own module preference submission choices"
  on public.module_preference_submission_choices for select
  using (
    exists (
      select 1
      from public.module_preference_submissions submission
      where submission.id = module_preference_submission_choices.submission_id
        and submission.person_id = public.current_person_id()
    )
  );

create policy "students read available preference module offerings"
  on public.module_offerings for select
  using (
    exists (
      select 1
      from public.module_preference_window_offerings window_offering
      join public.module_preference_windows preference_window on preference_window.id = window_offering.window_id
      where window_offering.offering_id = module_offerings.id
        and preference_window.status = 'open'
        and preference_window.opens_at <= now()
        and preference_window.closes_at > now()
        and public.current_portal_actor_type() = 'student'
    )
  );

create policy "students read available preference course modules"
  on public.course_modules for select
  using (
    exists (
      select 1
      from public.module_offerings offering
      join public.module_preference_window_offerings window_offering on window_offering.offering_id = offering.id
      join public.module_preference_windows preference_window on preference_window.id = window_offering.window_id
      where offering.module_id = course_modules.id
        and preference_window.status = 'open'
        and preference_window.opens_at <= now()
        and preference_window.closes_at > now()
        and public.current_portal_actor_type() = 'student'
    )
  );

create policy "students read available preference terms"
  on public.terms for select
  using (
    exists (
      select 1
      from public.module_preference_windows preference_window
      where preference_window.term_id = terms.id
        and preference_window.status = 'open'
        and preference_window.opens_at <= now()
        and preference_window.closes_at > now()
        and public.current_portal_actor_type() = 'student'
    )
  );

create or replace function public.ensure_module_preference_window_offering_is_available()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_window_term_id uuid;
  v_offering record;
begin
  select term_id
  into v_window_term_id
  from public.module_preference_windows
  where id = new.window_id;

  if v_window_term_id is null then
    raise exception 'Module preference window not found';
  end if;

  select offering.id, offering.term_id, module.active as module_active, term.status as term_status
  into v_offering
  from public.module_offerings offering
  join public.course_modules module on module.id = offering.module_id
  join public.terms term on term.id = offering.term_id
  where offering.id = new.offering_id;

  if v_offering.id is null then
    raise exception 'Module offering not found';
  end if;

  if v_offering.term_id <> v_window_term_id then
    raise exception 'Module preference window offerings must belong to the window term';
  end if;

  if v_offering.module_active is not true then
    raise exception 'Inactive modules cannot be added to a module preference window';
  end if;

  if v_offering.term_status not in ('published', 'active') then
    raise exception 'Module preference windows can only use published or active term offerings';
  end if;

  return new;
end;
$$;

create trigger ensure_module_preference_window_offering_is_available
  before insert or update on public.module_preference_window_offerings
  for each row
  execute function public.ensure_module_preference_window_offering_is_available();

create or replace function public.current_active_student_id_for_module_preferences()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select students.id
  from public.students
  where students.person_id = public.current_person_id()
    and students.status = 'active'
    and public.current_portal_actor_type() = 'student'
  order by students.created_at asc
  limit 1;
$$;

create or replace function public.create_or_update_module_preference_window(
  p_window_id uuid,
  p_term_id uuid,
  p_title text,
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_offering_ids uuid[],
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_window_id uuid;
  v_title text := nullif(left(trim(coalesce(p_title, '')), 200), '');
  v_notes text := nullif(left(trim(coalesce(p_notes, '')), 4000), '');
  v_offering_ids uuid[] := coalesce(p_offering_ids, array[]::uuid[]);
  v_distinct_offering_count integer;
  v_existing_status public.module_preference_window_status;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can manage module preference windows'
      using errcode = '42501';
  end if;

  if v_title is null then
    raise exception 'Window title is required';
  end if;

  if p_opens_at >= p_closes_at then
    raise exception 'Window close date must be after the open date';
  end if;

  select count(distinct offering_id)
  into v_distinct_offering_count
  from unnest(v_offering_ids) as offering_id;

  if v_distinct_offering_count = 0 then
    raise exception 'At least one module offering is required';
  end if;

  if v_distinct_offering_count <> cardinality(v_offering_ids) then
    raise exception 'Duplicate module offerings are not allowed in a preference window';
  end if;

  if not exists (
    select 1
    from public.terms
    where id = p_term_id
      and status in ('published', 'active')
  ) then
    raise exception 'Preference windows can only be created for published or active terms';
  end if;

  if p_window_id is null then
    insert into public.module_preference_windows (
      term_id,
      title,
      opens_at,
      closes_at,
      notes,
      created_by_user_id
    )
    values (
      p_term_id,
      v_title,
      p_opens_at,
      p_closes_at,
      v_notes,
      v_actor_user_id
    )
    returning id into v_window_id;

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
      'module_preference_window.created',
      'module_preference_window',
      v_window_id,
      jsonb_build_object(
        'term_id', p_term_id,
        'offering_count', v_distinct_offering_count,
        'opens_at', p_opens_at,
        'closes_at', p_closes_at
      )
    );
  else
    select status
    into v_existing_status
    from public.module_preference_windows
    where id = p_window_id
    for update;

    if v_existing_status is null then
      raise exception 'Module preference window not found';
    end if;

    if v_existing_status <> 'draft' then
      raise exception 'Only draft module preference windows can be edited';
    end if;

    update public.module_preference_windows
    set
      term_id = p_term_id,
      title = v_title,
      opens_at = p_opens_at,
      closes_at = p_closes_at,
      notes = v_notes
    where id = p_window_id
    returning id into v_window_id;

    delete from public.module_preference_window_offerings
    where window_id = v_window_id;
  end if;

  insert into public.module_preference_window_offerings (window_id, offering_id, display_order)
  select v_window_id, offering_id, row_number() over ()
  from unnest(v_offering_ids) as offering_id;

  return v_window_id;
end;
$$;

create or replace function public.open_module_preference_window(p_window_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_window public.module_preference_windows;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can open module preference windows'
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

  if v_window.status <> 'draft' then
    raise exception 'Only draft module preference windows can be opened';
  end if;

  if v_window.closes_at <= now() then
    raise exception 'Window close date must be in the future before opening';
  end if;

  if not exists (
    select 1
    from public.module_preference_window_offerings
    where window_id = p_window_id
  ) then
    raise exception 'At least one available module offering is required before opening';
  end if;

  update public.module_preference_windows
  set
    status = 'open',
    opened_at = now(),
    opened_by_user_id = v_actor_user_id
  where id = p_window_id;

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
    'module_preference_window.opened',
    'module_preference_window',
    p_window_id,
    jsonb_build_object(
      'term_id', v_window.term_id,
      'opens_at', v_window.opens_at,
      'closes_at', v_window.closes_at
    )
  );

  return p_window_id;
end;
$$;

create or replace function public.close_module_preference_window(p_window_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_window public.module_preference_windows;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can close module preference windows'
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

  if v_window.status <> 'open' then
    raise exception 'Only open module preference windows can be closed';
  end if;

  update public.module_preference_windows
  set
    status = 'closed',
    closed_at = now(),
    closed_by_user_id = v_actor_user_id
  where id = p_window_id;

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
    'module_preference_window.closed',
    'module_preference_window',
    p_window_id,
    jsonb_build_object('term_id', v_window.term_id)
  );

  return p_window_id;
end;
$$;

create or replace function public.confirm_module_preference_window(p_window_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_window public.module_preference_windows;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can confirm module preference windows'
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

  if v_window.status <> 'closed' then
    raise exception 'Only closed module preference windows can be confirmed';
  end if;

  update public.module_preference_windows
  set
    status = 'confirmed',
    confirmed_at = now(),
    confirmed_by_user_id = v_actor_user_id
  where id = p_window_id;

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
    'module_preference_window.confirmed',
    'module_preference_window',
    p_window_id,
    jsonb_build_object(
      'term_id', v_window.term_id,
      'enrolments_created', 0,
      'finance_records_created', 0,
      'confirmation_foundation_only', true
    )
  );

  return p_window_id;
end;
$$;

create or replace function public.submit_module_preferences(
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

grant execute on function public.create_or_update_module_preference_window(
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz,
  uuid[],
  text
) to authenticated;

grant execute on function public.open_module_preference_window(uuid) to authenticated;
grant execute on function public.close_module_preference_window(uuid) to authenticated;
grant execute on function public.confirm_module_preference_window(uuid) to authenticated;
grant execute on function public.current_active_student_id_for_module_preferences() to authenticated;
grant execute on function public.submit_module_preferences(uuid, uuid[], text, inet, text) to authenticated;
