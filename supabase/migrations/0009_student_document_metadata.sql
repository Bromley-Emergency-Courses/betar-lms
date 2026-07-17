alter table public.managed_files
  add column if not exists file_category text not null default 'other'
    check (file_category in ('cv', 'identity', 'certificate', 'correspondence', 'other')),
  add column if not exists original_filename text,
  add column if not exists size_bytes bigint check (size_bytes is null or size_bytes >= 0);

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp'
]
where id = 'student-documents';
