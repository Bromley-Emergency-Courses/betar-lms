"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { createSupabaseServerClient } from "@/lib/supabase";
import { financeCommandSchema, type FinanceSnapshot } from "@/lib/student-finance";

export async function loadWorkspaceFinance(studentId: string): Promise<{ ok: true; snapshot: FinanceSnapshot } | { ok: false; error: string }> {
  await requirePermission("manage_finance");
  if (!studentWorkspaceEnabled()) return { ok: false, error: "The student workspace is disabled." };
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("read_student_finance_workspace", { student_key: z.uuid().parse(studentId) });
    if (error) throw new Error(error.message);
    return { ok: true, snapshot: data };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Finance records could not be loaded." }; }
}

export async function saveWorkspaceFinance(input: unknown): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  await requirePermission("manage_finance");
  if (!studentWorkspaceEnabled()) return { ok: false, error: "The student workspace is disabled." };
  const parsed = financeCommandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(issue => issue.message).join(" ") };
  try {
    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("save_student_finance", { command: parsed.data });
    if (error) throw new Error(error.message);
    revalidatePath("/", "layout");
    return { ok: true, message: "Finance record saved. No invoice was sent and no payment was collected." };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The save could not be confirmed. Review the finance records before retrying." }; }
}
