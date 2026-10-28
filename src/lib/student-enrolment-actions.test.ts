import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkspaceEnrolments, saveWorkspaceEnrolment } from "@/app/students/enrolment-actions";
import { executeAssessmentCommand, readStudentEnrolments } from "@/lib/assessment";
import { requirePermission } from "@/lib/auth";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/assessment/feature", () => ({ studentWorkspaceEnabled: vi.fn() }));
vi.mock("@/lib/assessment", () => ({ executeAssessmentCommand: vi.fn(), readStudentEnrolments: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const student = "49000000-0000-4000-8000-000000000001";
const enrolment = "49000000-0000-4000-8000-000000000002";
const base = { enrolment_id: enrolment, student_id: student, expected_token: "a".repeat(32), reason: "Reviewed" };
const command = { ...base, type: "SetEnrolmentRequirements", attendance_days: 0, presentation_required: false };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(studentWorkspaceEnabled).mockReturnValue(true); vi.mocked(executeAssessmentCommand).mockResolvedValue({ assessment: null, source_id: null, pass_reversed: false }); });
describe("student enrolment actions", () => {
  it("enforces permission and flag on reads and saves", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("Denied"));
    await expect(loadWorkspaceEnrolments(student)).rejects.toThrow("Denied");
    await expect(saveWorkspaceEnrolment({ command, expectedRevision: 1 })).rejects.toThrow("Denied");
    expect(requirePermission).toHaveBeenCalledWith("manage_course");
    vi.mocked(requirePermission).mockResolvedValue(undefined as never);
    vi.mocked(studentWorkspaceEnabled).mockReturnValue(false);
    expect(await loadWorkspaceEnrolments(student)).toMatchObject({ ok: false });
    expect(await saveWorkspaceEnrolment({ command, expectedRevision: 1 })).toMatchObject({ ok: false });
    expect(executeAssessmentCommand).not.toHaveBeenCalled(); expect(readStudentEnrolments).not.toHaveBeenCalled();
  });
  it.each([{ attendance_days: -1 }, { attendance_days: 1.2 }, { presentation_required: "false" }, { reason: " " }, { expected_token: undefined }, { pass_mark: 1 }, { plan_id: enrolment }, { status: "Pass" }, { offering_id: enrolment }])("rejects malformed or global configuration fields %j", async change => {
    expect(await saveWorkspaceEnrolment({ command: { ...command, ...change }, expectedRevision: 1 })).toMatchObject({ ok: false }); expect(executeAssessmentCommand).not.toHaveBeenCalled();
  });
  it.each([
    command,
    { ...command, attendance_days: null, presentation_required: null },
    { ...base, type: "SetEnrolmentDisposition", disposition: "Module deferred" },
    { ...base, type: "SetEnrolmentDisposition", disposition: "Abandoned" },
    { ...base, type: "ClearEnrolmentDisposition" },
    { ...base, type: "CancelMistakenEnrolment", confirmed: true },
    { enrolment_id: enrolment, student_id: student, reason: "New teaching", type: "CreateModuleEnrolment", offering_id: enrolment, offering_token: "b".repeat(32), attendance_days: null, presentation_required: null }
  ])("dispatches the typed command through the shared boundary: $type", async input => {
    expect(await saveWorkspaceEnrolment({ command: input, expectedRevision: 0 })).toMatchObject({ ok: true });
    expect(executeAssessmentCommand).toHaveBeenCalledWith(input, 0); expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("loads fresh scoped data on opening instead of reusing a pre-save revision", async () => {
    vi.mocked(readStudentEnrolments).mockResolvedValue({ enrolments: [], offerings: [] });
    expect(await loadWorkspaceEnrolments(student)).toEqual({ ok: true, workspace: { enrolments: [], offerings: [] } });
    expect(readStudentEnrolments).toHaveBeenCalledWith(student);
    expect(await loadWorkspaceEnrolments("bad")).toMatchObject({ ok: false });
    expect(readStudentEnrolments).toHaveBeenCalledTimes(1);
  });
  it("returns a stale save without retry or refresh", async () => {
    vi.mocked(executeAssessmentCommand).mockRejectedValue(new Error("Enrolment changed"));
    expect(await saveWorkspaceEnrolment({ command, expectedRevision: 1 })).toEqual({ ok: false, error: "Enrolment changed" });
    expect(executeAssessmentCommand).toHaveBeenCalledTimes(1); expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("requires deliberate confirmation and a revision", async () => {
    expect(await saveWorkspaceEnrolment({ command: { ...base, type: "CancelMistakenEnrolment", confirmed: false }, expectedRevision: 1 })).toMatchObject({ ok: false });
    expect(await saveWorkspaceEnrolment({ command: { ...base, type: "RemoveModuleEnrolment", confirmed: false }, expectedRevision: 1 })).toMatchObject({ ok: false });
    expect(await saveWorkspaceEnrolment({ command })).toMatchObject({ ok: false });
    expect(executeAssessmentCommand).not.toHaveBeenCalled();
  });
  it("rejects the retired removal command even with deliberate confirmation", async () => {
    expect(await saveWorkspaceEnrolment({ command: { ...base, type: "RemoveModuleEnrolment", confirmed: true }, expectedRevision: 1 })).toMatchObject({ ok: false });
    expect(executeAssessmentCommand).not.toHaveBeenCalled();
  });
});
