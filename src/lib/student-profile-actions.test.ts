import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveWorkspaceStudent } from "@/app/students/workspace-actions";
import { requirePermission } from "@/lib/auth";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { createSupabaseServerClient } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/assessment/feature", () => ({ studentWorkspaceEnabled: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.fn();
const input = { studentId: "49000000-0000-4000-8000-000000000001", expectedRevision: 0, details: { first_name: "Test", last_name: "Student", email: "test@example.test", temporary_id: "TEMP", cccu_student_id: null, phone: null, programme: "pgcert", start_term_id: null, status: "active", admission_stage: "accepted", notes: null } };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(studentWorkspaceEnabled).mockReturnValue(true);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
  rpc.mockResolvedValue({ data: 1, error: null });
});
describe("student workspace action", () => {
  it("requires the existing admissions permission and checks the feature flag", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("Denied"));
    await expect(saveWorkspaceStudent(input)).rejects.toThrow("Denied");
    expect(requirePermission).toHaveBeenCalledWith("manage_admissions");
    vi.mocked(studentWorkspaceEnabled).mockReturnValue(false);
    expect(await saveWorkspaceStudent(input)).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ expectedRevision: undefined }, { expectedRevision: -1 }, { unexpected: true }, { details: { ...input.details, credits: 60 } }, { details: { ...input.details, first_name: " " } }, { details: { ...input.details, email: "not email" } }])("rejects malformed input before touching the database", async changes => {
    expect(await saveWorkspaceStudent({ ...input, ...changes })).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("saves only validated fields and invalidates shared student and assessment displays", async () => {
    expect(await saveWorkspaceStudent(input)).toEqual({ ok: true, message: "Student details saved." });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_student_profile", { student_key: input.studentId, expected_revision: 0, details: input.details });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("retains stale errors without retrying or invalidating", async () => {
    rpc.mockResolvedValue({ error: { message: "Student details changed" } });
    expect(await saveWorkspaceStudent(input)).toEqual({ ok: false, error: "Student details changed" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("returns understandable duplicate-identifier feedback", async () => {
    rpc.mockResolvedValue({ error: { code: "23505", message: "internal database constraint" } });
    expect(await saveWorkspaceStudent(input)).toMatchObject({ ok: false, error: expect.stringContaining("identifier is already in use") });
  });
});
