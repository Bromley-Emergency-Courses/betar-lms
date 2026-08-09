import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0039_admissions_staff_operations_projections.sql"),
  "utf8"
);

const personId = "11111111-1111-4111-8111-111111111111";
const leadId = "22222222-2222-4222-8222-222222222222";
const studentId = "33333333-3333-4333-8333-333333333333";
const participantId = "44444444-4444-4444-8444-444444444444";
const cycleId = "55555555-5555-4555-8555-555555555555";
const termId = "66666666-6666-4666-8666-666666666666";

const foundationSchema = `
create role authenticated;

create table public.staff_new_student_admissions_work_items (
  admission_lead_id uuid primary key,
  first_name text not null,
  last_name text not null,
  email text not null,
  attention_indicators text[] not null default '{}',
  primary_next_action text not null,
  has_data_inconsistency boolean not null default false
);

create table public.students (
  id uuid primary key,
  temporary_id text not null,
  first_name text not null,
  last_name text not null
);

create table public.terms (
  id uuid primary key,
  name text not null,
  starts_on date not null
);

create table public.returning_student_cycles (
  id uuid primary key,
  phase text not null,
  target_term_id uuid not null references public.terms(id)
);

create table public.returning_student_cycle_participant_work_items (
  participant_id uuid primary key,
  cycle_id uuid not null references public.returning_student_cycles(id),
  student_id uuid not null references public.students(id),
  person_id uuid,
  membership_state text not null,
  current_email text,
  blocking_reason text,
  has_eligibility_change boolean not null default false
);

create table public.correspondence_logs (
  id uuid primary key default gen_random_uuid(),
  related_entity_type text,
  related_entity_id uuid,
  recipient_email text not null,
  delivery_status text not null,
  created_at timestamptz not null default now()
);
`;

describe("admissions staff operations projections", () => {
  it("derives staff-facing attention, search, contact and next-action fields", async () => {
    const db = new PGlite();
    try {
      await db.exec(foundationSchema);
      await db.exec(migration);
      await db.exec(`
        insert into public.staff_new_student_admissions_work_items (
          admission_lead_id, first_name, last_name, email, attention_indicators,
          primary_next_action, has_data_inconsistency
        ) values (
          '${leadId}', 'Asha', 'Applicant', 'asha@example.test',
          array['ready_for_decision'], 'record_decision', false
        );
        insert into public.students (id, temporary_id, first_name, last_name)
        values ('${studentId}', 'BETAR-001', 'Ravi', 'Returning');
        insert into public.terms (id, name, starts_on)
        values ('${termId}', 'January 2027', '2027-01-10');
        insert into public.returning_student_cycles (id, phase, target_term_id)
        values ('${cycleId}', 'collecting_responses', '${termId}');
        insert into public.returning_student_cycle_participant_work_items (
          participant_id, cycle_id, student_id, person_id, membership_state,
          current_email, blocking_reason, has_eligibility_change
        ) values (
          '${participantId}', '${cycleId}', '${studentId}', '${personId}',
          'included', 'ravi@example.test', null, false
        );
        insert into public.correspondence_logs (
          related_entity_type, related_entity_id, recipient_email, delivery_status, created_at
        ) values
          ('returning_student_cycle_participant', '${participantId}', 'old@example.test', 'failed', now() - interval '1 day'),
          ('returning_student_cycle_participant', '${participantId}', 'ravi@example.test', 'sent', now());
      `);

      const newOperation = await db.query<{
        applicant_name: string;
        needs_staff_attention: boolean;
        is_ready_to_progress: boolean;
        leading_attention_indicator: string;
      }>(`
        select applicant_name, needs_staff_attention, is_ready_to_progress, leading_attention_indicator
        from public.staff_new_student_admissions_operations
        where search_text like '%asha applicant%'
      `);
      expect(newOperation.rows[0]).toEqual({
        applicant_name: "Asha Applicant",
        needs_staff_attention: true,
        is_ready_to_progress: true,
        leading_attention_indicator: "ready_for_decision"
      });

      const returningOperation = await db.query<{
        student_name: string;
        contact_state: string;
        contact_attempt_count: number;
        latest_contact_recipient_email: string;
        primary_next_action: string;
      }>(`
        select student_name, contact_state, contact_attempt_count,
          latest_contact_recipient_email, primary_next_action
        from public.staff_returning_student_admissions_operations
      `);
      expect(returningOperation.rows[0]).toEqual({
        student_name: "Ravi Returning",
        contact_state: "sent",
        contact_attempt_count: 2,
        latest_contact_recipient_email: "ravi@example.test",
        primary_next_action: "await_response"
      });
    } finally {
      await db.close();
    }
  });
});
