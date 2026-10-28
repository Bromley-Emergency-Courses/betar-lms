import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTeachingPlans, saveTeachingPlan } from "@/app/staff/plan-actions";
import { requirePermission } from "./auth";
import { createSupabaseServerClient } from "./supabase";
import { staffCompanionTeachingEnabled } from "./assessment/feature";
import { revalidatePath } from "next/cache";

vi.mock("./auth", () => ({ requirePermission: vi.fn() }));
vi.mock("./supabase", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("./assessment/feature", () => ({ staffCompanionTeachingEnabled: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.fn();
const studentId = "62000000-0000-4000-8000-000000000001";
const input = { studentId, offeringId: "62000000-0000-4000-8000-000000000002", token: "a".repeat(32), kind: "attendance", sessionId: "62000000-0000-4000-8000-000000000003", fromSessionId: null, expected: true };
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(staffCompanionTeachingEnabled).mockReturnValue(true);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
  rpc.mockResolvedValue({ data: { offerings: [], sessions: [] }, error: null });
});
describe("teacher plan gateway", () => {
  it("requires permission and the default-off teaching exposure gate", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("Denied"));
    await expect(loadTeachingPlans(studentId)).rejects.toThrow("Denied");
    await expect(saveTeachingPlan(input)).rejects.toThrow("Denied");
    vi.mocked(requirePermission).mockResolvedValue(undefined as never);
    vi.mocked(staffCompanionTeachingEnabled).mockReturnValue(false);
    expect(await loadTeachingPlans(studentId)).toMatchObject({ ok: false });
    expect(await saveTeachingPlan(input)).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([input, { ...input, kind: "presentation", sessionId: null }])("dispatches only the narrow command and invalidates on success", async command => {
    expect(await saveTeachingPlan(command)).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("save_student_teaching_plan", { command });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it.each([{ studentId: "invalid" }, { status: "attended" }, { expected: "true" }, { token: "" }, { sessionId: null }, { fromSessionId: input.sessionId }, { kind: "presentation", expected: false }])("rejects invalid or expanded plan payloads: %j", async extra => {
    expect(await saveTeachingPlan({ ...input, ...extra })).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it("retains stale errors without retry or revalidation", async () => {
    rpc.mockResolvedValue({ error: { message: "Calendar changed" } });
    expect(await saveTeachingPlan(input)).toEqual({ ok: false, error: "Calendar changed" });
    expect(rpc).toHaveBeenCalledTimes(1); expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("loads one student's options with no service-role or expanded payload", async () => {
    expect(await loadTeachingPlans(studentId)).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("read_student_teaching_plans", { student_key: studentId });
  });
});
