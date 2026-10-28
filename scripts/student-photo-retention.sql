begin transaction read only;
select object.id, object.name, object.created_at, object.updated_at,
  object.metadata->>'size' size_bytes,
  (select count(*) from public.students student where student.photo_path=object.name) student_references,
  (select count(*) from public.managed_files file where file.bucket='student-photos' and file.object_path=object.name) managed_file_references,
  (select max(event.created_at) from public.audit_events event where event.action='save_student_photo'
    and (event.metadata->>'after_path'=object.name or event.metadata->>'before_path'=object.name)) latest_photo_audit,
  case
    when exists(select 1 from public.students student where student.photo_path=object.name)
      or exists(select 1 from public.managed_files file where file.bucket='student-photos' and file.object_path=object.name)
      then 'Retain: referenced by a student or managed file'
    when object.name !~ '^[0-9a-f-]{36}/workspace/[0-9a-f-]{36}\.(png|jpg|webp)$'
      then 'Retain: legacy or other workflow; investigate ownership'
    when exists(select 1 from public.audit_events event where event.action='save_student_photo' and event.metadata->>'after_path'=object.name)
      then 'Retain pending review: superseded photo or failed cleanup'
    else 'Retain pending review: unconfirmed upload; do not assume the save failed'
  end disposition
from storage.objects object
where object.bucket_id='student-photos'
order by object.created_at, object.name;
commit;
