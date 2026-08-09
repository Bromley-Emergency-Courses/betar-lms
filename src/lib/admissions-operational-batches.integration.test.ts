import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0038_operational_batches_email_pilot.sql"),
  "utf8"
);
const executorMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/0041_reviewed_new_student_batch_executor.sql"),
  "utf8"
);
const pilotControlsMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/0042_admissions_email_pilot_staff_controls.sql"),
  "utf8"
);

const adminId = "11111111-1111-4111-8111-111111111111";
const personOneId = "20000000-0000-4000-8000-000000000001";
const personTwoId = "20000000-0000-4000-8000-000000000002";
const personThreeId = "20000000-0000-4000-8000-000000000003";
const leadOneId = "30000000-0000-4000-8000-000000000001";
const leadTwoId = "30000000-0000-4000-8000-000000000002";
const leadThreeId = "30000000-0000-4000-8000-000000000003";
const studentId = "40000000-0000-4000-8000-000000000001";
const participantId = "40000000-0000-4000-8000-000000000002";
const templateId = "50000000-0000-4000-8000-000000000001";
const requestKey = "60000000-0000-4000-8000-000000000001";
const retryRequestKey = "60000000-0000-4000-8000-000000000002";
const returningRequestKey = "60000000-0000-4000-8000-000000000003";

const foundationSchema = `
create schema auth;
create role authenticated;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create type public.audit_actor_type as enum ('staff', 'applicant', 'student', 'service');
create type public.correspondence_channel as enum ('email', 'letter');
create type public.correspondence_delivery_status as enum ('queued', 'sent', 'delivered', 'failed', 'bounced', 'suppressed');

create table public.staff_profiles (
  id uuid primary key,
  active boolean not null default true
);

create function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.staff_profiles
    where id = auth.uid() and active
  );
$$;

create table public.persons (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text
);

create table public.students (
  id uuid primary key,
  person_id uuid references public.persons(id),
  temporary_id text not null unique,
  first_name text not null,
  last_name text not null,
  email text not null,
  status text not null,
  programme text not null
);

create table public.admission_leads (
  id uuid primary key,
  person_id uuid references public.persons(id),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  stage text not null default 'interest',
  programme text not null default 'pgcert',
  converted_student_id uuid references public.students(id),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  admission_lead_id uuid not null references public.admission_leads(id),
  status text not null default 'draft'
);

create table public.returning_student_cycle_participants (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  person_id uuid references public.persons(id)
);

create table public.correspondence_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  version integer not null,
  channel public.correspondence_channel not null,
  description text,
  subject_template text not null,
  body_template text,
  unique (template_key, channel, version)
);

create table public.correspondence_logs (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  recipient_email text not null,
  recipient_name text,
  related_entity_type text,
  related_entity_id uuid,
  template_id uuid references public.correspondence_templates(id),
  template_key text not null,
  template_version integer not null,
  channel public.correspondence_channel not null,
  rendered_subject text not null,
  provider_message_id text,
  delivery_status public.correspondence_delivery_status not null default 'queued',
  sent_at timestamptz,
  status_updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_type public.audit_actor_type not null,
  actor_user_id uuid,
  actor_person_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
`;

describe("admissions operational batches and email pilot database workflow", () => {
  it("preserves reviewed targets, retries failures only, and marks fake records without changing source data", async () => {
    const db = new PGlite();

    try {
      await db.exec(foundationSchema);
      await db.exec(migration);
      await db.exec(`select set_config('request.jwt.claim.sub', '${adminId}', false)`);
      await db.exec(`
        insert into public.staff_profiles (id) values ('${adminId}');
        insert into public.persons (id, first_name, last_name, email) values
          ('${personOneId}', 'Fake', 'Applicant', 'owner+applicant@example.org'),
          ('${personTwoId}', 'Failed', 'Applicant', 'owner+failed@example.org'),
          ('${personThreeId}', 'Excluded', 'Applicant', 'genuine@example.org');
        insert into public.admission_leads (id, person_id, first_name, last_name, email) values
          ('${leadOneId}', '${personOneId}', 'Fake', 'Applicant', 'owner+applicant@example.org'),
          ('${leadTwoId}', '${personTwoId}', 'Failed', 'Applicant', 'owner+failed@example.org'),
          ('${leadThreeId}', '${personThreeId}', 'Excluded', 'Applicant', 'genuine@example.org');
        insert into public.students (
          id, person_id, temporary_id, first_name, last_name, email, status, programme
        ) values (
          '${studentId}', '${personOneId}', 'TEST-001', 'Fake', 'Student',
          'owner+student@example.org', 'active', 'pgcert'
        );
        insert into public.returning_student_cycle_participants (id, student_id, person_id)
        values ('${participantId}', '${studentId}', '${personOneId}');
        insert into public.correspondence_templates (
          id, template_key, version, channel, subject_template, body_template
        ) values
          ('${templateId}', 'application_invitation', 1, 'email', 'Invitation', 'Body'),
          ('50000000-0000-4000-8000-000000000002', 'module_preference_window_opened', 1, 'email', 'Returning access', 'Body');
      `);

      const sourceBefore = await db.query<{ id: string; email: string; stage: string }>(`
        select id, email, stage from public.admission_leads order by id
      `);

      const fakeLeadMarker = await db.query<{ id: string }>(`
        select public.mark_fake_admission_lead_for_email_pilot(
          '${leadOneId}', 'Product owner applicant', 'End-to-end applicant pilot.'
        ) as id
      `);
      const fakeStudentMarker = await db.query<{ id: string }>(`
        select public.mark_fake_student_for_email_pilot(
          '${studentId}', 'Product owner student', 'End-to-end returning-student pilot.'
        ) as id
      `);

      const marked = await db.query<{ record_type: string; person_id: string; active: boolean }>(`
        select record_type::text, person_id, active
        from public.admissions_email_test_records
        order by record_type
      `);
      expect(marked.rows).toEqual([
        { record_type: "new_applicant", person_id: personOneId, active: true },
        { record_type: "returning_student", person_id: personOneId, active: true }
      ]);

      const targets = JSON.stringify([
        {
          entity_type: "admission_lead",
          entity_id: leadOneId,
          person_id: personOneId,
          recipient_email: "owner+applicant@example.org",
          recipient_name: "Fake Applicant",
          eligible: true,
          source_snapshot: { admission_lead_id: leadOneId, journey_stage: "enquiry" }
        },
        {
          entity_type: "admission_lead",
          entity_id: leadTwoId,
          person_id: personTwoId,
          recipient_email: "owner+failed@example.org",
          recipient_name: "Failed Applicant",
          eligible: true,
          source_snapshot: { admission_lead_id: leadTwoId, journey_stage: "enquiry" }
        },
        {
          entity_type: "admission_lead",
          entity_id: leadThreeId,
          person_id: personThreeId,
          recipient_email: "genuine@example.org",
          recipient_name: "Excluded Applicant",
          eligible: false,
          exclusion_reason: "This admissions record is no longer eligible for an invitation.",
          source_snapshot: { admission_lead_id: leadThreeId, journey_stage: "closed" }
        }
      ]).replaceAll("'", "''");

      const created = await db.query<{ id: string }>(`
        select public.create_admissions_operational_batch(
          '${requestKey}',
          'new_students',
          'invite_application',
          'all_matching',
          '${targets}'::jsonb,
          '{"journey_stage":"enquiry"}'::jsonb,
          'application_invitation',
          1,
          'Your BETAR application invitation',
          'Use the secure link to apply.'
        ) as id
      `);
      const batchId = created.rows[0]?.id;
      expect(batchId).toBeTruthy();

      const duplicate = await db.query<{ id: string }>(`
        select public.create_admissions_operational_batch(
          '${requestKey}', 'new_students', 'invite_application', 'all_matching',
          '${targets}'::jsonb, '{}'::jsonb,
          'application_invitation', 1, 'Ignored duplicate', 'Ignored duplicate'
        ) as id
      `);
      expect(duplicate.rows[0]?.id).toBe(batchId);

      const initialBatch = await db.query<{
        status: string;
        reviewed_count: number;
        queued_count: number;
        excluded_count: number;
      }>(`
        select status::text, reviewed_count, queued_count, excluded_count
        from public.admissions_operational_batches where id = '${batchId}'
      `);
      expect(initialBatch.rows[0]).toEqual({
        status: "queued",
        reviewed_count: 3,
        queued_count: 2,
        excluded_count: 1
      });

      const initialLogs = await db.query<{ count: number }>(`
        select count(*)::integer as count
        from public.correspondence_logs
        where operational_batch_id = '${batchId}'
      `);
      expect(initialLogs.rows[0]?.count).toBe(2);

      const claimed = await db.query<{ target_id: string; entity_id: string; correspondence_log_id: string }>(`
        select target_id, entity_id, correspondence_log_id
        from public.claim_admissions_operational_batch_targets('${batchId}', 10)
        order by entity_id
      `);
      expect(claimed.rows).toHaveLength(2);

      await db.exec(`
        select public.finish_admissions_operational_batch_target(
          '${claimed.rows[0].target_id}', 'succeeded', null
        );
        select public.finish_admissions_operational_batch_target(
          '${claimed.rows[1].target_id}', 'failed', 'Provider temporarily rejected the message.'
        );
      `);

      const completedBatch = await db.query<{
        status: string;
        succeeded_count: number;
        failed_count: number;
        excluded_count: number;
      }>(`
        select status::text, succeeded_count, failed_count, excluded_count
        from public.admissions_operational_batches where id = '${batchId}'
      `);
      expect(completedBatch.rows[0]).toEqual({
        status: "completed",
        succeeded_count: 1,
        failed_count: 1,
        excluded_count: 1
      });

      const retried = await db.query<{ id: string }>(`
        select public.retry_failed_admissions_operational_batch(
          '${batchId}', '${retryRequestKey}'
        ) as id
      `);
      const retryBatchId = retried.rows[0]?.id;
      const retryTargets = await db.query<{ entity_id: string; status: string }>(`
        select entity_id, status::text
        from public.admissions_operational_batch_targets
        where batch_id = '${retryBatchId}'
      `);
      expect(retryTargets.rows).toEqual([
        { entity_id: claimed.rows[1].entity_id, status: "queued" }
      ]);

      const retryLogs = await db.query<{ count: number }>(`
        select count(*)::integer as count
        from public.correspondence_logs
        where operational_batch_id = '${retryBatchId}'
      `);
      expect(retryLogs.rows[0]?.count).toBe(1);

      await db.exec(`
        select public.unmark_admissions_email_test_record(
          '${fakeLeadMarker.rows[0].id}', 'Applicant pilot is complete.'
        )
      `);
      const unmarked = await db.query<{ active: boolean; reason: string }>(`
        select active, unmark_reason as reason
        from public.admissions_email_test_records
        where id = '${fakeLeadMarker.rows[0].id}'
      `);
      expect(unmarked.rows[0]).toEqual({ active: false, reason: "Applicant pilot is complete." });
      expect(fakeStudentMarker.rows[0]?.id).toBeTruthy();

      const returningTargets = JSON.stringify([
        {
          entity_type: "returning_student_cycle_participant",
          entity_id: participantId,
          person_id: personOneId,
          recipient_email: "owner+student@example.org",
          recipient_name: "Fake Student",
          eligible: true,
          source_snapshot: { student_id: studentId, current_status: "active" }
        }
      ]).replaceAll("'", "''");
      const returningBatch = await db.query<{ id: string }>(`
        select public.create_admissions_operational_batch(
          '${returningRequestKey}',
          'returning_students',
          'contact_returning_student',
          'one',
          '${returningTargets}'::jsonb,
          '{}'::jsonb,
          'module_preference_window_opened',
          1,
          'Choose your next BETAR modules',
          'Use the secure link to respond.'
        ) as id
      `);
      const returningLog = await db.query<{ student_id: string; body: string }>(`
        select metadata->>'student_id' as student_id, rendered_body as body
        from public.correspondence_logs
        where operational_batch_id = '${returningBatch.rows[0].id}'
      `);
      expect(returningLog.rows[0]).toEqual({
        student_id: studentId,
        body: "Use the secure link to respond."
      });

      const sourceAfter = await db.query<{ id: string; email: string; stage: string }>(`
        select id, email, stage from public.admission_leads order by id
      `);
      expect(sourceAfter.rows).toEqual(sourceBefore.rows);

      await db.exec("set role authenticated");
      await expect(
        db.exec(`
          insert into public.admissions_operational_batches (
            request_key, workspace, action, scope, initiated_by_user_id, reviewed_count
          ) values (
            '60000000-0000-4000-8000-000000000099',
            'new_students', 'send_reminder', 'one', '${adminId}', 1
          )
        `)
      ).rejects.toThrow(/permission denied/i);
      await db.exec("reset role");
    } finally {
      await db.close();
    }
  });

  it("queues reviewed invitations for unlinked enquiries and recovers interrupted targets", async () => {
    const db = new PGlite();
    const unlinkedLeadId = "30000000-0000-4000-8000-000000000010";
    const invitationRequestKey = "60000000-0000-4000-8000-000000000010";
    const closeRequestKey = "60000000-0000-4000-8000-000000000011";

    try {
      await db.exec(foundationSchema);
      await db.exec(migration);
      await db.exec(executorMigration);
      await db.exec(pilotControlsMigration);
      await db.exec(`
        select set_config('request.jwt.claim.sub', '${adminId}', false);
        insert into public.staff_profiles (id) values ('${adminId}');
        insert into public.admission_leads (id, first_name, last_name, email)
        values ('${unlinkedLeadId}', 'Unlinked', 'Enquiry', 'unlinked@example.test');
        insert into public.correspondence_templates (
          id, template_key, version, channel, subject_template, body_template
        ) values ('${templateId}', 'application_invitation', 1, 'email', 'Invitation', 'Body');
      `);

      const pilotMarker = await db.query<{ id: string }>(`
        select public.mark_fake_admission_lead_for_email_pilot(
          '${unlinkedLeadId}', 'Unlinked enquiry pilot', 'Controlled applicant journey.'
        ) as id
      `);
      const markedLead = await db.query<{ person_id: string; stage: string; marker_active: boolean; link_audits: number }>(`
        select lead.person_id, lead.stage, marker.active as marker_active,
          (select count(*)::integer from public.audit_events
           where action = 'admission.person_linked_for_email_pilot' and entity_id = lead.id) as link_audits
        from public.admission_leads lead
        join public.admissions_email_test_records marker on marker.admission_lead_id = lead.id
        where lead.id = '${unlinkedLeadId}'
      `);
      expect(pilotMarker.rows[0]?.id).toBeTruthy();
      expect(markedLead.rows[0]).toMatchObject({ stage: "interest", marker_active: true, link_audits: 1 });
      expect(markedLead.rows[0]?.person_id).toBeTruthy();

      const targets = JSON.stringify([{
        entity_type: "admission_lead",
        entity_id: unlinkedLeadId,
        person_id: null,
        recipient_email: "unlinked@example.test",
        recipient_name: "Unlinked Enquiry",
        eligible: true,
        source_snapshot: { journey_stage: "enquiry", source_lead_stage: "interest" }
      }]).replaceAll("'", "''");
      const created = await db.query<{ id: string }>(`
        select public.create_new_student_invitation_operational_batch(
          '${invitationRequestKey}', 'one', '${targets}'::jsonb, '{}'::jsonb,
          'Your BETAR application invitation',
          'Continue securely: {{action_link}}'
        ) as id
      `);
      const batchId = created.rows[0]?.id;

      const queued = await db.query<{
        person_id: string;
        status: string;
        queued_count: number;
        correspondence_count: number;
      }>(`
        select lead.person_id, target.status::text, batch.queued_count,
          (select count(*)::integer from public.correspondence_logs where operational_batch_id = batch.id) as correspondence_count
        from public.admissions_operational_batches batch
        join public.admissions_operational_batch_targets target on target.batch_id = batch.id
        join public.admission_leads lead on lead.id = target.entity_id
        where batch.id = '${batchId}'
      `);
      expect(queued.rows[0]).toMatchObject({ status: "queued", queued_count: 1, correspondence_count: 0 });
      expect(queued.rows[0]?.person_id).toBeTruthy();

      const claimed = await db.query<{ target_id: string }>(`
        select target_id from public.claim_admissions_operational_batch_targets('${batchId}', 1)
      `);
      const targetId = claimed.rows[0]?.target_id;
      const correspondenceId = "50000000-0000-4000-8000-000000000010";
      await db.exec(`
        insert into public.correspondence_logs (
          id, person_id, recipient_email, recipient_name, related_entity_type, related_entity_id,
          template_id, template_key, template_version, channel, rendered_subject, delivery_status
        ) values (
          '${correspondenceId}', '${queued.rows[0]?.person_id}', 'unlinked@example.test', 'Unlinked Enquiry',
          'application_invitation', '70000000-0000-4000-8000-000000000010',
          '${templateId}', 'application_invitation', 1, 'email', 'Initial subject', 'queued'
        );
        select public.link_invitation_operational_batch_target(
          '${targetId}', '${correspondenceId}', '${queued.rows[0]?.person_id}',
          'unlinked@example.test', 'Unlinked Enquiry'
        );
      `);
      const linked = await db.query<{ body: string; operational_batch_target_id: string }>(`
        select rendered_body as body, operational_batch_target_id
        from public.correspondence_logs where id = '${correspondenceId}'
      `);
      expect(linked.rows[0]).toEqual({
        body: "Continue securely: {{action_link}}",
        operational_batch_target_id: targetId
      });

      await db.exec(`
        update public.admissions_operational_batch_targets
        set last_progress_at = now() - interval '10 minutes'
        where id = '${targetId}';
      `);
      const recovered = await db.query<{ count: number }>(`
        select public.requeue_stale_admissions_operational_batch_targets(
          '${batchId}', now() - interval '5 minutes'
        ) as count
      `);
      expect(recovered.rows[0]?.count).toBe(1);

      const closeTargets = JSON.stringify([{
        entity_type: "admission_lead",
        entity_id: unlinkedLeadId,
        person_id: queued.rows[0]?.person_id,
        eligible: true,
        source_snapshot: { journey_stage: "enquiry", source_lead_stage: "interest" }
      }]).replaceAll("'", "''");
      const closeBatch = await db.query<{ id: string }>(`
        select public.create_reasoned_admissions_operational_batch(
          '${closeRequestKey}', 'new_students', 'close_abandoned', 'one',
          '${closeTargets}'::jsonb, '{}'::jsonb, 'Applicant is not proceeding this intake.'
        ) as id
      `);
      const reason = await db.query<{ action_reason: string }>(`
        select action_reason from public.admissions_operational_batches where id = '${closeBatch.rows[0]?.id}'
      `);
      expect(reason.rows[0]?.action_reason).toBe("Applicant is not proceeding this intake.");

      const failedCloseTarget = await db.query<{ target_id: string }>(`
        select target_id from public.claim_admissions_operational_batch_targets('${closeBatch.rows[0]?.id}', 1)
      `);
      await db.exec(`
        select public.finish_admissions_operational_batch_target(
          '${failedCloseTarget.rows[0]?.target_id}', 'failed', 'Temporary executor failure.'
        )
      `);
      const retryBatch = await db.query<{ id: string }>(`
        select public.retry_failed_reviewed_admissions_operational_batch(
          '${closeBatch.rows[0]?.id}', '60000000-0000-4000-8000-000000000012'
        ) as id
      `);
      const retryReason = await db.query<{ action_reason: string; target_count: number }>(`
        select batch.action_reason,
          (select count(*)::integer from public.admissions_operational_batch_targets where batch_id = batch.id) as target_count
        from public.admissions_operational_batches batch where id = '${retryBatch.rows[0]?.id}'
      `);
      expect(retryReason.rows[0]).toEqual({
        action_reason: "Applicant is not proceeding this intake.",
        target_count: 1
      });

      await db.exec("select set_config('request.jwt.claim.sub', '', false)");
      await expect(db.exec(`
        select public.mark_fake_admission_lead_for_email_pilot(
          '${unlinkedLeadId}', 'Unauthorized marker', 'Must be rejected.'
        )
      `)).rejects.toThrow("Only admissions admins can mark fake pilot records");
      await expect(db.exec(`
        select public.create_new_student_invitation_operational_batch(
          '60000000-0000-4000-8000-000000000099', 'one', '${targets}'::jsonb, '{}'::jsonb,
          'Invitation', 'Continue: {{action_link}}'
        )
      `)).rejects.toThrow("Only admissions admins can create invitation batches");
    } finally {
      await db.close();
    }
  });

  it("durably enqueues the 500-record acceptance batch without expanding its scope", async () => {
    const db = new PGlite();
    const leads = Array.from({ length: 500 }, (_, index) => ({
      id: `80000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      email: `scale-${index + 1}@example.test`
    }));

    try {
      await db.exec(foundationSchema);
      await db.exec(migration);
      await db.exec(executorMigration);
      await db.exec(`
        select set_config('request.jwt.claim.sub', '${adminId}', false);
        insert into public.staff_profiles (id) values ('${adminId}');
        insert into public.admission_leads (id, first_name, last_name, email) values
        ${leads.map((lead, index) => `('${lead.id}', 'Scale', 'Applicant ${index + 1}', '${lead.email}')`).join(",\n")};
      `);

      const targets = JSON.stringify(leads.map((lead, index) => ({
        entity_type: "admission_lead",
        entity_id: lead.id,
        person_id: null,
        recipient_name: `Scale Applicant ${index + 1}`,
        eligible: true,
        source_snapshot: { journey_stage: "enquiry", source_lead_stage: "interest" }
      }))).replaceAll("'", "''");
      const startedAt = performance.now();
      const batch = await db.query<{ id: string }>(`
        select public.create_reasoned_admissions_operational_batch(
          '60000000-0000-4000-8000-000000000500', 'new_students', 'close_abandoned',
          'all_matching', '${targets}'::jsonb, '{"stage":"enquiry"}'::jsonb,
          'Applicant is not proceeding this intake.'
        ) as id
      `);

      const queued = await db.query<{ reviewed_count: number; queued_count: number; target_count: number }>(`
        select batch.reviewed_count, batch.queued_count,
          (select count(*)::integer from public.admissions_operational_batch_targets where batch_id = batch.id) as target_count
        from public.admissions_operational_batches batch where id = '${batch.rows[0]?.id}'
      `);
      expect(queued.rows[0]).toEqual({ reviewed_count: 500, queued_count: 500, target_count: 500 });
      expect(performance.now() - startedAt).toBeLessThan(2000);
    } finally {
      await db.close();
    }
  });
});
