alter table public.attendance_sessions
  add column if not exists term_id uuid references public.terms(id) on delete cascade;

update public.attendance_sessions session
set term_id = offering.term_id
from public.module_offerings offering
where session.offering_id = offering.id
  and session.term_id is null;

alter table public.attendance_sessions
  alter column term_id set not null,
  alter column offering_id drop not null;
