import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAdmissionLeadAdministrativeDetails } from "@/lib/admission-lead-administration";
import {
  mapStaffNewStudentAdmissionsWorkItem,
  newStudentJourneyStageLabels,
  newStudentJourneyStages
} from "@/lib/admissions-staff-workflow";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0035_staff_new_student_workflow_foundation.sql"),
  "utf8"
);

describe("staff new-student workflow foundation", () => {
  it("parses administrative lead fields without accepting workflow state", () => {
    const formData = new FormData();
    formData.set("first_name", "  Asha ");
    formData.set("last_name", " Applicant ");
    formData.set("email", " ASHA@EXAMPLE.TEST ");
    formData.set("programme", "pgcert");
    formData.set("stage", "registered");
    formData.set("archived", "on");

    expect(parseAdmissionLeadAdministrativeDetails(formData)).toEqual({
      first_name: "Asha",
      last_name: "Applicant",
      email: "asha@example.test",
      phone: null,
      programme: "pgcert",
      module_interest_ids: [],
      source: null,
      last_contacted_on: null,
      next_action_on: null,
      notes: null
    });
  });

  it("defines all seven approved derived journey stages", () => {
    expect(newStudentJourneyStages).toEqual([
      "enquiry",
      "application",
      "review",
      "offer",
      "registration",
      "complete",
      "closed"
    ]);
    expect(Object.values(newStudentJourneyStageLabels)).toEqual([
      "Enquiry",
      "Application",
      "Review",
      "Offer",
      "Registration",
      "Complete",
      "Closed"
    ]);
  });

  it("maps the database projection and rejects unknown workflow values", () => {
    const row = {
      admission_lead_id: "11111111-1111-4111-8111-111111111111",
      person_id: null,
      first_name: "Asha",
      last_name: "Applicant",
      email: "asha@example.test",
      phone: null,
      programme: "pgcert",
      source_lead_stage: "submitted",
      journey_stage: "review",
      target_term_id: null,
      application_id: "22222222-2222-4222-8222-222222222222",
      application_status: "submitted",
      review_readiness_status: "ready_for_decision",
      decision_outcome: null,
      offer_id: null,
      offer_status: null,
      registration_id: null,
      registration_status: null,
      has_data_inconsistency: false,
      attention_indicators: ["ready_for_decision"],
      primary_next_action: "record_decision",
      current_deadline_at: null,
      last_activity_at: "2026-08-09T09:00:00Z",
      created_at: "2026-08-01T09:00:00Z"
    };

    expect(mapStaffNewStudentAdmissionsWorkItem(row)).toMatchObject({
      journeyStage: "review",
      primaryNextAction: "record_decision",
      attentionIndicators: ["ready_for_decision"]
    });

    expect(() => mapStaffNewStudentAdmissionsWorkItem({ ...row, journey_stage: "reviewed" })).toThrow(
      "Unknown new-student journey stage"
    );
  });

  it("adds an admin-only invoker projection and guarded administrative RPCs", () => {
    expect(migration).toContain("create type public.new_student_journey_stage");
    expect(migration).toContain("create or replace function public.derive_new_student_journey_stage");
    expect(migration).toContain("create or replace view public.staff_new_student_admissions_work_items");
    expect(migration).toContain("with (security_invoker = true)");
    expect(migration).toContain("has_data_inconsistency");
    expect(migration).toContain("'repair_inconsistency'");
    expect(migration).toContain("create or replace function public.record_staff_admission_enquiry");
    expect(migration).toContain("create or replace function public.update_admission_lead_administrative_details");
    expect(migration).toContain("'enquiry.recorded_by_staff'");
    expect(migration).toContain("'admission_lead.administrative_details_updated'");
    expect(migration).toContain("revoke insert, update, delete on table public.admission_leads from authenticated");
  });
});
