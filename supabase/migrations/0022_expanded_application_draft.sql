alter table public.applications
  add column title text,
  add column first_name text,
  add column middle_names text,
  add column last_name text,
  add column preferred_name text,
  add column previous_surname text,
  add column date_of_birth date,
  add column previous_study_detail text,
  add column partner_student_id text,
  add column email text,
  add column phone text,
  add column address_line_1 text,
  add column address_line_2 text,
  add column city text,
  add column postcode text,
  add column country text,
  add column department_specialty text,
  add column professional_registration_body text,
  add column professional_registration_number text,
  add column qualification_result text,
  add column qualification_country text,
  add column intended_start_term_id uuid references public.terms(id) on delete restrict,
  add column nationality text,
  add column country_of_birth text,
  add column country_of_residence text,
  add column needs_visa_check boolean not null default false,
  add column visa_notes text,
  add column funding_source text not null default 'unknown'
    check (funding_source in ('self_funded', 'employer_sponsor', 'nhs_trust', 'other', 'unknown')),
  add column funding_organisation text,
  add column funding_contact text,
  add column pocus_previous_experience text,
  add column pocus_motivation text,
  add column pocus_case_improved_management text,
  add column pocus_limitations_case text,
  add column evidence_summary text;

create index applications_intended_start_term_idx
  on public.applications(intended_start_term_id);

create table public.application_module_offering_choices (
  application_id uuid not null references public.applications(id) on delete cascade,
  offering_id uuid not null references public.module_offerings(id) on delete restrict,
  choice_order smallint not null check (choice_order in (1, 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (application_id, offering_id),
  unique (application_id, choice_order)
);

alter table public.application_module_offering_choices enable row level security;

create index application_module_offering_choices_offering_idx
  on public.application_module_offering_choices(offering_id);

create trigger touch_application_module_offering_choices_updated_at
  before update on public.application_module_offering_choices
  for each row
  execute function public.touch_person_updated_at();

create policy "admins manage application offering choices"
  on public.application_module_offering_choices for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own application offering choices"
  on public.application_module_offering_choices for select
  using (
    exists (
      select 1
      from public.applications
      where applications.id = application_module_offering_choices.application_id
        and applications.person_id = public.current_person_id()
    )
  );

create table public.application_support_needs (
  application_id uuid primary key references public.applications(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete restrict,
  disclosed boolean not null default false,
  support_detail text,
  requested_adjustments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    disclosed = true
    or (support_detail is null and requested_adjustments is null)
  )
);

alter table public.application_support_needs enable row level security;

create index application_support_needs_person_idx
  on public.application_support_needs(person_id);

create trigger touch_application_support_needs_updated_at
  before update on public.application_support_needs
  for each row
  execute function public.touch_person_updated_at();

create policy "admins manage application support needs"
  on public.application_support_needs for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own application support needs"
  on public.application_support_needs for select
  using (
    person_id = public.current_person_id()
    and public.current_portal_actor_type() = 'applicant'
  );

create policy "portal users read future application terms"
  on public.terms for select
  using (
    public.current_person_id() is not null
    and status in ('published', 'active')
    and starts_on >= current_date
  );

create policy "portal users read selectable application offerings"
  on public.module_offerings for select
  using (
    public.current_person_id() is not null
    and exists (
      select 1
      from public.course_modules
      where course_modules.id = module_offerings.module_id
        and course_modules.active = true
    )
    and exists (
      select 1
      from public.terms
      where terms.id = module_offerings.term_id
        and terms.status in ('published', 'active')
        and terms.starts_on >= current_date
    )
  );

drop function public.save_application_draft(
  uuid,
  text,
  uuid[],
  text,
  text,
  text,
  text,
  text,
  integer,
  text,
  text
);

create or replace function public.save_application_draft(
  p_admission_lead_id uuid,
  p_programme text,
  p_intended_start_term_id uuid default null,
  p_selected_module_offering_ids uuid[] default '{}'::uuid[],
  p_title text default null,
  p_first_name text default null,
  p_middle_names text default null,
  p_last_name text default null,
  p_preferred_name text default null,
  p_previous_surname text default null,
  p_date_of_birth date default null,
  p_previous_study_detail text default null,
  p_partner_student_id text default null,
  p_email text default null,
  p_phone text default null,
  p_address_line_1 text default null,
  p_address_line_2 text default null,
  p_city text default null,
  p_postcode text default null,
  p_country text default null,
  p_clinical_role text default null,
  p_employer text default null,
  p_department_specialty text default null,
  p_professional_registration_body text default null,
  p_professional_registration_number text default null,
  p_highest_qualification text default null,
  p_qualification_awarding_body text default null,
  p_qualification_year integer default null,
  p_qualification_result text default null,
  p_qualification_country text default null,
  p_work_experience text default null,
  p_nationality text default null,
  p_country_of_birth text default null,
  p_country_of_residence text default null,
  p_needs_visa_check boolean default false,
  p_visa_notes text default null,
  p_funding_source text default 'unknown',
  p_funding_organisation text default null,
  p_funding_contact text default null,
  p_support_needs_disclosed boolean default false,
  p_support_needs_detail text default null,
  p_support_needs_adjustments text default null,
  p_pocus_previous_experience text default null,
  p_pocus_motivation text default null,
  p_pocus_case_improved_management text default null,
  p_pocus_limitations_case text default null,
  p_evidence_summary text default null
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
  v_lead public.admission_leads%rowtype;
  v_application public.applications%rowtype;
  v_application_id uuid;
  v_programme text := coalesce(nullif(trim(p_programme), ''), 'pgcert');
  v_selected_offering_ids uuid[] := coalesce(p_selected_module_offering_ids, '{}'::uuid[]);
  v_title text := nullif(left(trim(coalesce(p_title, '')), 40), '');
  v_first_name text := nullif(left(trim(coalesce(p_first_name, '')), 120), '');
  v_middle_names text := nullif(left(trim(coalesce(p_middle_names, '')), 160), '');
  v_last_name text := nullif(left(trim(coalesce(p_last_name, '')), 120), '');
  v_preferred_name text := nullif(left(trim(coalesce(p_preferred_name, '')), 120), '');
  v_previous_surname text := nullif(left(trim(coalesce(p_previous_surname, '')), 120), '');
  v_previous_study_detail text := nullif(left(trim(coalesce(p_previous_study_detail, '')), 500), '');
  v_partner_student_id text := nullif(left(trim(coalesce(p_partner_student_id, '')), 80), '');
  v_email text := nullif(left(lower(trim(coalesce(p_email, ''))), 254), '');
  v_phone text := nullif(left(trim(coalesce(p_phone, '')), 80), '');
  v_address_line_1 text := nullif(left(trim(coalesce(p_address_line_1, '')), 180), '');
  v_address_line_2 text := nullif(left(trim(coalesce(p_address_line_2, '')), 180), '');
  v_city text := nullif(left(trim(coalesce(p_city, '')), 120), '');
  v_postcode text := nullif(left(trim(coalesce(p_postcode, '')), 40), '');
  v_country text := nullif(left(trim(coalesce(p_country, '')), 120), '');
  v_clinical_role text := nullif(left(trim(coalesce(p_clinical_role, '')), 160), '');
  v_employer text := nullif(left(trim(coalesce(p_employer, '')), 160), '');
  v_department_specialty text := nullif(left(trim(coalesce(p_department_specialty, '')), 160), '');
  v_registration_body text := nullif(left(trim(coalesce(p_professional_registration_body, '')), 120), '');
  v_registration_number text := nullif(left(trim(coalesce(p_professional_registration_number, '')), 120), '');
  v_professional_registration text := nullif(left(trim(concat_ws(' ', v_registration_body, v_registration_number)), 160), '');
  v_highest_qualification text := nullif(left(trim(coalesce(p_highest_qualification, '')), 220), '');
  v_qualification_awarding_body text := nullif(left(trim(coalesce(p_qualification_awarding_body, '')), 220), '');
  v_qualification_result text := nullif(left(trim(coalesce(p_qualification_result, '')), 120), '');
  v_qualification_country text := nullif(left(trim(coalesce(p_qualification_country, '')), 120), '');
  v_work_experience text := nullif(left(trim(coalesce(p_work_experience, '')), 4000), '');
  v_nationality text := nullif(left(trim(coalesce(p_nationality, '')), 120), '');
  v_country_of_birth text := nullif(left(trim(coalesce(p_country_of_birth, '')), 120), '');
  v_country_of_residence text := nullif(left(trim(coalesce(p_country_of_residence, '')), 120), '');
  v_visa_notes text := nullif(left(trim(coalesce(p_visa_notes, '')), 1000), '');
  v_funding_source text := coalesce(nullif(trim(p_funding_source), ''), 'unknown');
  v_funding_organisation text := nullif(left(trim(coalesce(p_funding_organisation, '')), 180), '');
  v_funding_contact text := nullif(left(trim(coalesce(p_funding_contact, '')), 220), '');
  v_support_detail text := nullif(left(trim(coalesce(p_support_needs_detail, '')), 3000), '');
  v_support_adjustments text := nullif(left(trim(coalesce(p_support_needs_adjustments, '')), 2000), '');
  v_pocus_previous_experience text := nullif(left(trim(coalesce(p_pocus_previous_experience, '')), 4000), '');
  v_pocus_motivation text := nullif(left(trim(coalesce(p_pocus_motivation, '')), 4000), '');
  v_pocus_case_improved_management text := nullif(left(trim(coalesce(p_pocus_case_improved_management, '')), 4000), '');
  v_pocus_limitations_case text := nullif(left(trim(coalesce(p_pocus_limitations_case, '')), 4000), '');
  v_evidence_summary text := nullif(left(trim(coalesce(p_evidence_summary, '')), 2000), '');
begin
  if v_auth_user_id is null or v_person_id is null or v_actor_type <> 'applicant' then
    raise exception 'An authenticated applicant session is required';
  end if;

  if v_programme not in ('pgcert', 'microcredential') then
    raise exception 'Programme must be pgcert or microcredential';
  end if;

  if v_funding_source not in ('self_funded', 'employer_sponsor', 'nhs_trust', 'other', 'unknown') then
    raise exception 'Funding source is not valid';
  end if;

  if p_qualification_year is not null and (p_qualification_year < 1900 or p_qualification_year > 2100) then
    raise exception 'Qualification year is outside the accepted range';
  end if;

  if cardinality(v_selected_offering_ids) > 2 then
    raise exception 'Applicants may select one or two module offerings';
  end if;

  if (
    select count(distinct selected_offering.offering_id)
    from unnest(v_selected_offering_ids) as selected_offering(offering_id)
  ) <> cardinality(v_selected_offering_ids) then
    raise exception 'Duplicate module offerings cannot be selected';
  end if;

  if cardinality(v_selected_offering_ids) > 0 and p_intended_start_term_id is null then
    raise exception 'Choose programme and intended start term before selecting module offerings';
  end if;

  if p_intended_start_term_id is not null and not exists (
    select 1
    from public.terms
    where terms.id = p_intended_start_term_id
      and terms.status in ('published', 'active')
      and terms.starts_on >= current_date
  ) then
    raise exception 'Intended start term must be a published or active future term';
  end if;

  if exists (
    select 1
    from unnest(v_selected_offering_ids) as selected_offering(offering_id)
    where not exists (
      select 1
      from public.module_offerings offering
      join public.course_modules course_module on course_module.id = offering.module_id
      join public.terms term on term.id = offering.term_id
      where offering.id = selected_offering.offering_id
        and offering.term_id = p_intended_start_term_id
        and course_module.active = true
        and term.status in ('published', 'active')
        and term.starts_on >= current_date
    )
  ) then
    raise exception 'Selected module offerings must be active offerings for the intended future start term';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = p_admission_lead_id
    and person_id = v_person_id
  for update;

  if not found then
    raise exception 'Application invitation was not found for this applicant';
  end if;

  if v_lead.archived or v_lead.converted_student_id is not null then
    raise exception 'Archived or converted leads cannot be edited by applicants';
  end if;

  if v_lead.stage <> 'application_invited' then
    raise exception 'Application drafts can only be saved before submission';
  end if;

  select *
  into v_application
  from public.applications
  where admission_lead_id = p_admission_lead_id
  for update;

  if found and v_application.status <> 'draft' then
    raise exception 'Submitted applications cannot be changed through draft save';
  end if;

  if found then
    update public.applications
    set
      programme = v_programme,
      title = v_title,
      first_name = v_first_name,
      middle_names = v_middle_names,
      last_name = v_last_name,
      preferred_name = v_preferred_name,
      previous_surname = v_previous_surname,
      date_of_birth = p_date_of_birth,
      previous_study_detail = v_previous_study_detail,
      partner_student_id = v_partner_student_id,
      email = v_email,
      phone = v_phone,
      address_line_1 = v_address_line_1,
      address_line_2 = v_address_line_2,
      city = v_city,
      postcode = v_postcode,
      country = v_country,
      clinical_role = v_clinical_role,
      employer = v_employer,
      department_specialty = v_department_specialty,
      professional_registration = v_professional_registration,
      professional_registration_body = v_registration_body,
      professional_registration_number = v_registration_number,
      highest_qualification = v_highest_qualification,
      qualification_awarding_body = v_qualification_awarding_body,
      qualification_year = p_qualification_year,
      qualification_result = v_qualification_result,
      qualification_country = v_qualification_country,
      work_experience = v_work_experience,
      intended_start_term_id = p_intended_start_term_id,
      nationality = v_nationality,
      country_of_birth = v_country_of_birth,
      country_of_residence = v_country_of_residence,
      needs_visa_check = coalesce(p_needs_visa_check, false),
      visa_notes = v_visa_notes,
      funding_source = v_funding_source,
      funding_organisation = v_funding_organisation,
      funding_contact = v_funding_contact,
      pocus_previous_experience = v_pocus_previous_experience,
      pocus_motivation = v_pocus_motivation,
      pocus_case_improved_management = v_pocus_case_improved_management,
      pocus_limitations_case = v_pocus_limitations_case,
      evidence_summary = v_evidence_summary,
      last_saved_at = now()
    where id = v_application.id
    returning id into v_application_id;
  else
    insert into public.applications (
      admission_lead_id,
      person_id,
      programme,
      module_interest_ids,
      title,
      first_name,
      middle_names,
      last_name,
      preferred_name,
      previous_surname,
      date_of_birth,
      previous_study_detail,
      partner_student_id,
      email,
      phone,
      address_line_1,
      address_line_2,
      city,
      postcode,
      country,
      clinical_role,
      employer,
      department_specialty,
      professional_registration,
      professional_registration_body,
      professional_registration_number,
      highest_qualification,
      qualification_awarding_body,
      qualification_year,
      qualification_result,
      qualification_country,
      work_experience,
      intended_start_term_id,
      nationality,
      country_of_birth,
      country_of_residence,
      needs_visa_check,
      visa_notes,
      funding_source,
      funding_organisation,
      funding_contact,
      pocus_previous_experience,
      pocus_motivation,
      pocus_case_improved_management,
      pocus_limitations_case,
      evidence_summary
    )
    values (
      p_admission_lead_id,
      v_person_id,
      v_programme,
      coalesce(v_lead.module_interest_ids, '{}'::uuid[]),
      v_title,
      v_first_name,
      v_middle_names,
      v_last_name,
      v_preferred_name,
      v_previous_surname,
      p_date_of_birth,
      v_previous_study_detail,
      v_partner_student_id,
      v_email,
      v_phone,
      v_address_line_1,
      v_address_line_2,
      v_city,
      v_postcode,
      v_country,
      v_clinical_role,
      v_employer,
      v_department_specialty,
      v_professional_registration,
      v_registration_body,
      v_registration_number,
      v_highest_qualification,
      v_qualification_awarding_body,
      p_qualification_year,
      v_qualification_result,
      v_qualification_country,
      v_work_experience,
      p_intended_start_term_id,
      v_nationality,
      v_country_of_birth,
      v_country_of_residence,
      coalesce(p_needs_visa_check, false),
      v_visa_notes,
      v_funding_source,
      v_funding_organisation,
      v_funding_contact,
      v_pocus_previous_experience,
      v_pocus_motivation,
      v_pocus_case_improved_management,
      v_pocus_limitations_case,
      v_evidence_summary
    )
    returning id into v_application_id;
  end if;

  delete from public.application_module_offering_choices
  where application_id = v_application_id;

  insert into public.application_module_offering_choices (
    application_id,
    offering_id,
    choice_order
  )
  select
    v_application_id,
    selected_offering.offering_id,
    selected_offering.ordinality::smallint
  from unnest(v_selected_offering_ids) with ordinality as selected_offering(offering_id, ordinality);

  if p_support_needs_disclosed = true or v_support_detail is not null or v_support_adjustments is not null then
    insert into public.application_support_needs (
      application_id,
      person_id,
      disclosed,
      support_detail,
      requested_adjustments
    )
    values (
      v_application_id,
      v_person_id,
      true,
      v_support_detail,
      v_support_adjustments
    )
    on conflict (application_id) do update
    set
      person_id = excluded.person_id,
      disclosed = excluded.disclosed,
      support_detail = excluded.support_detail,
      requested_adjustments = excluded.requested_adjustments,
      updated_at = now();
  else
    delete from public.application_support_needs
    where application_id = v_application_id
      and person_id = v_person_id;
  end if;

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
    'application.draft_saved',
    'application',
    v_application_id,
    jsonb_build_object(
      'admission_lead_id',
      p_admission_lead_id,
      'programme',
      v_programme,
      'intended_start_term_id',
      p_intended_start_term_id,
      'selected_module_offering_count',
      cardinality(v_selected_offering_ids),
      'has_work_experience',
      v_work_experience is not null,
      'has_qualification',
      v_highest_qualification is not null,
      'support_needs_disclosed',
      coalesce(p_support_needs_disclosed, false),
      'has_support_needs_detail',
      v_support_detail is not null,
      'has_pocus_previous_experience',
      v_pocus_previous_experience is not null,
      'has_pocus_motivation',
      v_pocus_motivation is not null,
      'has_pocus_case_improved_management',
      v_pocus_case_improved_management is not null,
      'has_pocus_limitations_case',
      v_pocus_limitations_case is not null
    )
  );

  return v_application_id;
end;
$$;

revoke all on function public.save_application_draft(
  uuid,
  text,
  uuid,
  uuid[],
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public;

grant execute on function public.save_application_draft(
  uuid,
  text,
  uuid,
  uuid[],
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;
