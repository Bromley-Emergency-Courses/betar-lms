import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  admissionsRegistrationConvertedAction,
  buildRegistrationConversionAuditMetadata,
  canConvertSubmittedRegistration,
  parseConvertSubmittedAdmissionsRegistrationForm
} from "@/lib/admissions-conversion";

const staffUserId = "11111111-1111-4111-8111-111111111111";
const teacherUserId = "22222222-2222-4222-8222-222222222222";
const applicantUserId = "33333333-3333-4333-8333-333333333333";
const personId = "44444444-4444-4444-8444-444444444444";
const leadId = "55555555-5555-4555-8555-555555555555";
const applicationId = "66666666-6666-4666-8666-666666666666";
const offerId = "77777777-7777-4777-8777-777777777777";
const registrationId = "88888888-8888-4888-8888-888888888888";
const termId = "99999999-9999-4999-8999-999999999999";
const moduleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const offeringId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const identityFileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const qualificationFileId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const existingStudentId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const rpcTestSchema = `
create schema auth;
create schema storage;

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

create function auth.role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;

create role authenticated;
create role service_role;

create type public.user_role as enum ('admin', 'teacher', 'reception');
create type public.portal_actor_type as enum ('applicant', 'student');
create type public.audit_actor_type as enum ('staff', 'applicant', 'student', 'service');
create type public.student_status as enum ('prospect', 'active', 'completed', 'withdrawn', 'deferred', 'interrupted');
create type public.admission_stage as enum (
  'interest',
  'application_invited',
  'submitted',
  'reviewed',
  'offered',
  'rejected',
  'accepted',
  'cccu_registration_pending',
  'cccu_registration_complete'
);
create type public.admission_lead_stage as enum (
  'interest',
  'application_invited',
  'submitted',
  'reviewed',
  'offered',
  'rejected',
  'accepted',
  'offer_declined',
  'offer_lapsed',
  'registration_in_progress',
  'archived'
);
create type public.application_status as enum ('draft', 'submitted');
create type public.application_offer_status as enum ('issued', 'withdrawn', 'accepted', 'declined', 'lapsed');
create type public.application_document_verification_status as enum ('unverified', 'verified', 'rejected');
create type public.module_mode as enum ('practical', 'online');
create type public.term_status as enum ('draft', 'published', 'active', 'closed');
create type public.enrolment_status as enum ('planned', 'in_progress', 'completed', 'failed', 'deferred');
create type public.admissions_conversion_status as enum ('draft', 'ready_for_conversion', 'converted', 'cancelled');
create type public.admissions_registration_status as enum ('not_started', 'in_progress', 'submitted');
create type public.admissions_registration_document_slot_key as enum (
  'identity_evidence',
  'qualification_evidence',
  'student_id_photo'
);

create table public.staff_profiles (
  id uuid primary key references auth.users(id),
  full_name text not null,
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

create table public.persons (
  id uuid primary key,
  first_name text not null,
  last_name text not null,
  preferred_name text,
  date_of_birth date,
  email text not null,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  postcode text,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.persons(id),
  cccu_student_id text unique,
  temporary_id text not null unique,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  status public.student_status not null default 'prospect',
  admission_stage public.admission_stage not null default 'interest',
  programme text not null check (programme in ('pgcert', 'microcredential')),
  start_term_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  capacity integer not null default 1
);

create table public.enrolments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  offering_id uuid not null references public.module_offerings(id),
  status public.enrolment_status not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, offering_id)
);

create table public.finance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  term_id uuid not null references public.terms(id),
  expected_amount_pence integer not null
);

create table storage.objects (
  bucket_id text not null,
  name text not null,
  metadata jsonb not null default '{}'::jsonb,
  primary key (bucket_id, name)
);

create table public.managed_files (
  id uuid primary key,
  student_id uuid references public.students(id),
  person_id uuid references public.persons(id),
  bucket text not null,
  object_path text not null,
  label text not null,
  file_category text,
  original_filename text,
  sanitized_filename text,
  content_type text,
  size_bytes bigint,
  retention_class text,
  uploaded_by_person_id uuid references public.persons(id),
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_type public.audit_actor_type not null,
  actor_user_id uuid references auth.users(id),
  actor_person_id uuid references public.persons(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.person_auth_identities (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  auth_user_id uuid not null references auth.users(id),
  email text not null,
  actor_type public.portal_actor_type not null default 'applicant',
  active boolean not null default true,
  unique (auth_user_id)
);

create table public.admission_leads (
  id uuid primary key,
  person_id uuid references public.persons(id),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  stage public.admission_lead_stage not null default 'interest',
  programme text not null default 'pgcert' check (programme in ('pgcert', 'microcredential')),
  converted_student_id uuid references public.students(id),
  archived boolean not null default false,
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

create table public.application_offers (
  id uuid primary key,
  application_id uuid not null references public.applications(id),
  person_id uuid not null references public.persons(id),
  offer_reference text not null,
  programme text not null check (programme in ('pgcert', 'microcredential')),
  intended_start_term_id uuid references public.terms(id),
  status public.application_offer_status not null default 'issued',
  accepted_at timestamptz
);

create table public.application_offer_module_offerings (
  offer_id uuid not null references public.application_offers(id),
  offering_id uuid not null references public.module_offerings(id),
  choice_order smallint not null,
  primary key (offer_id, offering_id)
);

create table public.admissions_conversion_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  source_entity_type text not null,
  source_entity_id uuid not null,
  accepted_offer_entity_type text not null default 'offer',
  accepted_offer_entity_id uuid not null,
  registration_entity_type text not null default 'registration',
  registration_entity_id uuid not null,
  status public.admissions_conversion_status not null default 'draft',
  offer_accepted_at timestamptz,
  registration_completed_at timestamptz,
  terms_version text,
  terms_hash text,
  terms_accepted_at timestamptz,
  terms_accepted_by_auth_user_id uuid references auth.users(id),
  terms_acceptance_ip inet,
  first_name text not null,
  last_name text not null,
  preferred_name text,
  date_of_birth date,
  email text not null,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  postcode text,
  country text,
  cccu_student_id text,
  temporary_id text,
  programme text not null check (programme in ('pgcert', 'microcredential')),
  start_term_id uuid not null references public.terms(id),
  initial_module_offering_ids uuid[] not null default '{}',
  student_id uuid references public.students(id),
  converted_at timestamptz,
  converted_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_entity_type, source_entity_id),
  unique (registration_entity_type, registration_entity_id)
);

create table public.admissions_conversion_documents (
  id uuid primary key default gen_random_uuid(),
  conversion_request_id uuid not null references public.admissions_conversion_requests(id) on delete cascade,
  managed_file_id uuid not null references public.managed_files(id),
  document_kind text not null,
  verified_at timestamptz not null,
  verified_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (conversion_request_id, managed_file_id)
);

create table public.admissions_registrations (
  id uuid primary key,
  application_offer_id uuid not null references public.application_offers(id),
  application_id uuid not null references public.applications(id),
  admission_lead_id uuid not null references public.admission_leads(id),
  person_id uuid not null references public.persons(id),
  status public.admissions_registration_status not null default 'not_started',
  programme text not null check (programme in ('pgcert', 'microcredential')),
  intended_start_term_id uuid not null references public.terms(id),
  first_name text not null,
  last_name text not null,
  preferred_name text,
  date_of_birth date,
  email text not null,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  postcode text,
  country text,
  module_confirmation_accepted boolean not null default false,
  module_confirmed_at timestamptz,
  module_confirmed_by_auth_user_id uuid references auth.users(id),
  terms_version text,
  terms_hash text,
  terms_accepted_at timestamptz,
  terms_accepted_by_auth_user_id uuid references auth.users(id),
  terms_accepted_by_person_id uuid references public.persons(id),
  terms_acceptance_ip inet,
  submitted_at timestamptz,
  submitted_by_auth_user_id uuid references auth.users(id),
  saved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admissions_registration_module_offerings (
  registration_id uuid not null references public.admissions_registrations(id),
  application_offer_id uuid not null references public.application_offers(id),
  offering_id uuid not null references public.module_offerings(id),
  choice_order smallint not null,
  term_id uuid not null references public.terms(id),
  term_name text not null,
  term_starts_on date not null,
  module_code text not null,
  module_title text not null,
  module_credits integer not null,
  module_mode public.module_mode not null,
  price_pence integer not null,
  capacity integer not null,
  confirmed boolean not null default true,
  primary key (registration_id, offering_id)
);

create table public.admissions_registration_document_slots (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.admissions_registrations(id),
  person_id uuid not null references public.persons(id),
  slot_key public.admissions_registration_document_slot_key not null,
  label text not null,
  required boolean not null default false,
  managed_file_id uuid references public.managed_files(id),
  verification_status public.application_document_verification_status not null default 'unverified',
  verifier_user_id uuid references auth.users(id),
  verification_at timestamptz,
  retention_class text not null,
  unique (registration_id, slot_key)
);
`;

const conversionMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/0030_registration_conversion_to_student_enrolments.sql"),
  "utf8"
);

async function createDb(options: { existingStudent?: boolean; teacherActor?: boolean; missingDateOfBirth?: boolean } = {}) {
  const db = new PGlite();
  await db.exec(rpcTestSchema);
  await db.exec(conversionMigration);
  await db.exec(`
    insert into auth.users (id) values
      ('${staffUserId}'),
      ('${teacherUserId}'),
      ('${applicantUserId}');

    insert into public.staff_profiles (id, full_name, role, active) values
      ('${staffUserId}', 'Admissions Admin', 'admin', true),
      ('${teacherUserId}', 'Teacher User', 'teacher', true);

    insert into public.persons (
      id,
      first_name,
      last_name,
      preferred_name,
      date_of_birth,
      email,
      phone,
      address_line_1,
      city,
      postcode,
      country
    )
    values (
      '${personId}',
      'Amara',
      'Lewis',
      'Amara',
      '1990-04-12',
      'amara@example.nhs.uk',
      '07700900200',
      '12 Example Street',
      'London',
      'E1 1AA',
      'United Kingdom'
    );

    insert into public.person_auth_identities (person_id, auth_user_id, email, actor_type, active)
    values ('${personId}', '${applicantUserId}', 'amara@example.nhs.uk', 'applicant', true);

    insert into public.terms (id, name, starts_on, status)
    values ('${termId}', 'September 2026', '2026-09-01', 'published');

    insert into public.course_modules (id, code, title, credits, mode, active)
    values ('${moduleId}', 'POCUS-1', 'Core POCUS', 10, 'online', true);

    insert into public.module_offerings (id, module_id, term_id, price_pence, capacity)
    values ('${offeringId}', '${moduleId}', '${termId}', 100000, 20);

    insert into public.admission_leads (id, person_id, first_name, last_name, email, phone, stage, programme)
    values ('${leadId}', '${personId}', 'Amara', 'Lewis', 'amara@example.nhs.uk', '07700900200', 'registration_in_progress', 'pgcert');

    insert into public.applications (id, admission_lead_id, person_id, status, programme, intended_start_term_id, first_name, last_name, email)
    values ('${applicationId}', '${leadId}', '${personId}', 'submitted', 'pgcert', '${termId}', 'Amara', 'Lewis', 'amara@example.nhs.uk');

    insert into public.application_offers (id, application_id, person_id, offer_reference, programme, intended_start_term_id, status, accepted_at)
    values ('${offerId}', '${applicationId}', '${personId}', 'BETAR-2026-001', 'pgcert', '${termId}', 'accepted', now());

    insert into public.application_offer_module_offerings (offer_id, offering_id, choice_order)
    values ('${offerId}', '${offeringId}', 1);

    insert into public.admissions_registrations (
      id,
      application_offer_id,
      application_id,
      admission_lead_id,
      person_id,
      status,
      programme,
      intended_start_term_id,
      first_name,
      last_name,
      preferred_name,
      date_of_birth,
      email,
      phone,
      address_line_1,
      city,
      postcode,
      country,
      module_confirmation_accepted,
      module_confirmed_at,
      module_confirmed_by_auth_user_id,
      terms_version,
      terms_hash,
      terms_accepted_at,
      terms_accepted_by_auth_user_id,
      terms_accepted_by_person_id,
      submitted_at,
      submitted_by_auth_user_id
    )
    values (
      '${registrationId}',
      '${offerId}',
      '${applicationId}',
      '${leadId}',
      '${personId}',
      'submitted',
      'pgcert',
      '${termId}',
      'Amara',
      'Lewis',
      'Amara',
      ${options.missingDateOfBirth ? "null" : "'1990-04-12'"},
      'amara@example.nhs.uk',
      '07700900200',
      '12 Example Street',
      'London',
      'E1 1AA',
      'United Kingdom',
      true,
      now(),
      '${applicantUserId}',
      'registration-terms-v1',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      now(),
      '${applicantUserId}',
      '${personId}',
      now(),
      '${applicantUserId}'
    );

    insert into public.admissions_registration_module_offerings (
      registration_id,
      application_offer_id,
      offering_id,
      choice_order,
      term_id,
      term_name,
      term_starts_on,
      module_code,
      module_title,
      module_credits,
      module_mode,
      price_pence,
      capacity
    )
    values (
      '${registrationId}',
      '${offerId}',
      '${offeringId}',
      1,
      '${termId}',
      'September 2026',
      '2026-09-01',
      'POCUS-1',
      'Core POCUS',
      10,
      'online',
      100000,
      20
    );

    insert into storage.objects (bucket_id, name, metadata) values
      ('id-documents', '${personId}/${registrationId}/identity_evidence/passport.pdf', '{"mimetype":"application/pdf","size":512000}'::jsonb),
      ('qualification-documents', '${personId}/${registrationId}/qualification_evidence/certificate.pdf', '{"mimetype":"application/pdf","size":512000}'::jsonb);

    insert into public.managed_files (id, person_id, bucket, object_path, label, retention_class)
    values
      ('${identityFileId}', '${personId}', 'id-documents', '${personId}/${registrationId}/identity_evidence/passport.pdf', 'Identity evidence', 'identity_document'),
      ('${qualificationFileId}', '${personId}', 'qualification-documents', '${personId}/${registrationId}/qualification_evidence/certificate.pdf', 'Qualification evidence', 'qualification_document');

    insert into public.admissions_registration_document_slots (registration_id, person_id, slot_key, label, required, managed_file_id, verification_status, retention_class)
    values
      ('${registrationId}', '${personId}', 'identity_evidence', 'Identity evidence', true, '${identityFileId}', 'unverified', 'identity_document'),
      ('${registrationId}', '${personId}', 'qualification_evidence', 'Qualification evidence', true, '${qualificationFileId}', 'unverified', 'qualification_document'),
      ('${registrationId}', '${personId}', 'student_id_photo', 'Student ID photo', false, null, 'unverified', 'student_photo');
  `);

  if (options.existingStudent) {
    await db.exec(`
      insert into public.students (
        id,
        person_id,
        temporary_id,
        first_name,
        last_name,
        email,
        status,
        admission_stage,
        programme,
        start_term_id
      )
      values (
        '${existingStudentId}',
        '${personId}',
        'BETAR-TMP-EXISTING',
        'Existing',
        'Student',
        'old@example.nhs.uk',
        'prospect',
        'accepted',
        'pgcert',
        '${termId}'
      );
    `);
  }

  await db.exec(`
    select set_config('request.jwt.claim.sub', '${options.teacherActor ? teacherUserId : staffUserId}', false);
    select set_config('request.jwt.claim.role', 'authenticated', false);
  `);
  return db;
}

describe("admissions registration conversion", () => {
  it("parses staff conversion form and guards UI eligibility", () => {
    const formData = new FormData();
    formData.set("registration_id", registrationId);
    formData.set("application_id", applicationId);

    expect(parseConvertSubmittedAdmissionsRegistrationForm(formData)).toEqual({
      registration_id: registrationId,
      application_id: applicationId
    });

    expect(
      canConvertSubmittedRegistration({
        registrationStatus: "submitted",
        registrationDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        requiredDocumentCount: 2,
        uploadedRequiredDocumentCount: 2,
        moduleConfirmationAccepted: true,
        termsAcceptedAt: new Date().toISOString(),
        leadStage: "registration_in_progress"
      })
    ).toEqual({ allowed: true, reason: "allowed" });

    expect(
      canConvertSubmittedRegistration({
        registrationStatus: "submitted",
        requiredDocumentCount: 2,
        uploadedRequiredDocumentCount: 1,
        moduleConfirmationAccepted: true,
        termsAcceptedAt: new Date().toISOString(),
        leadStage: "registration_in_progress"
      }).reason
    ).toBe("required_documents_missing");

    expect(
      canConvertSubmittedRegistration({
        registrationStatus: "submitted",
        registrationDeadlineAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        requiredDocumentCount: 2,
        uploadedRequiredDocumentCount: 2,
        moduleConfirmationAccepted: true,
        termsAcceptedAt: new Date().toISOString(),
        leadStage: "registration_in_progress"
      }).reason
    ).toBe("registration_deadline_passed");
  });

  it("creates a student, planned enrolment, conversion metadata, and no finance rows", async () => {
    const db = await createDb();

    const result = await db.query<{ converted_student_id: string }>(
      "select converted_student_id from public.convert_submitted_admissions_registration($1)",
      [registrationId]
    );

    const studentId = result.rows[0]?.converted_student_id;
    expect(studentId).toMatch(/[0-9a-f-]{36}/);

    const state = await db.query<{
      student_count: number;
      enrolment_count: number;
      finance_count: number;
      registration_status: string;
      lead_stage: string;
      identity_type: string;
      audit_count: number;
    }>(`
      select
        (select count(*)::int from public.students) as student_count,
        (select count(*)::int from public.enrolments where student_id = '${studentId}' and offering_id = '${offeringId}') as enrolment_count,
        (select count(*)::int from public.finance_records) as finance_count,
        (select status::text from public.admissions_registrations where id = '${registrationId}') as registration_status,
        (select stage::text from public.admission_leads where id = '${leadId}') as lead_stage,
        (select actor_type::text from public.person_auth_identities where person_id = '${personId}') as identity_type,
        (select count(*)::int from public.audit_events where action = '${admissionsRegistrationConvertedAction}') as audit_count
    `);

    expect(state.rows[0]).toEqual({
      student_count: 1,
      enrolment_count: 1,
      finance_count: 0,
      registration_status: "complete",
      lead_stage: "registered",
      identity_type: "student",
      audit_count: 1
    });
  });

  it("activates an existing linked student instead of creating a duplicate", async () => {
    const db = await createDb({ existingStudent: true });

    const result = await db.query<{ converted_student_id: string }>(
      "select converted_student_id from public.convert_submitted_admissions_registration($1)",
      [registrationId]
    );
    const count = await db.query<{ count: number }>("select count(*)::int from public.students");
    const student = await db.query<{ status: string; first_name: string; email: string }>(
      "select status::text, first_name, email from public.students where id = $1",
      [existingStudentId]
    );

    expect(result.rows[0]?.converted_student_id).toBe(existingStudentId);
    expect(count.rows[0]?.count).toBe(1);
    expect(student.rows[0]).toEqual({
      status: "active",
      first_name: "Amara",
      email: "amara@example.nhs.uk"
    });
  });

  it("blocks conversion when required registration data is missing", async () => {
    const db = await createDb({ missingDateOfBirth: true });

    await expect(
      db.query("select * from public.convert_submitted_admissions_registration($1)", [registrationId])
    ).rejects.toThrow(/required checks pass/);
  });

  it("blocks non-admin staff conversion attempts", async () => {
    const db = await createDb({ teacherActor: true });

    await expect(
      db.query("select * from public.convert_submitted_admissions_registration($1)", [registrationId])
    ).rejects.toThrow(/Only admissions admins/);
  });

  it("is idempotent for repeated conversion attempts", async () => {
    const db = await createDb();

    const first = await db.query<{ converted_student_id: string }>(
      "select converted_student_id from public.convert_submitted_admissions_registration($1)",
      [registrationId]
    );
    const second = await db.query<{ converted_student_id: string }>(
      "select converted_student_id from public.convert_submitted_admissions_registration($1)",
      [registrationId]
    );
    const counts = await db.query<{ student_count: number; enrolment_count: number; audit_count: number }>(`
      select
        (select count(*)::int from public.students) as student_count,
        (select count(*)::int from public.enrolments) as enrolment_count,
        (select count(*)::int from public.audit_events where action = '${admissionsRegistrationConvertedAction}') as audit_count
    `);

    expect(second.rows[0]?.converted_student_id).toBe(first.rows[0]?.converted_student_id);
    expect(counts.rows[0]).toEqual({
      student_count: 1,
      enrolment_count: 1,
      audit_count: 1
    });
  });

  it("documents migration behavior and redacted audit metadata", () => {
    expect(conversionMigration).toContain("create or replace function public.convert_submitted_admissions_registration");
    expect(conversionMigration).toContain("create or replace function public.convert_admissions_registration");
    expect(conversionMigration).toContain("insert into public.enrolments");
    expect(conversionMigration).not.toContain("insert into public.finance_records");
    expect(conversionMigration).toContain("revoke execute on function public.convert_admissions_registration(uuid) from authenticated");
    expect(conversionMigration).not.toContain(
      "grant execute on function public.convert_admissions_registration(uuid) to authenticated"
    );
    expect(conversionMigration).toContain(
      "grant execute on function public.convert_submitted_admissions_registration(uuid) to authenticated, service_role"
    );
    expect(conversionMigration).toContain("stage = 'registered'");
    expect(conversionMigration).toContain("status = 'complete'");
    expect(conversionMigration).toContain("on conflict on constraint enrolments_student_id_offering_id_key do nothing");

    expect(
      buildRegistrationConversionAuditMetadata({
        conversionRequestId: "request-1",
        registrationId: "registration-1",
        applicationId: "application-1",
        admissionLeadId: "lead-1",
        offerId: "offer-1",
        personId: "person-1",
        studentId: "student-1",
        initialModuleOfferingIds: ["offering-1"]
      })
    ).toEqual({
      registration_id: "registration-1",
      application_id: "application-1",
      admission_lead_id: "lead-1",
      offer_id: "offer-1",
      person_id: "person-1",
      student_id: "student-1",
      initial_module_offering_ids: ["offering-1"],
      finance_generation_enabled: false
    });
  });

  it("removes legacy accepted-lead conversion bypasses from the admissions lead UI and action", () => {
    const admissionsRecords = readFileSync(join(process.cwd(), "src/components/admissions-records.tsx"), "utf8");
    const adminActions = readFileSync(join(process.cwd(), "src/lib/admin-actions.ts"), "utf8");
    const legacyConversionAction = adminActions.slice(
      adminActions.indexOf("export async function convertAdmissionLeadToStudent"),
      adminActions.indexOf("export async function createProspect")
    );

    expect(admissionsRecords).not.toContain("convertAdmissionLeadToStudent");
    expect(admissionsRecords).not.toContain("ConvertLeadForm");
    expect(admissionsRecords).toContain('"registration_in_progress"');
    expect(admissionsRecords).toContain('"registered"');
    expect(adminActions).not.toContain("leadStageSchema");
    expect(adminActions).toContain('supabase.rpc("update_admission_lead_administrative_details"');
    expect(legacyConversionAction).toContain("Admissions conversion must be completed from a submitted registration review.");
    expect(legacyConversionAction).not.toContain(".from(\"students\").insert(parsed).select(\"id\").single()");
  });
});
