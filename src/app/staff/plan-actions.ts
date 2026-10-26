"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { staffCompanionTeachingEnabled } from "@/lib/assessment/feature";
import { createSupabaseServerClient } from "@/lib/supabase";
import { teachingPlanCommandSchema, type TeachingPlanOptions } from "@/lib/teaching-plans";

export async function loadTeachingPlans(studentId: string): Promise<{ ok: true; options: TeachingPlanOptions } | { ok: false; error: string }> {
  await requirePermission("record_teaching");
  if (!staffCompanionTeachingEnabled()) return { ok: false, error: "Companion planning is disabled." };
  try {
    const client = await createSupabaseServerClient();
    const result = await client.rpc("read_student_teaching_plans", { student_key: z.uuid().parse(studentId) });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, options: result.data };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Plans could not be loaded." }; }
}

export async function saveTeachingPlan(input: unknown) {
  await requirePermission("record_teaching");
  if (!staffCompanionTeachingEnabled()) return { ok: false, error: "Companion planning is disabled." };
  const parsed = teachingPlanCommandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid plan and destination." };
  try {
    const client = await createSupabaseServerClient();
    const result = await client.rpc("save_student_teaching_plan", { command: parsed.data });
    if (result.error) throw new Error(result.error.message);
    revalidatePath("/", "layout");
    return { ok: true, message: "Plan saved. Actual attendance, presentation scores and other module plans are unchanged." };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Save could not be confirmed. Review current plans before retrying." }; }
}
