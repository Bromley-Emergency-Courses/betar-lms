import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/exam-adapters/results/route";
import { GET } from "@/app/api/exam-adapters/contract/route";
import { getCurrentStaffProfile } from "./auth";
import { getLmsData } from "./lms-data";
import { ingestAssessmentSource } from "./assessment";
import { persistNormalizedExamResults, syncEnrolmentStatusesForExamResults } from "./exam-adapters";

vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ getCurrentStaffProfile: vi.fn() }));
vi.mock("./lms-data", () => ({ getLmsData: vi.fn() }));
vi.mock("./assessment", () => ({ ingestAssessmentSource: vi.fn() }));
vi.mock("./supabase", () => ({ createSupabaseServerClient: vi.fn(async () => ({})) }));
vi.mock("./exam-adapters", async importOriginal => ({ ...await importOriginal<typeof import("./exam-adapters")>(), persistNormalizedExamResults: vi.fn(async () => []), syncEnrolmentStatusesForExamResults: vi.fn(async () => []) }));

function request(secret = "synthetic-secret", reason?: string) {
  return new NextRequest("https://lms.invalid/api/exam-adapters/results", {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", ...(reason ? { "x-assessment-reason": reason } : {}) }, body: "[]"
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "shadow");
  vi.stubEnv("EXAM_ADAPTER_SHARED_SECRET", "synthetic-secret");
  vi.mocked(getCurrentStaffProfile).mockResolvedValue({ id: "synthetic-admin", fullName: "Synthetic Admin", role: "admin", active: true });
  vi.mocked(ingestAssessmentSource).mockResolvedValue({ created: 0, unchanged: 0, source_updated: 0, auto_matched: 0, unmatched: 0, rejected: 0, errors: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe("machine adapter and administrator import boundary", () => {
  it.each(["shadow", "live"])("rejects machine-only credentials in %s without reading or writing academic data", async mode => {
    vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", mode);
    vi.mocked(getCurrentStaffProfile).mockResolvedValue(null);
    expect((await POST(request())).status).toBe(403);
    expect(getLmsData).not.toHaveBeenCalled();
    expect(ingestAssessmentSource).not.toHaveBeenCalled();
    expect(persistNormalizedExamResults).not.toHaveBeenCalled();
  });
  it("requires the configured secret even with an administrator session", async () => {
    expect((await POST(request("wrong"))).status).toBe(401);
    vi.stubEnv("EXAM_ADAPTER_SHARED_SECRET", "");
    expect((await POST(request())).status).toBe(401);
    expect(getCurrentStaffProfile).not.toHaveBeenCalled();
    expect(ingestAssessmentSource).not.toHaveBeenCalled();
  });
  it("rejects teachers and missing administrator reasons before ingestion", async () => {
    vi.mocked(getCurrentStaffProfile).mockResolvedValue({ id: "synthetic-teacher", fullName: "Synthetic Teacher", role: "teacher", active: true });
    expect((await POST(request("synthetic-secret", "Review"))).status).toBe(403);
    vi.mocked(getCurrentStaffProfile).mockResolvedValue({ id: "synthetic-admin", fullName: "Synthetic Admin", role: "admin", active: true });
    expect((await POST(request())).status).toBe(400);
    expect((await POST(request("synthetic-secret", "   "))).status).toBe(400);
    expect(getLmsData).not.toHaveBeenCalled();
    expect(ingestAssessmentSource).not.toHaveBeenCalled();
  });
  it("uses only the new evidence path in live mode", async () => {
    vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "live");
    expect((await POST(request("synthetic-secret", "Reviewed import"))).status).toBe(200);
    expect(ingestAssessmentSource).toHaveBeenCalledExactlyOnceWith([]);
    expect(persistNormalizedExamResults).not.toHaveBeenCalled();
    expect(syncEnrolmentStatusesForExamResults).not.toHaveBeenCalled();
  });
  it("retains the explicit dual-write path in shadow mode", async () => {
    expect((await POST(request("synthetic-secret", "Reviewed import"))).status).toBe(200);
    expect(ingestAssessmentSource).toHaveBeenCalledOnce();
    expect(persistNormalizedExamResults).toHaveBeenCalledOnce();
    expect(syncEnrolmentStatusesForExamResults).toHaveBeenCalledOnce();
  });
  it.each(["shadow", "live"])("documents the actual authentication requirements in %s", async mode => {
    vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", mode);
    const contract = await (await GET()).json();
    expect(contract.authentication).toContain("active administrator session");
    expect(contract.requiredHeaders).toContain("x-assessment-reason");
    expect(contract.assessmentWorkflowMode).toBe(mode);
  });
  it("keeps the off-mode contract separate from assessment authorization", async () => {
    vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "off");
    const contract = await (await GET()).json();
    expect(contract.authentication).not.toContain("administrator session");
    expect(contract.requiredHeaders).toEqual(["authorization", "content-type"]);
  });
});
