create table public.enrolment_evidence_retention (
  enrolment_id uuid not null references public.enrolments(id),
  source_table text not null,
  first_observed_at timestamptz not null default now(),
  primary key(enrolment_id, source_table)
);
alter table public.enrolment_evidence_retention enable row level security;
revoke all on public.enrolment_evidence_retention from public, anon, authenticated, service_role;
create trigger enrolment_evidence_retention_immutable before update or delete on public.enrolment_evidence_retention
  for each row execute function public.assessment_immutable();

create function public.retain_enrolment_evidence(source_table text, row_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare student_key uuid := (row_data->>'student_id')::uuid; offering_key uuid := (row_data->>'offering_id')::uuid;
  term_key uuid := (row_data->>'term_id')::uuid; enrolment_key uuid := (row_data->>'enrolment_id')::uuid;
begin
  if row_data ? 'session_id' then
    select offering_id, term_id into offering_key, term_key from public.attendance_sessions where id = (row_data->>'session_id')::uuid;
  end if;
  insert into public.enrolment_evidence_retention(enrolment_id, source_table)
    select enrolment.id, source_table from public.active_module_enrolments enrolment
    join public.module_offerings offering on offering.id = enrolment.offering_id
    where enrolment.id = enrolment_key or (enrolment.student_id = student_key
      and (enrolment.offering_id = offering_key or offering.term_id = term_key))
    on conflict do nothing;
end;
$$;
create function public.retain_enrolment_evidence_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.retain_enrolment_evidence(tg_table_name, to_jsonb(new));
  return null;
end;
$$;
do $$
declare table_name text;
begin
  foreach table_name in array array['module_assessment_attempts','module_assessment_arrangements','enrolment_assessment_overrides',
    'exam_results','encounter_logs','assessment_attempts','presentation_scores','attendance_records','expected_attendance','finance_records'] loop
    execute format('select public.retain_enrolment_evidence(%L, to_jsonb(evidence)) from public.%I evidence', table_name, table_name);
    execute format('create trigger retain_enrolment_evidence after insert or update on public.%I for each row execute function public.retain_enrolment_evidence_trigger()', table_name);
  end loop;
end;
$$;
revoke all on function public.retain_enrolment_evidence(text,jsonb), public.retain_enrolment_evidence_trigger() from public, anon, authenticated, service_role;

create or replace function public.student_enrolment_removal_reasons(enrolment_key uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare enrolment_row public.enrolments; reasons text[] := '{}'; reference_row record; referenced boolean;
begin
  select * into strict enrolment_row from public.enrolments where id = enrolment_key;
  for reference_row in
    select relation.relname, attribute.attname from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_attribute attribute on attribute.attrelid = relation.oid and attribute.attnum = constraint_row.conkey[1]
    where constraint_row.contype = 'f' and constraint_row.confrelid = 'public.enrolments'::regclass and namespace.nspname = 'public'
  loop
    execute format('select exists(select 1 from public.%I where %I = $1)', reference_row.relname, reference_row.attname) into referenced using enrolment_key;
    if referenced then reasons := array_append(reasons, case reference_row.relname
      when 'enrolment_evidence_retention' then 'Recorded evidence must be reviewed, even after its original record has been corrected or removed.'
      when 'enrolment_assessment_history' then 'Calculated assessment history is retained, even when no exam score has been entered.'
      when 'module_assessment_attempts' then 'Assessment attempts and their complete history must be retained.'
      when 'module_assessment_arrangements' then 'Assessment arrangements must be retained.'
      when 'enrolment_disposition_events' then 'Module participation decisions must be retained.'
      when 'enrolment_assessment_overrides' then 'Exceptional decisions must be retained.'
      else 'Linked assessment records must be retained.' end); end if;
  end loop;
  if exists(select 1 from public.exam_results where student_id = enrolment_row.student_id and offering_id = enrolment_row.offering_id)
    or exists(select 1 from public.encounter_logs where student_id = enrolment_row.student_id and offering_id = enrolment_row.offering_id)
    or exists(select 1 from public.assessment_attempts where student_id = enrolment_row.student_id and offering_id = enrolment_row.offering_id)
    or exists(select 1 from public.presentation_scores where student_id = enrolment_row.student_id and offering_id = enrolment_row.offering_id) then
    reasons := array_append(reasons, 'Exam or teaching evidence is associated with this student and offering.');
  end if;
  if exists(select 1 from public.attendance_records record join public.attendance_sessions session on session.id = record.session_id
    join public.module_offerings offering on offering.term_id = session.term_id where record.student_id = enrolment_row.student_id and offering.id = enrolment_row.offering_id)
    or exists(select 1 from public.expected_attendance record join public.attendance_sessions session on session.id = record.session_id
    join public.module_offerings offering on offering.term_id = session.term_id where record.student_id = enrolment_row.student_id and offering.id = enrolment_row.offering_id) then
    reasons := array_append(reasons, 'Attendance or expected-list evidence exists in this teaching term.');
  end if;
  if enrolment_row.status::text <> 'planned' or enrolment_row.credits_awarded <> 0 or enrolment_row.final_mark is not null or enrolment_row.grade is not null then
    reasons := array_append(reasons, 'Recorded legacy participation or outcome evidence must be retained.');
  end if;
  return reasons;
end;
$$;

create or replace function public.set_assessment_rollout(requested_mode text, evidence jsonb, change_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare actor uuid := public.assessment_require_admin(); gate text;
begin
  perform 1 from public.assessment_rollout for update;
  if requested_mode not in ('shadow','live') or length(trim(coalesce(change_reason,''))) = 0 then raise exception 'Valid rollout mode and reason required'; end if;
  if requested_mode = 'live' then
    foreach gate in array array['reconciliation_review','sanitized_rehearsal','pilot_signoff','backup_restore','module_plans_review'] loop
      if length(trim(coalesce(evidence->>gate,''))) = 0 then raise exception 'Missing rollout sign-off: %',gate; end if;
    end loop;
    if exists(select 1 from public.course_modules where active and assessment_plan_id is null)
      or exists(select 1 from public.active_module_enrolments where assessment_plan_id is null) then raise exception 'Every module and enrolment needs a reviewed assessment plan'; end if;
  end if;
  update public.assessment_rollout set mode = requested_mode, signoff_reference = evidence::text;
  insert into public.audit_events(actor_user_id,action,entity_type,reason,metadata)
  values(actor,'assessment.rollout_changed','assessment_rollout',change_reason,jsonb_build_object('mode',requested_mode,'evidence',evidence));
end;
$$;
