create type public.admission_lead_stage as enum (
  'interest',
  'application_invited',
  'submitted',
  'reviewed',
  'offered',
  'rejected',
  'accepted',
  'archived'
);

create table public.admission_leads (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  stage public.admission_lead_stage not null default 'interest',
  programme text not null default 'pgcert' check (programme in ('pgcert', 'microcredential')),
  module_interest_ids uuid[] not null default '{}',
  source text,
  last_contacted_on date,
  next_action_on date,
  notes text,
  converted_student_id uuid references public.students(id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admission_leads enable row level security;

create policy "admins manage admission leads"
  on public.admission_leads for all
  using (public.is_admin())
  with check (public.is_admin());

create index admission_leads_stage_idx on public.admission_leads(stage);
create index admission_leads_archived_idx on public.admission_leads(archived);
create index admission_leads_converted_student_id_idx on public.admission_leads(converted_student_id);
