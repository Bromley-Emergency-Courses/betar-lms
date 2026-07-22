insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'application-docs',
    'application-docs',
    false,
    26214400,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/webp'
    ]
  ),
  (
    'id-documents',
    'id-documents',
    false,
    10485760,
    array[
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp'
    ]
  ),
  (
    'qualification-documents',
    'qualification-documents',
    false,
    26214400,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png',
      'image/jpeg',
      'image/webp'
    ]
  ),
  (
    'generated-letters',
    'generated-letters',
    false,
    26214400,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  ),
  (
    'deferral-evidence',
    'deferral-evidence',
    false,
    26214400,
    array[
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp'
    ]
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets
set public = false
where id in (
  'student-photos',
  'student-documents',
  'application-docs',
  'id-documents',
  'qualification-documents',
  'generated-letters',
  'deferral-evidence'
);

alter table public.managed_files
  add column if not exists person_id uuid references public.persons(id) on delete set null,
  add column if not exists uploaded_by_person_id uuid references public.persons(id) on delete set null,
  add column if not exists sanitized_filename text,
  add column if not exists retention_class text not null default 'student_academic_record';

update public.managed_files
set retention_class = case file_category
  when 'identity' then 'identity_document'
  when 'certificate' then 'qualification_document'
  when 'correspondence' then 'generated_letter'
  when 'cv' then 'application_document'
  else retention_class
end;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'managed_files_retention_class_check'
      and conrelid = 'public.managed_files'::regclass
  ) then
    alter table public.managed_files
      add constraint managed_files_retention_class_check
      check (
        retention_class in (
          'application_document',
          'identity_document',
          'qualification_document',
          'student_photo',
          'generated_letter',
          'deferral_evidence',
          'student_academic_record',
          'other'
        )
      );
  end if;
end $$;

create index if not exists managed_files_person_id_idx
  on public.managed_files(person_id);

create index if not exists managed_files_uploaded_by_person_id_idx
  on public.managed_files(uploaded_by_person_id);

create index if not exists managed_files_retention_class_idx
  on public.managed_files(retention_class);

create index if not exists managed_files_bucket_object_path_idx
  on public.managed_files(bucket, object_path);

drop policy if exists "admins manage lms storage objects" on storage.objects;
drop policy if exists "teachers read lms storage objects" on storage.objects;
drop policy if exists "teachers read non-sensitive lms storage objects" on storage.objects;

create policy "admins manage lms storage objects"
  on storage.objects for all
  using (
    bucket_id in (
      'student-photos',
      'student-documents',
      'application-docs',
      'id-documents',
      'qualification-documents',
      'generated-letters',
      'deferral-evidence',
      'imports',
      'exports',
      'templates'
    )
    and public.is_admin()
  )
  with check (
    bucket_id in (
      'student-photos',
      'student-documents',
      'application-docs',
      'id-documents',
      'qualification-documents',
      'generated-letters',
      'deferral-evidence',
      'imports',
      'exports',
      'templates'
    )
    and public.is_admin()
  );

create policy "teachers read non-sensitive lms storage objects"
  on storage.objects for select
  using (
    bucket_id in ('student-photos', 'exports', 'templates')
    and public.is_teacher()
  );

drop policy if exists "teachers read managed files" on public.managed_files;
drop policy if exists "teachers read non-sensitive managed files" on public.managed_files;
drop policy if exists "portal users read own managed file metadata" on public.managed_files;

create policy "teachers read non-sensitive managed files"
  on public.managed_files for select
  using (
    public.is_teacher()
    and bucket = 'student-photos'
    and retention_class = 'student_photo'
  );

create policy "portal users read own managed file metadata"
  on public.managed_files for select
  using (
    person_id = public.current_person_id()
    and bucket in ('application-docs', 'qualification-documents', 'student-photos', 'generated-letters')
    and retention_class in ('application_document', 'qualification_document', 'student_photo', 'generated_letter')
  );
