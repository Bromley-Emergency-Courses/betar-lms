import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncExamPortalMapping } from "./admin-actions";
import { requirePermission } from "./auth";
import { createSupabaseServerClient } from "./supabase";
import { ingestPortalAssessmentResults } from "./assessment/portal-ingestion";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`Redirect: ${url}`); } }));
vi.mock("./auth", () => ({ requirePermission: vi.fn() }));
vi.mock("./supabase", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("./assessment/portal-ingestion", () => ({ ingestPortalAssessmentResults: vi.fn() }));

const mappingId = "68000000-0000-4000-8000-000000000001";
const mapping = { id: mappingId, portal_exam_id: "synthetic-exam", module_id: "68000000-0000-4000-8000-000000000002", term_id: "68000000-0000-4000-8000-000000000003", portal_exam_kind: "module_theory", physics_required: true };
const result = { token_id: "synthetic-token", student_name: "Synthetic Learner", lms_student_id: "123456789", completed_at: "2026-10-20T12:00:00Z", score: 35, total: 50, percentage: 70 };
const summary = { created: 1, unchanged: 0, source_updated: 0, auto_matched: 0, unmatched: 1, rejected: 0, errors: [] };
const fetchMock = vi.fn();
const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
const from = vi.fn(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: mapping, error: null }) }) }), update }));
function form() {
  const input = new FormData();
  input.set("mapping_id", mappingId);
  input.set("assessment_reason", "Reviewed synthetic import");
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "live");
  vi.stubEnv("EXAM_PORTAL_LMS_RESULTS_URL", "https://portal.invalid/functions/v1/lms-results");
  vi.stubEnv("EXAM_PORTAL_LMS_API_SECRET", "synthetic-secret");
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(requirePermission).mockResolvedValue({ id: "synthetic-admin", fullName: "Synthetic Admin", active: true, role: "admin" });
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
  vi.mocked(ingestPortalAssessmentResults).mockResolvedValue(summary);
  fetchMock.mockResolvedValue(Response.json({ exam_id: mapping.portal_exam_id, available_for_lms: true, results: [result] }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("administrator Portal pull compatibility", () => {
  it("pulls reviewed results directly from the Portal and routes live evidence without writing legacy tables", async () => {
    await expect(syncExamPortalMapping(form())).rejects.toThrow("Redirect: /assessments?");
    expect(requirePermission).toHaveBeenCalledExactlyOnceWith("manage_course");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://portal.invalid/functions/v1/lms-results", {
      method: "POST", headers: { authorization: "Bearer synthetic-secret", "content-type": "application/json" },
      body: JSON.stringify({ exam_id: mapping.portal_exam_id }), cache: "no-store"
    });
    expect(ingestPortalAssessmentResults).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ portal_exam_id: mapping.portal_exam_id, module_id: mapping.module_id, term_id: mapping.term_id, physics_required: true }), [expect.objectContaining(result)], "Reviewed synthetic import");
    expect(from.mock.calls.flat()).toEqual(["exam_portal_mappings"]);
    expect(update).not.toHaveBeenCalled();
  });
  it("rejects a caller without the administrator permission before any network or database access", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("Denied"));
    await expect(syncExamPortalMapping(form())).rejects.toThrow("Denied");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
  it("refuses unavailable exam results without ingesting them", async () => {
    fetchMock.mockResolvedValue(Response.json({ exam_id: mapping.portal_exam_id, available_for_lms: false, results: [result] }));
    await expect(syncExamPortalMapping(form())).rejects.toThrow("Redirect: /exams?mode=edit");
    expect(ingestPortalAssessmentResults).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ last_sync_status: "not_available_for_lms" }));
  });
  it("does not import on missing configuration or a rejected Portal response", async () => {
    vi.stubEnv("EXAM_PORTAL_LMS_API_SECRET", "");
    await expect(syncExamPortalMapping(form())).rejects.toThrow("Set EXAM_PORTAL_LMS_RESULTS_URL");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("EXAM_PORTAL_LMS_API_SECRET", "synthetic-secret");
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(syncExamPortalMapping(form())).rejects.toThrow("HTTP 401");
    expect(ingestPortalAssessmentResults).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("rejects invalid scores rather than accepting a malformed Portal payload", async () => {
    fetchMock.mockResolvedValue(Response.json({ exam_id: mapping.portal_exam_id, available_for_lms: true, results: [{ ...result, percentage: 101 }] }));
    await expect(syncExamPortalMapping(form())).rejects.toThrow();
    expect(ingestPortalAssessmentResults).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("stops on failed shadow evidence ingestion before writing legacy submissions", async () => {
    vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "shadow");
    vi.mocked(ingestPortalAssessmentResults).mockRejectedValue(new Error("Assessment import rejected"));
    await expect(syncExamPortalMapping(form())).rejects.toThrow("Assessment import rejected");
    expect(from.mock.calls.flat()).toEqual(["exam_portal_mappings"]);
    expect(update).not.toHaveBeenCalled();
  });
});
