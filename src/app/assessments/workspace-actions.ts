"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { executeAssessmentCommand } from "@/lib/assessment";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { workspaceCommandSchema } from "@/lib/assessment/workspace-command";
import type { AssessmentEvaluation } from "@/lib/assessment/types";

export type WorkspaceSaveResult = { ok: true; assessment: AssessmentEvaluation; message: string } | { ok: false; error: string };

export async function saveWorkspaceAssessment(input: unknown): Promise<WorkspaceSaveResult> {
  await requirePermission("manage_course");
  if (!studentWorkspaceEnabled()) return { ok: false, error: "The student workspace is disabled." };
  const parsed = workspaceCommandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(issue => issue.message).join(" ") };
  try {
    const result = await executeAssessmentCommand(parsed.data.command, parsed.data.expectedRevision);
    if (!result.assessment) throw new Error("The saved assessment could not be read.");
    revalidatePath("/", "layout");
    const changes = result.change ? ` Outcome: ${result.change.before_status} → ${result.change.after_status}. Awarded credits: ${result.change.before_credits} → ${result.change.after_credits}.` : "";
    return { ok: true, assessment: result.assessment, message: (result.pass_reversed ? "Saved. The calculated Pass was reversed; review the outcome and awarded credits." : "Assessment saved.") + changes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The assessment could not be saved. Your entries have been kept." };
  }
}
