import { describe, expect, it } from "vitest";
import {
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
