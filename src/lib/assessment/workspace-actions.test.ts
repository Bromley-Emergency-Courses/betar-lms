import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveWorkspaceAssessment } from "@/app/assessments/workspace-actions";
import { requirePermission } from "@/lib/auth";
import { executeAssessmentCommand } from "@/lib/assessment";
import { studentWorkspaceEnabled } from "./feature";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/assessment", () => ({ executeAssessmentCommand: vi.fn() }));
vi.mock("./feature", () => ({ studentWorkspaceEnabled: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const input = { expectedRevision: 3, command: { type: "SetAssessmentOverride", enrolment_id: "49000000-0000-4000-8000-000000000001", kind: "credits", value: 0, reason: "Reviewed evidence" } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(studentWorkspaceEnabled).mockReturnValue(true);
});

describe("workspace server action", () => {
  it("requires administrator permissions even for direct calls", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("Not permitted"));
    await expect(saveWorkspaceAssessment(input)).rejects.toThrow("Not permitted");
    expect(requirePermission).toHaveBeenCalledWith("manage_course");
    expect(executeAssessmentCommand).not.toHaveBeenCalled();
  });
  it("refuses writes when the integration is disabled", async () => {
    vi.mocked(studentWorkspaceEnabled).mockReturnValue(false);
    expect(await saveWorkspaceAssessment(input)).toMatchObject({ ok: false, error: "The student workspace is disabled." });
    expect(executeAssessmentCommand).not.toHaveBeenCalled();
  });
  it("does not forward configuration, matching or pass-mark injections", async () => {
    for (const change of [{ type: "MatchSourceResult" }, { type: "ChangeEnrolmentAssessmentPlan" }, { pass_mark: 0 }]) {
      expect(await saveWorkspaceAssessment({ ...input, command: { ...input.command, ...change } })).toMatchObject({ ok: false });
    }
    expect(executeAssessmentCommand).not.toHaveBeenCalled();
  });
  it("returns a stale-write failure without silently retrying on a newer revision", async () => {
    vi.mocked(executeAssessmentCommand).mockRejectedValue(new Error("Assessment changed. Reload before saving."));
    expect(await saveWorkspaceAssessment(input)).toMatchObject({ ok: false, error: "Assessment changed. Reload before saving." });
    expect(executeAssessmentCommand).toHaveBeenCalledExactlyOnceWith(input.command, 3);
  });
});
