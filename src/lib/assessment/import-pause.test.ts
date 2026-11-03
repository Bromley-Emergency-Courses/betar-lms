import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSupabaseServerClient } from "@/lib/supabase";
import { automaticExamImportsPaused, requireAutomaticExamImportsOpen } from "./import-pause";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ createSupabaseServerClient: vi.fn() }));
const rpc = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ASSESSMENT_OPERATIONS_PAUSED", "false");
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
});
afterEach(() => vi.unstubAllEnvs());

it.each([true, null, undefined, "false"])("fails closed unless the database explicitly permits imports (%s)", async data => {
  rpc.mockResolvedValue({ data, error: null });
  expect(await automaticExamImportsPaused()).toBe(true);
  await expect(requireAutomaticExamImportsOpen()).rejects.toThrow("temporarily paused");
});
it("allows imports only after the separate database pause is lifted", async () => {
  rpc.mockResolvedValue({ data: false, error: null });
  expect(await automaticExamImportsPaused()).toBe(false);
  expect(rpc).toHaveBeenCalledWith("assessment_portal_imports_paused");
});
it("retains the broader operational pause", async () => {
  vi.stubEnv("ASSESSMENT_OPERATIONS_PAUSED", "true");
  expect(await automaticExamImportsPaused()).toBe(true);
  expect(createSupabaseServerClient).not.toHaveBeenCalled();
});
it("fails closed on missing migration, database errors and unavailable sessions", async () => {
  rpc.mockResolvedValue({ data: false, error: { message: "Unavailable" } });
  expect(await automaticExamImportsPaused()).toBe(true);
  vi.mocked(createSupabaseServerClient).mockRejectedValue(new Error("No connection"));
  expect(await automaticExamImportsPaused()).toBe(true);
});
