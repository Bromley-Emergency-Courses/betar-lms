create function public.read_student_photo_workspace(student_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare student public.students;
begin
  if auth.uid() is null or public.is_admin() is not true then raise exception 'An active administrator is required'; end if;
  select * into student from public.students where id=student_key;
  if student.id is null then raise exception 'Student not found'; end if;
  return jsonb_build_object('revision',student.profile_revision,'hasPhoto',student.photo_path is not null);
end;
$$;
revoke all on function public.read_student_photo_workspace(uuid) from public, anon, service_role;
grant execute on function public.read_student_photo_workspace(uuid) to authenticated;

create function public.save_student_photo(student_key uuid, expected_revision integer, object_path text, removal_confirmed boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  previous public.students;
  saved public.students;
  object_metadata jsonb;
begin
  if auth.uid() is null or public.is_admin() is not true then raise exception 'An active administrator is required'; end if;
  select * into previous from public.students where id=student_key for update;
  if previous.id is null then raise exception 'Student not found'; end if;
  if expected_revision is null or previous.profile_revision <> expected_revision then
    raise exception 'Student or photo changed. Discard this draft and reopen to review the latest photo.';
  end if;
  if object_path is null then
    if removal_confirmed is distinct from true then raise exception 'Confirm removing the current profile photo'; end if;
    if previous.photo_path is null then raise exception 'There is no profile photo to remove'; end if;
  else
    if removal_confirmed is distinct from false or object_path !~ ('^' || student_key::text || '/workspace/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$') then
      raise exception 'Invalid student photo path';
    end if;
    select metadata into object_metadata from storage.objects where bucket_id='student-photos' and name=object_path for share;
    if object_metadata is null or coalesce(object_metadata->>'mimetype','') not in ('image/png','image/jpeg','image/webp')
      or coalesce((object_metadata->>'size')::bigint,0) not between 1 and 10485760 then raise exception 'Upload a supported private photo before saving'; end if;
    if exists(select 1 from public.audit_events where action='save_student_photo' and metadata->>'after_path'=object_path) then
      raise exception 'This uploaded photo has already been used. Reopen the editor before retrying.';
    end if;
  end if;
  update public.students set photo_path=object_path where id=student_key returning * into saved;
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'save_student_photo','student',student_key,jsonb_build_object('before_path',previous.photo_path,'after_path',saved.photo_path,
      'before_revision',previous.profile_revision,'after_revision',saved.profile_revision));
  return jsonb_build_object('previousPath',previous.photo_path,'revision',saved.profile_revision);
end;
$$;
revoke all on function public.save_student_photo(uuid,integer,text,boolean) from public, anon, service_role;
grant execute on function public.save_student_photo(uuid,integer,text,boolean) to authenticated;
