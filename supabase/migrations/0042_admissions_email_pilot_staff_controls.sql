create or replace function public.mark_fake_admission_lead_for_email_pilot(
  p_admission_lead_id uuid,
  p_label text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_lead public.admission_leads%rowtype;
  v_person_id uuid;
  v_record_id uuid;
  v_label text := nullif(left(trim(coalesce(p_label, '')), 160), '');
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 2000), '');
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can mark fake pilot records' using errcode = '42501';
  end if;

  if v_label is null or v_reason is null then
    raise exception 'A label and reason are required';
  end if;

  select * into v_lead
  from public.admission_leads
  where id = p_admission_lead_id
  for update;

  if not found then
    raise exception 'The admissions record was not found';
  end if;

  v_person_id := v_lead.person_id;
  if v_person_id is null then
    insert into public.persons (first_name, last_name, email, phone)
    values (v_lead.first_name, v_lead.last_name, lower(v_lead.email), v_lead.phone)
    returning id into v_person_id;

    update public.admission_leads
    set person_id = v_person_id,
        updated_at = now()
    where id = v_lead.id;

    insert into public.audit_events (
      actor_type, actor_user_id, actor_person_id, action, entity_type, entity_id, metadata
    ) values (
      'staff', v_actor_user_id, null, 'admission.person_linked_for_email_pilot',
      'admission_lead', v_lead.id,
      jsonb_build_object('person_id', v_person_id)
    );
  end if;

  insert into public.admissions_email_test_records (
    record_type,
    person_id,
    admission_lead_id,
    label,
    reason,
    active,
    marked_by_user_id,
    marked_at,
    unmarked_by_user_id,
    unmarked_at,
    unmark_reason
  )
  values (
    'new_applicant',
    v_person_id,
    p_admission_lead_id,
    v_label,
    v_reason,
    true,
    v_actor_user_id,
    now(),
    null,
    null,
    null
  )
  on conflict (admission_lead_id) do update
  set
    person_id = excluded.person_id,
    label = excluded.label,
    reason = excluded.reason,
    active = true,
    marked_by_user_id = excluded.marked_by_user_id,
    marked_at = now(),
    unmarked_by_user_id = null,
    unmarked_at = null,
    unmark_reason = null
  returning id into v_record_id;

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, reason, metadata
  )
  values (
    'staff', v_actor_user_id, 'admissions_email_test_record.marked',
    'admission_lead', p_admission_lead_id, v_reason,
    jsonb_build_object('test_record_id', v_record_id, 'record_type', 'new_applicant', 'label', v_label)
  );

  return v_record_id;
end;
$$;

revoke all on function public.mark_fake_admission_lead_for_email_pilot(uuid, text, text) from public;
grant execute on function public.mark_fake_admission_lead_for_email_pilot(uuid, text, text) to authenticated;
