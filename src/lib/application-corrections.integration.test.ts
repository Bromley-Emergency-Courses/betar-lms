import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0036_application_correction_evidence_foundation.sql"),
  "utf8"
);

const staffUserId = "11111111-1111-4111-8111-111111111111";
const applicantUserId = "22222222-2222-4222-8222-222222222222";
const personId = "33333333-3333-4333-8333-333333333333";
const leadId = "44444444-4444-4444-8444-444444444444";
const applicationId = "55555555-5555-4555-8555-555555555555";
const oldFileId = "66666666-6666-4666-8666-666666666666";
const slotId = "88888888-8888-4888-8888-888888888888";

const foundationSchema = `
create schema auth;
create schema storage;
create role authenticated;

create table storage.objects (
  bucket_id text not null,
  name text not null,
  metadata jsonb not null default '{}'::jsonb,
  primary key (bucket_id, name)
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create type public.portal_actor_type as enum ('applicant', 'student');
create type public.audit_actor_type as enum ('staff', 'applicant', 'student', 'service');
create type public.correspondence_channel as enum ('email', 'letter');
create type public.correspondence_delivery_status as enum ('queued', 'sent', 'delivered', 'failed', 'bounced', 'suppressed');
create type public.correspondence_bounce_status as enum ('none', 'soft_bounce', 'hard_bounce', 'complaint', 'blocked', 'unknown');
create type public.application_status as enum ('draft', 'submitted');
create type public.application_review_readiness_status as enum ('not_ready', 'needs_information', 'ready_for_decision');
create type public.application_decision_outcome as enum ('offer', 'rejection');
create type public.application_document_slot_key as enum (
  'qualification_evidence',
  'professional_registration_evidence',
  'cv_or_supporting_evidence',
  'funding_evidence'
);
create type public.application_document_verification_status as enum ('unverified', 'verified', 'rejected');

create function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.is_admin', true), '') = 'true';
$$;

create function public.current_person_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.person_id', true), '')::uuid;
$$;

create function public.current_portal_actor_type()
returns public.portal_actor_type
language sql
stable
as $$
  select nullif(current_setting('app.actor_type', true), '')::public.portal_actor_type;
$$;

create table public.staff_profiles (
  id uuid primary key,
  active boolean not null default true
);

create table public.persons (
  id uuid primary key,
  first_name text not null,
  last_name text not null,
  email text not null
);

create table public.admission_leads (
  id uuid primary key,
  person_id uuid references public.persons(id),
  first_name text not null,
  last_name text not null,
  email text not null,
  archived boolean not null default false,
  converted_student_id uuid
);

create table public.applications (
  id uuid primary key,
  admission_lead_id uuid not null references public.admission_leads(id),
  person_id uuid not null references public.persons(id),
  status public.application_status not null,
  title text,
  first_name text,
  middle_names text,
  last_name text,
  preferred_name text,
  previous_surname text,
  date_of_birth date,
  previous_study_detail text,
  partner_student_id text,
  email text,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  postcode text,
  country text,
  clinical_role text,
  employer text,
  department_specialty text,
  professional_registration_body text,
  professional_registration_number text,
  highest_qualification text,
  qualification_awarding_body text,
  qualification_year integer check (qualification_year is null or qualification_year between 1900 and 2100),
  qualification_result text,
  qualification_country text,
  work_experience text,
  nationality text,
  country_of_birth text,
  country_of_residence text,
  needs_visa_check boolean not null default false,
  visa_notes text,
  funding_source text,
  funding_organisation text,
  funding_contact text,
  pocus_previous_experience text,
  pocus_motivation text,
  pocus_case_improved_management text,
  pocus_limitations_case text,
  evidence_summary text,
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.managed_files (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.persons(id),
  bucket text not null,
  object_path text not null,
  label text not null,
  file_category text not null default 'other',
  original_filename text,
  sanitized_filename text,
  content_type text,
  size_bytes bigint,
  uploaded_by_user_id uuid,
  uploaded_by_person_id uuid references public.persons(id),
  retention_class text not null default 'application_document',
  created_at timestamptz not null default now()
);

create table public.application_document_slots (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  person_id uuid not null references public.persons(id),
  slot_key public.application_document_slot_key not null,
  label text not null,
  required boolean not null default false,
  managed_file_id uuid references public.managed_files(id),
  original_filename text,
  sanitized_filename text,
  content_type text,
  size_bytes bigint,
  uploaded_at timestamptz,
  uploaded_by_user_id uuid,
  uploaded_by_person_id uuid references public.persons(id),
  verification_status public.application_document_verification_status not null default 'unverified',
  verifier_user_id uuid references public.staff_profiles(id),
  verification_at timestamptz,
  verification_note text,
  retention_class text not null default 'application_document',
  updated_at timestamptz not null default now(),
  unique (application_id, slot_key)
);

create table public.application_reviews (
  application_id uuid primary key references public.applications(id),
  reviewed_by_user_id uuid references public.staff_profiles(id),
  readiness_status public.application_review_readiness_status not null,
  last_reviewed_at timestamptz,
  updated_at timestamptz not null default now()
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
  delivery_status public.correspondence_delivery_status not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz not null default now()
);

create table public.application_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  admission_lead_id uuid not null references public.admission_leads(id),
  person_id uuid not null references public.persons(id),
  outcome public.application_decision_outcome not null,
  decision_reason text not null,
  decided_by_user_id uuid references public.staff_profiles(id),
  decided_at timestamptz not null default now()
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

async function useStaff(db: PGlite) {
  await db.exec(`
    select set_config('request.jwt.claim.sub', '${staffUserId}', false);
    select set_config('app.is_admin', 'true', false);
    select set_config('app.person_id', '', false);
    select set_config('app.actor_type', '', false);
  `);
}

async function useApplicant(db: PGlite) {
  await db.exec(`
    select set_config('request.jwt.claim.sub', '${applicantUserId}', false);
    select set_config('app.is_admin', 'false', false);
    select set_config('app.person_id', '${personId}', false);
    select set_config('app.actor_type', 'applicant', false);
  `);
}

describe("application correction and evidence database workflow", () => {
  it("preserves correction rounds and evidence versions while guarding decisions", async () => {
    const db = new PGlite();

    try {
      await db.exec(foundationSchema);
      await db.exec(migration);
      await db.exec(`
        insert into public.staff_profiles (id) values ('${staffUserId}');
        insert into public.persons (id, first_name, last_name, email)
        values ('${personId}', 'Asha', 'Original', 'asha@example.test');
        insert into public.admission_leads (id, person_id, first_name, last_name, email)
        values ('${leadId}', '${personId}', 'Asha', 'Original', 'asha@example.test');
        insert into public.applications (
          id, admission_lead_id, person_id, status, first_name, last_name, previous_surname, date_of_birth,
          email, phone, address_line_1, city, postcode, country, clinical_role, employer,
          department_specialty, professional_registration_body, professional_registration_number,
          highest_qualification, qualification_awarding_body, qualification_year, work_experience,
          nationality, country_of_residence, pocus_previous_experience, pocus_motivation,
          pocus_case_improved_management, pocus_limitations_case, submitted_at
        ) values (
          '${applicationId}', '${leadId}', '${personId}', 'submitted', 'Asha', 'Original', 'Prior', '1990-01-01',
          'asha@example.test', '07000000000', '1 Test Road', 'London', 'SW1A 1AA', 'UK', 'Doctor', 'NHS',
          'Emergency Medicine', 'GMC', '1234567', 'MBBS', 'Test University', 2015, 'Ten years',
          'British', 'UK', 'Some experience', 'Motivation', 'Case', 'Limitations', now()
        );
        insert into public.application_reviews (application_id, readiness_status)
        values ('${applicationId}', 'ready_for_decision');
        insert into public.managed_files (
          id, person_id, bucket, object_path, label, original_filename, sanitized_filename,
          content_type, size_bytes, uploaded_by_person_id
        ) values (
          '${oldFileId}', '${personId}', 'qualification-documents', 'old.pdf', 'Qualification',
          'old.pdf', 'old.pdf', 'application/pdf', 100, '${personId}'
        );
        insert into public.application_document_slots (
          id, application_id, person_id, slot_key, label, required, managed_file_id,
          original_filename, sanitized_filename, content_type, size_bytes, uploaded_by_person_id,
          verification_status, verifier_user_id, verification_at
        ) values (
          '${slotId}', '${applicationId}', '${personId}', 'qualification_evidence', 'Qualification', true,
          '${oldFileId}', 'old.pdf', 'old.pdf', 'application/pdf', 100, '${personId}', 'unverified',
          null, null
        );
      `);

      await useStaff(db);
      const supersededOverride = await db.query<{ id: string }>(`
        select public.record_application_evidence_override(
          '${slotId}',
          'Temporary override while the original is checked.'
        ) as id
      `);
      const requestResult = await db.query<{ result: { request_id: string; correspondence_log_id: string } }>(`
        select public.request_application_corrections(
          '${applicationId}',
          '[
            {"target_type":"application_field","target_key":"last_name","instructions":"Use the legal surname."},
            {"target_type":"application_field","target_key":"previous_surname","instructions":"Clear this if it is not applicable."},
            {"target_type":"document_slot","target_key":"qualification_evidence","instructions":"Upload the complete certificate."}
          ]'::jsonb,
          'Two specific corrections are required.',
          now() + interval '14 days'
        ) as result
      `);
      const requestId = requestResult.rows[0]?.result.request_id;
      expect(requestId).toBeTruthy();

      const opened = await db.query<{ status: string; readiness: string; delivery: string; original_last_name: string }>(`
        select
          request.status::text,
          review.readiness_status::text as readiness,
          log.delivery_status::text as delivery,
          request.application_snapshot->>'last_name' as original_last_name
        from public.application_correction_requests request
        join public.application_reviews review on review.application_id = request.application_id
        join public.correspondence_logs log on log.id = request.correspondence_log_id
        where request.id = '${requestId}'
      `);
      expect(opened.rows[0]).toEqual({
        status: "open",
        readiness: "needs_information",
        delivery: "queued",
        original_last_name: "Original"
      });

      const items = await db.query<{ id: string; target_type: string; target_key: string }>(`
        select id, target_type::text, target_key from public.application_correction_items
        where request_id = '${requestId}' order by target_type
      `);
      const documentItemId = items.rows.find((item) => item.target_type === "document_slot")?.id;
      const fieldItemId = items.rows.find((item) => item.target_key === "last_name")?.id;
      const clearedFieldItemId = items.rows.find((item) => item.target_key === "previous_surname")?.id;
      expect(documentItemId).toBeTruthy();
      expect(fieldItemId).toBeTruthy();
      expect(clearedFieldItemId).toBeTruthy();

      const replacementObjectPath = `${personId}/${applicationId}/qualification_evidence/replacement.pdf`;
      await db.query(
        `insert into storage.objects (bucket_id, name, metadata)
         values ('qualification-documents', $1, '{"mimetype":"application/pdf","size":200}'::jsonb)`,
        [replacementObjectPath]
      );

      await useApplicant(db);
      await db.query(`select public.save_application_correction_response($1, $2::jsonb, null, $3)`, [
        fieldItemId,
        JSON.stringify("Corrected"),
        "Matches my passport."
      ]);
      await db.query(`select public.save_application_correction_response($1, null, null, null, true)`, [
        clearedFieldItemId
      ]);
      const replacementUpload = await db.query<{ id: string }>(`
        select public.record_application_correction_document_upload(
          $1,
          'qualification-documents',
          $2,
          'replacement.pdf',
          'replacement.pdf',
          'application/pdf',
          200,
          'The complete certificate is attached.'
        ) as id
      `, [
        documentItemId,
        replacementObjectPath
      ]);
      const replacementFileId = replacementUpload.rows[0]?.id;
      expect(replacementFileId).toBeTruthy();
      const savedDrafts = await db.query<{ count: number }>(`
        select count(*)::int as count from public.application_correction_item_drafts
        where request_id = '${requestId}'
      `);
      expect(savedDrafts.rows[0]?.count).toBe(3);
      await db.query(`select public.resubmit_application_corrections($1)`, [requestId]);

      const submittedVersions = await db.query<{ count: number }>(`
        select count(*)::int as count from public.application_correction_item_versions
        where request_id = '${requestId}' and revision_number = 1
      `);
      expect(submittedVersions.rows[0]?.count).toBe(3);

      await useStaff(db);
      await db.query(`select public.review_application_corrections($1, $2::jsonb)`, [
        requestId,
        JSON.stringify([
          { item_id: fieldItemId, outcome: "accepted", review_note: "Identity checked." },
          { item_id: clearedFieldItemId, outcome: "accepted", review_note: "Not applicable." },
          { item_id: documentItemId, outcome: "accepted", review_note: "Replacement received." }
        ])
      ]);

      const resolved = await db.query<{
        status: string;
        last_name: string;
        previous_surname: string | null;
        managed_file_id: string;
        verification_status: string;
        preserved_versions: number;
      }>(`
        select
          request.status::text,
          application.last_name,
          application.previous_surname,
          slot.managed_file_id,
          slot.verification_status::text,
          (select count(*)::int from public.application_document_slot_versions version where version.slot_id = slot.id) as preserved_versions
        from public.application_correction_requests request
        join public.applications application on application.id = request.application_id
        join public.application_document_slots slot on slot.application_id = application.id
        where request.id = '${requestId}'
      `);
      expect(resolved.rows[0]).toEqual({
        status: "resolved",
        last_name: "Corrected",
        previous_surname: null,
        managed_file_id: replacementFileId,
        verification_status: "unverified",
        preserved_versions: 1
      });
      const revokedOverride = await db.query<{ revoked_at: string | null }>(`
        select revoked_at from public.application_evidence_overrides
        where id = '${supersededOverride.rows[0]?.id}'
      `);
      expect(revokedOverride.rows[0]?.revoked_at).toBeTruthy();

      await expect(
        db.exec(`
          insert into public.application_decisions (
            application_id, admission_lead_id, person_id, outcome, decision_reason, decided_by_user_id
          ) values ('${applicationId}', '${leadId}', '${personId}', 'offer', 'Eligible', '${staffUserId}')
        `)
      ).rejects.toThrow("Offers require verified evidence or a valid slot-specific override");

      const override = await db.query<{ id: string }>(`
        select public.record_application_evidence_override('${slotId}', 'Verified directly with the awarding body.') as id
      `);
      await db.exec(`
        insert into public.application_decisions (
          application_id, admission_lead_id, person_id, outcome, decision_reason, decided_by_user_id
        ) values ('${applicationId}', '${leadId}', '${personId}', 'offer', 'Eligible', '${staffUserId}')
      `);
      const linkedOverride = await db.query<{ decision_id: string | null }>(`
        select decision_id from public.application_evidence_overrides where id = '${override.rows[0]?.id}'
      `);
      expect(linkedOverride.rows[0]?.decision_id).toBeTruthy();

      await db.exec(`
        insert into public.persons (id, first_name, last_name, email)
        values ('99999999-9999-4999-8999-999999999999', 'Rejected', 'Applicant', 'rejected@example.test');
        insert into public.admission_leads (id, person_id, first_name, last_name, email)
        values (
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          '99999999-9999-4999-8999-999999999999',
          'Rejected', 'Applicant', 'rejected@example.test'
        );
        insert into public.applications (
          id, admission_lead_id, person_id, status, first_name, last_name, email, submitted_at
        ) values (
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          '99999999-9999-4999-8999-999999999999',
          'submitted', 'Rejected', 'Applicant', 'rejected@example.test', now()
        );
        insert into public.application_reviews (application_id, readiness_status)
        values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'ready_for_decision');
        insert into public.application_document_slots (
          id, application_id, person_id, slot_key, label, required, verification_status
        ) values (
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          '99999999-9999-4999-8999-999999999999',
          'professional_registration_evidence', 'Registration', true, 'rejected'
        );
      `);

      const activeRequest = await db.query<{ result: { request_id: string } }>(`
        select public.request_application_corrections(
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          '[{"target_type":"document_slot","target_key":"funding_evidence","instructions":"Upload sponsor evidence."}]'::jsonb
        ) as result
      `);
      const placeholderSlot = await db.query<{ required: boolean; managed_file_id: string | null }>(`
        select required, managed_file_id
        from public.application_document_slots
        where application_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
          and slot_key = 'funding_evidence'
      `);
      expect(placeholderSlot.rows[0]).toEqual({ required: false, managed_file_id: null });
      await expect(
        db.exec(`select public.record_application_evidence_override(
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'Attempt to override rejected evidence.'
        )`)
      ).rejects.toThrow("Rejected evidence cannot be overridden");
      await expect(
        db.exec(`
          insert into public.application_decisions (
            application_id, admission_lead_id, person_id, outcome, decision_reason, decided_by_user_id
          ) values (
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            '99999999-9999-4999-8999-999999999999',
            'offer', 'Not valid while corrections are open', '${staffUserId}'
          )
        `)
      ).rejects.toThrow("Offers are blocked while application corrections are active");

      await db.exec(`
        insert into public.application_decisions (
          application_id, admission_lead_id, person_id, outcome, decision_reason, decided_by_user_id
        ) values (
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          '99999999-9999-4999-8999-999999999999',
          'rejection', 'Does not meet entry criteria', '${staffUserId}'
        )
      `);
      const cancelled = await db.query<{ status: string; audit_count: number }>(`
        select
          request.status::text,
          (
            select count(*)::int from public.audit_events event
            where event.entity_id = request.id
              and event.action = 'application.correction_cancelled_by_rejection'
          ) as audit_count
        from public.application_correction_requests request
        where request.id = '${activeRequest.rows[0]?.result.request_id}'
      `);
      expect(cancelled.rows[0]).toEqual({ status: "cancelled", audit_count: 1 });
    } finally {
      await db.close();
    }
  });
});
