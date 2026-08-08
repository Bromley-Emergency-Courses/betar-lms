create or replace function public.current_person_can_read_selectable_application_offering(p_offering_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_person_id() is not null
    and exists (
      select 1
      from public.module_offerings offering
      join public.course_modules module on module.id = offering.module_id
      join public.terms term on term.id = offering.term_id
      where offering.id = p_offering_id
        and module.active = true
        and term.status in ('published', 'active')
        and term.starts_on >= current_date
    );
$$;

create or replace function public.current_person_can_read_application_offer_offering(p_offering_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.application_offer_module_offerings offer_choice
    join public.application_offers offer on offer.id = offer_choice.offer_id
    where offer_choice.offering_id = p_offering_id
      and offer.person_id = public.current_person_id()
  );
$$;

create or replace function public.current_person_can_read_application_offer_module(p_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.module_offerings offering
    join public.application_offer_module_offerings offer_choice on offer_choice.offering_id = offering.id
    join public.application_offers offer on offer.id = offer_choice.offer_id
    where offering.module_id = p_module_id
      and offer.person_id = public.current_person_id()
  );
$$;

create or replace function public.current_person_can_read_registration_offering(p_offering_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admissions_registration_module_offerings registration_choice
    join public.admissions_registrations registration on registration.id = registration_choice.registration_id
    where registration_choice.offering_id = p_offering_id
      and registration.person_id = public.current_person_id()
  );
$$;

create or replace function public.current_person_can_read_registration_module(p_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.module_offerings offering
    join public.admissions_registration_module_offerings registration_choice on registration_choice.offering_id = offering.id
    join public.admissions_registrations registration on registration.id = registration_choice.registration_id
    where offering.module_id = p_module_id
      and registration.person_id = public.current_person_id()
  );
$$;

create or replace function public.current_student_can_read_preference_offering(p_offering_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_portal_actor_type() = 'student'
    and exists (
      select 1
      from public.module_preference_window_offerings window_offering
      join public.module_preference_windows preference_window on preference_window.id = window_offering.window_id
      where window_offering.offering_id = p_offering_id
        and preference_window.status = 'open'
        and preference_window.opens_at <= now()
        and preference_window.closes_at > now()
    );
$$;

create or replace function public.current_student_can_read_preference_module(p_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_portal_actor_type() = 'student'
    and exists (
      select 1
      from public.module_offerings offering
      join public.module_preference_window_offerings window_offering on window_offering.offering_id = offering.id
      join public.module_preference_windows preference_window on preference_window.id = window_offering.window_id
      where offering.module_id = p_module_id
        and preference_window.status = 'open'
        and preference_window.opens_at <= now()
        and preference_window.closes_at > now()
    );
$$;

drop policy if exists "portal users read selectable application offerings" on public.module_offerings;
drop policy if exists "portal users read own offered module offerings" on public.module_offerings;
drop policy if exists "portal users read own offered course modules" on public.course_modules;
drop policy if exists "portal users read own registration offered module offerings" on public.module_offerings;
drop policy if exists "portal users read own registration offered course modules" on public.course_modules;
drop policy if exists "students read available preference module offerings" on public.module_offerings;
drop policy if exists "students read available preference course modules" on public.course_modules;

create policy "portal users read selectable application offerings"
  on public.module_offerings for select
  using (public.current_person_can_read_selectable_application_offering(module_offerings.id));

create policy "portal users read own offered module offerings"
  on public.module_offerings for select
  using (public.current_person_can_read_application_offer_offering(module_offerings.id));

create policy "portal users read own offered course modules"
  on public.course_modules for select
  using (public.current_person_can_read_application_offer_module(course_modules.id));

create policy "portal users read own registration offered module offerings"
  on public.module_offerings for select
  using (public.current_person_can_read_registration_offering(module_offerings.id));

create policy "portal users read own registration offered course modules"
  on public.course_modules for select
  using (public.current_person_can_read_registration_module(course_modules.id));

create policy "students read available preference module offerings"
  on public.module_offerings for select
  using (public.current_student_can_read_preference_offering(module_offerings.id));

create policy "students read available preference course modules"
  on public.course_modules for select
  using (public.current_student_can_read_preference_module(course_modules.id));
