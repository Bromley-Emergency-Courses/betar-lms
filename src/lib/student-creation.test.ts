import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceStudent } from "@/app/students/creation-actions";
import { requirePermission } from "@/lib/auth";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { createSupabaseServerClient } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/assessment/feature", () => ({ studentWorkspaceEnabled: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.fn();
const input = { studentId: "49000000-0000-4000-8000-000000000001", details: { first_name: "Test",last_name: "Student",temporary_id: null,cccu_student_id: null,email: "student@example.test",phone: null,programme: "pgcert",start_term_id: null,status: "prospect",admission_stage: "interest",notes: null } };
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(studentWorkspaceEnabled).mockReturnValue(true);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
  rpc.mockResolvedValue({ data: input.studentId,error: null });
});
describe("workspace student creation action", () => {
  it("requires admissions permission and gates the integrated action", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("Denied")); await expect(createWorkspaceStudent(input)).rejects.toThrow("Denied");
    expect(requirePermission).toHaveBeenCalledWith("manage_admissions"); vi.mocked(studentWorkspaceEnabled).mockReturnValue(false);
    expect(await createWorkspaceStudent(input)).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it("preserves the stable creation identifier, nullable fields and shared invalidation", async () => {
    expect(await createWorkspaceStudent(input)).toEqual({ ok: true,studentId: input.studentId });
    expect(rpc).toHaveBeenCalledWith("create_workspace_student",{ student_key: input.studentId,details: input.details }); expect(revalidatePath).toHaveBeenCalledWith("/","layout");
  });
  it.each([{ first_name: " " },{ temporary_id: "x" },{ email: "bad" },{ programme: "other" },{ status: "Pass" },{ admission_stage: "passed" },{ start_term_id: "bad" },{ notes: "a".repeat(10001) },{ person_id: input.studentId },{ photo_path: "forged" },{ credits: 60 }])("rejects malformed or non-creation fields %j", async details => {
    expect(await createWorkspaceStudent({ ...input,details: { ...input.details,...details } })).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([["23505","identifier is already in use"],["23503","start term is no longer available"]])("explains %s without navigating or invalidating", async (code,message) => {
    rpc.mockResolvedValue({ error: { code,message: "Database rejected" } }); expect(await createWorkspaceStudent(input)).toMatchObject({ ok: false,error: expect.stringContaining(message) }); expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("does not retry or mint a second identifier on transport failure", async () => {
    rpc.mockRejectedValue(new Error("Network lost")); expect(await createWorkspaceStudent(input)).toMatchObject({ ok: false,error: expect.stringContaining("same unchanged draft") }); expect(rpc).toHaveBeenCalledTimes(1); expect(revalidatePath).not.toHaveBeenCalled();
  });
});
