alter table public.admissions_operational_batches
  add column if not exists action_reason text;

create or replace function public.create_new_student_invitation_operational_batch(
  p_request_key uuid,
  p_scope public.admissions_action_scope,
  p_targets jsonb,
  p_reviewed_filters jsonb,
  p_rendered_subject text,
  p_rendered_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_existing_batch_id uuid;
  v_batch_id uuid;
  v_template_id uuid;
  v_target jsonb;
  v_ordinal integer;
  v_target_id uuid;
  v_lead public.admission_leads%rowtype;
  v_person_id uuid;
  v_eligible boolean;
  v_exclusion_reason text;
  v_reviewed_count integer;
  v_queued_count integer := 0;
  v_excluded_count integer := 0;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can create invitation batches' using errcode = '42501';
  end if;

  select id into v_existing_batch_id
  from public.admissions_operational_batches
  where request_key = p_request_key;
  if v_existing_batch_id is not null then
    return v_existing_batch_id;
  end if;

  if p_targets is null or jsonb_typeof(p_targets) <> 'array' then
    raise exception 'Reviewed targets must be a JSON array';
  end if;
  v_reviewed_count := jsonb_array_length(p_targets);
  if v_reviewed_count < 1 or v_reviewed_count > 500 then
    raise exception 'Operational batches require between 1 and 500 reviewed targets';
  end if;
  if p_scope = 'one' and v_reviewed_count <> 1 then
    raise exception 'One-record scope requires exactly one reviewed target';
  end if;
  if nullif(trim(coalesce(p_rendered_subject, '')), '') is null
    or nullif(trim(coalesce(p_rendered_body, '')), '') is null then
    raise exception 'Invitation batches require reviewed subject and body snapshots';
  end if;
  if position('{{action_link}}' in p_rendered_body) = 0 then
    raise exception 'Invitation messages must include the secure action-link placeholder';
  end if;

  select id into v_template_id
  from public.correspondence_templates
  where template_key = 'application_invitation' and version = 1 and channel = 'email'
  limit 1;
  if v_template_id is null then
    raise exception 'The application invitation template was not found';
  end if;

  insert into public.admissions_operational_batches (
    request_key, workspace, action, scope, initiated_by_user_id, reviewed_filters,
    reviewed_count, correspondence_template_id, correspondence_template_key,
    correspondence_template_version, rendered_subject, rendered_body
  ) values (
    p_request_key, 'new_students', 'invite_application', p_scope, v_actor_user_id,
    coalesce(p_reviewed_filters, '{}'::jsonb), v_reviewed_count, v_template_id,
    'application_invitation', 1, trim(p_rendered_subject), p_rendered_body
  ) returning id into v_batch_id;

  for v_target, v_ordinal in
    select value, ordinality::integer
    from jsonb_array_elements(p_targets) with ordinality
  loop
    if v_target->>'entity_type' <> 'admission_lead'
      or nullif(v_target->>'entity_id', '') is null then
      raise exception 'Invitation targets must be admissions records';
    end if;

    v_eligible := coalesce((v_target->>'eligible')::boolean, false);
    v_exclusion_reason := nullif(left(trim(coalesce(v_target->>'exclusion_reason', '')), 2000), '');
    v_person_id := null;

    if v_eligible then
      select * into v_lead
      from public.admission_leads
      where id = (v_target->>'entity_id')::uuid
      for update;

      if not found
        or v_lead.archived
        or v_lead.converted_student_id is not null
        or v_lead.stage not in ('interest', 'application_invited') then
        v_eligible := false;
        v_exclusion_reason := 'The admissions record became ineligible before the invitation batch was queued.';
      elsif exists (
        select 1 from public.applications
        where admission_lead_id = v_lead.id and status = 'submitted'
      ) then
        v_eligible := false;
        v_exclusion_reason := 'The application was submitted before the invitation batch was queued.';
      else
        v_person_id := v_lead.person_id;
        if v_person_id is null then
          insert into public.persons (first_name, last_name, email, phone)
          values (v_lead.first_name, v_lead.last_name, lower(v_lead.email), v_lead.phone)
          returning id into v_person_id;

          update public.admission_leads
          set person_id = v_person_id, updated_at = now()
          where id = v_lead.id;

          insert into public.audit_events (
            actor_type, actor_user_id, actor_person_id, action, entity_type, entity_id, metadata
          ) values (
            'staff', v_actor_user_id, null, 'admission.person_linked_for_batch_invitation',
            'admission_lead', v_lead.id,
            jsonb_build_object('person_id', v_person_id, 'operational_batch_id', v_batch_id)
          );
        end if;
      end if;
    end if;

    if not v_eligible and v_exclusion_reason is null then
      raise exception 'Every excluded target requires a plain-language reason';
    end if;

    insert into public.admissions_operational_batch_targets (
      batch_id, ordinal, entity_type, entity_id, person_id, recipient_email,
      recipient_name, status, exclusion_reason, source_snapshot, completed_at
    ) values (
      v_batch_id, v_ordinal, 'admission_lead', (v_target->>'entity_id')::uuid,
      coalesce(v_person_id, nullif(v_target->>'person_id', '')::uuid),
      lower(nullif(trim(v_target->>'recipient_email'), '')),
      nullif(trim(v_target->>'recipient_name'), ''),
      case when v_eligible then 'queued'::public.admissions_operational_target_status else 'excluded'::public.admissions_operational_target_status end,
      case when v_eligible then null else v_exclusion_reason end,
      coalesce(v_target->'source_snapshot', '{}'::jsonb) || jsonb_build_object('person_id', coalesce(v_person_id, nullif(v_target->>'person_id', '')::uuid)),
      case when v_eligible then null else now() end
    ) returning id into v_target_id;

    if v_eligible then v_queued_count := v_queued_count + 1;
    else v_excluded_count := v_excluded_count + 1;
    end if;
  end loop;

  update public.admissions_operational_batches
  set queued_count = v_queued_count,
      excluded_count = v_excluded_count,
      status = case when v_queued_count = 0 then 'completed'::public.admissions_operational_batch_status else 'queued'::public.admissions_operational_batch_status end,
      completed_at = case when v_queued_count = 0 then now() else null end,
      last_progress_at = now()
  where id = v_batch_id;

  insert into public.audit_events (
    actor_type, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    'staff', v_actor_user_id, 'admissions_operational_batch.created',
    'admissions_operational_batch', v_batch_id,
    jsonb_build_object(
      'workspace', 'new_students', 'batch_action', 'invite_application',
      'scope', p_scope, 'reviewed_count', v_reviewed_count, 'request_key', p_request_key
    )
  );

  return v_batch_id;
end;
$$;

create or replace function public.create_reasoned_admissions_operational_batch(
  p_request_key uuid,
  p_workspace public.admissions_workspace,
  p_action public.admissions_operational_action,
  p_scope public.admissions_action_scope,
  p_targets jsonb,
  p_reviewed_filters jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 4000), '');
  v_batch_id uuid;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can create reasoned operational batches' using errcode = '42501';
  end if;
  if p_workspace <> 'new_students' or p_action <> 'close_abandoned' then
    raise exception 'This reviewed batch action is not implemented by the reasoned executor';
  end if;
  if v_reason is null then
    raise exception 'A batch action reason is required';
  end if;

  v_batch_id := public.create_admissions_operational_batch(
    p_request_key, p_workspace, p_action, p_scope, p_targets,
    coalesce(p_reviewed_filters, '{}'::jsonb), null, null, null, null
  );

  update public.admissions_operational_batches
  set action_reason = coalesce(action_reason, v_reason)
  where id = v_batch_id;

  return v_batch_id;
end;
$$;

create or replace function public.link_invitation_operational_batch_target(
  p_target_id uuid,
  p_correspondence_log_id uuid,
  p_person_id uuid,
  p_recipient_email text,
  p_recipient_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_target public.admissions_operational_batch_targets%rowtype;
  v_batch public.admissions_operational_batches%rowtype;
  v_invitation_log public.correspondence_logs%rowtype;
  v_existing_log_id uuid;
  v_linked_log_id uuid;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can link invitation batch correspondence' using errcode = '42501';
  end if;

  select * into v_target from public.admissions_operational_batch_targets where id = p_target_id for update;
  if not found or v_target.status <> 'running' then
    raise exception 'The invitation batch target is not running';
  end if;
  select * into v_batch from public.admissions_operational_batches where id = v_target.batch_id;
  if v_batch.action <> 'invite_application' or v_batch.workspace <> 'new_students' then
    raise exception 'The batch target is not an application invitation';
  end if;

  select * into v_invitation_log
  from public.correspondence_logs
  where id = p_correspondence_log_id and person_id = p_person_id and delivery_status = 'queued'
  for update;
  if not found then
    raise exception 'The queued invitation correspondence could not be linked';
  end if;

  select id into v_existing_log_id
  from public.correspondence_logs
  where operational_batch_target_id = v_target.id
  order by attempt_number desc, created_at desc
  limit 1
  for update;

  if v_existing_log_id is not null and v_existing_log_id <> p_correspondence_log_id then
    update public.correspondence_logs
    set person_id = p_person_id,
        recipient_email = lower(trim(p_recipient_email)),
        recipient_name = nullif(trim(p_recipient_name), ''),
        related_entity_type = v_invitation_log.related_entity_type,
        related_entity_id = v_invitation_log.related_entity_id,
        rendered_subject = v_batch.rendered_subject,
        rendered_body = v_batch.rendered_body,
        delivery_status = 'queued',
        metadata = v_invitation_log.metadata || metadata || jsonb_build_object(
          'operational_batch_id', v_batch.id,
          'operational_batch_target_id', v_target.id,
          'admission_lead_id', v_target.entity_id
        )
    where id = v_existing_log_id;

    update public.correspondence_logs
    set delivery_status = 'suppressed',
        metadata = metadata || jsonb_build_object(
          'delivery_status', 'suppressed',
          'email_suppression_reason', 'superseded_by_batch_retry_attempt',
          'superseded_by_correspondence_log_id', v_existing_log_id
        )
    where id = p_correspondence_log_id;
    v_linked_log_id := v_existing_log_id;
  else
    update public.correspondence_logs
    set operational_batch_id = v_batch.id,
        operational_batch_target_id = v_target.id,
        rendered_subject = v_batch.rendered_subject,
        rendered_body = v_batch.rendered_body,
        metadata = metadata || jsonb_build_object(
          'operational_batch_id', v_batch.id,
          'operational_batch_target_id', v_target.id,
          'admission_lead_id', v_target.entity_id
        )
    where id = p_correspondence_log_id;
    v_linked_log_id := p_correspondence_log_id;
  end if;

  update public.admissions_operational_batch_targets
  set person_id = p_person_id,
      recipient_email = lower(trim(p_recipient_email)),
      recipient_name = nullif(trim(p_recipient_name), ''),
      source_snapshot = source_snapshot || jsonb_build_object('person_id', p_person_id),
      last_progress_at = now()
  where id = p_target_id;

  return v_linked_log_id;
end;
$$;

create or replace function public.requeue_stale_admissions_operational_batch_targets(
  p_batch_id uuid,
  p_stale_before timestamptz default now() - interval '5 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_requeued integer;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can recover operational batches' using errcode = '42501';
  end if;

  update public.admissions_operational_batch_targets
  set status = 'queued', started_at = null, last_progress_at = now()
  where batch_id = p_batch_id and status = 'running' and last_progress_at < p_stale_before;
  get diagnostics v_requeued = row_count;

  if v_requeued > 0 then
    update public.admissions_operational_batches batch
    set status = 'queued',
        queued_count = counts.queued_count,
        running_count = counts.running_count,
        last_progress_at = now()
    from (
      select count(*) filter (where status = 'queued')::integer as queued_count,
             count(*) filter (where status = 'running')::integer as running_count
      from public.admissions_operational_batch_targets where batch_id = p_batch_id
    ) counts
    where batch.id = p_batch_id;
  end if;
  return v_requeued;
end;
$$;

create or replace function public.retry_failed_reviewed_admissions_operational_batch(
  p_batch_id uuid,
  p_request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_retry_batch_id uuid;
  v_original public.admissions_operational_batches%rowtype;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'Only admissions admins can retry reviewed operational batches' using errcode = '42501';
  end if;

  select * into v_original
  from public.admissions_operational_batches
  where id = p_batch_id;
  if not found
    or v_original.workspace <> 'new_students'
    or v_original.action not in ('invite_application', 'close_abandoned') then
    raise exception 'This batch action is not available in the current reviewed executor';
  end if;

  v_retry_batch_id := public.retry_failed_admissions_operational_batch(p_batch_id, p_request_key);
  update public.admissions_operational_batches retry
  set action_reason = original.action_reason
  from public.admissions_operational_batches original
  where retry.id = v_retry_batch_id and original.id = p_batch_id;
  return v_retry_batch_id;
end;
$$;

revoke all on function public.create_new_student_invitation_operational_batch(uuid, public.admissions_action_scope, jsonb, jsonb, text, text) from public;
revoke all on function public.create_reasoned_admissions_operational_batch(uuid, public.admissions_workspace, public.admissions_operational_action, public.admissions_action_scope, jsonb, jsonb, text) from public;
revoke all on function public.link_invitation_operational_batch_target(uuid, uuid, uuid, text, text) from public;
revoke all on function public.requeue_stale_admissions_operational_batch_targets(uuid, timestamptz) from public;
revoke all on function public.retry_failed_reviewed_admissions_operational_batch(uuid, uuid) from public;

grant execute on function public.create_new_student_invitation_operational_batch(uuid, public.admissions_action_scope, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.create_reasoned_admissions_operational_batch(uuid, public.admissions_workspace, public.admissions_operational_action, public.admissions_action_scope, jsonb, jsonb, text) to authenticated;
grant execute on function public.link_invitation_operational_batch_target(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.requeue_stale_admissions_operational_batch_targets(uuid, timestamptz) to authenticated;
grant execute on function public.retry_failed_reviewed_admissions_operational_batch(uuid, uuid) to authenticated;
