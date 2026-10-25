"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { createSupabaseServerClient } from "@/lib/supabase";
import { teachingCommandSchema, type TeachingOptions } from "@/lib/student-teaching";

export async function loadWorkspaceTeaching(studentId: string): Promise<{ ok: true; options: TeachingOptions } | { ok: false; error: string }> {
  await requirePermission("record_teaching");
  if (!studentWorkspaceEnabled()) return { ok: false, error: "The student workspace is disabled." };
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("read_student_teaching_options", { student_key: z.uuid().parse(studentId) });
    if (error) throw new Error(error.message);
    return { ok: true, options: data };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Teaching options could not be loaded." }; }
}

export async function saveWorkspaceTeaching(input: unknown): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  await requirePermission("record_teaching");
  if (!studentWorkspaceEnabled()) return { ok: false, error: "The student workspace is disabled." };
  const parsed = teachingCommandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(issue => issue.message).join(" ") };
  try {
    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("create_student_teaching_record", { command: parsed.data });
    if (error) throw new Error(error.message);
    revalidatePath("/", "layout");
    return { ok: true, message: "Teaching record saved. Relevant module outcomes have been recalculated; exam scores and exceptional decisions are unchanged." };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "The save could not be confirmed. Review the timeline before retrying." }; }
}
