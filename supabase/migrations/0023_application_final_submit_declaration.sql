alter table public.applications
  add column declaration_accepted_at timestamptz,
  add column declaration_version text,
  add column declaration_text_hash text,
  add column declaration_actor_user_id uuid references auth.users(id) on delete set null,
  add column declaration_person_id uuid references public.persons(id) on delete set null,
  add column declaration_ip_address inet,
  add column declaration_user_agent text;

create index applications_submitted_at_idx
  on public.applications(submitted_at desc)
  where status = 'submitted';

create or replace function public.submit_application(
  p_application_id uuid,
  p_declaration_accepted boolean,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_person_id uuid := public.current_person_id();
  v_actor_type public.portal_actor_type := public.current_portal_actor_type();
  v_application public.applications%rowtype;
  v_lead public.admission_leads%rowtype;
  v_admission_lead_id uuid;
  v_selected_offering_count integer;
  v_missing_fields text[] := '{}'::text[];
  v_declaration_version text := 'application-declaration-2026-07-23-v1';
  v_declaration_text_hash text := '71b23b4f1e241df24f6c5d19a67fbe27d0419e58f663794f527e267a7d83986c';
  v_user_agent text := nullif(left(trim(coalesce(p_user_agent, '')), 500), '');
begin
  if v_auth_user_id is null or v_person_id is null or v_actor_type <> 'applicant' then
    raise exception 'An authenticated applicant session is required';
  end if;

  if coalesce(p_declaration_accepted, false) <> true then
    raise exception 'Declaration acceptance is required before submission';
  end if;

  select admission_lead_id
  into v_admission_lead_id
  from public.applications
  where id = p_application_id
    and person_id = v_person_id;

  if not found then
    raise exception 'Application was not found for this applicant';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = v_admission_lead_id
    and person_id = v_person_id
  for update;

  if not found then
    raise exception 'Application lead was not found for this applicant';
  end if;

  if v_lead.archived or v_lead.converted_student_id is not null then
    raise exception 'Archived or converted leads cannot be submitted by applicants';
  end if;

  if v_lead.stage <> 'application_invited' then
    raise exception 'Application can only be submitted from the invited stage';
  end if;

  select *
  into v_application
  from public.applications
  where id = p_application_id
    and admission_lead_id = v_lead.id
    and person_id = v_person_id
  for update;

  if not found then
    raise exception 'Application was not found for this applicant';
  end if;

  if v_application.status <> 'draft' then
    raise exception 'Only draft applications can be submitted';
  end if;

  if v_application.programme not in ('pgcert', 'microcredential') then
    v_missing_fields := array_append(v_missing_fields, 'programme');
  end if;
  if v_application.first_name is null then
    v_missing_fields := array_append(v_missing_fields, 'first_name');
  end if;
  if v_application.last_name is null then
    v_missing_fields := array_append(v_missing_fields, 'last_name');
  end if;
  if v_application.date_of_birth is null then
    v_missing_fields := array_append(v_missing_fields, 'date_of_birth');
  end if;
  if v_application.email is null or position('@' in v_application.email) = 0 then
    v_missing_fields := array_append(v_missing_fields, 'email');
  end if;
  if v_application.phone is null then
    v_missing_fields := array_append(v_missing_fields, 'phone');
  end if;
  if v_application.address_line_1 is null then
    v_missing_fields := array_append(v_missing_fields, 'address_line_1');
  end if;
  if v_application.city is null then
    v_missing_fields := array_append(v_missing_fields, 'city');
  end if;
  if v_application.postcode is null then
    v_missing_fields := array_append(v_missing_fields, 'postcode');
  end if;
  if v_application.country is null then
    v_missing_fields := array_append(v_missing_fields, 'country');
  end if;
  if v_application.clinical_role is null then
    v_missing_fields := array_append(v_missing_fields, 'clinical_role');
  end if;
  if v_application.employer is null then
    v_missing_fields := array_append(v_missing_fields, 'employer');
  end if;
  if v_application.department_specialty is null then
    v_missing_fields := array_append(v_missing_fields, 'department_specialty');
  end if;
  if v_application.professional_registration_body is null then
    v_missing_fields := array_append(v_missing_fields, 'professional_registration_body');
  end if;
  if v_application.professional_registration_number is null then
    v_missing_fields := array_append(v_missing_fields, 'professional_registration_number');
  end if;
  if v_application.work_experience is null then
    v_missing_fields := array_append(v_missing_fields, 'work_experience');
  end if;
  if v_application.highest_qualification is null then
    v_missing_fields := array_append(v_missing_fields, 'highest_qualification');
  end if;
  if v_application.qualification_awarding_body is null then
    v_missing_fields := array_append(v_missing_fields, 'qualification_awarding_body');
  end if;
  if v_application.qualification_year is null then
    v_missing_fields := array_append(v_missing_fields, 'qualification_year');
  end if;
  if v_application.intended_start_term_id is null then
    v_missing_fields := array_append(v_missing_fields, 'intended_start_term_id');
  end if;
  if v_application.nationality is null then
    v_missing_fields := array_append(v_missing_fields, 'nationality');
  end if;
  if v_application.country_of_residence is null then
    v_missing_fields := array_append(v_missing_fields, 'country_of_residence');
  end if;
  if v_application.pocus_previous_experience is null then
    v_missing_fields := array_append(v_missing_fields, 'pocus_previous_experience');
  end if;
  if v_application.pocus_motivation is null then
    v_missing_fields := array_append(v_missing_fields, 'pocus_motivation');
  end if;
  if v_application.pocus_case_improved_management is null then
    v_missing_fields := array_append(v_missing_fields, 'pocus_case_improved_management');
  end if;
  if v_application.pocus_limitations_case is null then
    v_missing_fields := array_append(v_missing_fields, 'pocus_limitations_case');
  end if;

  select count(*)
  into v_selected_offering_count
  from public.application_module_offering_choices
  where application_id = v_application.id;

  if v_selected_offering_count not between 1 and 2 then
    v_missing_fields := array_append(v_missing_fields, 'selected_module_offerings');
  end if;

  if cardinality(v_missing_fields) > 0 then
    raise exception 'Application cannot be submitted until required fields are complete: %', array_to_string(v_missing_fields, ', ');
  end if;

  if v_application.intended_start_term_id is not null and not exists (
    select 1
    from public.terms
    where terms.id = v_application.intended_start_term_id
      and terms.status in ('published', 'active')
      and terms.starts_on >= current_date
  ) then
    raise exception 'Intended start term must be a published or active future term';
  end if;

  if exists (
    select 1
    from public.application_module_offering_choices choice
    where choice.application_id = v_application.id
      and not exists (
        select 1
        from public.module_offerings offering
        join public.course_modules course_module on course_module.id = offering.module_id
        join public.terms term on term.id = offering.term_id
        where offering.id = choice.offering_id
          and offering.term_id = v_application.intended_start_term_id
          and course_module.active = true
          and term.status in ('published', 'active')
          and term.starts_on >= current_date
      )
  ) then
    raise exception 'Selected module offerings must be active offerings for the intended future start term';
  end if;

  update public.applications
  set
    status = 'submitted',
    submitted_at = now(),
    declaration_accepted_at = now(),
    declaration_version = v_declaration_version,
    declaration_text_hash = v_declaration_text_hash,
    declaration_actor_user_id = v_auth_user_id,
    declaration_person_id = v_person_id,
    declaration_ip_address = p_ip_address,
    declaration_user_agent = v_user_agent
  where id = v_application.id;

  update public.admission_leads
  set
    stage = 'submitted'
  where id = v_lead.id;

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
    'application.submitted',
    'application',
    v_application.id,
    jsonb_build_object(
      'admission_lead_id',
      v_lead.id,
      'programme',
      v_application.programme,
      'intended_start_term_id',
      v_application.intended_start_term_id,
      'selected_module_offering_count',
      v_selected_offering_count,
      'declaration_version',
      v_declaration_version,
      'declaration_text_hash',
      v_declaration_text_hash
    )
  );

  return v_application.id;
end;
$$;

revoke all on function public.submit_application(
  uuid,
  boolean,
  inet,
  text
) from public;

grant execute on function public.submit_application(
  uuid,
  boolean,
  inet,
  text
) to authenticated;
