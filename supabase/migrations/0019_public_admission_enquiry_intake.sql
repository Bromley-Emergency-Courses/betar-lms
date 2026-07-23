create or replace function public.submit_public_admission_enquiry(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text default null,
  p_programme text default 'pgcert',
  p_module_interest_ids uuid[] default '{}'::uuid[],
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text := nullif(trim(p_first_name), '');
  v_last_name text := nullif(trim(p_last_name), '');
  v_email text := lower(nullif(trim(p_email), ''));
  v_phone text := nullif(left(trim(coalesce(p_phone, '')), 40), '');
  v_programme text := coalesce(nullif(trim(p_programme), ''), 'pgcert');
  v_module_interest_ids uuid[] := coalesce(p_module_interest_ids, '{}'::uuid[]);
  v_notes text := nullif(left(trim(coalesce(p_notes, '')), 2000), '');
  v_lead_id uuid;
begin
  if v_first_name is null or length(v_first_name) > 80 then
    raise exception 'First name is required and must be 80 characters or fewer';
  end if;

  if v_last_name is null or length(v_last_name) > 80 then
    raise exception 'Last name is required and must be 80 characters or fewer';
  end if;

  if v_email is null or length(v_email) > 254 or v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'A valid email address is required';
  end if;

  if v_programme not in ('pgcert', 'microcredential') then
    raise exception 'Programme must be pgcert or microcredential';
  end if;

  if cardinality(v_module_interest_ids) > 20 then
    raise exception 'Too many module interests supplied';
  end if;

  insert into public.admission_leads (
    first_name,
    last_name,
    email,
    phone,
    stage,
    programme,
    module_interest_ids,
    source,
    notes
  )
  values (
    v_first_name,
    v_last_name,
    v_email,
    v_phone,
    'interest',
    v_programme,
    v_module_interest_ids,
    'public_apply',
    v_notes
  )
  returning id into v_lead_id;

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
    null,
    null,
    'enquiry.submitted',
    'admission_lead',
    v_lead_id,
    jsonb_build_object(
      'programme',
      v_programme,
      'module_interest_count',
      cardinality(v_module_interest_ids),
      'source',
      'public_apply'
    )
  );

  return v_lead_id;
end;
$$;

revoke all on function public.submit_public_admission_enquiry(text, text, text, text, text, uuid[], text) from public;
grant execute on function public.submit_public_admission_enquiry(text, text, text, text, text, uuid[], text) to anon, authenticated;
