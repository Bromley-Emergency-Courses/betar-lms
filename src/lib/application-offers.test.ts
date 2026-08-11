import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  applicationOfferAcceptedAction,
  applicationOfferAcceptedTemplateKey,
  applicationOfferDeadlineReminderTemplateKey,
  applicationOfferDeclinedAction,
  applicationOfferDeclinedTemplateKey,
  applicationOfferEntityType,
  applicationOfferLapsedAction,
  applicationOfferLapsedTemplateKey,
  applicationOfferReminderEligibleAction,
  buildApplicationOfferLapsedAuditMetadata,
  buildApplicationOfferReminderAuditMetadata,
  buildApplicationOfferResponseAuditMetadata,
  canRespondToApplicationOffer,
  parseProcessApplicationOfferDeadlineWorkflowForm,
  parseRespondToApplicationOfferForm
} from "@/lib/application-offers";

const applicantUserId = "11111111-1111-4111-8111-111111111111";
const applicantPersonId = "22222222-2222-4222-8222-222222222222";
const otherApplicantUserId = "33333333-3333-4333-8333-333333333333";
const otherApplicantPersonId = "44444444-4444-4444-8444-444444444444";
const leadId = "55555555-5555-4555-8555-555555555555";
const applicationId = "66666666-6666-4666-8666-666666666666";
const offerId = "77777777-7777-4777-8777-777777777777";
const termId = "88888888-8888-4888-8888-888888888888";
const moduleId = "99999999-9999-4999-8999-999999999999";
const offeringId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const staffUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const rpcTestSchema = `
create schema auth;
create table auth.users (
  id uuid primary key
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create role authenticated;

create type public.user_role as enum ('admin', 'teacher', 'reception');
create type public.portal_actor_type as enum ('applicant', 'student');
create type public.admission_lead_stage as enum (
  'interest',
  'application_invited',
  'submitted',
  'reviewed',
  'offered',
  'rejected',
  'accepted',
  'archived'
);
create type public.application_status as enum ('draft', 'submitted');
create type public.application_decision_outcome as enum ('offer', 'rejection');
create type public.application_review_readiness_status as enum ('not_ready', 'needs_information', 'ready_for_decision');
create type public.application_offer_status as enum ('issued', 'withdrawn', 'accepted', 'declined', 'lapsed');
create type public.correspondence_channel as enum ('email', 'letter');
create type public.correspondence_delivery_status as enum ('queued', 'sent', 'delivered', 'failed', 'bounced', 'suppressed');
create type public.correspondence_bounce_status as enum ('none', 'soft_bounce', 'hard_bounce', 'complaint', 'blocked', 'unknown');
create type public.term_status as enum ('draft', 'published', 'active', 'closed');
create type public.module_mode as enum ('practical', 'online');

create table public.persons (
  id uuid primary key,
  first_name text not null,
  last_name text not null,
  email text not null
);

create table public.staff_profiles (
  id uuid primary key references auth.users(id),
  name text not null,
  email text not null,
  role public.user_role not null,
  active boolean not null default true
);

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles
    where id = auth.uid()
      and role = 'admin'
      and active = true
  );
$$;

create table public.person_auth_identities (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  auth_user_id uuid not null references auth.users(id),
  email text not null,
  actor_type public.portal_actor_type not null default 'applicant',
  active boolean not null default true
);

create function public.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select person_id
  from public.person_auth_identities
  where auth_user_id = auth.uid()
    and active = true
  limit 1;
$$;

create function public.current_portal_actor_type()
returns public.portal_actor_type
language sql
stable
security definer
set search_path = public
as $$
  select actor_type
  from public.person_auth_identities
  where auth_user_id = auth.uid()
    and active = true
  limit 1;
$$;

create table public.admission_leads (
  id uuid primary key,
  first_name text not null,
  last_name text not null,
  email text not null,
  stage public.admission_lead_stage not null default 'interest',
  archived boolean not null default false,
  converted_student_id uuid,
  next_action_on date
);

create table public.applications (
  id uuid primary key,
  admission_lead_id uuid not null references public.admission_leads(id),
  person_id uuid not null references public.persons(id),
  status public.application_status not null default 'draft',
  programme text not null default 'pgcert' check (programme in ('pgcert', 'microcredential')),
  intended_start_term_id uuid,
  first_name text,
  last_name text,
  email text
);

create table public.application_reviews (
  application_id uuid primary key references public.applications(id),
  readiness_status public.application_review_readiness_status not null default 'not_ready'
);

create table public.terms (
  id uuid primary key,
  name text not null,
  starts_on date not null,
  status public.term_status not null default 'published'
);

create table public.course_modules (
  id uuid primary key,
  code text not null,
  title text not null,
  credits integer not null default 10,
  mode public.module_mode not null default 'online',
  active boolean not null default true
);

create table public.module_offerings (
  id uuid primary key,
  module_id uuid not null references public.course_modules(id),
  term_id uuid not null references public.terms(id),
  price_pence integer not null default 0,
  capacity integer not null default 0
);

create table public.application_offers (
  id uuid primary key,
  decision_id uuid,
  application_id uuid not null references public.applications(id),
  person_id uuid not null references public.persons(id),
  offer_reference text not null,
  programme text not null check (programme in ('pgcert', 'microcredential')),
  intended_start_term_id uuid references public.terms(id),
  status public.application_offer_status not null default 'issued',
  issued_by_user_id uuid references public.staff_profiles(id),
  issued_at timestamptz not null default now(),
  deadline_at timestamptz,
  letter_template_id uuid,
  letter_template_key text not null default 'offer_issued',
  letter_template_version integer not null default 1,
  correspondence_log_id uuid,
  accepted_at timestamptz,
  declined_at timestamptz,
  lapsed_at timestamptz
);

create table public.application_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  admission_lead_id uuid not null references public.admission_leads(id),
  person_id uuid not null references public.persons(id),
  outcome public.application_decision_outcome not null,
  decision_reason text not null,
  decided_by_user_id uuid references public.staff_profiles(id),
  decided_at timestamptz not null default now(),
  correspondence_log_id uuid
);

create table public.application_offer_module_offerings (
  offer_id uuid not null references public.application_offers(id),
  offering_id uuid not null references public.module_offerings(id),
  choice_order smallint not null
);

create table public.application_module_offering_choices (
  application_id uuid not null references public.applications(id),
  offering_id uuid not null references public.module_offerings(id),
  choice_order smallint not null
);

create table public.application_rejections (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.application_decisions(id),
  application_id uuid not null references public.applications(id),
  person_id uuid not null references public.persons(id),
  rejection_reason text not null,
  rejected_by_user_id uuid references public.staff_profiles(id),
  rejected_at timestamptz not null default now(),
  letter_template_id uuid,
  letter_template_key text not null default 'rejection',
  letter_template_version integer not null default 1,
  correspondence_log_id uuid
);

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
  provider_message_id text,
  delivery_status public.correspondence_delivery_status not null default 'queued',
  bounce_status public.correspondence_bounce_status not null default 'none',
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,
  actor_user_id uuid references auth.users(id),
  actor_person_id uuid references public.persons(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
`;

async function createOfferRpcTestDb() {
  const db = new PGlite();
  await db.exec(rpcTestSchema);
  await db.exec(readFileSync(join(process.cwd(), "supabase/migrations/0027_applicant_offer_response.sql"), "utf8"));
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [applicantUserId]);
  return db;
}

async function createOfferDeadlineWorkflowTestDb() {
  const db = await createOfferRpcTestDb();
  await db.exec(readFileSync(join(process.cwd(), "supabase/migrations/0028_offer_deadlines_lapse_reminders.sql"), "utf8"));
  await db.query("insert into auth.users (id) values ($1) on conflict do nothing", [staffUserId]);
  await db.query(
    "insert into public.staff_profiles (id, name, email, role, active) values ($1, 'Admissions Admin', 'admin@example.test', 'admin', true)",
    [staffUserId]
  );
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [staffUserId]);
  return db;
}

async function seedOfferScenario(
  db: PGlite,
  options: {
    status?: "issued" | "withdrawn" | "accepted" | "declined" | "lapsed";
    deadlineAt?: string | null;
    leadStage?: "submitted" | "reviewed" | "offered" | "accepted" | "offer_declined";
    offerPersonId?: string;
  } = {}
) {
  const status = options.status ?? "issued";
  const offerPersonId = options.offerPersonId ?? applicantPersonId;
  await db.query("insert into auth.users (id) values ($1), ($2)", [applicantUserId, otherApplicantUserId]);
  await db.query(
    `
      insert into public.persons (id, first_name, last_name, email)
      values
        ($1, 'Asha', 'Applicant', 'asha@example.test'),
        ($2, 'Other', 'Applicant', 'other@example.test')
    `,
    [applicantPersonId, otherApplicantPersonId]
  );
  await db.query(
    `
      insert into public.person_auth_identities (person_id, auth_user_id, email, actor_type, active)
      values
        ($1, $2, 'asha@example.test', 'applicant', true),
        ($3, $4, 'other@example.test', 'applicant', true)
    `,
    [applicantPersonId, applicantUserId, otherApplicantPersonId, otherApplicantUserId]
  );
  await db.query(
    "insert into public.admission_leads (id, first_name, last_name, email, stage, next_action_on) values ($1, 'Asha', 'Applicant', 'asha@example.test', $2, '2099-08-10')",
    [leadId, options.leadStage ?? "offered"]
  );
  await db.query(
    "insert into public.applications (id, admission_lead_id, person_id, status, first_name, last_name, email) values ($1, $2, $3, 'submitted', 'Asha', 'Applicant', 'asha.application@example.test')",
    [applicationId, leadId, applicantPersonId]
  );
  await db.query("insert into public.terms (id, name, starts_on) values ($1, 'September 2026', '2026-09-07')", [termId]);
  await db.query(
    "insert into public.course_modules (id, code, title, credits, mode) values ($1, 'POCUS-CORE', 'Foundations', 10, 'online')",
    [moduleId]
  );
  await db.query(
    "insert into public.module_offerings (id, module_id, term_id, price_pence, capacity) values ($1, $2, $3, 90000, 24)",
    [offeringId, moduleId, termId]
  );

  const acceptedAt = status === "accepted" ? "2026-07-28T12:00:00Z" : null;
  const declinedAt = status === "declined" ? "2026-07-28T12:00:00Z" : null;
  const lapsedAt = status === "lapsed" ? "2026-07-28T12:00:00Z" : null;
  const acceptedUserId = status === "accepted" ? applicantUserId : null;
  const acceptedPersonId = status === "accepted" ? applicantPersonId : null;
  const declinedUserId = status === "declined" ? applicantUserId : null;
  const declinedPersonId = status === "declined" ? applicantPersonId : null;

  await db.query(
    `
      insert into public.application_offers (
        id,
        application_id,
        person_id,
        offer_reference,
        programme,
        intended_start_term_id,
        status,
        deadline_at,
        accepted_at,
        declined_at,
        lapsed_at,
        accepted_by_auth_user_id,
        accepted_by_person_id,
        declined_by_auth_user_id,
        declined_by_person_id
      )
      values ($1, $2, $3, 'BETAR-2026-TEST', 'pgcert', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `,
    [
      offerId,
      applicationId,
      offerPersonId,
      termId,
      status,
      options.deadlineAt ?? "2099-08-10T23:59:59Z",
      acceptedAt,
      declinedAt,
      lapsedAt,
      acceptedUserId,
      acceptedPersonId,
      declinedUserId,
      declinedPersonId
    ]
  );
  await db.query(
    "insert into public.application_offer_module_offerings (offer_id, offering_id, choice_order) values ($1, $2, 1)",
    [offerId, offeringId]
  );
}

async function processOfferDeadlineWorkflow(db: PGlite, referenceTime = "2026-07-28T12:00:00Z") {
  return db.query<{ result: Record<string, unknown> }>(
    "select public.process_application_offer_deadline_workflow($1::timestamptz, 3) as result",
    [referenceTime]
  );
}

async function respondToOffer(db: PGlite, response: "accept" | "decline") {
  return db.query<{ result: Record<string, unknown> }>(
    "select public.respond_to_application_offer($1, $2, '203.0.113.8'::inet, 'vitest user agent') as result",
    [offerId, response]
  );
}

async function expectOfferResponseRejected(db: PGlite, expectedMessage: string) {
  await expect(respondToOffer(db, "accept")).rejects.toThrow(expectedMessage);
  const auditRows = await db.query<{ count: string }>("select count(*)::text from public.audit_events");
  const correspondenceRows = await db.query<{ count: string }>("select count(*)::text from public.correspondence_logs");
  expect(auditRows.rows[0]?.count).toBe("0");
  expect(correspondenceRows.rows[0]?.count).toBe("0");
}

describe("application offer responses", () => {
  it("parses applicant offer response forms", () => {
    const form = new FormData();
    form.set("offer_id", "66666666-6666-4666-8666-666666666666");
    form.set("offer_response", "accept");

    expect(parseRespondToApplicationOfferForm(form)).toEqual({
      offer_id: "66666666-6666-4666-8666-666666666666",
      offer_response: "accept"
    });

    form.set("offer_response", "decline");
    expect(parseRespondToApplicationOfferForm(form).offer_response).toBe("decline");

    form.set("offer_response", "withdraw");
    expect(() => parseRespondToApplicationOfferForm(form)).toThrow();
  });

  it("parses staff offer deadline workflow forms", () => {
    const form = new FormData();
    expect(parseProcessApplicationOfferDeadlineWorkflowForm(form)).toEqual({ reminder_window_days: 3 });

    form.set("reminder_window_days", "7");
    expect(parseProcessApplicationOfferDeadlineWorkflowForm(form)).toEqual({ reminder_window_days: 7 });

    form.set("reminder_window_days", "31");
    expect(() => parseProcessApplicationOfferDeadlineWorkflowForm(form)).toThrow();
  });

  it("allows applicant responses only for issued offers before the deadline", () => {
    const now = new Date("2026-07-28T12:00:00Z");

    expect(
      canRespondToApplicationOffer(
        {
          status: "issued",
          deadlineAt: "2026-07-29T12:00:00Z"
        },
        now
      )
    ).toEqual({ allowed: true, reason: "allowed" });

    expect(
      canRespondToApplicationOffer(
        {
          status: "accepted",
          deadlineAt: "2026-07-29T12:00:00Z"
        },
        now
      ).reason
    ).toBe("offer_not_issued");

    expect(
      canRespondToApplicationOffer(
        {
          status: "issued",
          deadlineAt: "2026-07-28T12:00:00Z"
        },
        now
      ).reason
    ).toBe("offer_deadline_passed");

    expect(
      canRespondToApplicationOffer(
        {
          status: "issued",
          deadlineAt: "2026-07-27T12:00:00Z"
        },
        now
      ).reason
    ).toBe("offer_deadline_passed");
  });

  it("builds redacted applicant response audit metadata", () => {
    expect(
      buildApplicationOfferResponseAuditMetadata({
        offerId: "offer-1",
        applicationId: "application-1",
        admissionLeadId: "lead-1",
        personId: "person-1",
        response: "accept",
        deadlineAt: "2026-08-07T23:59:59+00:00",
        correspondenceLogId: "log-1"
      })
    ).toEqual({
      offer_id: "offer-1",
      application_id: "application-1",
      admission_lead_id: "lead-1",
      person_id: "person-1",
      response: "accept",
      deadline_at: "2026-08-07T23:59:59+00:00",
      correspondence_log_id: "log-1",
      production_email_send_enabled: false,
      provider_message_id: null
    });
  });

  it("builds redacted deadline reminder and lapse audit metadata", () => {
    expect(
      buildApplicationOfferReminderAuditMetadata({
        offerId: "offer-1",
        applicationId: "application-1",
        admissionLeadId: "lead-1",
        personId: "person-1",
        deadlineAt: "2026-07-31T12:00:00Z",
        referenceTime: "2026-07-28T12:00:00Z",
        reminderWindowDays: 3,
        correspondenceLogId: "log-1"
      })
    ).toMatchObject({
      offer_id: "offer-1",
      deadline_at: "2026-07-31T12:00:00Z",
      reminder_window_days: 3,
      delivery_status: "suppressed",
      production_email_send_enabled: false,
      provider_message_id: null
    });

    expect(
      buildApplicationOfferLapsedAuditMetadata({
        offerId: "offer-1",
        applicationId: "application-1",
        admissionLeadId: "lead-1",
        personId: "person-1",
        deadlineAt: "2026-07-27T12:00:00Z",
        correspondenceLogId: "log-2"
      })
    ).toMatchObject({
      offer_id: "offer-1",
      deadline_at: "2026-07-27T12:00:00Z",
      correspondence_log_id: "log-2",
      delivery_status: "suppressed",
      production_email_send_enabled: false,
      provider_message_id: null
    });
  });

  it("adds applicant response metadata, lead transitions, audit events, and suppressed correspondence", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/0027_applicant_offer_response.sql"),
      "utf8"
    );

    expect(migration).toContain("alter type public.admission_lead_stage add value if not exists 'offer_declined'");
    expect(migration).toContain("accepted_by_auth_user_id");
    expect(migration).toContain("accepted_by_person_id");
    expect(migration).toContain("accepted_ip_address inet");
    expect(migration).toContain("declined_by_auth_user_id");
    expect(migration).toContain("declined_by_person_id");
    expect(migration).toContain("declined_ip_address inet");
    expect(migration).toContain("create or replace function public.respond_to_application_offer");
    expect(migration).toContain("v_actor_type <> 'applicant'");
    expect(migration).toContain("v_offer.status <> 'issued'");
    expect(migration).toContain("v_offer.deadline_at is not null and v_offer.deadline_at <= now()");
    expect(migration).toContain("v_lead.stage <> 'offered'");
    expect(migration).toContain("stage = v_new_lead_stage");
    expect(migration).toContain("'offer.accepted'");
    expect(migration).toContain("'offer.declined'");
    expect(migration).toContain("'delivery_status',\n      'suppressed'");
    expect(migration).toContain("'provider_message_id',\n      null");
    expect(migration).toContain("grant execute on function public.respond_to_application_offer");
    expect(migration).not.toContain("insert into public.enrolments");
    expect(migration).not.toContain("insert into public.finance_records");
    expect(migration).not.toContain("convert_admissions_registration");
    expect(applicationOfferAcceptedTemplateKey).toBe("offer_accepted_confirmation");
    expect(applicationOfferDeclinedTemplateKey).toBe("offer_declined_confirmation");
    expect(applicationOfferAcceptedAction).toBe("offer.accepted");
    expect(applicationOfferDeclinedAction).toBe("offer.declined");
    expect(applicationOfferEntityType).toBe("application_offer");
  });

  it("adds valid deadlines, suppressed reminder/lapse placeholders, and a guarded manual workflow RPC", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/0028_offer_deadlines_lapse_reminders.sql"),
      "utf8"
    );

    expect(migration).toContain("alter type public.admission_lead_stage add value if not exists 'offer_lapsed'");
    expect(migration).toContain("deadline_reminder_count");
    expect(migration).toContain("application_offers_issued_deadline_required");
    expect(migration).toContain("coalesce(p_offer_deadline_at, now() + interval '14 days')");
    expect(migration).toContain("create or replace function public.process_application_offer_deadline_workflow");
    expect(migration).toContain("'offer.reminder_eligible'");
    expect(migration).toContain("'offer.lapsed'");
    expect(migration).toContain("stage = 'offer_lapsed'");
    expect(migration).toContain("'delivery_status',\n        'suppressed'");
    expect(migration).toContain("'provider_message_id',\n        null");
    expect(migration).toContain(`'${applicationOfferDeadlineReminderTemplateKey}'`);
    expect(migration).toContain(`'${applicationOfferLapsedTemplateKey}'`);
    expect(migration).not.toContain("insert into public.enrolments");
    expect(migration).not.toContain("insert into public.finance_records");
    expect(migration).not.toContain("convert_admissions_registration");
    expect(applicationOfferReminderEligibleAction).toBe("offer.reminder_eligible");
    expect(applicationOfferLapsedAction).toBe("offer.lapsed");
  });

  it("records one suppressed reminder eligibility log for issued offers approaching deadline", async () => {
    const db = await createOfferDeadlineWorkflowTestDb();
    try {
      await seedOfferScenario(db, { deadlineAt: "2026-07-30T12:00:00Z" });

      const result = await processOfferDeadlineWorkflow(db);
      expect(result.rows[0]?.result).toMatchObject({
        reminder_count: 1,
        lapsed_count: 0,
        delivery_status: "suppressed",
        production_email_send_enabled: false,
        provider_message_id: null
      });

      const offerRows = await db.query<{
        status: string;
        deadline_reminder_count: number;
        last_deadline_reminder_at: string | null;
      }>(
        `
          select status::text, deadline_reminder_count, last_deadline_reminder_at::text
          from public.application_offers
          where id = $1
        `,
        [offerId]
      );
      expect(offerRows.rows[0]).toMatchObject({
        status: "issued",
        deadline_reminder_count: 1
      });
      expect(offerRows.rows[0]?.last_deadline_reminder_at).toBeTruthy();

      await processOfferDeadlineWorkflow(db);
      const duplicateRows = await db.query<{ count: string }>(
        "select count(*)::text from public.correspondence_logs where template_key = 'offer_deadline_reminder'"
      );
      expect(duplicateRows.rows[0]?.count).toBe("1");

      const auditRows = await db.query<{ action: string; metadata: unknown }>(
        "select action, metadata from public.audit_events where action = 'offer.reminder_eligible'"
      );
      expect(auditRows.rows).toHaveLength(1);
      expect(auditRows.rows[0]?.metadata).toMatchObject({
        offer_id: offerId,
        deadline_at: "2026-07-30T12:00:00+00:00",
        delivery_status: "suppressed",
        production_email_send_enabled: false,
        provider_message_id: null
      });
    } finally {
      await db.close();
    }
  });

  it("marks overdue issued offers as lapsed with suppressed lapse correspondence", async () => {
    const db = await createOfferDeadlineWorkflowTestDb();
    try {
      await seedOfferScenario(db, { deadlineAt: "2026-07-27T12:00:00Z" });

      const result = await processOfferDeadlineWorkflow(db);
      expect(result.rows[0]?.result).toMatchObject({
        reminder_count: 0,
        lapsed_count: 1,
        delivery_status: "suppressed",
        production_email_send_enabled: false
      });

      const offerRows = await db.query<{ status: string; lapsed_at: string | null }>(
        "select status::text, lapsed_at::text from public.application_offers where id = $1",
        [offerId]
      );
      expect(offerRows.rows[0]?.status).toBe("lapsed");
      expect(offerRows.rows[0]?.lapsed_at).toBeTruthy();

      const leadRows = await db.query<{ stage: string; next_action_on: string | null }>(
        "select stage::text, next_action_on::text from public.admission_leads where id = $1",
        [leadId]
      );
      expect(leadRows.rows[0]).toEqual({ stage: "offer_lapsed", next_action_on: null });

      const correspondenceRows = await db.query<{
        template_key: string;
        delivery_status: string;
        provider_message_id: string | null;
        metadata: unknown;
      }>(
        `
          select template_key, delivery_status::text, provider_message_id, metadata
          from public.correspondence_logs
          where template_key = 'offer_lapsed_notice'
        `
      );
      expect(correspondenceRows.rows).toHaveLength(1);
      expect(correspondenceRows.rows[0]).toMatchObject({
        template_key: "offer_lapsed_notice",
        delivery_status: "suppressed",
        provider_message_id: null
      });
      expect(correspondenceRows.rows[0]?.metadata).toMatchObject({
        offer_id: offerId,
        delivery_status: "suppressed",
        production_email_send_enabled: false,
        provider_message_id: null
      });

      const auditRows = await db.query<{ action: string; metadata: unknown }>(
        "select action, metadata from public.audit_events where action = 'offer.lapsed'"
      );
      expect(auditRows.rows).toHaveLength(1);
      expect(auditRows.rows[0]?.metadata).toMatchObject({
        offer_id: offerId,
        deadline_at: "2026-07-27T12:00:00+00:00",
        delivery_status: "suppressed",
        production_email_send_enabled: false,
        provider_message_id: null
      });
    } finally {
      await db.close();
    }
  });

  it("executes the offer acceptance RPC transactionally with audit and suppressed correspondence", async () => {
    const db = await createOfferRpcTestDb();
    try {
      await seedOfferScenario(db);

      const result = await respondToOffer(db, "accept");
      expect(result.rows[0]?.result).toMatchObject({
        offer_id: offerId,
        status: "accepted",
        lead_stage: "accepted",
        delivery_status: "suppressed",
        provider_message_id: null
      });

      const offerRows = await db.query<{
        status: string;
        accepted_at: string | null;
        accepted_by_auth_user_id: string | null;
        accepted_by_person_id: string | null;
        accepted_ip_address: string | null;
        accepted_user_agent: string | null;
      }>(
        `
          select
            status::text,
            accepted_at::text,
            accepted_by_auth_user_id::text,
            accepted_by_person_id::text,
            accepted_ip_address::text,
            accepted_user_agent
          from public.application_offers
          where id = $1
        `,
        [offerId]
      );
      expect(offerRows.rows[0]).toMatchObject({
        status: "accepted",
        accepted_by_auth_user_id: applicantUserId,
        accepted_by_person_id: applicantPersonId,
        accepted_ip_address: "203.0.113.8/32",
        accepted_user_agent: "vitest user agent"
      });
      expect(offerRows.rows[0]?.accepted_at).toBeTruthy();

      const leadRows = await db.query<{ stage: string; next_action_on: string | null }>(
        "select stage::text, next_action_on::text from public.admission_leads where id = $1",
        [leadId]
      );
      expect(leadRows.rows[0]).toEqual({ stage: "accepted", next_action_on: null });

      const auditRows = await db.query<{ action: string; actor_user_id: string; actor_person_id: string; metadata: unknown }>(
        "select action, actor_user_id::text, actor_person_id::text, metadata from public.audit_events"
      );
      expect(auditRows.rows).toHaveLength(1);
      expect(auditRows.rows[0]).toMatchObject({
        action: "offer.accepted",
        actor_user_id: applicantUserId,
        actor_person_id: applicantPersonId
      });
      expect(auditRows.rows[0]?.metadata).toMatchObject({
        offer_id: offerId,
        application_id: applicationId,
        admission_lead_id: leadId,
        response: "accept",
        production_email_send_enabled: false,
        provider_message_id: null
      });

      const correspondenceRows = await db.query<{
        template_key: string;
        template_version: number;
        delivery_status: string;
        provider_message_id: string | null;
        recipient_email: string;
        created_by_user_id: string | null;
        metadata: unknown;
      }>(
        `
          select
            template_key,
            template_version,
            delivery_status::text,
            provider_message_id,
            recipient_email,
            created_by_user_id::text,
            metadata
          from public.correspondence_logs
        `
      );
      expect(correspondenceRows.rows).toHaveLength(1);
      expect(correspondenceRows.rows[0]).toMatchObject({
        template_key: "offer_accepted_confirmation",
        template_version: 1,
        delivery_status: "suppressed",
        provider_message_id: null,
        recipient_email: "asha.application@example.test",
        created_by_user_id: null
      });
      expect(correspondenceRows.rows[0]?.metadata).toMatchObject({
        offer_id: offerId,
        response: "accept",
        delivery_status: "suppressed",
        production_email_send_enabled: false,
        provider_message_id: null
      });
    } finally {
      await db.close();
    }
  });

  it("executes the offer decline RPC with declined state and suppressed correspondence", async () => {
    const db = await createOfferRpcTestDb();
    try {
      await seedOfferScenario(db);

      const result = await respondToOffer(db, "decline");
      expect(result.rows[0]?.result).toMatchObject({
        offer_id: offerId,
        status: "declined",
        lead_stage: "offer_declined",
        delivery_status: "suppressed",
        provider_message_id: null
      });

      const offerRows = await db.query<{
        status: string;
        declined_at: string | null;
        declined_by_auth_user_id: string | null;
        declined_by_person_id: string | null;
        declined_ip_address: string | null;
      }>(
        `
          select
            status::text,
            declined_at::text,
            declined_by_auth_user_id::text,
            declined_by_person_id::text,
            declined_ip_address::text
          from public.application_offers
          where id = $1
        `,
        [offerId]
      );
      expect(offerRows.rows[0]).toMatchObject({
        status: "declined",
        declined_by_auth_user_id: applicantUserId,
        declined_by_person_id: applicantPersonId,
        declined_ip_address: "203.0.113.8/32"
      });
      expect(offerRows.rows[0]?.declined_at).toBeTruthy();

      const leadRows = await db.query<{ stage: string }>(
        "select stage::text from public.admission_leads where id = $1",
        [leadId]
      );
      expect(leadRows.rows[0]?.stage).toBe("offer_declined");

      const auditRows = await db.query<{ action: string; metadata: unknown }>("select action, metadata from public.audit_events");
      const correspondenceRows = await db.query<{ template_key: string; delivery_status: string; provider_message_id: string | null }>(
        "select template_key, delivery_status::text, provider_message_id from public.correspondence_logs"
      );
      expect(auditRows.rows[0]).toMatchObject({ action: "offer.declined" });
      expect(auditRows.rows[0]?.metadata).toMatchObject({ response: "decline" });
      expect(correspondenceRows.rows[0]).toEqual({
        template_key: "offer_declined_confirmation",
        delivery_status: "suppressed",
        provider_message_id: null
      });
    } finally {
      await db.close();
    }
  });

  it("rejects applicant responses for offers owned by another portal person", async () => {
    const db = await createOfferRpcTestDb();
    try {
      await seedOfferScenario(db, { offerPersonId: otherApplicantPersonId });
      await expectOfferResponseRejected(db, "Offer was not found for this applicant");
    } finally {
      await db.close();
    }
  });

  it("rejects applicant responses after the offer deadline", async () => {
    const db = await createOfferRpcTestDb();
    try {
      await seedOfferScenario(db, { deadlineAt: "2026-01-01T00:00:00Z" });
      await expectOfferResponseRejected(db, "Offer deadline has passed");
    } finally {
      await db.close();
    }
  });

  it("rejects applicant responses at the exact offer deadline instant", async () => {
    const db = await createOfferRpcTestDb();
    try {
      await seedOfferScenario(db);

      await expect(
        db.query(
          `
            with deadline_boundary as (
              update public.application_offers
              set deadline_at = now()
              where id = $1
              returning id
            )
            select public.respond_to_application_offer($1, 'accept', '203.0.113.8'::inet, 'vitest user agent') as result
            from deadline_boundary
          `,
          [offerId]
        )
      ).rejects.toThrow("Offer deadline has passed");

      const auditRows = await db.query<{ count: string }>("select count(*)::text from public.audit_events");
      const correspondenceRows = await db.query<{ count: string }>("select count(*)::text from public.correspondence_logs");
      expect(auditRows.rows[0]?.count).toBe("0");
      expect(correspondenceRows.rows[0]?.count).toBe("0");
    } finally {
      await db.close();
    }
  });

  it.each(["accepted", "declined", "withdrawn", "lapsed"] as const)(
    "rejects applicant responses for %s offers",
    async (status) => {
      const db = await createOfferRpcTestDb();
      try {
        await seedOfferScenario(db, { status });
        await expectOfferResponseRejected(db, "Only issued offers can be accepted or declined");
      } finally {
        await db.close();
      }
    }
  );

  it.each(["submitted", "reviewed", "accepted", "offer_declined"] as const)(
    "rejects applicant responses when the lead stage is %s",
    async (leadStage) => {
      const db = await createOfferRpcTestDb();
      try {
        await seedOfferScenario(db, { leadStage });
        await expectOfferResponseRejected(db, "Offer is not in an admissions stage that can receive applicant responses");
      } finally {
        await db.close();
      }
    }
  );
});
