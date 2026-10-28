"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { createSupabaseServerClient } from "@/lib/supabase";
import { attendanceCommandSchema, sharedSessionCommandSchema } from "@/lib/student-attendance";
import type { WorkspaceAttendance } from "@/lib/student-workspace";

type SaveResult = { ok: true; message: string; attendance?: WorkspaceAttendance } | { ok: false; error: string };

async function execute(rpc: "save_student_attendance" | "create_student_term_session", input: unknown): Promise<SaveResult> {
  await requirePermission("manage_course");
  if (!studentWorkspaceEnabled()) return { ok: false, error: "The student workspace is disabled." };
  const parsed = (rpc === "save_student_attendance" ? attendanceCommandSchema : sharedSessionCommandSchema).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(issue => issue.message).join(" ") };
  try {
    const client = await createSupabaseServerClient();
    const { error } = await client.rpc(rpc, { command: parsed.data });
    if (error) {
      if (["40P01", "40001", "23505"].includes(error.code)) return { ok: false, error: "Attendance or session records changed during saving. Discard and reopen to review the latest records." };
      throw new Error(error.message);
    }
    let attendance: WorkspaceAttendance | undefined;
    if (rpc === "save_student_attendance") {
      const latest = await client.rpc("read_student_attendance", { student_key: parsed.data.studentId });
      if (latest.error) throw new Error("Attendance was saved, but the refreshed record could not be loaded. Reopen the workspace before making further changes.");
      attendance = (latest.data as WorkspaceAttendance[] | null)?.find(record => record.id === parsed.data.sessionId);
    }
    revalidatePath("/", "layout");
    return { ok: true, attendance, message: rpc === "save_student_attendance" ? "Attendance saved. Affected module outcomes and credits have been recalculated." : "Shared term session added. No student has been marked expected or attending." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The save could not be confirmed. Your entries have been kept." };
  }
}

export async function saveWorkspaceAttendance(input: unknown): Promise<SaveResult> { return execute("save_student_attendance", input); }
export async function createWorkspaceSession(input: unknown): Promise<SaveResult> { return execute("create_student_term_session", input); }
