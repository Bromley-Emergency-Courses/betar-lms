"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { createSupabaseServerClient } from "@/lib/supabase";
import { studentProfileCommandSchema } from "@/lib/student-details";

export type StudentProfileSaveResult = { ok: true; message: string } | { ok: false; error: string };

export async function saveWorkspaceStudent(input: unknown): Promise<StudentProfileSaveResult> {
  await requirePermission("manage_admissions");
  if (!studentWorkspaceEnabled()) return { ok: false, error: "The student workspace is disabled." };
  const parsed = studentProfileCommandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(issue => issue.message).join(" ") };
  try {
    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("save_student_profile", { student_key: parsed.data.studentId, expected_revision: parsed.data.expectedRevision, details: parsed.data.details });
    if (error) {
      if (error.code === "23505") return { ok: false, error: "That student identifier is already in use. Check the temporary and CCCU identifiers." };
      if (error.code === "23503") return { ok: false, error: "The selected start term is no longer available. Reopen the editor to review the latest terms." };
      throw new Error(error.message);
    }
    revalidatePath("/", "layout");
    return { ok: true, message: "Student details saved." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Student details could not be saved. Your entries have been kept." };
  }
}
