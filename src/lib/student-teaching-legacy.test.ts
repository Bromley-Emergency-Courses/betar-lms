import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveLegacyTeaching } from "./student-teaching-legacy";
import { requirePermission } from "./auth";
import { createSupabaseServerClient } from "./supabase";
import { presentationRubricCriteria } from "./presentation-rubric";

vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ requirePermission: vi.fn() }));
vi.mock("./supabase", () => ({ createSupabaseServerClient: vi.fn() }));
const rpc = vi.fn();
const id = (suffix: number) => `59000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const observation = { id: id(1), student_id: id(2), offering_id: id(3), occurred_on: "2026-10-25", kind: "observation", summary: "Observed scan", concern_level: "none" };
const options = { offerings: [{ id: id(3), moduleId: id(4), token: "a".repeat(32) }], definitions: [{ id: id(5), moduleId: id(4), token: "b".repeat(32) }] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
  rpc.mockImplementation(async name => ({ data: name === "read_student_teaching_options" ? options : null, error: null }));
});

describe("legacy teaching command adapter", () => {
  it("uses presentation-specific eligibility and does not treat a duplicate submission as success", async () => {
    const input = { id: id(1), student_id: id(2), offering_id: id(3), occurred_on: "2026-10-25", kind: "presentation",
      presentation_type: "case_presentation", duration_minutes: 20, scores: Object.fromEntries(presentationRubricCriteria.map(criterion => [criterion.id,4])), comments: null };
    rpc.mockImplementation(async name => ({ data: name === "read_student_teaching_options" ? { ...options, offerings: [], presentations: options.offerings } : { status: "duplicate", id: id(8) }, error: null }));
    await expect(saveLegacyTeaching(input)).rejects.toThrow("Edit your existing submission");
    expect(rpc).toHaveBeenLastCalledWith("create_student_teaching_record", { command: { ...input, offering_token: "a".repeat(32) } });
  });
  it("uses the existing guarded command with the form's stable retry identity and no supplied author", async () => {
    await saveLegacyTeaching(observation);
    expect(requirePermission).toHaveBeenCalledWith("record_teaching");
    expect(rpc).toHaveBeenLastCalledWith("create_student_teaching_record", { command: { ...observation, offering_token: "a".repeat(32) } });
    await saveLegacyTeaching(observation);
    expect(rpc.mock.calls.filter(call => call[0] === "create_student_teaching_record").map(call => call[1].command.id)).toEqual([id(1),id(1)]);
  });
  it("supplies only the matching module's current formative configuration token", async () => {
    const formative = { id: id(1), student_id: id(2), offering_id: id(3), occurred_on: "2026-10-25", kind: "formative", definition_id: id(5), assessed_item_ids: ["image"], overall_score: 0, comments: null };
    await saveLegacyTeaching(formative);
    expect(rpc).toHaveBeenLastCalledWith("create_student_teaching_record", { command: { ...formative, offering_token: "a".repeat(32), definition_token: "b".repeat(32) } });
  });
  it("rejects spoofed authors, missing command identity and invalid dates before saving", async () => {
    for (const extra of [{ staff_user_id: id(6) }, { id: "" }, { occurred_on: "2026-02-30" }]) {
      await expect(saveLegacyTeaching({ ...observation, ...extra })).rejects.toThrow();
    }
    expect(rpc.mock.calls.some(call => call[0] === "create_student_teaching_record")).toBe(false);
  });
  it("does not fall back to a table insert if permission, eligibility or command validation fails", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("Denied"));
    await expect(saveLegacyTeaching(observation)).rejects.toThrow("Denied");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: { offerings: [], definitions: [] }, error: null });
    await expect(saveLegacyTeaching(observation)).rejects.toThrow("not eligible");
    rpc.mockImplementation(async name => name === "read_student_teaching_options" ? { data: options, error: null } : { data: null, error: { message: "Teaching or enrolment details changed" } });
    await expect(saveLegacyTeaching(observation)).rejects.toThrow("details changed");
  });
});
