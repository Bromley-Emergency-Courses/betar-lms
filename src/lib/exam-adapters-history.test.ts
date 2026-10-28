import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { persistNormalizedExamResults, syncEnrolmentStatusesForExamResults } from "./exam-adapters";
import { getAppData } from "./seed";
import type { ExamResult } from "./types";

function fixture(count = 1) {
  const data = structuredClone(getAppData());
  const original = data.enrolments[0];
  data.students.find(student => student.id === original.studentId)!.status = "active";
  data.enrolments = Array.from({ length: count }, (_, index) => ({ ...original, id: `enrolment-${index}`, status: "in_progress" as const }));
  const result: ExamResult = {
    id: "result-new", studentId: original.studentId, offeringId: original.offeringId,
    componentType: "theory", sourceSystem: "theory_portal", sourceAttemptId: "new-attempt",
    score: 20, passMark: 50, passed: false, resitRequired: true, isResit: false,
    attemptNumber: 1, priorAttemptMissing: false, takenOn: "2026-10-28", importedAt: "2026-10-28T10:00:00Z"
  };
  return { data, result };
}

function client(protectedIds: string[], lookupError = false) {
  const updates = vi.fn(async (_column: string, id: string) => ({ error: protectedIds.includes(id) ? { message: "Historical academic baseline is preserved" } : null }));
  const lookup = vi.fn(async (_column: string, ids: string[]) => ({
    data: lookupError ? null : protectedIds.filter(id => ids.includes(id)).map(enrolment_id => ({ enrolment_id })),
    error: lookupError ? { message: "Historical protection lookup unavailable" } : null
  }));
  const persisted = vi.fn(async () => ({ error: null }));
  const from = vi.fn((table: string) => {
    if (table === "assessment_historical_outcomes") return { select: () => ({ in: lookup }) };
    if (table === "exam_results") return { upsert: () => ({ select: persisted }) };
    if (table === "enrolments") return { update: () => ({ eq: updates }) };
    throw new Error(`Unexpected table ${table}`);
  });
  return { supabase: { from } as unknown as SupabaseClient, updates, lookup, persisted, from };
}

describe("legacy import historical outcome compatibility", () => {
  it("accepts an imported score without attempting to overwrite its protected historical outcome", async () => {
    const { data, result } = fixture();
    const database = client([data.enrolments[0].id]);
    const accepted = await persistNormalizedExamResults(database.supabase, [{ ok: true, result }]);
    expect(database.persisted).toHaveBeenCalledOnce();
    await expect(syncEnrolmentStatusesForExamResults(database.supabase, data, accepted)).resolves.toEqual([]);
    expect(database.updates).not.toHaveBeenCalled();
  });

  it("still updates new enrolments while retaining protected records in the same import", async () => {
    const { data, result } = fixture(2);
    const database = client([data.enrolments[0].id]);
    await expect(syncEnrolmentStatusesForExamResults(database.supabase, data, [result])).resolves.toEqual([
      { enrolmentId: data.enrolments[1].id, studentId: result.studentId, status: "failed", creditsAwarded: 0 }
    ]);
    expect(database.updates).toHaveBeenCalledExactlyOnceWith("id", data.enrolments[1].id);
  });

  it("does not treat a failed protection lookup as permission to change outcomes", async () => {
    const { data, result } = fixture();
    const database = client([], true);
    await expect(syncEnrolmentStatusesForExamResults(database.supabase, data, [result])).rejects.toThrow("Historical protection lookup unavailable");
    expect(database.updates).not.toHaveBeenCalled();
  });

  it("checks every affected enrolment without exceeding the API row limit", async () => {
    const { data, result } = fixture(1001);
    const database = client(data.enrolments.map(enrolment => enrolment.id));
    await expect(syncEnrolmentStatusesForExamResults(database.supabase, data, [result])).resolves.toEqual([]);
    const checkedIds = database.lookup.mock.calls.flatMap(([, ids]) => ids);
    expect(new Set(checkedIds)).toEqual(new Set(data.enrolments.map(enrolment => enrolment.id)));
    expect(database.lookup.mock.calls.every(([, ids]) => ids.length <= 200)).toBe(true);
    expect(database.updates).not.toHaveBeenCalled();
  });

  it("does not query or write when there are no incoming or affected results", async () => {
    const { data, result } = fixture();
    const database = client([]);
    expect(await syncEnrolmentStatusesForExamResults(database.supabase, data, [])).toEqual([]);
    expect(await syncEnrolmentStatusesForExamResults(database.supabase, data, [{ ...result, studentId: "unrelated" }])).toEqual([]);
    expect(database.from).not.toHaveBeenCalled();
  });
});
