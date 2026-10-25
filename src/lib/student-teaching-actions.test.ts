import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkspaceTeaching, saveWorkspaceTeaching } from "@/app/students/teaching-actions";
import { requirePermission } from "@/lib/auth";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { createSupabaseServerClient } from "@/lib/supabase";
import { presentationRubricCriteria } from "./presentation-rubric";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/assessment/feature", () => ({ studentWorkspaceEnabled: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.fn();
const student = "49000000-0000-4000-8000-000000000001";
const base = { id: "49000000-0000-4000-8000-000000000002", student_id: student, offering_id: "49000000-0000-4000-8000-000000000003", offering_token: "a".repeat(32), occurred_on: "2025-03-01" };
const observation = { ...base, kind: "observation", summary: "Reviewed scan", concern_level: "watch" };
const formative = { ...base, kind: "formative", definition_id: base.id, definition_token: "b".repeat(32), assessed_item_ids: ["image"], overall_score: 0, comments: null };
const presentation = { ...base, kind: "presentation", presentation_type: "journal_club", duration_minutes: 15, scores: Object.fromEntries(presentationRubricCriteria.map(criterion => [criterion.id, 4])), comments: "Feedback" };
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(studentWorkspaceEnabled).mockReturnValue(true);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
  rpc.mockResolvedValue({ error: null, data: { offerings: [], definitions: [] } });
});
describe("student teaching actions", () => {
  it("requires teaching permission on reads and writes and honours the feature flag", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("Denied"));
    await expect(loadWorkspaceTeaching(student)).rejects.toThrow("Denied"); await expect(saveWorkspaceTeaching(observation)).rejects.toThrow("Denied");
    expect(requirePermission).toHaveBeenCalledWith("record_teaching");
    vi.mocked(requirePermission).mockResolvedValue(undefined as never); vi.mocked(studentWorkspaceEnabled).mockReturnValue(false);
    expect(await loadWorkspaceTeaching(student)).toMatchObject({ ok: false }); expect(await saveWorkspaceTeaching(observation)).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([observation, formative, presentation])("dispatches $kind without a client author or calculated total", async input => {
    expect(await saveWorkspaceTeaching(input)).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("create_student_teaching_record", { command: input }); expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it.each([{ summary: " " }, { concern_level: "urgent" }, { staff_user_id: student }, { offering_token: undefined }, { occurred_on: "2025-02-30" }, { kind: "exam" }, { summary: "x".repeat(10001) }])("rejects invalid observation or spoofed fields %j", async extra => {
    expect(await saveWorkspaceTeaching({ ...observation, ...extra })).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ assessed_item_ids: [] }, { assessed_item_ids: ["image", "image"] }, { overall_score: 2.5 }, { definition_token: undefined }, { scores: { image: 5 } }])("rejects malformed formative evidence %j", async extra => {
    expect(await saveWorkspaceTeaching({ ...formative, ...extra })).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ scores: {} }, { scores: { ...presentation.scores, unknown: 2 } }, { scores: { ...presentation.scores, [presentationRubricCriteria[0].id]: 0 } }, { duration_minutes: 0 }, { total_score: 50 }, { presentation_type: "exam" }])("rejects incomplete or forged presentation evidence %j", async extra => {
    expect(await saveWorkspaceTeaching({ ...presentation, ...extra })).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it("loads scoped options afresh and rejects malformed student identifiers", async () => {
    expect(await loadWorkspaceTeaching(student)).toMatchObject({ ok: true }); expect(rpc).toHaveBeenCalledWith("read_student_teaching_options", { student_key: student });
    expect(await loadWorkspaceTeaching("bad")).toMatchObject({ ok: false }); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("returns stale errors without retrying or invalidating the dirty editor", async () => {
    rpc.mockResolvedValue({ error: { message: "Formative assessment configuration changed" } });
    expect(await saveWorkspaceTeaching(formative)).toEqual({ ok: false, error: "Formative assessment configuration changed" });
    expect(rpc).toHaveBeenCalledTimes(1); expect(revalidatePath).not.toHaveBeenCalled();
  });
});
