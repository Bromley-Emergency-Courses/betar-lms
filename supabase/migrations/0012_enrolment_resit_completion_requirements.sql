alter type public.enrolment_status add value if not exists 'resit';
alter type public.enrolment_status add value if not exists 'did_not_complete';

alter table public.enrolments
  add column if not exists attendance_days_required_override integer check (attendance_days_required_override >= 0),
  add column if not exists presentation_required_override boolean;
