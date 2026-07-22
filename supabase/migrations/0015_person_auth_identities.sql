create type public.portal_actor_type as enum ('applicant', 'student');

create table public.person_auth_identities (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  actor_type public.portal_actor_type not null default 'applicant',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id)
);

alter table public.person_auth_identities enable row level security;

create index person_auth_identities_person_id_idx
  on public.person_auth_identities(person_id);

create unique index person_auth_identities_one_active_person_idx
  on public.person_auth_identities(person_id)
  where active;

create index person_auth_identities_email_lookup_idx
  on public.person_auth_identities(lower(email));

create trigger touch_person_auth_identities_updated_at
  before update on public.person_auth_identities
  for each row
  execute function public.touch_person_updated_at();

create or replace function public.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select person_id
  from public.person_auth_identities
  where auth_user_id = auth.uid()
    and active = true
  limit 1;
$$;

create or replace function public.current_portal_actor_type()
returns public.portal_actor_type
language sql
stable
security definer
set search_path = public
as $$
  select actor_type
  from public.person_auth_identities
  where auth_user_id = auth.uid()
    and active = true
  limit 1;
$$;

create policy "portal users read own auth identity"
  on public.person_auth_identities for select
  using (auth_user_id = auth.uid() and active = true);

create policy "admins manage person auth identities"
  on public.person_auth_identities for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own person"
  on public.persons for select
  using (id = public.current_person_id());
