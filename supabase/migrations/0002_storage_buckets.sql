insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('student-photos', 'student-photos', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  (
    'student-documents',
    'student-documents',
    false,
    52428800,
    array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
  ),
  ('imports', 'imports', false, 26214400, array['text/csv', 'application/vnd.ms-excel']),
  (
    'exports',
    'exports',
    false,
    26214400,
    array['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  ),
  (
    'templates',
    'templates',
    false,
    26214400,
    array['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "admins manage lms storage objects"
  on storage.objects for all
  using (
    bucket_id in ('student-photos', 'student-documents', 'imports', 'exports', 'templates')
    and public.is_admin()
  )
  with check (
    bucket_id in ('student-photos', 'student-documents', 'imports', 'exports', 'templates')
    and public.is_admin()
  );

create policy "teachers read lms storage objects"
  on storage.objects for select
  using (
    bucket_id in ('student-photos', 'student-documents', 'exports', 'templates')
    and public.is_teacher()
  );
