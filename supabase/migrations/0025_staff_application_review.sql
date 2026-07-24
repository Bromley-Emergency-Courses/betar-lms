create type public.application_review_readiness_status as enum (
  'not_ready',
  'needs_information',
  'ready_for_decision'
);

create table public.application_reviews (
  application_id uuid primary key references public.applications(id) on delete cascade,
  reviewed_by_user_id uuid references public.staff_profiles(id) on delete set null,
  readiness_status public.application_review_readiness_status not null default 'not_ready',
  review_notes text,
  decision_reason_notes text,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.application_reviews enable row level security;

create index application_reviews_readiness_idx
  on public.application_reviews(readiness_status, updated_at desc);

create index application_reviews_reviewed_by_idx
  on public.application_reviews(reviewed_by_user_id);

create trigger touch_application_reviews_updated_at
  before update on public.application_reviews
  for each row
  execute function public.touch_person_updated_at();

create policy "admins manage application reviews"
  on public.application_reviews for all
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.verify_application_document_slot(
  p_slot_id uuid,
  p_verification_status public.application_document_verification_status,
  p_verification_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_staff public.staff_profiles%rowtype;
  v_slot public.application_document_slots%rowtype;
  v_application public.applications%rowtype;
  v_lead public.admission_leads%rowtype;
  v_previous_status public.application_document_verification_status;
  v_note text := nullif(left(trim(coalesce(p_verification_note, '')), 2000), '');
  v_action text;
begin
  if v_actor_user_id is null then
    raise exception 'An authenticated staff session is required';
  end if;

  select *
  into v_staff
  from public.staff_profiles
  where id = v_actor_user_id
    and active = true;

  if not found or v_staff.role <> 'admin' then
    raise exception 'Only admissions admins can verify application documents';
  end if;

  select *
  into v_slot
  from public.application_document_slots
  where id = p_slot_id
  for update;

  if not found then
    raise exception 'Application document slot was not found';
  end if;

  if v_slot.managed_file_id is null then
    raise exception 'A document must be uploaded before verification';
  end if;

  select *
  into v_application
  from public.applications
  where id = v_slot.application_id
  for update;

  if not found or v_application.status <> 'submitted' then
    raise exception 'Documents can only be verified after application submission';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = v_application.admission_lead_id
  for update;

  if not found then
    raise exception 'Admission lead was not found for this application';
  end if;

  if v_lead.archived or v_lead.converted_student_id is not null then
    raise exception 'Archived or converted application documents cannot be verified';
  end if;

  if v_lead.stage not in ('submitted', 'reviewed') then
    raise exception 'Application documents cannot be verified from this admissions stage';
  end if;

  v_previous_status := v_slot.verification_status;

  update public.application_document_slots
  set
    verification_status = p_verification_status,
    verifier_user_id = v_actor_user_id,
    verification_at = now(),
    verification_note = v_note
  where id = v_slot.id;

  v_action := case p_verification_status
    when 'verified' then 'document.verified'
    when 'rejected' then 'document.rejected'
    else 'document.verification_reset'
  end;

  insert into public.audit_events (
    actor_type,
    actor_user_id,
    actor_person_id,
    action,
    entity_type,
    entity_id,
    reason,
    metadata
  )
  values (
    'staff',
    v_actor_user_id,
    null,
    v_action,
    'application_document',
    v_slot.id,
    v_note,
    jsonb_build_object(
      'application_id',
      v_application.id,
      'admission_lead_id',
      v_application.admission_lead_id,
      'person_id',
      v_application.person_id,
      'slot_key',
      v_slot.slot_key,
      'required',
      v_slot.required,
      'previous_status',
      v_previous_status,
      'verification_status',
      p_verification_status,
      'managed_file_id',
      v_slot.managed_file_id,
      'has_note',
      v_note is not null
    )
  );

  return v_slot.id;
end;
$$;

revoke all on function public.verify_application_document_slot(
  uuid,
  public.application_document_verification_status,
  text
) from public;

grant execute on function public.verify_application_document_slot(
  uuid,
  public.application_document_verification_status,
  text
) to authenticated;

create or replace function public.record_staff_application_review(
  p_application_id uuid,
  p_readiness_status public.application_review_readiness_status,
  p_review_notes text default null,
  p_decision_reason_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_staff public.staff_profiles%rowtype;
  v_application public.applications%rowtype;
  v_lead public.admission_leads%rowtype;
  v_review_notes text := nullif(left(trim(coalesce(p_review_notes, '')), 6000), '');
  v_decision_reason_notes text := nullif(left(trim(coalesce(p_decision_reason_notes, '')), 4000), '');
  v_previous_readiness public.application_review_readiness_status;
  v_verified_required_documents integer;
  v_required_documents integer;
begin
  if v_actor_user_id is null then
    raise exception 'An authenticated staff session is required';
  end if;

  select *
  into v_staff
  from public.staff_profiles
  where id = v_actor_user_id
    and active = true;

  if not found or v_staff.role <> 'admin' then
    raise exception 'Only admissions admins can record application reviews';
  end if;

  select *
  into v_application
  from public.applications
  where id = p_application_id
  for update;

  if not found or v_application.status <> 'submitted' then
    raise exception 'Only submitted applications can be reviewed';
  end if;

  select *
  into v_lead
  from public.admission_leads
  where id = v_application.admission_lead_id
  for update;

  if not found then
    raise exception 'Admission lead was not found for this application';
  end if;

  if v_lead.archived or v_lead.converted_student_id is not null then
    raise exception 'Archived or converted applications cannot be reviewed';
  end if;

  if v_lead.stage not in ('submitted', 'reviewed') then
    raise exception 'Application cannot be reviewed from this admissions stage';
  end if;

  select readiness_status
  into v_previous_readiness
  from public.application_reviews
  where application_id = v_application.id
  for update;

  select
    count(*) filter (where required = true),
    count(*) filter (where required = true and verification_status = 'verified')
  into v_required_documents, v_verified_required_documents
  from public.application_document_slots
  where application_id = v_application.id;

  insert into public.application_reviews (
    application_id,
    reviewed_by_user_id,
    readiness_status,
    review_notes,
    decision_reason_notes,
    last_reviewed_at
  )
  values (
    v_application.id,
    v_actor_user_id,
    p_readiness_status,
    v_review_notes,
    v_decision_reason_notes,
    now()
  )
  on conflict (application_id)
  do update set
    reviewed_by_user_id = excluded.reviewed_by_user_id,
    readiness_status = excluded.readiness_status,
    review_notes = excluded.review_notes,
    decision_reason_notes = excluded.decision_reason_notes,
    last_reviewed_at = excluded.last_reviewed_at;

  if p_readiness_status = 'ready_for_decision' and v_lead.stage = 'submitted' then
    update public.admission_leads
    set stage = 'reviewed'
    where id = v_lead.id;
  end if;

  insert into public.audit_events (
    actor_type,
    actor_user_id,
    actor_person_id,
    action,
    entity_type,
    entity_id,
    reason,
    metadata
  )
  values (
    'staff',
    v_actor_user_id,
    null,
    'application.review_recorded',
    'application',
    v_application.id,
    v_review_notes,
    jsonb_build_object(
      'admission_lead_id',
      v_application.admission_lead_id,
      'person_id',
      v_application.person_id,
      'previous_readiness_status',
      v_previous_readiness,
      'readiness_status',
      p_readiness_status,
      'has_review_notes',
      v_review_notes is not null,
      'has_decision_reason_notes',
      v_decision_reason_notes is not null,
      'required_document_count',
      coalesce(v_required_documents, 0),
      'verified_required_document_count',
      coalesce(v_verified_required_documents, 0),
      'lead_stage_after_review',
      case
        when p_readiness_status = 'ready_for_decision' and v_lead.stage = 'submitted' then 'reviewed'
        else v_lead.stage::text
      end
    )
  );

  return v_application.id;
end;
$$;

revoke all on function public.record_staff_application_review(
  uuid,
  public.application_review_readiness_status,
  text,
  text
) from public;

grant execute on function public.record_staff_application_review(
  uuid,
  public.application_review_readiness_status,
  text,
  text
) to authenticated;
