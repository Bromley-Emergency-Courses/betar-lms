import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAssessmentSummaries } from "./index";
import { createSupabaseServerClient } from "@/lib/supabase";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ createSupabaseServerClient: vi.fn() }));

const calls: Array<{ table: string; columns: string; ids: string[] }> = [];
let databaseMode = "shadow";
let queryError: { message: string } | null = null;
const from = vi.fn((table: string) => {
  const call = { table, columns: "", ids: [] as string[] };
  calls.push(call);
  const query = {
    select: (columns: string) => { call.columns = columns; return query; },
    in: (column: string, ids: string[]) => { expect(column).toBe("enrolment_id"); call.ids = ids; return query; },
    order: () => query,
    range: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "assessment_historical_results" ? [] : call.ids.map(enrolment_id => ({ enrolment_id, assessment: { needs_plan: false }, legacy_status: "planned", legacy_credits: 0, legacy_final_mark: null, legacy_grade: null })), error: queryError }).then(resolve),
    single: async () => ({ data: { mode: databaseMode }, error: queryError })
  };
  return query;
});

beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; databaseMode = "shadow"; queryError = null;
  vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "shadow");
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
});
afterEach(() => vi.unstubAllEnvs());

describe("scoped assessment summaries", () => {
  it("never turns an empty scope into a full table read", async () => {
    expect(await readAssessmentSummaries([])).toEqual([]);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
  it("deduplicates and batches IDs with scoped historical evidence for retained outcomes", async () => {
    const ids = Array.from({ length: 111 }, (_, index) => `enrolment-${index}`);
    expect(await readAssessmentSummaries([...ids, ids[0]])).toHaveLength(111);
    expect(calls.map(call => call.ids.length)).toEqual([50, 50, 50, 50, 11, 11]);
    expect(calls.filter(call => call.table === "assessment_outcomes").every(call => call.columns === "enrolment_id,student_id,student_name,student_identifier,module_code,module_title,original_cohort,assessment,legacy_status,legacy_final_mark,legacy_grade,legacy_credits,original_term_id,module_credits")).toBe(true);
    expect(calls.filter(call => call.table === "assessment_historical_results").map(call => call.ids.length)).toEqual([50, 50, 11]);
  });
  it("uses the existing disabled and database live-cutover gates", async () => {
    vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "off");
    await expect(readAssessmentSummaries(["enrolment"])).rejects.toThrow("disabled");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "live");
    await expect(readAssessmentSummaries(["enrolment"])).rejects.toThrow("sign-off gate");
    expect(calls.some(call => call.table === "assessment_outcomes")).toBe(false);
    databaseMode = "live";
    expect((await readAssessmentSummaries(["enrolment"])).map(row => row.enrolment_id)).toEqual(["enrolment"]);
  });
  it("propagates failures instead of reporting missing results as Pending", async () => {
    queryError = { message: "Unavailable" };
    await expect(readAssessmentSummaries(["enrolment"])).rejects.toThrow("Unavailable");
  });
});
