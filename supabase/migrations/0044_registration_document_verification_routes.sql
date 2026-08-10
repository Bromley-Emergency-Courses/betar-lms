alter table public.admissions_registration_document_slots
  add column verification_route text not null default 'upload'
    check (verification_route in ('upload', 'in_person'));

alter table public.admissions_registration_document_slots
  add constraint admissions_registration_document_route_status_check
  check (verification_route <> 'in_person' or verification_status <> 'rejected');

create or replace function public.normalize_registration_document_upload_route()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.managed_file_id is not null
    and new.managed_file_id is distinct from old.managed_file_id then
    new.verification_route := 'upload';
  end if;
  return new;
end;
$$;

create trigger normalize_registration_document_upload_route
  before update of managed_file_id on public.admissions_registration_document_slots
  for each row
  execute function public.normalize_registration_document_upload_route();

create or replace function public.set_admissions_registration_document_verification_route(
  p_registration_id uuid,
  p_slot_key public.admissions_registration_document_slot_key,
  p_verification_route text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_person_id uuid := public.current_person_id();
  v_slot public.admissions_registration_document_slots%rowtype;
  v_registration public.admissions_registrations%rowtype;
begin
  if v_auth_user_id is null
    or v_person_id is null
    or public.current_portal_actor_type() <> 'applicant' then
    raise exception 'An authenticated applicant session is required';
  end if;

  if p_verification_route not in ('upload', 'in_person') then
    raise exception 'Document verification route is invalid';
  end if;

  select * into v_registration
  from public.admissions_registrations
  where id = p_registration_id
    and person_id = v_person_id
  for update;

  if not found or v_registration.status <> 'in_progress' then
    raise exception 'Only in-progress registrations can change document verification routes';
  end if;

  select * into v_slot
  from public.admissions_registration_document_slots
  where registration_id = v_registration.id
    and person_id = v_person_id
    and slot_key = p_slot_key
    and required = true
  for update;

  if not found then
    raise exception 'Required registration document slot was not found';
  end if;

  if p_verification_route = 'in_person' and v_slot.managed_file_id is not null then
    raise exception 'An uploaded document already exists for this slot';
  end if;

  update public.admissions_registration_document_slots
  set
    verification_route = p_verification_route,
    verification_status = 'unverified',
    verifier_user_id = null,
    verification_at = null,
    verification_note = null
  where id = v_slot.id;

  insert into public.audit_events (
    actor_type,
    actor_user_id,
    actor_person_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    'applicant',
    v_auth_user_id,
    v_person_id,
    'registration.document_verification_route_selected',
    'admissions_registration_document_slot',
    v_slot.id,
    jsonb_build_object(
      'registration_id', v_registration.id,
      'slot_key', v_slot.slot_key,
      'verification_route', p_verification_route,
      'requires_staff_follow_up', p_verification_route = 'in_person'
    )
  );

  return v_slot.id;
end;
$$;

create or replace function public.verify_admissions_registration_document_slot(
  p_slot_id uuid,
  p_verification_route text,
  p_verification_status public.application_document_verification_status,
  p_verification_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.admissions_registration_document_slots%rowtype;
  v_note text := nullif(left(trim(coalesce(p_verification_note, '')), 4000), '');
begin
  if not public.is_admin() then
    raise exception 'Only admissions admins can verify registration documents'
      using errcode = '42501';
  end if;

  if p_verification_route not in ('upload', 'in_person') then
    raise exception 'Document verification route is invalid';
  end if;

  select * into v_slot
  from public.admissions_registration_document_slots
  where id = p_slot_id
  for update;

  if not found then
    raise exception 'Registration document slot was not found';
  end if;

  if p_verification_route = 'upload' and v_slot.managed_file_id is null then
    raise exception 'Uploaded-document verification requires an uploaded file';
  end if;

  if p_verification_status = 'rejected' and v_slot.managed_file_id is null then
    raise exception 'Only an uploaded document can be rejected';
  end if;

  if p_verification_route = 'in_person'
    and p_verification_status = 'verified'
    and v_note is null then
    raise exception 'In-person verification requires a staff note';
  end if;

  update public.admissions_registration_document_slots
  set
    verification_route = p_verification_route,
    verification_status = p_verification_status,
    verifier_user_id = case when p_verification_status = 'unverified' then null else auth.uid() end,
    verification_at = case when p_verification_status = 'unverified' then null else now() end,
    verification_note = v_note
  where id = v_slot.id;

  insert into public.audit_events (
    actor_type,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    reason,
    metadata
  )
  values (
    'staff',
    auth.uid(),
    'registration.document_verification_recorded',
    'admissions_registration_document_slot',
    v_slot.id,
    v_note,
    jsonb_build_object(
      'registration_id', v_slot.registration_id,
      'slot_key', v_slot.slot_key,
      'verification_route', p_verification_route,
      'verification_status', p_verification_status,
      'requires_staff_follow_up', p_verification_route = 'in_person' and p_verification_status = 'unverified'
    )
  );

  return v_slot.id;
end;
$$;

do $$
declare
  v_definition text;
  v_updated text;
  v_old text := $old$
  where not exists (
    select 1
    from public.admissions_registration_document_slots document_slot
    where document_slot.registration_id = v_registration.id
      and document_slot.person_id = v_person_id
      and document_slot.slot_key = required_slot.slot_key
      and document_slot.managed_file_id is not null
      and document_slot.verification_status <> 'rejected'
      and exists (
        select 1
        from public.managed_files managed_file
        join storage.objects storage_object
          on storage_object.bucket_id = managed_file.bucket
          and storage_object.name = managed_file.object_path
        where managed_file.id = document_slot.managed_file_id
          and managed_file.person_id = v_person_id
          and managed_file.bucket in ('id-documents', 'qualification-documents')
      )
  );$old$;
  v_new text := $new$
  where not exists (
    select 1
    from public.admissions_registration_document_slots document_slot
    where document_slot.registration_id = v_registration.id
      and document_slot.person_id = v_person_id
      and document_slot.slot_key = required_slot.slot_key
      and (
        document_slot.verification_route = 'in_person'
        or (
          document_slot.managed_file_id is not null
          and document_slot.verification_status <> 'rejected'
          and exists (
            select 1
            from public.managed_files managed_file
            join storage.objects storage_object
              on storage_object.bucket_id = managed_file.bucket
              and storage_object.name = managed_file.object_path
            where managed_file.id = document_slot.managed_file_id
              and managed_file.person_id = v_person_id
              and managed_file.bucket in ('id-documents', 'qualification-documents')
          )
        )
      )
  );$new$;
begin
  select pg_get_functiondef(
    'public.submit_admissions_registration(uuid, boolean, text, text, inet, text)'::regprocedure
  ) into v_definition;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception 'Could not update submit_admissions_registration document checks';
  end if;
  execute v_updated;
end;
$$;

do $$
declare
  v_definition text;
  v_updated text;
  v_old text := $old$
  where not exists (
    select 1
    from public.admissions_registration_document_slots document_slot
    join public.managed_files managed_file on managed_file.id = document_slot.managed_file_id
    join storage.objects storage_object
      on storage_object.bucket_id = managed_file.bucket
      and storage_object.name = managed_file.object_path
    where document_slot.registration_id = v_registration.id
      and document_slot.person_id = v_registration.person_id
      and document_slot.slot_key = required_slot.slot_key
      and document_slot.required = true
      and document_slot.verification_status <> 'rejected'
      and managed_file.person_id = v_registration.person_id
      and managed_file.bucket in ('id-documents', 'qualification-documents')
  );$old$;
  v_new text := $new$
  where not exists (
    select 1
    from public.admissions_registration_document_slots document_slot
    where document_slot.registration_id = v_registration.id
      and document_slot.person_id = v_registration.person_id
      and document_slot.slot_key = required_slot.slot_key
      and document_slot.required = true
      and (
        document_slot.verification_route = 'in_person'
        or (
          document_slot.managed_file_id is not null
          and document_slot.verification_status <> 'rejected'
          and exists (
            select 1
            from public.managed_files managed_file
            join storage.objects storage_object
              on storage_object.bucket_id = managed_file.bucket
              and storage_object.name = managed_file.object_path
            where managed_file.id = document_slot.managed_file_id
              and managed_file.person_id = v_registration.person_id
              and managed_file.bucket in ('id-documents', 'qualification-documents')
          )
        )
      )
  );$new$;
begin
  select pg_get_functiondef(
    'public.convert_submitted_admissions_registration(uuid)'::regprocedure
  ) into v_definition;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception 'Could not update convert_submitted_admissions_registration document checks';
  end if;
  execute v_updated;
end;
$$;

revoke all on function public.set_admissions_registration_document_verification_route(
  uuid,
  public.admissions_registration_document_slot_key,
  text
) from public;
grant execute on function public.set_admissions_registration_document_verification_route(
  uuid,
  public.admissions_registration_document_slot_key,
  text
) to authenticated;

revoke all on function public.verify_admissions_registration_document_slot(
  uuid,
  text,
  public.application_document_verification_status,
  text
) from public;
grant execute on function public.verify_admissions_registration_document_slot(
  uuid,
  text,
  public.application_document_verification_status,
  text
) to authenticated;
