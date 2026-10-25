import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkspacePhoto, saveWorkspacePhoto } from "@/app/students/photo-actions";
import { saveStudentPhotoChange } from "./student-photo-service";
import { studentPhotoLimit, validateStudentPhotoSignature } from "./student-photo";
import { requirePermission } from "@/lib/auth";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { createSupabaseServerClient } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/assessment/feature", () => ({ studentWorkspaceEnabled: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.fn(); const upload = vi.fn(); const remove = vi.fn(); const limit = vi.fn(); const from = vi.fn();
const studentId = "49000000-0000-4000-8000-000000000001";
const png = () => new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])], "photo.png", { type: "image/png" });
function fields(operation = "upload") {
  const form = new FormData(); form.set("student_id",studentId); form.set("expected_revision","2"); form.set("operation",operation);
  if (operation === "upload") form.set("photo",png()); else form.set("confirm_remove","yes");
  return form;
}
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(studentWorkspaceEnabled).mockReturnValue(true);
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit }; from.mockReturnValue(query); limit.mockResolvedValue({ data: [], error: null });
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc, from, storage: { from: vi.fn().mockReturnValue({ upload, remove }) } } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
  rpc.mockImplementation(name => Promise.resolve(name === "read_student_photo_workspace" ? { data: { revision: 2, hasPhoto: true }, error: null } : { data: { previousPath: `${studentId}/old.png`, revision: 3 }, error: null }));
  upload.mockResolvedValue({ error: null }); remove.mockResolvedValue({ error: null });
});
describe("private student photo actions", () => {
  it("requires administrator permission for both workspace reads and all save paths", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("Denied"));
    await expect(loadWorkspacePhoto(studentId)).rejects.toThrow("Denied"); await expect(saveWorkspacePhoto(fields())).rejects.toThrow("Denied"); await expect(saveStudentPhotoChange(fields())).rejects.toThrow("Denied");
    expect(requirePermission).toHaveBeenCalledWith("manage_everything"); expect(upload).not.toHaveBeenCalled();
  });
  it("gates workspace reads and writes without disabling the legacy service", async () => {
    vi.mocked(studentWorkspaceEnabled).mockReturnValue(false);
    expect(await loadWorkspacePhoto(studentId)).toMatchObject({ ok: false }); expect(await saveWorkspacePhoto(fields())).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
    expect(await saveStudentPhotoChange(fields())).toMatchObject({ ok: true });
  });
  it("uploads a new unique private path, atomically saves, then cleans the old file and refreshes", async () => {
    expect(await loadWorkspacePhoto(studentId)).toMatchObject({ ok: true, snapshot: { revision: 2, hasPhoto: true } });
    expect(await saveWorkspacePhoto(fields())).toEqual({ ok: true, message: "Profile photo saved." });
    const path = upload.mock.calls[0][0]; expect(path).toMatch(new RegExp(`^${studentId}/workspace/.*\\.png$`));
    expect(upload.mock.calls[0][2]).toEqual({ contentType: "image/png", upsert: false });
    expect(rpc).toHaveBeenCalledWith("save_student_photo", { student_key: studentId, expected_revision: 2, object_path: path, removal_confirmed: false });
    expect(remove).toHaveBeenCalledWith([`${studentId}/old.png`]); expect(revalidatePath).toHaveBeenCalledWith("/","layout");
  });
  it("requires deliberate removal and never deletes storage before the reference is saved", async () => {
    const form = fields("remove"); form.delete("confirm_remove"); expect(await saveWorkspacePhoto(form)).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
    expect(await saveWorkspacePhoto(fields("remove"))).toMatchObject({ ok: true }); expect(upload).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("save_student_photo", { student_key: studentId, expected_revision: 2, object_path: null, removal_confirmed: true });
    expect(remove.mock.invocationCallOrder[0]).toBeGreaterThan(rpc.mock.invocationCallOrder.at(-1)!);
  });
  it("rejects stale snapshots before uploading anything", async () => {
    rpc.mockResolvedValue({ data: { revision: 3 }, error: null });
    expect(await saveWorkspacePhoto(fields())).toMatchObject({ ok: false, error: expect.stringContaining("changed") }); expect(upload).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it("cleans only the new upload after a confirmed database rollback and retains the old photo", async () => {
    rpc.mockImplementation(name => Promise.resolve(name === "read_student_photo_workspace" ? { data: { revision: 2 }, error: null } : { error: { code: "P0001", message: "Student or photo changed" } }));
    expect(await saveWorkspacePhoto(fields())).toMatchObject({ ok: false }); expect(remove).toHaveBeenCalledExactlyOnceWith([upload.mock.calls[0][0]]); expect(revalidatePath).not.toHaveBeenCalled();
  });
  it.each(["throw", "response"])("does not delete either object after an ambiguous commit %s failure", async failure => {
    rpc.mockImplementation(name => name === "read_student_photo_workspace" ? Promise.resolve({ data: { revision: 2 } }) : failure === "throw" ? Promise.reject(new Error("Network lost")) : Promise.resolve({ error: { message: "Network lost", code: "" } }));
    expect(await saveWorkspacePhoto(fields())).toMatchObject({ ok: false }); expect(remove).not.toHaveBeenCalled(); expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("reports cleanup failure as a saved change and does not remove shared documentary evidence", async () => {
    remove.mockResolvedValue({ error: { message: "Storage offline" } }); expect(await saveWorkspacePhoto(fields())).toMatchObject({ ok: true, message: expect.stringContaining("administrator review") });
    remove.mockClear(); limit.mockResolvedValue({ data: [{ id: "shared" }], error: null });
    expect(await saveWorkspacePhoto(fields("remove"))).toMatchObject({ ok: true, message: expect.stringContaining("another record references") }); expect(remove).not.toHaveBeenCalled();
  });
  it("preserves the old reference after upload failure", async () => {
    upload.mockResolvedValue({ error: { message: "Storage offline" } });
    expect(await saveWorkspacePhoto(fields())).toMatchObject({ ok: false }); expect(rpc).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled();
  });
  it.each([new File(["<svg/>"],"photo.svg",{ type: "image/svg+xml" }), new File(["<html>"],"photo.png",{ type: "image/png" }), new File([],"empty.png",{ type: "image/png" }), new File([new Uint8Array(studentPhotoLimit + 1)],"large.png",{ type: "image/png" })])("rejects unsupported, disguised, empty and oversized files", async file => {
    const form = fields(); form.set("photo",file); expect(await saveWorkspacePhoto(form)).toMatchObject({ ok: false }); expect(upload).not.toHaveBeenCalled();
  });
  it("requires a frozen numeric revision", async () => {
    const form = fields(); form.delete("expected_revision"); expect(await saveWorkspacePhoto(form)).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([new File([new Uint8Array([255,216,255,224])],"photo.jpg",{ type: "image/jpeg" }),new File(["RIFF1234WEBP"],"photo.webp",{ type: "image/webp" })])("accepts the supported JPEG and WEBP signatures", async file => expect(await validateStudentPhotoSignature(file)).toBeUndefined());
});
