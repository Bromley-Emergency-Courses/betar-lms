alter table public.attendance_records
  add column if not exists admin_note text;
