import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceSession, saveWorkspaceAttendance } from "@/app/students/attendance-actions";
import { requirePermission } from "@/lib/auth";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { createSupabaseServerClient } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/assessment/feature", () => ({ studentWorkspaceEnabled: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.fn();
const identity = { studentId: "49000000-0000-4000-8000-000000000001", sessionId: "49000000-0000-4000-8000-000000000002" };
const attendance = { ...identity, expectedRevision: 0, expectedSessionRevision: 0, status: "attended", expected: false, note: "Reviewed", reason: "Register checked", confirmClear: false };
const session = { ...identity, termId: "49000000-0000-4000-8000-000000000003", date: "2025-04-15", startsAt: "09:00", endsAt: "17:00", location: "Teaching room", reason: "Agreed term date" };
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(studentWorkspaceEnabled).mockReturnValue(true);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
  rpc.mockResolvedValue({ error: null });
});
describe("attendance workspace actions", () => {
  it.each([saveWorkspaceAttendance, createWorkspaceSession])("requires admin course permission and the workspace flag", async save => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("Denied"));
    await expect(save(attendance)).rejects.toThrow("Denied");
    expect(requirePermission).toHaveBeenCalledWith("manage_course");
    vi.mocked(studentWorkspaceEnabled).mockReturnValue(false);
    expect(await save(attendance)).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ expectedRevision: undefined }, { expectedSessionRevision: -1 }, { checkedInAt: "forged" }, { status: "Pass" }, { reason: " " }, { note: "x".repeat(501) }])("rejects invalid attendance fields", async fields => {
    expect(await saveWorkspaceAttendance({ ...attendance, ...fields })).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ date: "2025-02-30" }, { startsAt: "19:00" }, { endsAt: "09:00" }, { startsAt: "25:00" }, { expectedStudentIds: [identity.studentId] }, { location: " " }])("rejects invalid or student-assignment session fields", async fields => {
    expect(await createWorkspaceSession({ ...session, ...fields })).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it("dispatches both typed commands and invalidates shared views", async () => {
    expect(await saveWorkspaceAttendance(attendance)).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("save_student_attendance", { command: attendance });
    expect(await createWorkspaceSession(session)).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("create_student_term_session", { command: session });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("returns stale and serialization failures without retrying", async () => {
    rpc.mockResolvedValue({ error: { code: "40P01", message: "deadlock detected" } });
    expect(await saveWorkspaceAttendance(attendance)).toMatchObject({ ok: false, error: expect.stringContaining("Discard and reopen") });
    expect(rpc).toHaveBeenCalledTimes(1); expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("returns the fresh saved snapshot so an immediate second edit does not reuse the old revision", async () => {
    const saved = { id: identity.sessionId, revision: 2, sessionRevision: 0, status: "attended" };
    rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: null, data: [saved] });
    expect(await saveWorkspaceAttendance(attendance)).toMatchObject({ ok: true, attendance: saved });
    expect(rpc).toHaveBeenLastCalledWith("read_student_attendance", { student_key: identity.studentId });
  });
  it("explains an unconfirmed refresh after saving without replaying the mutation", async () => {
    rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "Read unavailable" } });
    expect(await saveWorkspaceAttendance(attendance)).toMatchObject({ ok: false, error: expect.stringContaining("Attendance was saved") });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
