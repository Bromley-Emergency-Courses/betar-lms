"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { executeAssessmentCommand, readStudentEnrolments } from "@/lib/assessment";
import { studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { enrolmentCommandSchema, type EnrolmentWorkspace } from "@/lib/student-enrolment";

export async function loadWorkspaceEnrolments(studentId: string): Promise<{ ok: true; workspace: EnrolmentWorkspace } | { ok: false; error: string }> {
  await requirePermission("manage_course");
  if (!studentWorkspaceEnabled()) return { ok: false, error: "The student workspace is disabled." };
  try { return { ok: true, workspace: await readStudentEnrolments(z.uuid().parse(studentId)) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Enrolments could not be loaded." }; }
}

export async function saveWorkspaceEnrolment(input: unknown): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  await requirePermission("manage_course");
  if (!studentWorkspaceEnabled()) return { ok: false, error: "The student workspace is disabled." };
  const parsed = enrolmentCommandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(issue => issue.message).join(" ") };
  try {
    const result = await executeAssessmentCommand(parsed.data.command, parsed.data.expectedRevision);
    revalidatePath("/", "layout");
    if (parsed.data.command.type === "CancelMistakenEnrolment") return { ok: true, message: "Enrolment cancelled as added in error. No records were deleted. Affected module requirements have been recalculated; the cancellation remains available under Show cancelled enrolments." };
    return { ok: true, message: `Enrolment saved. Affected module outcomes have been recalculated; scores and exceptional decisions are unchanged.${result.pass_reversed ? " The calculated Pass was reversed; review the outcomes and credits." : ""}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The save could not be confirmed. Review saved records before retrying." };
  }
}
