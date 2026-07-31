import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  canSubmitModulePreferences,
  modulePreferenceCapacityBlockedAction,
  modulePreferenceSubmittedAction,
  modulePreferenceUpdatedAction,
  modulePreferenceWindowClosedAction,
  modulePreferenceWindowConfirmedAction,
  modulePreferenceWindowCreatedAction,
  modulePreferenceWindowOpenedAction,
  parseModulePreferenceLifecycleForm,
  parseModulePreferenceSubmissionForm,
  parseModulePreferenceWindowForm,
  validateModulePreferenceChoices
} from "@/lib/module-preferences";

const preferenceMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/0032_termly_module_preference_windows.sql"),
  "utf8"
);
const capacityMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/0033_module_preference_capacity_safe_submission.sql"),
  "utf8"
);
const portalPreferencesPage = readFileSync(
  join(process.cwd(), "src/app/portal/module-preferences/page.tsx"),
  "utf8"
);
const staffPreferencesPage = readFileSync(
  join(process.cwd(), "src/app/admissions/preferences/page.tsx"),
  "utf8"
);
const portalPreferencesAction = readFileSync(
  join(process.cwd(), "src/app/portal/module-preferences/actions.ts"),
  "utf8"
);

const adminUserId = "11111111-1111-4111-8111-111111111111";
const studentUserId = "22222222-2222-4222-8222-222222222222";
const secondStudentUserId = "22222222-2222-4222-8222-222222222223";
const personId = "33333333-3333-4333-8333-333333333333";
const secondPersonId = "33333333-3333-4333-8333-333333333334";
const studentId = "44444444-4444-4444-8444-444444444444";
const secondStudentId = "44444444-4444-4444-8444-444444444445";
const termId = "55555555-5555-4555-8555-555555555555";
const otherTermId = "66666666-6666-4666-8666-666666666666";
const moduleId = "77777777-7777-4777-8777-777777777777";
const otherModuleId = "88888888-8888-4888-8888-888888888888";
const offeringId = "99999999-9999-4999-8999-999999999999";
const secondOfferingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const unavailableOfferingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const preferenceWorkflowSchema = `
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
create type public.portal_actor_type as enum ('applicant', 'student');
create type public.student_status as enum ('prospect', 'active', 'completed', 'withdrawn', 'deferred', 'interrupted');
create type public.enrolment_status as enum ('planned', 'in_progress', 'completed', 'failed', 'deferred', 'resit', 'did_not_complete');
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
create type public.module_mode as enum ('practical', 'online');
create type public.term_status as enum ('draft', 'published', 'active', 'closed');

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
  email text not null
);

create table public.person_auth_identities (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  auth_user_id uuid not null references auth.users(id),
  email text not null,
  actor_type public.portal_actor_type not null default 'student',
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

create function public.touch_person_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.students (
  id uuid primary key,
  person_id uuid references public.persons(id),
  temporary_id text not null,
  first_name text not null,
  last_name text not null,
  email text not null,
  status public.student_status not null default 'active',
  admission_stage public.admission_stage not null default 'cccu_registration_complete',
  programme text not null default 'pgcert',
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
  capacity integer not null,
  created_at timestamptz not null default now()
);

create table public.enrolments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  offering_id uuid not null references public.module_offerings(id),
  status public.enrolment_status not null default 'planned',
  unique (student_id, offering_id)
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
`;

async function createPreferenceWorkflowDb() {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(preferenceWorkflowSchema);
  await db.exec(preferenceMigration);
  await db.exec(capacityMigration);
  await db.exec(`
    insert into auth.users (id) values
      ('${adminUserId}'),
      ('${studentUserId}'),
      ('${secondStudentUserId}');

    insert into public.staff_profiles (id, full_name, role)
    values ('${adminUserId}', 'Admin User', 'admin');

    insert into public.persons (id, first_name, last_name, email)
    values
      ('${personId}', 'Student', 'User', 'student@example.test'),
      ('${secondPersonId}', 'Second', 'Student', 'second@example.test');

    insert into public.person_auth_identities (person_id, auth_user_id, email, actor_type)
    values
      ('${personId}', '${studentUserId}', 'student@example.test', 'student'),
      ('${secondPersonId}', '${secondStudentUserId}', 'second@example.test', 'student');

    insert into public.students (id, person_id, temporary_id, first_name, last_name, email, status)
    values
      ('${studentId}', '${personId}', 'TMP-001', 'Student', 'User', 'student@example.test', 'active'),
      ('${secondStudentId}', '${secondPersonId}', 'TMP-002', 'Second', 'Student', 'second@example.test', 'active');

    insert into public.terms (id, name, starts_on, status)
    values
      ('${termId}', 'September 2026', '2026-09-07', 'published'),
      ('${otherTermId}', 'January 2027', '2027-01-05', 'published');

    insert into public.course_modules (id, code, title, credits, mode, active)
    values
      ('${moduleId}', 'POCUS-A', 'Module A', 10, 'practical', true),
      ('${otherModuleId}', 'POCUS-B', 'Module B', 10, 'online', true);

    insert into public.module_offerings (id, module_id, term_id, price_pence, capacity)
    values
      ('${offeringId}', '${moduleId}', '${termId}', 90000, 12),
      ('${secondOfferingId}', '${otherModuleId}', '${termId}', 90000, 12),
      ('${unavailableOfferingId}', '${moduleId}', '${otherTermId}', 90000, 12);
  `);
  return db;
}

async function createOpenPreferenceWindow(db: PGlite, offeringIds: string[] = [offeringId, secondOfferingId]) {
  const created = await db.query<{ window_id: string }>(
    `
      with auth_context as (
        select
          set_config('request.jwt.claim.sub', '${adminUserId}', true),
          set_config('request.jwt.claim.role', 'authenticated', true)
      )
      select public.create_or_update_module_preference_window(
        null,
        $1,
        'September preferences',
        '2026-07-01T09:00:00Z',
        '2026-12-01T17:00:00Z',
        $2::uuid[],
        null
      )::text as window_id
      from auth_context
    `,
    [termId, offeringIds]
  );
  const windowId = created.rows[0]?.window_id;
  expect(windowId).toBeTruthy();

  await db.query(
    `
      with auth_context as (
        select
          set_config('request.jwt.claim.sub', '${adminUserId}', true),
          set_config('request.jwt.claim.role', 'authenticated', true)
      )
      select public.open_module_preference_window($1)
      from auth_context
    `,
    [windowId]
  );

  return windowId;
}

async function submitPreferencesAs(db: PGlite, authUserId: string, windowId: string, offeringIds: string[]) {
  return db.query<{ submission_id: string | null }>(
    `
      with auth_context as (
        select
          set_config('request.jwt.claim.sub', $2, true),
          set_config('request.jwt.claim.role', 'authenticated', true)
      )
      select public.submit_module_preferences($1, $3::uuid[], null, null, 'vitest')::text as submission_id
      from auth_context
    `,
    [windowId, authUserId, offeringIds]
  );
}

describe("module preferences", () => {
  it("parses staff and student preference forms", () => {
    const windowForm = new FormData();
    windowForm.set("term_id", termId);
    windowForm.set("title", " September preferences ");
    windowForm.set("opens_at", "2026-08-01T09:00");
    windowForm.set("closes_at", "2026-08-15T17:00");
    windowForm.append("offering_ids", offeringId);
    windowForm.append("offering_ids", secondOfferingId);
    windowForm.set("notes", " Staff note ");

    expect(parseModulePreferenceWindowForm(windowForm)).toMatchObject({
      window_id: null,
      term_id: termId,
      title: "September preferences",
      offering_ids: [offeringId, secondOfferingId],
      notes: "Staff note"
    });

    const lifecycleForm = new FormData();
    lifecycleForm.set("window_id", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(parseModulePreferenceLifecycleForm(lifecycleForm)).toEqual({
      window_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    });

    const submissionForm = new FormData();
    submissionForm.set("window_id", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    submissionForm.set("first_choice_offering_id", offeringId);
    submissionForm.set("second_choice_offering_id", secondOfferingId);
    submissionForm.set("skip_reason", "No capacity this term");
    expect(parseModulePreferenceSubmissionForm(submissionForm)).toEqual({
      window_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      first_choice_offering_id: offeringId,
      second_choice_offering_id: secondOfferingId,
      offering_ids: [offeringId, secondOfferingId],
      skip_reason: "No capacity this term"
    });

    const skipForm = new FormData();
    skipForm.set("window_id", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(parseModulePreferenceSubmissionForm(skipForm)).toMatchObject({
      offering_ids: [],
      skip_reason: null
    });

    const invalidOrderForm = new FormData();
    invalidOrderForm.set("window_id", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    invalidOrderForm.set("second_choice_offering_id", secondOfferingId);
    expect(() => parseModulePreferenceSubmissionForm(invalidOrderForm)).toThrow(/first preference/);
  });

  it("validates open-window timing and available choices", () => {
    expect(
      canSubmitModulePreferences({
        status: "open",
        opensAt: "2026-08-01T09:00:00Z",
        closesAt: "2026-08-15T17:00:00Z",
        now: new Date("2026-08-02T12:00:00Z")
      })
    ).toEqual({ allowed: true, reason: "allowed" });

    expect(
      canSubmitModulePreferences({
        status: "draft",
        opensAt: "2026-08-01T09:00:00Z",
        closesAt: "2026-08-15T17:00:00Z",
        now: new Date("2026-08-02T12:00:00Z")
      }).reason
    ).toBe("not_open");

    expect(
      validateModulePreferenceChoices({
        offeringIds: [offeringId, unavailableOfferingId],
        availableOfferingIds: [offeringId, secondOfferingId]
      }).errors
    ).toContain("Selected module offerings must be available in this preference window.");
  });

  it("records create/open/close/confirm actions without creating enrolments or finance", () => {
    expect(preferenceMigration).toContain(modulePreferenceWindowCreatedAction);
    expect(preferenceMigration).toContain(modulePreferenceWindowOpenedAction);
    expect(preferenceMigration).toContain(modulePreferenceWindowClosedAction);
    expect(preferenceMigration).toContain(modulePreferenceWindowConfirmedAction);
    expect(preferenceMigration).not.toContain("portal students read own active student row for module preferences");
    expect(preferenceMigration).toContain("current_active_student_id_for_module_preferences");
    expect(preferenceMigration).toContain("person_id = public.current_person_id()");
    expect(preferenceMigration).toContain("status = 'active'");
    expect(preferenceMigration).toContain("with ordinality as selected(offering_id, preference_order)");
    expect(preferenceMigration).not.toContain("insert into public.enrolments");
    expect(preferenceMigration).not.toContain("insert into public.finance_records");
    expect(capacityMigration).toContain("for update");
    expect(capacityMigration).toContain("enrolment.status in ('planned', 'in_progress')");
    expect(capacityMigration).toContain(modulePreferenceCapacityBlockedAction);
    expect(capacityMigration).toContain("module_preference_window_offering_capacity");
  });

  it("keeps preference UI ordered and staff offering selection term-scoped", () => {
    expect(portalPreferencesPage).toContain('name="first_choice_offering_id"');
    expect(portalPreferencesPage).toContain('name="second_choice_offering_id"');
    expect(portalPreferencesPage).not.toContain('name="offering_ids" type="checkbox"');
    expect(portalPreferencesAction).toContain("preferenceError");
    expect(portalPreferencesAction).toContain("parseModulePreferenceSubmissionForm");
    expect(staffPreferencesPage).toContain("offering.termId === term.id");
  });

  it("submits and updates one active student submission per window", async () => {
    const db = await createPreferenceWorkflowDb();
    try {
      const windowId = await createOpenPreferenceWindow(db);
      const firstSubmission = await submitPreferencesAs(db, studentUserId, windowId, [offeringId]);
      const secondSubmission = await submitPreferencesAs(db, studentUserId, windowId, [secondOfferingId]);

      expect(secondSubmission.rows[0]?.submission_id).toBe(firstSubmission.rows[0]?.submission_id);

      const counts = await db.query<{
        submission_count: number;
        choice_count: number;
        selected_offering_id: string;
        submitted_events: number;
        updated_events: number;
      }>(`
        select
          (select count(*)::int from public.module_preference_submissions) as submission_count,
          (select count(*)::int from public.module_preference_submission_choices) as choice_count,
          (select offering_id::text from public.module_preference_submission_choices limit 1) as selected_offering_id,
          (select count(*)::int from public.audit_events where action = '${modulePreferenceSubmittedAction}') as submitted_events,
          (select count(*)::int from public.audit_events where action = '${modulePreferenceUpdatedAction}') as updated_events
      `);

      expect(counts.rows[0]).toMatchObject({
        submission_count: 1,
        choice_count: 1,
        selected_offering_id: secondOfferingId,
        submitted_events: 1,
        updated_events: 1
      });
    } finally {
      await db.close();
    }
  });

  it("updates a full own selection and releases the old choice for other students", async () => {
    const db = await createPreferenceWorkflowDb();
    try {
      await db.exec(`
        update public.module_offerings
        set capacity = 1
        where id in ('${offeringId}', '${secondOfferingId}');
      `);
      const windowId = await createOpenPreferenceWindow(db);

      const firstSubmission = await submitPreferencesAs(db, studentUserId, windowId, [offeringId]);
      const sameChoiceUpdate = await submitPreferencesAs(db, studentUserId, windowId, [offeringId]);
      const movedChoiceUpdate = await submitPreferencesAs(db, studentUserId, windowId, [secondOfferingId]);
      const secondStudentSubmission = await submitPreferencesAs(db, secondStudentUserId, windowId, [offeringId]);

      expect(sameChoiceUpdate.rows[0]?.submission_id).toBe(firstSubmission.rows[0]?.submission_id);
      expect(movedChoiceUpdate.rows[0]?.submission_id).toBe(firstSubmission.rows[0]?.submission_id);
      expect(secondStudentSubmission.rows[0]?.submission_id).toBeTruthy();

      const capacity = await db.query<{
        offering_id: string;
        preference_selection_count: number;
        remaining_places: number;
        is_full: boolean;
      }>(
        `
          with auth_context as (
            select
              set_config('request.jwt.claim.sub', '${adminUserId}', true),
              set_config('request.jwt.claim.role', 'authenticated', true)
          )
          select
            offering_id::text,
            preference_selection_count,
            remaining_places,
            is_full
          from auth_context, public.module_preference_window_offering_capacity(array[$1::uuid])
          where offering_id in ($2, $3)
          order by offering_id::text
        `,
        [windowId, offeringId, secondOfferingId]
      );

      expect(capacity.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            offering_id: offeringId,
            preference_selection_count: 1,
            remaining_places: 0,
            is_full: true
          }),
          expect.objectContaining({
            offering_id: secondOfferingId,
            preference_selection_count: 1,
            remaining_places: 0,
            is_full: true
          })
        ])
      );
    } finally {
      await db.close();
    }
  });

  it("rejects full offerings and records a capacity-blocked audit event", async () => {
    const db = await createPreferenceWorkflowDb();
    try {
      await db.exec(`
        update public.module_offerings set capacity = 1 where id = '${offeringId}';
        insert into public.enrolments (student_id, offering_id, status)
        values ('${secondStudentId}', '${offeringId}', 'planned');
      `);
      const windowId = await createOpenPreferenceWindow(db, [offeringId]);

      const blockedSubmission = await submitPreferencesAs(db, studentUserId, windowId, [offeringId]);
      expect(blockedSubmission.rows[0]?.submission_id).toBeNull();

      const counts = await db.query<{
        submission_count: number;
        choice_count: number;
        blocked_events: number;
      }>(`
        select
          (select count(*)::int from public.module_preference_submissions) as submission_count,
          (select count(*)::int from public.module_preference_submission_choices) as choice_count,
          (select count(*)::int from public.audit_events where action = '${modulePreferenceCapacityBlockedAction}') as blocked_events
      `);

      expect(counts.rows[0]).toMatchObject({
        submission_count: 0,
        choice_count: 0,
        blocked_events: 1
      });
    } finally {
      await db.close();
    }
  });

  it("prevents oversubscription when two students request the final place", async () => {
    const db = await createPreferenceWorkflowDb();
    try {
      await db.exec(`update public.module_offerings set capacity = 1 where id = '${offeringId}';`);
      const windowId = await createOpenPreferenceWindow(db, [offeringId]);

      const [firstSubmission, secondSubmission] = await Promise.all([
        submitPreferencesAs(db, studentUserId, windowId, [offeringId]),
        submitPreferencesAs(db, secondStudentUserId, windowId, [offeringId])
      ]);
      const returnedSubmissionIds = [firstSubmission.rows[0]?.submission_id, secondSubmission.rows[0]?.submission_id];

      expect(returnedSubmissionIds.filter(Boolean)).toHaveLength(1);
      expect(returnedSubmissionIds.filter((value) => value === null)).toHaveLength(1);

      const counts = await db.query<{
        choice_count: number;
        blocked_events: number;
      }>(`
        select
          (select count(*)::int from public.module_preference_submission_choices where offering_id = '${offeringId}') as choice_count,
          (select count(*)::int from public.audit_events where action = '${modulePreferenceCapacityBlockedAction}') as blocked_events
      `);

      expect(counts.rows[0]).toMatchObject({
        choice_count: 1,
        blocked_events: 1
      });
    } finally {
      await db.close();
    }
  });

  it("rejects student choices outside the window offering list", async () => {
    const db = await createPreferenceWorkflowDb();
    try {
      await db.exec(`
        set "request.jwt.claim.sub" = '${adminUserId}';
        set "request.jwt.claim.role" = 'authenticated';
      `);
      const created = await db.query<{ window_id: string }>(
        `
          select public.create_or_update_module_preference_window(
            null,
            $1,
            'September preferences',
            '2026-07-01T09:00:00Z',
            '2026-12-01T17:00:00Z',
            array[$2::uuid],
            null
          )::text as window_id
        `,
        [termId, offeringId]
      );
      const windowId = created.rows[0]?.window_id;
      await db.query("select public.open_module_preference_window($1)", [windowId]);

      await db.exec(`
        set "request.jwt.claim.sub" = '${studentUserId}';
        set "request.jwt.claim.role" = 'authenticated';
      `);

      await expect(
        db.query("select public.submit_module_preferences($1, array[$2::uuid], null, null, 'vitest')", [
          windowId,
          unavailableOfferingId
        ])
      ).rejects.toThrow(/available in this preference window/);
    } finally {
      await db.close();
    }
  });
});
