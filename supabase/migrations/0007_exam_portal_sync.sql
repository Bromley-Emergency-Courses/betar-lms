create table public.exam_portal_mappings (
  id uuid primary key default gen_random_uuid(),
  portal_exam_id text not null unique,
  exam_title text,
  term_id uuid not null references public.terms(id) on delete cascade,
  module_id uuid references public.course_modules(id) on delete cascade,
  component_type public.exam_component_type not null default 'theory',
  portal_exam_kind text not null default 'module_theory' check (portal_exam_kind in ('module_theory', 'physics_equipment')),
  physics_required boolean not null default true,
  active boolean not null default true,
  last_synced_at timestamptz,
  last_sync_status text,
  last_sync_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (portal_exam_kind = 'physics_equipment' and module_id is null)
    or (portal_exam_kind = 'module_theory' and module_id is not null)
  )
);

create table public.exam_portal_submissions (
  id uuid primary key default gen_random_uuid(),
  mapping_id uuid not null references public.exam_portal_mappings(id) on delete cascade,
  portal_exam_id text not null,
  token_id text not null,
  token text,
  cccu_student_id text not null,
  student_id uuid references public.students(id) on delete set null,
  student_name text not null,
  source_session_id text,
  started_at timestamptz,
  completed_at timestamptz,
  answered integer,
  score numeric(8, 2) not null,
  total numeric(8, 2) not null,
  percentage numeric(5, 2) not null check (percentage >= 0 and percentage <= 100),
  integrity_event_count integer not null default 0,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portal_exam_id, token_id)
);

alter table public.exam_portal_mappings enable row level security;
alter table public.exam_portal_submissions enable row level security;

create policy "teachers read exam portal mappings"
  on public.exam_portal_mappings for select using (public.is_teacher());
create policy "admins manage exam portal mappings"
  on public.exam_portal_mappings for all using (public.is_admin()) with check (public.is_admin());

create policy "teachers read exam portal submissions"
  on public.exam_portal_submissions for select using (public.is_teacher());
create policy "admins manage exam portal submissions"
  on public.exam_portal_submissions for all using (public.is_admin()) with check (public.is_admin());

create index exam_portal_mappings_term_id_idx on public.exam_portal_mappings(term_id);
create index exam_portal_mappings_module_id_idx on public.exam_portal_mappings(module_id);
create index exam_portal_submissions_mapping_id_idx on public.exam_portal_submissions(mapping_id);
create index exam_portal_submissions_student_id_idx on public.exam_portal_submissions(student_id);
create index exam_portal_submissions_cccu_student_id_idx on public.exam_portal_submissions(cccu_student_id);
