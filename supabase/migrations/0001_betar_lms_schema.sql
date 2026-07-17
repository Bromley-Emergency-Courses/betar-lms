create extension if not exists "pgcrypto";

create type public.user_role as enum ('admin', 'teacher', 'reception');
create type public.student_status as enum ('prospect', 'active', 'completed', 'withdrawn', 'deferred', 'interrupted');
create type public.admission_stage as enum (
  'interest',
  'application_invited',
  'submitted',
  'reviewed',
  'offered',
  'rejected',
  'accepted',
  'cccu_registration_pending',
  'cccu_registration_complete'
);
create type public.module_mode as enum ('practical', 'online');
create type public.term_status as enum ('draft', 'published', 'active', 'closed');
create type public.enrolment_status as enum ('planned', 'in_progress', 'completed', 'failed', 'deferred');
create type public.attendance_status as enum ('expected', 'attended', 'partial', 'missed');
create type public.invoice_status as enum ('not_requested', 'requested', 'sent', 'corrected');
create type public.payment_status as enum ('not_due', 'outstanding', 'paid', 'disputed');
create type public.exam_component_type as enum ('theory', 'practical');
create type public.exam_source_system as enum ('theory_portal', 'practical_osce', 'manual');

create table public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.user_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  cccu_student_id text unique,
  temporary_id text not null unique,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  status public.student_status not null default 'prospect',
  admission_stage public.admission_stage not null default 'interest',
  programme text not null check (programme in ('pgcert', 'microcredential')),
  start_term_id uuid,
  photo_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  starts_on date not null,
  ends_on date not null,
  exam_window_starts_on date,
  exam_window_ends_on date,
  status public.term_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_on <= ends_on)
);

alter table public.students
  add constraint students_start_term_id_fkey foreign key (start_term_id) references public.terms(id);

create table public.course_modules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  credits integer not null default 10 check (credits > 0),
  mode public.module_mode not null,
  mandatory boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.module_offerings (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.course_modules(id) on delete restrict,
  term_id uuid not null references public.terms(id) on delete cascade,
  price_pence integer not null check (price_pence >= 0),
  capacity integer not null check (capacity > 0),
  attendance_days_required_first_practical integer not null default 3 check (attendance_days_required_first_practical >= 0),
  attendance_days_required_subsequent_practical integer not null default 2 check (attendance_days_required_subsequent_practical >= 0),
  presentation_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module_id, term_id)
);

create table public.enrolments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  offering_id uuid not null references public.module_offerings(id) on delete restrict,
  status public.enrolment_status not null default 'planned',
  grade text,
  final_mark numeric(5, 2),
  credits_awarded integer not null default 0 check (credits_awarded >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, offering_id)
);

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.module_offerings(id) on delete cascade,
  session_date date not null,
  starts_at time not null,
  ends_at time not null,
  location text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create table public.expected_attendance (
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, student_id)
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status public.attendance_status not null default 'expected',
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  recorded_by_user_id uuid references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create table public.assessment_definitions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.course_modules(id) on delete cascade,
  name text not null,
  domains jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.encounter_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  offering_id uuid not null references public.module_offerings(id) on delete cascade,
  staff_user_id uuid not null references public.staff_profiles(id),
  occurred_on date not null,
  summary text not null,
  concern_level text not null default 'none' check (concern_level in ('none', 'watch', 'support_needed')),
  created_at timestamptz not null default now()
);

create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  offering_id uuid not null references public.module_offerings(id) on delete cascade,
  definition_id uuid not null references public.assessment_definitions(id) on delete restrict,
  staff_user_id uuid not null references public.staff_profiles(id),
  occurred_on date not null,
  scores jsonb not null default '{}'::jsonb,
  comments text,
  created_at timestamptz not null default now()
);

create table public.presentation_scores (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  offering_id uuid not null references public.module_offerings(id) on delete cascade,
  staff_user_id uuid not null references public.staff_profiles(id),
  occurred_on date not null,
  presentation_type text check (presentation_type in ('case_presentation', 'journal_club')),
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  scores jsonb not null default '{}'::jsonb,
  total_score integer not null check (total_score >= 0),
  comments text,
  created_at timestamptz not null default now()
);

create table public.finance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  term_id uuid not null references public.terms(id) on delete restrict,
  expected_amount_pence integer not null check (expected_amount_pence >= 0),
  invoice_status public.invoice_status not null default 'not_requested',
  invoice_amount_pence integer check (invoice_amount_pence >= 0),
  payment_status public.payment_status not null default 'not_due',
  paid_amount_pence integer check (paid_amount_pence >= 0),
  purchase_order_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, term_id)
);

create table public.exam_results (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  offering_id uuid not null references public.module_offerings(id) on delete cascade,
  component_type public.exam_component_type not null,
  source_system public.exam_source_system not null,
  source_attempt_id text not null,
  score numeric(5, 2) not null check (score >= 0 and score <= 100),
  pass_mark numeric(5, 2) not null default 50 check (pass_mark >= 0 and pass_mark <= 100),
  passed boolean not null,
  resit_required boolean not null,
  taken_on date not null,
  imported_at timestamptz not null default now(),
  unique (source_system, source_attempt_id)
);

create table public.managed_files (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  bucket text not null,
  object_path text not null,
  label text not null,
  content_type text,
  uploaded_by_user_id uuid references public.staff_profiles(id),
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.staff_profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.staff_profiles enable row level security;
alter table public.students enable row level security;
alter table public.terms enable row level security;
alter table public.course_modules enable row level security;
alter table public.module_offerings enable row level security;
alter table public.enrolments enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.expected_attendance enable row level security;
alter table public.attendance_records enable row level security;
alter table public.assessment_definitions enable row level security;
alter table public.encounter_logs enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.presentation_scores enable row level security;
alter table public.finance_records enable row level security;
alter table public.exam_results enable row level security;
alter table public.managed_files enable row level security;
alter table public.audit_events enable row level security;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.staff_profiles where id = auth.uid() and active = true;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin';
$$;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'teacher');
$$;

create or replace function public.is_reception()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'reception');
$$;

create policy "staff can read own profile or admins read all"
  on public.staff_profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "admins manage staff"
  on public.staff_profiles for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "teachers and admins read students"
  on public.students for select
  using (public.is_teacher());

create policy "admins manage students"
  on public.students for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "teachers and admins read academic config"
  on public.terms for select using (public.is_teacher());
create policy "admins manage terms" on public.terms for all using (public.is_admin()) with check (public.is_admin());

create policy "teachers and admins read modules"
  on public.course_modules for select using (public.is_teacher());
create policy "admins manage modules" on public.course_modules for all using (public.is_admin()) with check (public.is_admin());

create policy "teachers and admins read offerings"
  on public.module_offerings for select using (public.is_teacher());
create policy "admins manage offerings" on public.module_offerings for all using (public.is_admin()) with check (public.is_admin());

create policy "teachers and admins read enrolments"
  on public.enrolments for select using (public.is_teacher());
create policy "admins manage enrolments" on public.enrolments for all using (public.is_admin()) with check (public.is_admin());

create policy "teachers and reception read sessions"
  on public.attendance_sessions for select using (public.is_teacher() or public.is_reception());
create policy "admins manage sessions" on public.attendance_sessions for all using (public.is_admin()) with check (public.is_admin());

create policy "teachers and reception read expected attendance"
  on public.expected_attendance for select using (public.is_teacher() or public.is_reception());
create policy "admins manage expected attendance" on public.expected_attendance for all using (public.is_admin()) with check (public.is_admin());

create policy "teachers and reception read attendance"
  on public.attendance_records for select using (public.is_teacher() or public.is_reception());
create policy "reception records check ins"
  on public.attendance_records for insert with check (public.is_reception());
create policy "reception updates check ins"
  on public.attendance_records for update using (public.is_reception()) with check (public.is_reception());
create policy "admins manage attendance"
  on public.attendance_records for all using (public.is_admin()) with check (public.is_admin());

create policy "teachers read assessment definitions"
  on public.assessment_definitions for select using (public.is_teacher());
create policy "admins manage assessment definitions"
  on public.assessment_definitions for all using (public.is_admin()) with check (public.is_admin());

create policy "teachers record encounters"
  on public.encounter_logs for insert with check (public.is_teacher());
create policy "teachers read encounters"
  on public.encounter_logs for select using (public.is_teacher());
create policy "admins manage encounters"
  on public.encounter_logs for all using (public.is_admin()) with check (public.is_admin());

create policy "teachers record assessment attempts"
  on public.assessment_attempts for insert with check (public.is_teacher());
create policy "teachers read assessment attempts"
  on public.assessment_attempts for select using (public.is_teacher());
create policy "admins manage assessment attempts"
  on public.assessment_attempts for all using (public.is_admin()) with check (public.is_admin());

create policy "teachers record presentation scores"
  on public.presentation_scores for insert with check (public.is_teacher());
create policy "teachers read presentation scores"
  on public.presentation_scores for select using (public.is_teacher());
create policy "admins manage presentation scores"
  on public.presentation_scores for all using (public.is_admin()) with check (public.is_admin());

create policy "admins manage finance"
  on public.finance_records for all using (public.is_admin()) with check (public.is_admin());

create policy "teachers read exam results"
  on public.exam_results for select using (public.is_teacher());
create policy "admins manage exam results"
  on public.exam_results for all using (public.is_admin()) with check (public.is_admin());

create policy "teachers read managed files"
  on public.managed_files for select using (public.is_teacher());
create policy "admins manage managed files"
  on public.managed_files for all using (public.is_admin()) with check (public.is_admin());

create policy "admins read audit events"
  on public.audit_events for select using (public.is_admin());
create policy "authenticated users append audit events"
  on public.audit_events for insert with check (auth.uid() is not null);

create index students_status_idx on public.students(status);
create index students_admission_stage_idx on public.students(admission_stage);
create index enrolments_student_id_idx on public.enrolments(student_id);
create index attendance_records_student_id_idx on public.attendance_records(student_id);
create index encounter_logs_student_id_idx on public.encounter_logs(student_id);
create index finance_records_student_id_idx on public.finance_records(student_id);
create index exam_results_student_id_idx on public.exam_results(student_id);
