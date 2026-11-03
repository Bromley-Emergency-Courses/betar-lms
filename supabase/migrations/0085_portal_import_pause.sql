alter table public.assessment_operational_controls
  add column portal_imports_paused boolean not null default true;

create function public.assessment_portal_imports_paused() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select writes_paused or portal_imports_paused from public.assessment_operational_controls where singleton),true);
$$;
revoke all on function public.assessment_portal_imports_paused() from public, anon;
grant execute on function public.assessment_portal_imports_paused() to authenticated, service_role;

alter function public.ingest_assessment_source(jsonb) rename to ingest_assessment_source_before_portal_pause;
revoke all on function public.ingest_assessment_source_before_portal_pause(jsonb) from public, anon, authenticated, service_role;

create function public.ingest_assessment_source(batch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assessment_require_admin();
  if jsonb_typeof(batch) <> 'array' then raise exception 'Provide an array of source rows'; end if;
  if coalesce((select portal_imports_paused from public.assessment_operational_controls where singleton),true) and exists(
    select 1 from jsonb_array_elements(batch) input where input->>'source_system'='Portal'
  ) then raise exception 'Automatic exam imports are temporarily paused. Enter scores and resits manually in the student profile.'; end if;
  return public.ingest_assessment_source_before_portal_pause(batch);
end;
$$;
revoke all on function public.ingest_assessment_source(jsonb) from public, anon, service_role;
grant execute on function public.ingest_assessment_source(jsonb) to authenticated;

create function public.guard_paused_portal_imports() returns trigger
language plpgsql security definer set search_path = public as $$
declare blocked boolean := false;
begin
  if public.assessment_portal_imports_paused() then
    if tg_table_name in ('exam_portal_mappings','exam_portal_submissions') or tg_op='TRUNCATE' then
      blocked := true;
    elsif tg_table_name='exam_results' then
      if tg_op <> 'DELETE' then blocked := new.source_system='theory_portal'; end if;
      if tg_op <> 'INSERT' then blocked := blocked or old.source_system='theory_portal'; end if;
    elsif tg_table_name='module_assessment_source_results' then
      blocked := new.source_system='Portal';
    elsif tg_table_name='module_assessment_source_versions' then
      blocked := exists(select 1 from public.module_assessment_source_results where id=new.source_id and source_system='Portal');
    end if;
    if blocked then raise exception 'Automatic exam imports are temporarily paused. Enter scores and resits manually in the student profile.'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_paused_portal_imports() from public, anon, authenticated, service_role;

create trigger portal_import_pause before insert or update or delete or truncate on public.exam_portal_mappings
  for each statement execute function public.guard_paused_portal_imports();
create trigger portal_import_pause before insert or update or delete or truncate on public.exam_portal_submissions
  for each statement execute function public.guard_paused_portal_imports();
create trigger portal_import_pause before insert or update or delete on public.exam_results
  for each row execute function public.guard_paused_portal_imports();
create trigger portal_import_pause before insert on public.module_assessment_source_results
  for each row execute function public.guard_paused_portal_imports();
create trigger portal_import_pause before insert on public.module_assessment_source_versions
  for each row execute function public.guard_paused_portal_imports();
