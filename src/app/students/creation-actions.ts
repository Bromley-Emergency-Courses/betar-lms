"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { createSupabaseServerClient } from "@/lib/supabase";
import { studentCreationSchema } from "@/lib/student-details";

export async function createWorkspaceStudent(input: unknown): Promise<{ ok: true; studentId: string } | { ok: false; error: string }> {
  await requirePermission("manage_admissions");
  if (!studentWorkspaceEnabled()) return { ok: false, error: "The student workspace is disabled." };
  const parsed = studentCreationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(issue => issue.message).join(" ") };
  try {
    const client = await createSupabaseServerClient();
    const result = await client.rpc("create_workspace_student", { student_key: parsed.data.studentId, details: parsed.data.details });
    if (result.error) {
      if (result.error.code === "23505") return { ok: false, error: "That temporary or CCCU student identifier is already in use. Check the existing student before creating another record." };
      if (result.error.code === "23503") return { ok: false, error: "The selected start term is no longer available. Choose another term or leave it unset." };
      throw new Error(result.error.message);
    }
    revalidatePath("/", "layout");
    return { ok: true, studentId: result.data };
  } catch (error) { return { ok: false, error: `${error instanceof Error ? error.message : "Creation could not be confirmed."} Your entries are kept. Retrying the same unchanged draft will not create a second record.` }; }
}
