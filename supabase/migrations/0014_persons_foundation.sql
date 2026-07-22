create table public.persons (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  preferred_name text,
  date_of_birth date,
  email text not null,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  postcode text,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.persons enable row level security;

create policy "teachers and admins read persons"
  on public.persons for select
  using (public.is_teacher());

create policy "admins manage persons"
  on public.persons for all
  using (public.is_admin())
  with check (public.is_admin());

alter table public.students
  add column person_id uuid;

update public.students
set person_id = gen_random_uuid()
where person_id is null;

insert into public.persons (
  id,
  first_name,
  last_name,
  email,
  phone,
  created_at,
  updated_at
)
select
  students.person_id,
  students.first_name,
  students.last_name,
  students.email,
  students.phone,
  students.created_at,
  students.updated_at
from public.students
where students.person_id is not null;

alter table public.students
  add constraint students_person_id_fkey
  foreign key (person_id) references public.persons(id) on delete set null;

create index persons_email_lookup_idx on public.persons (lower(email));
create index persons_name_lookup_idx on public.persons (lower(last_name), lower(first_name));
create index students_person_id_idx on public.students(person_id);

create or replace function public.touch_person_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_persons_updated_at
  before update on public.persons
  for each row
  execute function public.touch_person_updated_at();

create or replace function public.sync_student_person()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.person_id is null then
    new.person_id = gen_random_uuid();

    insert into public.persons (
      id,
      first_name,
      last_name,
      email,
      phone,
      created_at,
      updated_at
    )
    values (
      new.person_id,
      new.first_name,
      new.last_name,
      new.email,
      new.phone,
      new.created_at,
      new.updated_at
    );

    return new;
  end if;

  if new.person_id is not null then
    update public.persons
    set
      first_name = new.first_name,
      last_name = new.last_name,
      email = new.email,
      phone = new.phone
    where id = new.person_id;
  end if;

  return new;
end;
$$;

create trigger sync_student_person_before_insert_update
  before insert or update of person_id, first_name, last_name, email, phone on public.students
  for each row
  execute function public.sync_student_person();
