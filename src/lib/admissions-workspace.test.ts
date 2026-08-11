import { describe, expect, it } from "vitest";
import {
  mapStaffNewStudentAdmissionsOperation,
  mapStaffReturningStudentAdmissionsOperation,
  parseNewStudentWorkspaceQuery,
  parseReturningStudentWorkspaceQuery,
  plainLanguageAdmissionsLabel
} from "@/lib/admissions-workspace";

describe("admissions workspace query state", () => {
  it("parses safe new-student filters and bounded pagination", () => {
    expect(parseNewStudentWorkspaceQuery({ q: " Asha ", stage: "review", attention: "ready", page: "3", page_size: "100" })).toEqual({
      search: "Asha",
      stage: "review",
      attention: "ready",
      page: 3,
      pageSize: 100
    });
    expect(parseNewStudentWorkspaceQuery({ page: "-2", page_size: "500", stage: "reviewed" })).toMatchObject({
      stage: "all",
      page: 1,
      pageSize: 50
    });
  });

  it("keeps returning-student status filters separate from new-student stages", () => {
    expect(parseReturningStudentWorkspaceQuery({ status: "deferred", stage: "offer" })).toMatchObject({
      status: "deferred",
      attention: "all"
    });
  });
});

describe("new-student duplicate mapping", () => {
  it("makes abandonment the recommended action for the later open record", () => {
    const mapped = mapStaffNewStudentAdmissionsOperation({
      admission_lead_id: "11111111-1111-4111-8111-111111111111",
      first_name: "Asha",
      last_name: "Applicant",
      email: "asha@example.test",
      programme: "pgcert",
      source_lead_stage: "interest",
      journey_stage: "enquiry",
      has_data_inconsistency: false,
      attention_indicators: [],
      primary_next_action: "invite_applicant",
      last_activity_at: "2026-08-10T10:00:00Z",
      created_at: "2026-08-10T10:00:00Z",
      applicant_name: "Asha Applicant",
      needs_staff_attention: true,
      is_ready_to_progress: false,
      is_awaiting_applicant: false,
      leading_attention_indicator: "duplicate_email",
      has_open_email_duplicate: true,
      application_deadline_state: "due",
      application_reminder_eligible: false,
      duplicate_open_admission_lead_id: "22222222-2222-4222-8222-222222222222",
      duplicate_open_applicant_name: "Earlier Applicant",
      duplicate_open_journey_stage: "application"
    });

    expect(mapped).toMatchObject({
      hasOpenEmailDuplicate: true,
      primaryNextAction: "abandon_duplicate",
      duplicateOpenApplicantName: "Earlier Applicant",
      leadingAttentionIndicator: "duplicate_email"
    });
  });

  it("warns on a progressed historical duplicate without replacing its genuine next action", () => {
    const mapped = mapStaffNewStudentAdmissionsOperation({
      admission_lead_id: "11111111-1111-4111-8111-111111111111",
      first_name: "Asha",
      last_name: "Applicant",
      email: "asha@example.test",
      programme: "pgcert",
      source_lead_stage: "submitted",
      journey_stage: "review",
      application_status: "submitted",
      has_data_inconsistency: false,
      attention_indicators: ["ready_for_decision"],
      primary_next_action: "record_decision",
      last_activity_at: "2026-08-10T10:00:00Z",
      created_at: "2026-08-10T10:00:00Z",
      applicant_name: "Asha Applicant",
      needs_staff_attention: true,
      is_ready_to_progress: false,
      is_awaiting_applicant: false,
      leading_attention_indicator: "duplicate_email",
      has_open_email_duplicate: true,
      application_deadline_state: "submitted",
      application_reminder_eligible: false,
      duplicate_open_admission_lead_id: "22222222-2222-4222-8222-222222222222"
    });

    expect(mapped.primaryNextAction).toBe("record_decision");
    expect(mapped.hasOpenEmailDuplicate).toBe(true);
  });
});

describe("returning-student operations mapping", () => {
  it("maps current and inclusion facts without conflating them", () => {
    const mapped = mapStaffReturningStudentAdmissionsOperation({
      participant_id: "participant-1",
      cycle_id: "cycle-1",
      student_id: "student-1",
      person_id: "person-1",
      membership_state: "included",
      inclusion_basis: "status_group",
      student_reference: "BETAR-001",
      first_name: "Asha",
      last_name: "Patel",
      student_name: "Asha Patel",
      snapshot_programme: "pgcert",
      snapshot_status: "active",
      snapshot_awarded_credits: 40,
      snapshot_email: "old@example.test",
      current_programme: "pgcert",
      current_status: "deferred",
      current_awarded_credits: 50,
      current_email: "new@example.test",
      has_eligibility_change: true,
      needs_additional_study_confirmation: false,
      cycle_phase: "collecting_responses",
      target_term_id: "term-1",
      target_term_name: "January 2027",
      target_term_starts_on: "2027-01-10",
      contact_attempt_count: 1,
      contact_state: "sent",
      response_state: "awaiting_response",
      needs_staff_attention: true,
      primary_next_action: "await_response"
    });

    expect(mapped).toMatchObject({
      snapshotStatus: "active",
      currentStatus: "deferred",
      snapshotAwardedCredits: 40,
      currentAwardedCredits: 50,
      hasEligibilityChange: true
    });
    expect(plainLanguageAdmissionsLabel(mapped.primaryNextAction)).toBe("Await Response");
  });
});
