import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  admissionsRegistrationDocumentSlotDefinitions,
  admissionsRegistrationLapsedAction,
  admissionsRegistrationLapsedTemplateKey,
  admissionsRegistrationReopenedAction,
  admissionsRegistrationReopenedTemplateKey,
  canReopenLapsedRegistration,
  admissionsRegistrationTermsHash,
  admissionsRegistrationTermsText,
  buildAdmissionsRegistrationDocumentObjectPath,
  canAccessAcceptedOfferRegistration,
  parseAdmissionsRegistrationDraftForm,
  parseAdmissionsRegistrationDocumentVerificationRouteForm,
  parseAdmissionsRegistrationDocumentUploadForm,
  parseBeginAdmissionsRegistrationForm,
  parseProcessAdmissionsRegistrationDeadlineWorkflowForm,
  parseReopenLapsedAdmissionsRegistrationForm,
  parseStaffRegistrationDocumentVerificationForm,
  parseSubmitAdmissionsRegistrationForm,
  validateAdmissionsRegistrationDocumentUpload
} from "@/lib/admissions-registration";

function uploadFile(overrides: Partial<Pick<File, "name" | "size" | "type">> = {}): Pick<File, "name" | "size" | "type"> {
  return {
    name: "Passport Scan.pdf",
    size: 512_000,
    type: "application/pdf",
    ...overrides
  };
}

const lapseMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/0031_registration_lapse_reopen_workflow.sql"),
  "utf8"
);
const documentVerificationRouteMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/0044_registration_document_verification_routes.sql"),
  "utf8"
);

const staffUserId = "11111111-1111-4111-8111-111111111111";
const teacherUserId = "22222222-2222-4222-8222-222222222222";
const applicantUserId = "33333333-3333-4333-8333-333333333333";
const personId = "44444444-4444-4444-8444-444444444444";
const leadId = "55555555-5555-4555-8555-555555555555";
const applicationId = "66666666-6666-4666-8666-666666666666";
const offerId = "77777777-7777-4777-8777-777777777777";
const registrationId = "88888888-8888-4888-8888-888888888888";
const completeRegistrationId = "99999999-9999-4999-8999-999999999999";
const convertedRegistrationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const studentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const termId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const moduleId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const offeringId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const lapseRpcTestSchema = `
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
create type public.audit_actor_type as enum ('staff', 'applicant', 'student', 'service');
create type public.correspondence_channel as enum ('email', 'letter', 'sms', 'phone');
create type public.correspondence_delivery_status as enum ('queued', 'sent', 'failed', 'suppressed');
create type public.correspondence_bounce_status as enum ('none', 'soft_bounced', 'hard_bounced', 'complained');
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
  'registered',
  'archived'
);
create type public.application_status as enum ('draft', 'submitted');
create type public.application_offer_status as enum ('issued', 'withdrawn', 'accepted', 'declined', 'lapsed');
create type public.admissions_registration_status as enum ('not_started', 'in_progress', 'submitted', 'complete');
create type public.admissions_conversion_status as enum ('draft', 'ready_for_conversion', 'converted', 'cancelled');
create type public.module_mode as enum ('practical', 'online');
create type public.term_status as enum ('draft', 'published', 'active', 'closed');
create type public.application_document_verification_status as enum ('unverified', 'verified', 'rejected');
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
  country text
);

create table public.students (
  id uuid primary key,
  person_id uuid references public.persons(id)
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
  sent_at timestamptz,
  status_updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users(id),
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
  credits integer not null,
  mode public.module_mode not null,
  active boolean not null default true
);

create table public.module_offerings (
  id uuid primary key,
  module_id uuid not null references public.course_modules(id),
  term_id uuid not null references public.terms(id),
  price_pence integer not null,
  capacity integer not null
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
  retention_class text
);

create table public.admission_leads (
  id uuid primary key,
  person_id uuid references public.persons(id),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  stage public.admission_lead_stage not null default 'interest',
  programme text not null default 'pgcert',
  converted_student_id uuid references public.students(id),
  archived boolean not null default false,
  next_action_on date
);

create table public.applications (
  id uuid primary key,
  admission_lead_id uuid not null references public.admission_leads(id),
  person_id uuid not null references public.persons(id),
  status public.application_status not null default 'draft',
  programme text not null default 'pgcert',
  intended_start_term_id uuid references public.terms(id),
  first_name text,
  last_name text,
  email text,
  converted_student_id uuid references public.students(id),
  converted_at timestamptz
);

create table public.application_offers (
  id uuid primary key,
  application_id uuid not null references public.applications(id),
  person_id uuid not null references public.persons(id),
  offer_reference text not null,
  programme text not null default 'pgcert',
  intended_start_term_id uuid references public.terms(id),
  status public.application_offer_status not null default 'issued',
  accepted_at timestamptz,
  converted_student_id uuid references public.students(id),
  converted_at timestamptz
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
  accepted_offer_entity_type text not null,
  accepted_offer_entity_id uuid not null,
  registration_entity_type text not null,
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
  programme text not null,
  start_term_id uuid not null references public.terms(id),
  initial_module_offering_ids uuid[] not null default '{}',
  student_id uuid references public.students(id),
  converted_at timestamptz,
  converted_by_user_id uuid references auth.users(id),
  unique (registration_entity_type, registration_entity_id)
);

create table public.admissions_conversion_documents (
  id uuid primary key default gen_random_uuid(),
  conversion_request_id uuid not null references public.admissions_conversion_requests(id),
  managed_file_id uuid not null references public.managed_files(id),
  document_kind text not null,
  verified_at timestamptz not null,
  verified_by_user_id uuid references auth.users(id),
  unique (conversion_request_id, managed_file_id)
);

create table public.admissions_registrations (
  id uuid primary key,
  application_offer_id uuid not null references public.application_offers(id),
  application_id uuid not null references public.applications(id),
  admission_lead_id uuid not null references public.admission_leads(id),
  person_id uuid not null references public.persons(id),
  status public.admissions_registration_status not null default 'not_started',
  programme text not null default 'pgcert',
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
  terms_acceptance_user_agent text,
  submitted_at timestamptz,
  submitted_by_auth_user_id uuid references auth.users(id),
  saved_at timestamptz,
  conversion_request_id uuid references public.admissions_conversion_requests(id),
  student_id uuid references public.students(id),
  converted_at timestamptz,
  converted_by_user_id uuid references auth.users(id),
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

create function public.convert_admissions_registration(p_conversion_request_id uuid)
returns table (
  conversion_request_id uuid,
  student_id uuid
)
language plpgsql
as $$
begin
  conversion_request_id := p_conversion_request_id;
  student_id := '${studentId}';
  return next;
end;
$$;
`;

async function createLapseWorkflowDb(options: { actor?: "admin" | "teacher" | "applicant" } = {}) {
  const db = new PGlite();
  const actor = options.actor ?? "admin";
  const actorUserId = actor === "teacher" ? teacherUserId : actor === "applicant" ? applicantUserId : staffUserId;

  await db.exec(lapseRpcTestSchema);
  await db.exec(lapseMigration);
  await db.exec(`
    insert into auth.users (id) values
      ('${staffUserId}'),
      ('${teacherUserId}'),
      ('${applicantUserId}');

    insert into public.staff_profiles (id, full_name, role, active) values
      ('${staffUserId}', 'Admissions Admin', 'admin', true),
      ('${teacherUserId}', 'Teacher User', 'teacher', true);

    insert into public.persons (id, first_name, last_name, email)
    values ('${personId}', 'Amara', 'Lewis', 'amara@example.nhs.uk');

    insert into public.students (id, person_id)
    values ('${studentId}', '${personId}');

    insert into public.terms (id, name, starts_on, status)
    values ('${termId}', 'September 2026', '2026-09-01', 'published');

    insert into public.course_modules (id, code, title, credits, mode, active)
    values ('${moduleId}', 'POCUS-1', 'Core POCUS', 10, 'online', true);

    insert into public.module_offerings (id, module_id, term_id, price_pence, capacity)
    values ('${offeringId}', '${moduleId}', '${termId}', 100000, 20);

    insert into public.admission_leads (id, person_id, first_name, last_name, email, stage, programme)
    values ('${leadId}', '${personId}', 'Amara', 'Lewis', 'amara@example.nhs.uk', 'registration_in_progress', 'pgcert');

    insert into public.applications (id, admission_lead_id, person_id, status, programme, intended_start_term_id, first_name, last_name, email)
    values ('${applicationId}', '${leadId}', '${personId}', 'submitted', 'pgcert', '${termId}', 'Amara', 'Lewis', 'amara@example.nhs.uk');

    insert into public.application_offers (id, application_id, person_id, offer_reference, programme, intended_start_term_id, status, accepted_at)
    values ('${offerId}', '${applicationId}', '${personId}', 'BETAR-2026-001', 'pgcert', '${termId}', 'accepted', '2026-07-20T12:00:00Z');

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
      email,
      module_confirmation_accepted,
      module_confirmed_at,
      module_confirmed_by_auth_user_id,
      terms_version,
      terms_hash,
      terms_accepted_at,
      terms_accepted_by_auth_user_id,
      terms_accepted_by_person_id,
      submitted_at,
      submitted_by_auth_user_id,
      registration_deadline_at
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
      'amara@example.nhs.uk',
      true,
      '2026-07-21T12:00:00Z',
      '${applicantUserId}',
      'registration-terms-v1',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '2026-07-21T12:00:00Z',
      '${applicantUserId}',
      '${personId}',
      '2026-07-21T12:00:00Z',
      '${applicantUserId}',
      '2026-07-25T12:00:00Z'
    );

    insert into public.admission_leads (id, person_id, first_name, last_name, email, stage, programme)
    values ('12121212-1212-4121-8121-121212121212', '${personId}', 'Complete', 'Applicant', 'complete@example.nhs.uk', 'registered', 'pgcert');

    insert into public.applications (id, admission_lead_id, person_id, status, programme, intended_start_term_id, first_name, last_name, email)
    values ('13131313-1313-4131-8131-131313131313', '12121212-1212-4121-8121-121212121212', '${personId}', 'submitted', 'pgcert', '${termId}', 'Complete', 'Applicant', 'complete@example.nhs.uk');

    insert into public.application_offers (id, application_id, person_id, offer_reference, programme, intended_start_term_id, status, accepted_at)
    values ('14141414-1414-4141-8141-141414141414', '13131313-1313-4131-8131-131313131313', '${personId}', 'BETAR-COMPLETE', 'pgcert', '${termId}', 'accepted', '2026-07-20T12:00:00Z');

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
      email,
      student_id,
      converted_at,
      registration_deadline_at
    )
    values (
      '${completeRegistrationId}',
      '14141414-1414-4141-8141-141414141414',
      '13131313-1313-4131-8131-131313131313',
      '12121212-1212-4121-8121-121212121212',
      '${personId}',
      'complete',
      'pgcert',
      '${termId}',
      'Complete',
      'Applicant',
      'complete@example.nhs.uk',
      '${studentId}',
      '2026-07-22T12:00:00Z',
      '2026-07-25T12:00:00Z'
    );

    insert into public.admission_leads (id, person_id, first_name, last_name, email, stage, programme, converted_student_id)
    values ('15151515-1515-4151-8151-151515151515', '${personId}', 'Converted', 'Applicant', 'converted@example.nhs.uk', 'registered', 'pgcert', '${studentId}');

    insert into public.applications (id, admission_lead_id, person_id, status, programme, intended_start_term_id, first_name, last_name, email)
    values ('16161616-1616-4161-8161-161616161616', '15151515-1515-4151-8151-151515151515', '${personId}', 'submitted', 'pgcert', '${termId}', 'Converted', 'Applicant', 'converted@example.nhs.uk');

    insert into public.application_offers (id, application_id, person_id, offer_reference, programme, intended_start_term_id, status, accepted_at)
    values ('17171717-1717-4171-8171-171717171717', '16161616-1616-4161-8161-161616161616', '${personId}', 'BETAR-CONVERTED', 'pgcert', '${termId}', 'accepted', '2026-07-20T12:00:00Z');

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
      email,
      student_id,
      registration_deadline_at
    )
    values (
      '${convertedRegistrationId}',
      '17171717-1717-4171-8171-171717171717',
      '16161616-1616-4161-8161-161616161616',
      '15151515-1515-4151-8151-151515151515',
      '${personId}',
      'submitted',
      'pgcert',
      '${termId}',
      'Converted',
      'Applicant',
      'converted@example.nhs.uk',
      '${studentId}',
      '2026-07-25T12:00:00Z'
    );

    select set_config('request.jwt.claim.sub', '${actorUserId}', false);
    select set_config('request.jwt.claim.role', 'authenticated', false);
  `);

  return db;
}

describe("admissions registration", () => {
  it("defines required registration slots and optional student photo", () => {
    expect(admissionsRegistrationDocumentSlotDefinitions.map((slot) => [slot.key, slot.required, slot.bucket])).toEqual([
      ["identity_evidence", true, "id-documents"],
      ["qualification_evidence", true, "qualification-documents"],
      ["student_id_photo", false, "student-photos"]
    ]);
  });

  it("parses registration forms", () => {
    const formData = new FormData();
    formData.set("offer_id", "77777777-7777-4777-8777-777777777777");
    expect(parseBeginAdmissionsRegistrationForm(formData)).toEqual({
      offer_id: "77777777-7777-4777-8777-777777777777"
    });

    formData.set("registration_id", "88888888-8888-4888-8888-888888888888");
    formData.set("first_name", "Amara");
    formData.set("last_name", "Lewis");
    formData.set("email", "AMARA.LEWIS@example.nhs.uk");
    formData.set("module_confirmation_accepted", "on");
    expect(parseAdmissionsRegistrationDraftForm(formData)).toMatchObject({
      registration_id: "88888888-8888-4888-8888-888888888888",
      first_name: "Amara",
      last_name: "Lewis",
      email: "amara.lewis@example.nhs.uk",
      module_confirmation_accepted: true
    });

    formData.set("slot_key", "identity_evidence");
    expect(parseAdmissionsRegistrationDocumentUploadForm(formData)).toEqual({
      registration_id: "88888888-8888-4888-8888-888888888888",
      slot_key: "identity_evidence"
    });

    formData.set("verification_route", "in_person");
    expect(parseAdmissionsRegistrationDocumentVerificationRouteForm(formData)).toEqual({
      registration_id: "88888888-8888-4888-8888-888888888888",
      slot_key: "identity_evidence",
      verification_route: "in_person"
    });

    formData.set("application_id", "66666666-6666-4666-8666-666666666666");
    formData.set("slot_id", "99999999-9999-4999-8999-999999999999");
    formData.set("verification_status", "unverified");
    formData.set("verification_note", "Bring the original passport to induction.");
    expect(parseStaffRegistrationDocumentVerificationForm(formData)).toEqual({
      application_id: "66666666-6666-4666-8666-666666666666",
      registration_id: "88888888-8888-4888-8888-888888888888",
      slot_id: "99999999-9999-4999-8999-999999999999",
      verification_route: "in_person",
      verification_status: "unverified",
      verification_note: "Bring the original passport to induction."
    });

    formData.set("terms_accepted", "on");
    expect(parseSubmitAdmissionsRegistrationForm(formData)).toEqual({
      registration_id: "88888888-8888-4888-8888-888888888888",
      terms_accepted: true
    });

    formData.set("lapse_reason", " Deadline passed ");
    expect(parseProcessAdmissionsRegistrationDeadlineWorkflowForm(formData)).toEqual({
      lapse_reason: "Deadline passed"
    });

    formData.set("application_id", "66666666-6666-4666-8666-666666666666");
    formData.set("reopen_reason", " Applicant supplied a valid reason ");
    formData.set("new_deadline_at", "2026-09-15");
    expect(parseReopenLapsedAdmissionsRegistrationForm(formData)).toEqual({
      registration_id: "88888888-8888-4888-8888-888888888888",
      application_id: "66666666-6666-4666-8666-666666666666",
      reopen_reason: "Applicant supplied a valid reason",
      new_deadline_at: "2026-09-15T23:59:59Z"
    });
  });

  it("validates registration document uploads by slot", () => {
    expect(validateAdmissionsRegistrationDocumentUpload({ file: uploadFile(), slotKey: "identity_evidence" })).toMatchObject({
      valid: true,
      sanitizedFilename: "passport-scan.pdf",
      extension: ".pdf"
    });

    expect(
      validateAdmissionsRegistrationDocumentUpload({
        file: uploadFile({ name: "photo.pdf", type: "application/pdf" }),
        slotKey: "student_id_photo"
      }).errors
    ).toContain("File type is not accepted for this slot.");

    expect(
      validateAdmissionsRegistrationDocumentUpload({
        file: uploadFile({ name: "passport.exe" }),
        slotKey: "identity_evidence"
      }).errors
    ).toContain("File extension is not accepted for this slot.");
  });

  it("builds object paths scoped to person, registration, and slot", () => {
    expect(
      buildAdmissionsRegistrationDocumentObjectPath(
        "person-1",
        "registration-1",
        "identity_evidence",
        "passport.pdf",
        "token-1"
      )
    ).toBe("person-1/registration-1/identity_evidence/token-1-passport.pdf");
  });

  it("gates registration to accepted owned offers only", () => {
    expect(
      canAccessAcceptedOfferRegistration({
        offerStatus: "accepted",
        offerPersonId: "person-1",
        actorPersonId: "person-1",
        leadStage: "accepted",
        archived: false
      })
    ).toBe(true);

    expect(
      canAccessAcceptedOfferRegistration({
        offerStatus: "issued",
        offerPersonId: "person-1",
        actorPersonId: "person-1",
        leadStage: "offered",
        archived: false
      })
    ).toBe(false);

    expect(
      canAccessAcceptedOfferRegistration({
        offerStatus: "accepted",
        offerPersonId: "person-1",
        actorPersonId: "person-2",
        leadStage: "accepted",
        archived: false
      })
    ).toBe(false);
  });

  it("allows staff reopen only for lapsed unconverted registrations", () => {
    expect(
      canReopenLapsedRegistration({
        registrationStatus: "lapsed",
        leadStage: "registration_lapsed"
      })
    ).toEqual({ allowed: true, reason: "allowed" });

    expect(
      canReopenLapsedRegistration({
        registrationStatus: "submitted",
        leadStage: "registration_in_progress"
      }).reason
    ).toBe("not_lapsed");

    expect(
      canReopenLapsedRegistration({
        registrationStatus: "lapsed",
        leadStage: "registration_lapsed",
        convertedStudentId: "student-1"
      }).reason
    ).toBe("already_converted");
  });

  it("executes the registration deadline workflow with audit and suppressed correspondence", async () => {
    const db = await createLapseWorkflowDb();

    const workflowResult = await db.query<{ result: string }>(
      "select public.process_admissions_registration_deadline_workflow($1, $2)::text as result",
      ["2026-08-01T12:00:00Z", "Deadline passed in test"]
    );
    expect(workflowResult.rows[0]?.result).toContain('"lapsed_count": 1');

    const state = await db.query<{
      registration_status: string;
      lead_stage: string;
      complete_status: string;
      converted_status: string;
      audit_count: number;
      correspondence_count: number;
      delivery_status: string;
      provider_message_id: string | null;
      stored_reason: string | null;
    }>(`
      select
        (select status::text from public.admissions_registrations where id = '${registrationId}') as registration_status,
        (select stage::text from public.admission_leads where id = '${leadId}') as lead_stage,
        (select status::text from public.admissions_registrations where id = '${completeRegistrationId}') as complete_status,
        (select status::text from public.admissions_registrations where id = '${convertedRegistrationId}') as converted_status,
        (select count(*)::int from public.audit_events where action = '${admissionsRegistrationLapsedAction}') as audit_count,
        (select count(*)::int from public.correspondence_logs where template_key = '${admissionsRegistrationLapsedTemplateKey}') as correspondence_count,
        (select delivery_status::text from public.correspondence_logs where template_key = '${admissionsRegistrationLapsedTemplateKey}' limit 1) as delivery_status,
        (select provider_message_id from public.correspondence_logs where template_key = '${admissionsRegistrationLapsedTemplateKey}' limit 1) as provider_message_id,
        (select lapsed_reason from public.admissions_registrations where id = '${registrationId}') as stored_reason
    `);

    expect(state.rows[0]).toEqual({
      registration_status: "lapsed",
      lead_stage: "registration_lapsed",
      complete_status: "complete",
      converted_status: "submitted",
      audit_count: 1,
      correspondence_count: 1,
      delivery_status: "suppressed",
      provider_message_id: null,
      stored_reason: "Deadline passed in test"
    });

    await expect(
      db.query("select * from public.convert_submitted_admissions_registration($1)", [registrationId])
    ).rejects.toThrow(/Lapsed registrations must be reopened/);
  });

  it("requires admin/service authorization for the registration deadline workflow", async () => {
    const teacherDb = await createLapseWorkflowDb({ actor: "teacher" });
    await expect(
      teacherDb.query("select public.process_admissions_registration_deadline_workflow($1, $2)", [
        "2026-08-01T12:00:00Z",
        "Deadline passed"
      ])
    ).rejects.toThrow(/Only admissions admins/);

    const applicantDb = await createLapseWorkflowDb({ actor: "applicant" });
    await expect(
      applicantDb.query("select public.process_admissions_registration_deadline_workflow($1, $2)", [
        "2026-08-01T12:00:00Z",
        "Deadline passed"
      ])
    ).rejects.toThrow(/Only admissions admins/);
  });

  it("reopens lapsed registrations with a mandatory reason and clears current submission metadata", async () => {
    const db = await createLapseWorkflowDb();
    await db.query("select public.process_admissions_registration_deadline_workflow($1, $2)", [
      "2026-08-01T12:00:00Z",
      "Deadline passed"
    ]);

    await expect(
      db.query("select public.reopen_lapsed_admissions_registration($1, $2, $3)", [registrationId, " ", "2099-01-01T23:59:59Z"])
    ).rejects.toThrow(/Reopen reason is required/);

    await db.query("select public.reopen_lapsed_admissions_registration($1, $2, $3)", [
      registrationId,
      "Applicant contacted admissions with updated availability",
      "2099-01-01T23:59:59Z"
    ]);

    const reopened = await db.query<{
      registration_status: string;
      lead_stage: string;
      submitted_at: string | null;
      terms_version: string | null;
      terms_accepted_at: string | null;
      module_confirmation_accepted: boolean;
      reopen_audit_count: number;
      correspondence_count: number;
      delivery_status: string;
      provider_message_id: string | null;
      reopened_reason: string | null;
    }>(`
      select
        (select status::text from public.admissions_registrations where id = '${registrationId}') as registration_status,
        (select stage::text from public.admission_leads where id = '${leadId}') as lead_stage,
        (select submitted_at::text from public.admissions_registrations where id = '${registrationId}') as submitted_at,
        (select terms_version from public.admissions_registrations where id = '${registrationId}') as terms_version,
        (select terms_accepted_at::text from public.admissions_registrations where id = '${registrationId}') as terms_accepted_at,
        (select module_confirmation_accepted from public.admissions_registrations where id = '${registrationId}') as module_confirmation_accepted,
        (select count(*)::int from public.audit_events where action = '${admissionsRegistrationReopenedAction}') as reopen_audit_count,
        (select count(*)::int from public.correspondence_logs where template_key = '${admissionsRegistrationReopenedTemplateKey}') as correspondence_count,
        (select delivery_status::text from public.correspondence_logs where template_key = '${admissionsRegistrationReopenedTemplateKey}' limit 1) as delivery_status,
        (select provider_message_id from public.correspondence_logs where template_key = '${admissionsRegistrationReopenedTemplateKey}' limit 1) as provider_message_id,
        (select reopened_reason from public.admissions_registrations where id = '${registrationId}') as reopened_reason
    `);

    expect(reopened.rows[0]).toEqual({
      registration_status: "in_progress",
      lead_stage: "registration_in_progress",
      submitted_at: null,
      terms_version: null,
      terms_accepted_at: null,
      module_confirmation_accepted: false,
      reopen_audit_count: 1,
      correspondence_count: 1,
      delivery_status: "suppressed",
      provider_message_id: null,
      reopened_reason: "Applicant contacted admissions with updated availability"
    });
  });

  it("blocks non-admin staff from reopening lapsed registrations", async () => {
    const db = await createLapseWorkflowDb();
    await db.query("select public.process_admissions_registration_deadline_workflow($1, $2)", [
      "2026-08-01T12:00:00Z",
      "Deadline passed"
    ]);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [teacherUserId]);

    await expect(
      db.query("select public.reopen_lapsed_admissions_registration($1, $2, $3)", [
        registrationId,
        "Applicant contacted admissions",
        "2099-01-01T23:59:59Z"
      ])
    ).rejects.toThrow(/Only admissions admins/);
  });

  it("adds registration lapse/reopen workflow migration without finance or sending side effects", () => {
    const migration = lapseMigration;

    expect(migration).toContain("alter type public.admission_lead_stage add value if not exists 'registration_lapsed'");
    expect(migration).toContain("alter type public.admissions_registration_status add value if not exists 'lapsed'");
    expect(migration).toContain("registration_deadline_at");
    expect(migration).toContain("lapsed_at");
    expect(migration).toContain("reopened_at");
    expect(migration).toContain("prevent_invalid_admissions_registration_lifecycle_update");
    expect(migration).toContain("Lapsed registrations must be reopened before submission or conversion");
    expect(migration).toContain("Registration deadline has passed; admissions must reopen the registration before submission");
    expect(migration).toContain("Registration deadline has passed; admissions must reopen the registration before conversion");
    expect(migration).toContain("create or replace function public.process_admissions_registration_deadline_workflow");
    expect(migration).toContain("create or replace function public.reopen_lapsed_admissions_registration");
    expect(migration).toContain("'registration.lapsed'");
    expect(migration).toContain("'registration.reopened'");
    expect(migration).toContain("'registration_lapsed_notice'");
    expect(migration).toContain("'registration_reopened_notice'");
    expect(migration).toContain("'suppressed'");
    expect(migration).toContain("'production_email_send_enabled', false");
    expect(migration).toContain("'provider_message_id', null");
    expect(migration).toContain("submission_fields_cleared");
    expect(migration).toContain("Lapsed registrations must be reopened and resubmitted before conversion");
    expect(migration).not.toContain("insert into public.finance_records");
    expect(migration).not.toContain("insert into public.enrolments (student_id");

    expect(admissionsRegistrationLapsedAction).toBe("registration.lapsed");
    expect(admissionsRegistrationReopenedAction).toBe("registration.reopened");
  });

  it("keeps T&C versioning stable and adds migration foundations without conversion side effects", () => {
    expect(admissionsRegistrationTermsText.length).toBeGreaterThan(80);
    expect(admissionsRegistrationTermsHash).toMatch(/^[a-f0-9]{64}$/);

    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/0029_accepted_offer_registration_foundation.sql"),
      "utf8"
    );

    expect(migration).toContain("create type public.admissions_registration_status");
    expect(migration).toContain("create table public.admissions_registrations");
    expect(migration).toContain("create table public.admissions_registration_person_detail_versions");
    expect(migration).toContain("create table public.admissions_registration_document_slots");
    expect(migration).toContain("module_code text not null");
    expect(migration).toContain("module_title text not null");
    expect(migration).toContain("price_pence integer not null");
    expect(migration).toContain("join public.course_modules course_module");
    expect(migration).toContain("join public.terms term");
    expect(migration).toContain("create or replace function public.begin_admissions_registration");
    expect(migration).toContain("create or replace function public.save_admissions_registration");
    expect(migration).toContain("create or replace function public.record_admissions_registration_document_upload");
    expect(migration).toContain("create or replace function public.submit_admissions_registration");
    expect(migration).toContain("'registration.started'");
    expect(migration).toContain("'registration.saved'");
    expect(migration).toContain("'registration.submitted'");
    expect(migration).toContain("'registration.terms_accepted'");
    expect(migration).toContain("'document.uploaded'");
    expect(migration).toContain("v_offer.status <> 'accepted'");
    expect(migration).toContain("v_lead.stage not in ('accepted', 'registration_in_progress')");
    expect(migration).toContain("p_terms_version");
    expect(migration).toContain("p_terms_hash");
    expect(migration).not.toContain("convert_admissions_registration(");
    expect(migration).not.toContain("insert into public.enrolments");
    expect(migration).not.toContain("insert into public.finance_records");
    expect(migration).not.toContain("insert into public.students");

    const actions = readFileSync(join(process.cwd(), "src/app/portal/registration/actions.ts"), "utf8");
    expect(actions.indexOf("save_admissions_registration")).toBeLessThan(actions.indexOf("submit_admissions_registration"));
    expect(actions).toContain("from(\"admissions_registration_terms_versions\")");
  });

  it("adds auditable upload or induction verification routes without placeholder files", () => {
    expect(documentVerificationRouteMigration).toContain("add column verification_route text not null default 'upload'");
    expect(documentVerificationRouteMigration).toContain("set_admissions_registration_document_verification_route");
    expect(documentVerificationRouteMigration).toContain("verify_admissions_registration_document_slot");
    expect(documentVerificationRouteMigration).toContain("registration.document_verification_route_selected");
    expect(documentVerificationRouteMigration).toContain("registration.document_verification_recorded");
    expect(documentVerificationRouteMigration).toContain("document_slot.verification_route = 'in_person'");
    expect(documentVerificationRouteMigration).toContain("requires_staff_follow_up");
    expect(documentVerificationRouteMigration).not.toContain("insert into storage.objects");
    expect(documentVerificationRouteMigration).not.toContain("insert into public.managed_files");
  });
});
