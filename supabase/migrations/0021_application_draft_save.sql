create type public.application_status as enum (
  'draft',
  'submitted'
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  admission_lead_id uuid not null references public.admission_leads(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete restrict,
  status public.application_status not null default 'draft',
  programme text not null default 'pgcert' check (programme in ('pgcert', 'microcredential')),
  module_interest_ids uuid[] not null default '{}',
  clinical_role text,
  employer text,
  professional_registration text,
  highest_qualification text,
  qualification_awarding_body text,
  qualification_year integer check (qualification_year is null or qualification_year between 1900 and 2100),
  work_experience text,
  personal_statement text,
  submitted_at timestamptz,
  last_saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (admission_lead_id),
  check (
    (status = 'submitted' and submitted_at is not null)
    or (status = 'draft' and submitted_at is null)
  )
);

alter table public.applications enable row level security;

create index applications_person_status_idx
  on public.applications(person_id, status, updated_at desc);

create index applications_admission_lead_idx
  on public.applications(admission_lead_id);

create trigger touch_applications_updated_at
  before update on public.applications
  for each row
  execute function public.touch_person_updated_at();

create policy "admins manage applications"
  on public.applications for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own applications"
  on public.applications for select
  using (person_id = public.current_person_id());

create policy "portal users read active modules for applications"
  on public.course_modules for select
  using (active = true and public.current_person_id() is not null);

create or replace function public.save_application_draft(
  p_admission_lead_id uuid,
  p_programme text,
  p_module_interest_ids uuid[] default '{}'::uuid[],
  p_clinical_role text default null,
  p_employer text default null,
  p_professional_registration text default null,
  p_highest_qualification text default null,
  p_qualification_awarding_body text default null,
  p_qualification_year integer default null,
  p_work_experience text default null,
  p_personal_statement text default null
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
  v_module_interest_ids uuid[] := coalesce(p_module_interest_ids, '{}'::uuid[]);
  v_clinical_role text := nullif(left(trim(coalesce(p_clinical_role, '')), 160), '');
  v_employer text := nullif(left(trim(coalesce(p_employer, '')), 160), '');
  v_professional_registration text := nullif(left(trim(coalesce(p_professional_registration, '')), 160), '');
  v_highest_qualification text := nullif(left(trim(coalesce(p_highest_qualification, '')), 220), '');
  v_qualification_awarding_body text := nullif(left(trim(coalesce(p_qualification_awarding_body, '')), 220), '');
  v_work_experience text := nullif(left(trim(coalesce(p_work_experience, '')), 4000), '');
  v_personal_statement text := nullif(left(trim(coalesce(p_personal_statement, '')), 4000), '');
begin
  if v_auth_user_id is null or v_person_id is null or v_actor_type <> 'applicant' then
    raise exception 'An authenticated applicant session is required';
  end if;

  if v_programme not in ('pgcert', 'microcredential') then
    raise exception 'Programme must be pgcert or microcredential';
  end if;

  if cardinality(v_module_interest_ids) > 20 then
    raise exception 'Too many module interests supplied';
  end if;

  if exists (
    select 1
    from unnest(v_module_interest_ids) as selected_module(module_id)
    where not exists (
      select 1
      from public.course_modules
      where course_modules.id = selected_module.module_id
        and course_modules.active = true
    )
  ) then
    raise exception 'Module interests must be active course modules';
  end if;

  if p_qualification_year is not null and (p_qualification_year < 1900 or p_qualification_year > 2100) then
    raise exception 'Qualification year is outside the accepted range';
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
      module_interest_ids = v_module_interest_ids,
      clinical_role = v_clinical_role,
      employer = v_employer,
      professional_registration = v_professional_registration,
      highest_qualification = v_highest_qualification,
      qualification_awarding_body = v_qualification_awarding_body,
      qualification_year = p_qualification_year,
      work_experience = v_work_experience,
      personal_statement = v_personal_statement,
      last_saved_at = now()
    where id = v_application.id
    returning id into v_application_id;
  else
    insert into public.applications (
      admission_lead_id,
      person_id,
      programme,
      module_interest_ids,
      clinical_role,
      employer,
      professional_registration,
      highest_qualification,
      qualification_awarding_body,
      qualification_year,
      work_experience,
      personal_statement
    )
    values (
      p_admission_lead_id,
      v_person_id,
      v_programme,
      v_module_interest_ids,
      v_clinical_role,
      v_employer,
      v_professional_registration,
      v_highest_qualification,
      v_qualification_awarding_body,
      p_qualification_year,
      v_work_experience,
      v_personal_statement
    )
    returning id into v_application_id;
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
      'module_interest_count',
      cardinality(v_module_interest_ids),
      'has_work_experience',
      v_work_experience is not null,
      'has_qualification',
      v_highest_qualification is not null,
      'has_statement',
      v_personal_statement is not null
    )
  );

  return v_application_id;
end;
$$;

revoke all on function public.save_application_draft(
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
) from public;

grant execute on function public.save_application_draft(
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
) to authenticated;
