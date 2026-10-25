import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkspaceFinance, saveWorkspaceFinance } from "@/app/students/finance-actions";
import { financePence } from "./student-finance";
import { requirePermission } from "@/lib/auth";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { createSupabaseServerClient } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/assessment/feature", () => ({ studentWorkspaceEnabled: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.fn();
const student = "49000000-0000-4000-8000-000000000001";
const input = { id: "49000000-0000-4000-8000-000000000002", student_id: student, term_id: "49000000-0000-4000-8000-000000000003", expected_version: null, term_token: "a".repeat(32), expected_amount_pence: 12345, invoice_amount_pence: null, paid_amount_pence: 0, invoice_status: "not_requested", payment_status: "not_due", notes: null };
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(studentWorkspaceEnabled).mockReturnValue(true);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
  rpc.mockResolvedValue({ error: null, data: { records: [], terms: [] } });
});
describe("student finance actions", () => {
  it("requires finance permission for reads and writes and honours the feature flag", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("Denied"));
    await expect(loadWorkspaceFinance(student)).rejects.toThrow("Denied"); await expect(saveWorkspaceFinance(input)).rejects.toThrow("Denied");
    expect(requirePermission).toHaveBeenCalledWith("manage_finance");
    vi.mocked(requirePermission).mockResolvedValue(undefined as never); vi.mocked(studentWorkspaceEnabled).mockReturnValue(false);
    expect(await loadWorkspaceFinance(student)).toMatchObject({ ok: false }); expect(await saveWorkspaceFinance(input)).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it("loads fresh scoped snapshots and saves exact null/zero amounts with shared invalidation", async () => {
    expect(await loadWorkspaceFinance(student)).toMatchObject({ ok: true }); expect(rpc).toHaveBeenCalledWith("read_student_finance_workspace", { student_key: student });
    expect(await saveWorkspaceFinance(input)).toMatchObject({ ok: true }); expect(rpc).toHaveBeenCalledWith("save_student_finance", { command: input }); expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it.each([{ expected_amount_pence: null }, { expected_amount_pence: -1 }, { paid_amount_pence: 1.5 }, { invoice_amount_pence: 2147483648 }, { invoice_status: "paid" }, { actor_user_id: student }, { expected_version: undefined }, { term_token: null }, { expected_version: student }, { notes: "a".repeat(10001) }])("rejects invalid or spoofed fields %j", async extra => {
    expect(await saveWorkspaceFinance({ ...input, ...extra })).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
  it("accepts frozen existing versions and retains stale errors without refreshing or retrying", async () => {
    rpc.mockResolvedValue({ error: { message: "Finance record changed" } });
    expect(await saveWorkspaceFinance({ ...input, expected_version: student, term_token: null })).toEqual({ ok: false, error: "Finance record changed" });
    expect(rpc).toHaveBeenCalledTimes(1); expect(revalidatePath).not.toHaveBeenCalled();
  });
  it.each([["0", 0], ["1.01", 101], ["1.1", 110], ["21474836.47", 2147483647], ["", null]])("parses exact pounds %s", (value, expected) => expect(financePence(value as string, true)).toBe(expected));
  it.each(["", "-1", "1.001", "1e3", "NaN", "Infinity", "1,234", "21474836.48"])("rejects ambiguous or invalid amounts %s", value => expect(() => financePence(value)).toThrow());
});
