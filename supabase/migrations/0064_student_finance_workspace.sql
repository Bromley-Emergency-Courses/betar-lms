alter table public.finance_records add column workspace_version uuid not null default gen_random_uuid();

create function public.advance_finance_workspace_version() returns trigger
language plpgsql set search_path = public as $$
begin
  new.workspace_version := gen_random_uuid();
  return new;
end;
$$;
revoke all on function public.advance_finance_workspace_version() from public, anon, authenticated, service_role;
create trigger finance_workspace_version before insert or update on public.finance_records
  for each row execute function public.advance_finance_workspace_version();

create function public.student_finance_term_token(student_key uuid, term_key uuid) returns text
language sql stable set search_path = public as $$
  select md5(coalesce(jsonb_agg(jsonb_build_array(enrolment.id,enrolment.status,offering.id,offering.price_pence)
    order by enrolment.id)::text,'[]'))
  from public.enrolments enrolment join public.module_offerings offering on offering.id=enrolment.offering_id
  where enrolment.student_id=student_key and offering.term_id=term_key;
$$;
revoke all on function public.student_finance_term_token(uuid,uuid) from public, anon, authenticated, service_role;

create function public.read_student_finance_workspace(student_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() is not true then raise exception 'An active administrator is required'; end if;
  if not exists(select 1 from public.students where id=student_key) then raise exception 'Student not found'; end if;
  return jsonb_build_object(
    'records',coalesce((select jsonb_agg(jsonb_build_object(
      'id',record.id,'term_id',record.term_id,'term',term.name,'version',record.workspace_version,
      'expected_amount_pence',record.expected_amount_pence,'invoice_amount_pence',record.invoice_amount_pence,
      'paid_amount_pence',record.paid_amount_pence,'invoice_status',record.invoice_status,'payment_status',record.payment_status,'notes',record.notes)
      order by term.starts_on desc,record.id)
      from public.finance_records record join public.terms term on term.id=record.term_id where record.student_id=student_key),'[]'::jsonb),
    'terms',coalesce((select jsonb_agg(jsonb_build_object('id',eligible.id,'label',eligible.name,
      'suggestedAmountPence',eligible.amount,'token',public.student_finance_term_token(student_key,eligible.id)) order by eligible.starts_on desc,eligible.id)
      from (select term.id,term.name,term.starts_on,sum(case when enrolment.status='deferred' then 0 else offering.price_pence end) amount
        from public.enrolments enrolment join public.module_offerings offering on offering.id=enrolment.offering_id
        join public.terms term on term.id=offering.term_id
        where enrolment.student_id=student_key and not exists(select 1 from public.finance_records record where record.student_id=student_key and record.term_id=term.id)
        group by term.id) eligible),'[]'::jsonb));
end;
$$;
revoke all on function public.read_student_finance_workspace(uuid) from public, anon, service_role;
grant execute on function public.read_student_finance_workspace(uuid) to authenticated;

create function public.save_student_finance(command jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  fields text[] := array['id','student_id','term_id','expected_version','term_token','expected_amount_pence','invoice_amount_pence','paid_amount_pence','invoice_status','payment_status','notes'];
  field_name text;
  student_key uuid;
  term_key uuid;
  record_key uuid;
  previous public.finance_records;
  saved public.finance_records;
begin
  if auth.uid() is null or public.is_admin() is not true then raise exception 'An active administrator is required'; end if;
  if jsonb_typeof(command) is distinct from 'object' or not(command ?& fields) or command-fields <> '{}'::jsonb then raise exception 'Invalid finance fields'; end if;
  foreach field_name in array fields loop
    if field_name in ('expected_amount_pence','invoice_amount_pence','paid_amount_pence') then
      if not (field_name <> 'expected_amount_pence' and command->field_name='null'::jsonb) then
        if jsonb_typeof(command->field_name) <> 'number' or (command->>field_name) !~ '^[0-9]+$' or (command->>field_name)::numeric > 2147483647 then raise exception 'Enter non-negative whole pence amounts'; end if;
      end if;
    elsif jsonb_typeof(command->field_name) <> 'string' and not(field_name in ('expected_version','term_token','notes') and command->field_name='null'::jsonb) then
      raise exception 'Invalid finance field: %',field_name;
    end if;
  end loop;
  if length(command->>'notes') > 10000 then raise exception 'Finance notes are too long'; end if;
  student_key := (command->>'student_id')::uuid; term_key := (command->>'term_id')::uuid; record_key := (command->>'id')::uuid;
  perform 1 from public.students where id=student_key for key share;
  if not found then raise exception 'Student not found'; end if;
  if command->>'expected_version' is null then
    if exists(select 1 from public.finance_records where id=record_key or (student_id=student_key and term_id=term_key)) then raise exception 'A finance record already exists. Discard this draft and reopen to review it.'; end if;
    perform 1 from public.enrolments enrolment join public.module_offerings offering on offering.id=enrolment.offering_id
      where enrolment.student_id=student_key and offering.term_id=term_key order by enrolment.id for share of enrolment,offering;
    if not found then raise exception 'Finance records can only be created for this student''s enrolled terms'; end if;
    if command->>'term_token' is distinct from public.student_finance_term_token(student_key,term_key) then
      raise exception 'Enrolments or offering prices changed. Discard this draft and reopen to review the expected fees.';
    end if;
    insert into public.finance_records(id,student_id,term_id,expected_amount_pence,invoice_amount_pence,paid_amount_pence,invoice_status,payment_status,notes)
      values(record_key,student_key,term_key,(command->>'expected_amount_pence')::integer,(command->>'invoice_amount_pence')::integer,
        (command->>'paid_amount_pence')::integer,(command->>'invoice_status')::public.invoice_status,(command->>'payment_status')::public.payment_status,nullif(trim(command->>'notes'),'')) returning * into saved;
  else
    if command->>'term_token' is not null then raise exception 'Term selection is fixed for existing finance records'; end if;
    select * into previous from public.finance_records where id=record_key for update;
    if previous.id is null or previous.student_id <> student_key or previous.term_id <> term_key or previous.workspace_version <> (command->>'expected_version')::uuid then
      raise exception 'Finance record changed, moved or was deleted. Discard this draft and reopen to review the latest record.';
    end if;
    update public.finance_records set expected_amount_pence=(command->>'expected_amount_pence')::integer,
      invoice_amount_pence=(command->>'invoice_amount_pence')::integer,paid_amount_pence=(command->>'paid_amount_pence')::integer,
      invoice_status=(command->>'invoice_status')::public.invoice_status,payment_status=(command->>'payment_status')::public.payment_status,
      notes=nullif(trim(command->>'notes'),'') where id=record_key returning * into saved;
  end if;
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),case when previous.id is null then 'create_student_finance' else 'update_student_finance' end,'finance_record',record_key,
      jsonb_build_object('before',case when previous.id is null then null else to_jsonb(previous) end,'after',to_jsonb(saved)));
  return saved.id;
end;
$$;
revoke all on function public.save_student_finance(jsonb) from public, anon, service_role;
grant execute on function public.save_student_finance(jsonb) to authenticated;
