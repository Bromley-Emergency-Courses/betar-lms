import { describe, expect, it } from "vitest";
import {
  parseAddReturningStudentCycleParticipantForm,
  parseCreateReturningStudentCycleForm,
  parseReturningStudentCycleParticipantActionForm,
  parseReturningStudentCyclePlannedCapacityForm
} from "@/lib/returning-student-cycles";

const cycleId = "11111111-1111-4111-8111-111111111111";
const termId = "22222222-2222-4222-8222-222222222222";
const studentId = "33333333-3333-4333-8333-333333333333";
const participantId = "44444444-4444-4444-8444-444444444444";
const cycleOfferingId = "55555555-5555-4555-8555-555555555555";

describe("returning-student cycle staff forms", () => {
  it("parses a Published target and distinct eligible status groups", () => {
    const formData = new FormData();
    formData.set("target_term_id", termId);
    formData.append("status_groups", "active");
    formData.append("status_groups", "deferred");

    expect(parseCreateReturningStudentCycleForm(formData)).toEqual({
      target_term_id: termId,
      status_groups: ["active", "deferred"]
    });

    formData.append("status_groups", "active");
    expect(() => parseCreateReturningStudentCycleForm(formData)).toThrow();
  });

  it("requires a reason for deliberate individual membership changes", () => {
    const add = new FormData();
    add.set("cycle_id", cycleId);
    add.set("student_id", studentId);
    add.set("reason", "Confirmed additional PGCert study with the learner.");
    expect(parseAddReturningStudentCycleParticipantForm(add)).toEqual({
      cycle_id: cycleId,
      student_id: studentId,
      reason: "Confirmed additional PGCert study with the learner."
    });

    const remove = new FormData();
    remove.set("cycle_id", cycleId);
    remove.set("participant_id", participantId);
    remove.set("reason", " ");
    expect(() => parseReturningStudentCycleParticipantActionForm(remove)).toThrow();
  });

  it("parses a flexible planned-capacity change with its reason", () => {
    const formData = new FormData();
    formData.set("cycle_id", cycleId);
    formData.set("cycle_offering_id", cycleOfferingId);
    formData.set("planned_capacity", "36");
    formData.set("reason", "Demand supports an additional teaching group.");

    expect(parseReturningStudentCyclePlannedCapacityForm(formData)).toEqual({
      cycle_id: cycleId,
      cycle_offering_id: cycleOfferingId,
      planned_capacity: 36,
      reason: "Demand supports an additional teaching group."
    });
  });
});
