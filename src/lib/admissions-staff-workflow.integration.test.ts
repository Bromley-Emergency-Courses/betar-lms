import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0035_staff_new_student_workflow_foundation.sql"),
  "utf8"
);
const terminalActionsMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/0040_new_student_terminal_offer_actions.sql"),
  "utf8"
);

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

create function public.is_admin()
returns boolean
language sql
stable
as $$
  select auth.uid() is not null;
$$;

create table public.staff_profiles (
  id uuid primary key,
  active boolean not null default true
);

create type public.admission_lead_stage as enum (
  'interest',
  'application_invited',
  'submitted',
  'reviewed',
  'offered',
  'rejected',
  'accepted',
  'registration_in_progress',
  'registration_lapsed',
  'registered',
  'offer_declined',
  'offer_lapsed',
  'archived'
);
create type public.application_status as enum ('draft', 'submitted');
create type public.application_review_readiness_status as enum ('not_ready', 'needs_information', 'ready_for_decision');
create type public.application_decision_outcome as enum ('offer', 'rejection');
create type public.application_offer_status as enum ('issued', 'withdrawn', 'accepted', 'declined', 'lapsed');
create type public.admissions_registration_status as enum ('not_started', 'in_progress', 'submitted', 'complete', 'lapsed');

create table public.persons (
  id uuid primary key,
  first_name text not null,
  last_name text not null,
  email text not null
);

create table public.students (
  id uuid primary key
);

create table public.course_modules (
  id uuid primary key,
  active boolean not null default true
);

create table public.admission_leads (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.persons(id),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  stage public.admission_lead_stage not null default 'interest',
  programme text not null default 'pgcert',
  module_interest_ids uuid[] not null default '{}',
  source text,
  last_contacted_on date,
  next_action_on date,
  application_invited_at timestamptz,
  converted_student_id uuid references public.students(id),
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.applications (
  id uuid primary key,
  admission_lead_id uuid not null references public.admission_leads(id),
  person_id uuid not null references public.persons(id),
  first_name text not null default '',
  last_name text not null default '',
  email text not null default '',
  status public.application_status not null,
  intended_start_term_id uuid,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.application_reviews (
  application_id uuid primary key references public.applications(id),
  readiness_status public.application_review_readiness_status not null,
  updated_at timestamptz not null default now()
);

create table public.application_decisions (
  id uuid primary key,
  application_id uuid not null references public.applications(id),
  outcome public.application_decision_outcome not null,
  decided_at timestamptz not null default now()
);

create table public.application_rejections (
  id uuid primary key,
  decision_id uuid not null references public.application_decisions(id)
);

create table public.application_offers (
  id uuid primary key,
  decision_id uuid not null references public.application_decisions(id),
  application_id uuid not null references public.applications(id),
  status public.application_offer_status not null,
  intended_start_term_id uuid,
  deadline_at timestamptz,
  converted_student_id uuid references public.students(id),
  offer_reference text not null default 'BETAR-TEST',
  accepted_at timestamptz,
  declined_at timestamptz,
  lapsed_at timestamptz,
  deadline_reminder_count integer not null default 0,
  issued_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admissions_registrations (
  id uuid primary key,
  application_id uuid not null references public.applications(id),
  status public.admissions_registration_status not null,
  intended_start_term_id uuid,
  registration_deadline_at timestamptz,
  student_id uuid references public.students(id),
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_type text not null,
  actor_user_id uuid,
  actor_person_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  reason text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create type public.correspondence_channel as enum ('email', 'letter');
create type public.correspondence_delivery_status as enum ('queued', 'sent', 'delivered', 'failed', 'bounced', 'suppressed');

create table public.correspondence_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  version integer not null,
  channel public.correspondence_channel not null default 'email',
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
  channel public.correspondence_channel not null default 'email',
  rendered_subject text not null,
  rendered_body text,
  delivery_status public.correspondence_delivery_status not null default 'queued',
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz not null default now()
);
`;

describe("staff new-student workflow database projection", () => {
  it("derives coherent stages, flags fabricated states, and guards staff administration", async () => {
    const db = new PGlite();

    try {
      await db.exec(foundationSchema);
      await db.exec(migration);
      await db.exec("select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false)");

      const created = await db.query<{ record_staff_admission_enquiry: string }>(`
        select public.record_staff_admission_enquiry(
          'Asha',
          'Applicant',
          'asha@example.test',
          null,
          'pgcert',
          '{}'::uuid[],
          'staff_email',
          null,
          null,
          'Initial enquiry'
        )
      `);
      const enquiryLeadId = created.rows[0]?.record_staff_admission_enquiry;

      expect(enquiryLeadId).toBeTruthy();

      await db.query(
        `insert into public.admission_leads (id, first_name, last_name, email, stage)
         values ($1, 'Fabricated', 'Offer', 'fabricated@example.test', 'offered')`,
        ["22222222-2222-4222-8222-222222222222"]
      );

      await db.exec(`
        insert into public.persons (id, first_name, last_name, email)
        values ('33333333-3333-4333-8333-333333333333', 'Complete', 'Applicant', 'complete@example.test');

        insert into public.students (id)
        values ('44444444-4444-4444-8444-444444444444');

        insert into public.admission_leads (
          id,
          person_id,
          first_name,
          last_name,
          email,
          stage,
          converted_student_id
        )
        values (
          '55555555-5555-4555-8555-555555555555',
          '33333333-3333-4333-8333-333333333333',
          'Complete',
          'Applicant',
          'complete@example.test',
          'submitted',
          '44444444-4444-4444-8444-444444444444'
        );

        insert into public.applications (
          id,
          admission_lead_id,
          person_id,
          status,
          submitted_at
        )
        values (
          '66666666-6666-4666-8666-666666666666',
          '55555555-5555-4555-8555-555555555555',
          '33333333-3333-4333-8333-333333333333',
          'submitted',
          now()
        );

        insert into public.application_decisions (id, application_id, outcome)
        values (
          '77777777-7777-4777-8777-777777777777',
          '66666666-6666-4666-8666-666666666666',
          'offer'
        );

        insert into public.application_offers (
          id,
          decision_id,
          application_id,
          status,
          converted_student_id
        )
        values (
          '88888888-8888-4888-8888-888888888888',
          '77777777-7777-4777-8777-777777777777',
          '66666666-6666-4666-8666-666666666666',
          'accepted',
          '44444444-4444-4444-8444-444444444444'
        );

        insert into public.admissions_registrations (
          id,
          application_id,
          status,
          student_id,
          converted_at
        )
        values (
          '99999999-9999-4999-8999-999999999999',
          '66666666-6666-4666-8666-666666666666',
          'complete',
          '44444444-4444-4444-8444-444444444444',
          now()
        );
      `);

      const workItems = await db.query<{
        admission_lead_id: string;
        journey_stage: string;
        has_data_inconsistency: boolean;
        primary_next_action: string;
      }>(`
        select
          admission_lead_id,
          journey_stage::text,
          has_data_inconsistency,
          primary_next_action
        from public.staff_new_student_admissions_work_items
        order by email
      `);

      expect(workItems.rows).toEqual([
        {
          admission_lead_id: enquiryLeadId,
          journey_stage: "enquiry",
          has_data_inconsistency: false,
          primary_next_action: "invite_applicant"
        },
        {
          admission_lead_id: "55555555-5555-4555-8555-555555555555",
          journey_stage: "complete",
          has_data_inconsistency: false,
          primary_next_action: "none"
        },
        {
          admission_lead_id: "22222222-2222-4222-8222-222222222222",
          journey_stage: "enquiry",
          has_data_inconsistency: true,
          primary_next_action: "repair_inconsistency"
        }
      ]);

      await db.query(
        `select public.update_admission_lead_administrative_details(
          $1,
          'Asha',
          'Updated',
          'asha.updated@example.test',
          null,
          'pgcert',
          '{}'::uuid[],
          'staff_email',
          null,
          null,
          null
        )`,
        [enquiryLeadId]
      );

      const updated = await db.query<{ stage: string; archived: boolean; last_name: string }>(
        "select stage::text, archived, last_name from public.admission_leads where id = $1",
        [enquiryLeadId]
      );

      expect(updated.rows[0]).toEqual({
        stage: "interest",
        archived: false,
        last_name: "Updated"
      });

      const auditActions = await db.query<{ action: string }>(
        "select action from public.audit_events order by id"
      );
      expect(auditActions.rows.map((row) => row.action)).toEqual([
        "enquiry.recorded_by_staff",
        "admission_lead.administrative_details_updated"
      ]);
    } finally {
      await db.close();
    }
  });

  it("closes and reopens pre-submission records and preserves reasoned offer outcomes", async () => {
    const db = new PGlite();
    const actorId = "11111111-1111-4111-8111-111111111111";
    const personId = "22222222-2222-4222-8222-222222222222";
    const enquiryId = "33333333-3333-4333-8333-333333333333";
    const offerLeadId = "44444444-4444-4444-8444-444444444444";
    const applicationId = "55555555-5555-4555-8555-555555555555";
    const decisionId = "66666666-6666-4666-8666-666666666666";
    const offerId = "77777777-7777-4777-8777-777777777777";

    try {
      await db.exec(foundationSchema);
      await db.exec(migration);
      await db.exec(terminalActionsMigration);
      await db.query("insert into public.staff_profiles (id) values ($1)", [actorId]);
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId]);

      await db.query(
        `insert into public.admission_leads (id, first_name, last_name, email)
         values ($1, 'Pre', 'Submission', 'pre@example.test')`,
        [enquiryId]
      );
      await db.query(
        "select public.abandon_new_student_admission($1, 'Applicant is not proceeding this intake')",
        [enquiryId]
      );

      const abandoned = await db.query<{ stage: string; journey_stage: string; archived: boolean }>(
        `select lead.stage::text, item.journey_stage::text, lead.archived
         from public.admission_leads lead
         join public.staff_new_student_admissions_work_items item on item.admission_lead_id = lead.id
         where lead.id = $1`,
        [enquiryId]
      );
      expect(abandoned.rows[0]).toEqual({ stage: "abandoned", journey_stage: "closed", archived: false });

      await db.query(
        "select public.reopen_abandoned_new_student_admission($1, 'Applicant asked to continue')",
        [enquiryId]
      );
      const reopened = await db.query<{ stage: string; journey_stage: string; reopened_at: string | null }>(
        `select lead.stage::text, item.journey_stage::text, period.reopened_at::text
         from public.admission_leads lead
         join public.staff_new_student_admissions_work_items item on item.admission_lead_id = lead.id
         join public.admission_abandonment_periods period on period.admission_lead_id = lead.id
         where lead.id = $1`,
        [enquiryId]
      );
      expect(reopened.rows[0]?.stage).toBe("interest");
      expect(reopened.rows[0]?.journey_stage).toBe("enquiry");
      expect(reopened.rows[0]?.reopened_at).not.toBeNull();

      await db.exec(`
        insert into public.persons (id, first_name, last_name, email)
        values ('${personId}', 'Offer', 'Applicant', 'offer@example.test');
        insert into public.admission_leads (id, person_id, first_name, last_name, email, stage)
        values ('${offerLeadId}', '${personId}', 'Offer', 'Applicant', 'offer@example.test', 'offer_lapsed');
        insert into public.applications (id, admission_lead_id, person_id, first_name, last_name, email, status, submitted_at)
        values ('${applicationId}', '${offerLeadId}', '${personId}', 'Offer', 'Applicant', 'offer@example.test', 'submitted', now());
        insert into public.application_decisions (id, application_id, outcome)
        values ('${decisionId}', '${applicationId}', 'offer');
        insert into public.application_offers (
          id, decision_id, application_id, status, offer_reference, deadline_at, lapsed_at
        ) values (
          '${offerId}', '${decisionId}', '${applicationId}', 'lapsed', 'BETAR-2026-TEST', now() - interval '2 days', now() - interval '1 day'
        );
      `);

      const reissue = await db.query<{ result: { correspondence_log_id: string } }>(
        `select public.reissue_lapsed_application_offer(
          $1,
          now() + interval '14 days',
          'Applicant was granted an extension'
        ) as result`,
        [offerId]
      );
      expect(reissue.rows[0]?.result.correspondence_log_id).toBeTruthy();

      const reissued = await db.query<{
        status: string;
        stage: string;
        journey_stage: string;
        reissue_count: number;
        reissue_history: number;
      }>(
        `select offer.status::text, lead.stage::text, item.journey_stage::text,
          offer.reissue_count,
          (select count(*)::integer from public.application_offer_reissues where offer_id = offer.id) as reissue_history
         from public.application_offers offer
         join public.applications application on application.id = offer.application_id
         join public.admission_leads lead on lead.id = application.admission_lead_id
         join public.staff_new_student_admissions_work_items item on item.admission_lead_id = lead.id
         where offer.id = $1`,
        [offerId]
      );
      expect(reissued.rows[0]).toEqual({
        status: "issued",
        stage: "offered",
        journey_stage: "offer",
        reissue_count: 1,
        reissue_history: 1
      });

      await db.query(
        "select public.withdraw_application_offer($1, 'Offer was issued in error')",
        [offerId]
      );
      const withdrawn = await db.query<{
        status: string;
        stage: string;
        journey_stage: string;
        withdrawal_reason: string;
        withdrawal_history: number;
        correspondence_count: number;
      }>(
        `select offer.status::text, lead.stage::text, item.journey_stage::text,
          offer.withdrawal_reason,
          (select count(*)::integer from public.application_offer_withdrawals where offer_id = offer.id) as withdrawal_history,
          (select count(*)::integer from public.correspondence_logs where related_entity_id = offer.id) as correspondence_count
         from public.application_offers offer
         join public.applications application on application.id = offer.application_id
         join public.admission_leads lead on lead.id = application.admission_lead_id
         join public.staff_new_student_admissions_work_items item on item.admission_lead_id = lead.id
         where offer.id = $1`,
        [offerId]
      );
      expect(withdrawn.rows[0]).toEqual({
        status: "withdrawn",
        stage: "withdrawn",
        journey_stage: "closed",
        withdrawal_reason: "Offer was issued in error",
        withdrawal_history: 1,
        correspondence_count: 2
      });

      await expect(
        db.query("select public.abandon_new_student_admission($1, 'Wrong closure type')", [offerLeadId])
      ).rejects.toThrow("Only enquiries and unsubmitted applications can be abandoned");

      const audit = await db.query<{ action: string }>(
        "select action from public.audit_events order by created_at, id"
      );
      expect(audit.rows.map((row) => row.action)).toEqual([
        "admission.abandoned",
        "admission.abandonment_reopened",
        "offer.reissued",
        "offer.withdrawn"
      ]);
    } finally {
      await db.close();
    }
  });
});
