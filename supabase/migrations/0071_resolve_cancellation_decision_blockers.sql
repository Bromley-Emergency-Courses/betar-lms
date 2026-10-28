create or replace function public.student_enrolment_cancellation_reasons(enrolment_key uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare reasons text[]; enrolment_row public.enrolments;
begin
  select * into strict enrolment_row from public.enrolments where id = enrolment_key;
  if public.enrolment_is_cancelled(enrolment_key) then return array['This enrolment is already cancelled as added in error.']; end if;
  reasons := array_remove(array_remove(public.student_enrolment_removal_reasons(enrolment_key),
    'Calculated assessment history is retained, even when no exam score has been entered.'),
    'Module participation decisions must be retained.');
  if exists(select 1 from public.finance_records record join public.module_offerings offering on offering.term_id = record.term_id
    where record.student_id = enrolment_row.student_id and offering.id = enrolment_row.offering_id) then
    reasons := array_append(reasons, 'Finance records exist in this teaching term. Separate review is required; no invoices or payments will be changed.');
  end if;
  if exists(select 1 from public.audit_events event where event.action = 'teaching.record_created'
    and event.metadata->>'student_id' = enrolment_row.student_id::text
    and event.metadata->'record'->>'offering_id' = enrolment_row.offering_id::text)
    or exists(select 1 from public.audit_events event join public.module_offerings offering on offering.id = enrolment_row.offering_id
      where event.action in ('create_student_finance','update_student_finance') and (
        (event.metadata->'before'->>'student_id' = enrolment_row.student_id::text and event.metadata->'before'->>'term_id' = offering.term_id::text)
        or (event.metadata->'after'->>'student_id' = enrolment_row.student_id::text and event.metadata->'after'->>'term_id' = offering.term_id::text)))
    or exists(select 1 from public.attendance_workspace_versions version join public.attendance_sessions session on session.id = version.session_id
      join public.module_offerings offering on offering.term_id = session.term_id
      where version.student_id = enrolment_row.student_id and version.revision > 0 and offering.id = enrolment_row.offering_id) then
    reasons := array_append(reasons, 'Historical teaching, attendance or finance evidence requires separate review, even if its current record has been cleared.');
  end if;

  reasons := array_remove(reasons, 'Exceptional decisions must be retained.');
  if exists(select 1 from public.assessment_current_overrides where enrolment_id = enrolment_key and value is not null) then
    reasons := array_append(reasons, 'Active exceptional decisions block cancellation. Review each decision and use Restore automatic calculation before retrying.');
  end if;
  if not exists(select 1 from public.enrolment_evidence_retention where enrolment_id = enrolment_key
    and source_table <> 'enrolment_assessment_overrides') then
    reasons := array_remove(reasons, 'Recorded evidence must be reviewed, even after its original record has been corrected or removed.');
  end if;
  if exists(select 1 from public.enrolment_assessment_history where enrolment_id = enrolment_key
    and coalesce((projection->>'awarded_credits')::numeric, 0) > 0)
    or exists(select 1 from public.enrolment_assessment_overrides where enrolment_id = enrolment_key
      and case when kind = 'credits' and jsonb_typeof(value) = 'number' then (value #>> '{}')::numeric > 0 else false end) then
    reasons := array_append(reasons, 'Credits have previously been awarded. Clearing an override does not remove that history; separate review is required.');
  end if;
  return reasons;
end;
$$;
