import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0037_returning_student_cycle_participant_foundation.sql"),
  "utf8"
);

const adminId = "11111111-1111-4111-8111-111111111111";
const targetTermId = "22222222-2222-4222-8222-222222222222";
const activeStudentId = "30000000-0000-4000-8000-000000000001";
const deferredStudentId = "30000000-0000-4000-8000-000000000002";
const missingIdentityStudentId = "30000000-0000-4000-8000-000000000003";
const interruptedStudentId = "30000000-0000-4000-8000-000000000004";
const additionalStudyStudentId = "30000000-0000-4000-8000-000000000005";
const withdrawnStudentId = "30000000-0000-4000-8000-000000000006";
const microcredentialStudentId = "30000000-0000-4000-8000-000000000007";
const newlyEligibleStudentId = "30000000-0000-4000-8000-000000000008";

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

create type public.student_status as enum ('prospect', 'active', 'completed', 'withdrawn', 'deferred', 'interrupted');
create type public.term_status as enum ('draft', 'published', 'active', 'closed');
create type public.module_mode as enum ('practical', 'online');
create type public.enrolment_status as enum ('planned', 'in_progress', 'completed', 'failed', 'deferred');
create type public.portal_actor_type as enum ('applicant', 'student');
create type public.audit_actor_type as enum ('staff', 'applicant', 'student', 'service');

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

create table public.persons (
  id uuid primary key,
  first_name text not null,
  last_name text not null,
  email text not null
);

create table public.students (
  id uuid primary key,
  person_id uuid references public.persons(id),
  temporary_id text not null unique,
  first_name text not null,
  last_name text not null,
  email text not null,
  status public.student_status not null,
  programme text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.terms (
  id uuid primary key,
  name text not null unique,
  starts_on date not null,
  ends_on date not null,
  status public.term_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.course_modules (
  id uuid primary key,
  code text not null unique,
  title text not null,
  credits integer not null,
  mode public.module_mode not null,
  active boolean not null default true
);

create table public.module_offerings (
  id uuid primary key,
  module_id uuid not null references public.course_modules(id),
  term_id uuid not null references public.terms(id),
  capacity integer not null,
  unique (module_id, term_id)
);

create table public.enrolments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  offering_id uuid not null references public.module_offerings(id),
  status public.enrolment_status not null default 'completed',
  credits_awarded integer not null default 0,
  unique (student_id, offering_id)
);

create table public.person_auth_identities (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  email text not null,
  actor_type public.portal_actor_type not null,
  active boolean not null default true,
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

function personId(index: number) {
  return `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

describe("returning-student cycle participant database workflow", () => {
  it("builds and deliberately refreshes a protected participant snapshot before opening", async () => {
    const db = new PGlite();

    try {
      await db.exec(foundationSchema);
      await db.exec(migration);
      await db.exec(`select set_config('request.jwt.claim.sub', '${adminId}', false)`);
      await db.exec(`
        insert into public.staff_profiles (id) values ('${adminId}');
        insert into public.terms (id, name, starts_on, ends_on, status)
        values (
          '${targetTermId}', 'January 2027', current_date + 90, current_date + 180, 'published'
        );
        insert into public.terms (id, name, starts_on, ends_on, status)
        values (
          '22222222-2222-4222-8222-222222222223', 'Current term', current_date - 60, current_date + 30, 'active'
        );
        insert into public.course_modules (id, code, title, credits, mode)
        values ('50000000-0000-4000-8000-000000000001', 'POCUS-CORE', 'Core POCUS', 10, 'practical');
        insert into public.module_offerings (id, module_id, term_id, capacity)
        values (
          '60000000-0000-4000-8000-000000000001',
          '50000000-0000-4000-8000-000000000001',
          '${targetTermId}',
          24
        );
      `);

      const students = [
        [activeStudentId, personId(1), "Active", "Learner", "active", "pgcert", 20, true],
        [deferredStudentId, personId(2), "Deferred", "Learner", "deferred", "pgcert", 50, true],
        [missingIdentityStudentId, personId(3), "Missing", "Identity", "active", "pgcert", 10, false],
        [interruptedStudentId, personId(4), "Interrupted", "Learner", "interrupted", "pgcert", 10, true],
        [additionalStudyStudentId, personId(5), "Additional", "Study", "active", "pgcert", 60, true],
        [withdrawnStudentId, personId(6), "Withdrawn", "Learner", "withdrawn", "pgcert", 0, true],
        [microcredentialStudentId, personId(7), "Micro", "Learner", "active", "microcredential", 0, true]
      ] as const;

      for (const [studentId, linkedPersonId, firstName, lastName, status, programme, credits, hasIdentity] of students) {
        await db.query(
          `insert into public.persons (id, first_name, last_name, email) values ($1, $2, $3, $4)`,
          [linkedPersonId, firstName, lastName, `${firstName.toLowerCase()}@example.test`]
        );
        await db.query(
          `insert into public.students (
             id, person_id, temporary_id, first_name, last_name, email, status, programme
           ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [studentId, linkedPersonId, `TMP-${studentId.slice(-4)}`, firstName, lastName, `${firstName.toLowerCase()}@example.test`, status, programme]
        );
        if (credits > 0) {
          await db.query(
            `insert into public.enrolments (student_id, offering_id, credits_awarded) values ($1, $2, $3)`,
            [studentId, "60000000-0000-4000-8000-000000000001", credits]
          );
        }
        if (hasIdentity) {
          await db.query(
            `insert into public.person_auth_identities (person_id, email, actor_type)
             values ($1, $2, 'student')`,
            [linkedPersonId, `${firstName.toLowerCase()}@example.test`]
          );
        }
      }

      await expect(
        db.exec(`
          insert into public.terms (id, name, starts_on, ends_on, status)
          values (
            '22222222-2222-4222-8222-222222222224',
            'Second published term', current_date + 200, current_date + 260, 'published'
          )
        `)
      ).rejects.toThrow("Only one published term may exist at a time");

      const protectedBefore = await db.query<{ student_id: string; status: string; credits: number }>(`
        select
          student.id as student_id,
          student.status::text,
          public.formally_awarded_credits(student.id) as credits
        from public.students student
        order by student.id
      `);

      const created = await db.query<{ id: string }>(`
        select public.create_returning_student_cycle(
          '${targetTermId}',
          array['active', 'deferred']::public.student_status[]
        ) as id
      `);
      const cycleId = created.rows[0]?.id;
      expect(cycleId).toBeTruthy();

      const protectedAfterSetup = await db.query<{ student_id: string; status: string; credits: number }>(`
        select
          student.id as student_id,
          student.status::text,
          public.formally_awarded_credits(student.id) as credits
        from public.students student
        order by student.id
      `);
      expect(protectedAfterSetup.rows).toEqual(protectedBefore.rows);

      const initialParticipants = await db.query<{ student_id: string }>(`
        select student_id from public.returning_student_cycle_participants
        where cycle_id = '${cycleId}' and membership_state = 'included'
        order by student_id
      `);
      expect(initialParticipants.rows.map((row) => row.student_id)).toEqual([
        activeStudentId,
        deferredStudentId,
        missingIdentityStudentId
      ]);

      const offeringSnapshot = await db.query<{ planned_capacity: number; code: string }>(`
        select planned_capacity, module_code_snapshot as code
        from public.returning_student_cycle_offerings where cycle_id = '${cycleId}'
      `);
      expect(offeringSnapshot.rows[0]).toEqual({ planned_capacity: 24, code: "POCUS-CORE" });

      await db.query(`select public.add_returning_student_cycle_participant($1, $2, $3)`, [
        cycleId,
        interruptedStudentId,
        "Include this learner individually from an unselected status group."
      ]);
      const additionalParticipant = await db.query<{ id: string }>(
        `select public.add_returning_student_cycle_participant($1, $2, $3) as id`,
        [cycleId, additionalStudyStudentId, "Learner has agreed to undertake additional PGCert study."]
      );
      await expect(
        db.query(`select public.add_returning_student_cycle_participant($1, $2, $3)`, [
          cycleId,
          withdrawnStudentId,
          "Should remain excluded."
        ])
      ).rejects.toThrow("Only a non-withdrawn PGCert learner");

      const additionalState = await db.query<{ confirmed: boolean }>(`
        select additional_study_confirmed_at is not null as confirmed
        from public.returning_student_cycle_participants
        where id = '${additionalParticipant.rows[0]?.id}'
      `);
      expect(additionalState.rows[0]?.confirmed).toBe(true);

      await db.exec(`
        update public.enrolments set credits_awarded = 60 where student_id = '${activeStudentId}';
        update public.students set status = 'interrupted' where id = '${deferredStudentId}';
        insert into public.persons (id, first_name, last_name, email)
        values ('${personId(8)}', 'Newly', 'Eligible', 'newly@example.test');
        insert into public.students (
          id, person_id, temporary_id, first_name, last_name, email, status, programme
        ) values (
          '${newlyEligibleStudentId}', '${personId(8)}', 'TMP-0008',
          'Newly', 'Eligible', 'newly@example.test', 'active', 'pgcert'
        );
        insert into public.person_auth_identities (person_id, email, actor_type)
        values ('${personId(8)}', 'newly@example.test', 'student');
      `);

      const preview = await db.query<{ change_type: string; student_id: string }>(`
        select change_type, student_id
        from public.preview_returning_student_cycle_eligibility('${cycleId}')
      `);
      expect(preview.rows).toEqual(
        expect.arrayContaining([
          { change_type: "add_eligible", student_id: newlyEligibleStudentId },
          { change_type: "remove_ineligible", student_id: activeStudentId },
          { change_type: "remove_ineligible", student_id: deferredStudentId }
        ])
      );

      const refresh = await db.query<{ result: { added_count: number; removed_count: number } }>(`
        select public.apply_returning_student_cycle_eligibility_refresh('${cycleId}') as result
      `);
      expect(refresh.rows[0]?.result).toMatchObject({ added_count: 1, removed_count: 2 });

      const missingParticipant = await db.query<{ id: string }>(`
        select id from public.returning_student_cycle_participants
        where cycle_id = '${cycleId}' and student_id = '${missingIdentityStudentId}'
      `);
      await expect(db.exec(`select public.open_returning_student_cycle('${cycleId}')`)).rejects.toThrow(
        "Resolve participant setup blockers"
      );
      await db.query(`select public.remove_returning_student_cycle_participant($1, $2)`, [
        missingParticipant.rows[0]?.id,
        "Portal identity must be repaired before a future cycle."
      ]);

      await db.exec(`
        insert into public.course_modules (id, code, title, credits, mode)
        values ('50000000-0000-4000-8000-000000000002', 'POCUS-LUNG', 'Lung POCUS', 10, 'practical');
        insert into public.module_offerings (id, module_id, term_id, capacity)
        values (
          '60000000-0000-4000-8000-000000000002',
          '50000000-0000-4000-8000-000000000002',
          '${targetTermId}',
          18
        );
      `);
      await expect(db.exec(`select public.open_returning_student_cycle('${cycleId}')`)).rejects.toThrow(
        "Target-term offerings changed"
      );
      const offeringRefresh = await db.query<{ result: { added_count: number } }>(`
        select public.refresh_returning_student_cycle_offerings('${cycleId}') as result
      `);
      expect(offeringRefresh.rows[0]?.result).toMatchObject({ added_count: 1 });

      const cycleOffering = await db.query<{ id: string }>(`
        select id from public.returning_student_cycle_offerings
        where cycle_id = '${cycleId}' and module_code_snapshot = 'POCUS-CORE'
      `);
      await db.query(`select public.set_returning_cycle_offering_planned_capacity($1, 30, $2)`, [
        cycleOffering.rows[0]?.id,
        "Capacity is flexible based on current demand."
      ]);

      await db.exec(`select public.open_returning_student_cycle('${cycleId}')`);
      const opened = await db.query<{ phase: string; sent_count: number; capacity: number }>(`
        select
          cycle.phase::text,
          (
            select count(*)::int from public.audit_events event
            where event.entity_id = cycle.id
              and (event.metadata->>'email_sent')::boolean is true
          ) as sent_count,
          (
            select planned_capacity from public.returning_student_cycle_offerings offering
            where offering.cycle_id = cycle.id and offering.module_code_snapshot = 'POCUS-CORE'
          ) as capacity
        from public.returning_student_cycles cycle where cycle.id = '${cycleId}'
      `);
      expect(opened.rows[0]).toEqual({ phase: "collecting_responses", sent_count: 0, capacity: 30 });

      await db.exec(`update public.students set status = 'withdrawn' where id = '${newlyEligibleStudentId}'`);
      const withdrawnWorkItem = await db.query<{ blocking_reason: string; has_change: boolean }>(`
        select blocking_reason, has_eligibility_change as has_change
        from public.returning_student_cycle_participant_work_items
        where cycle_id = '${cycleId}' and student_id = '${newlyEligibleStudentId}'
      `);
      expect(withdrawnWorkItem.rows[0]).toEqual({ blocking_reason: "withdrawn", has_change: true });

      await db.exec(`select public.begin_returning_student_cycle_review('${cycleId}')`);
      const finalPhase = await db.query<{ phase: string }>(`
        select phase::text from public.returning_student_cycles where id = '${cycleId}'
      `);
      expect(finalPhase.rows[0]?.phase).toBe("review_confirmation");

      const sourceCapacity = await db.query<{ capacity: number }>(`
        select capacity from public.module_offerings
        where id = '60000000-0000-4000-8000-000000000001'
      `);
      expect(sourceCapacity.rows[0]?.capacity).toBe(24);

      await db.exec("set role authenticated");
      await expect(
        db.exec(`
          insert into public.returning_student_cycles (target_term_id)
          values ('${targetTermId}')
        `)
      ).rejects.toThrow(/permission denied/i);
      await db.exec("reset role");
    } finally {
      await db.close();
    }
  });
});
