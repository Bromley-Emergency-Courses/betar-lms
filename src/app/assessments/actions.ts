"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { backfillAssessmentResults, executeAssessmentCommand, previewEnrolmentAssessmentPlan, saveModuleAssessmentPlan } from "@/lib/assessment";
import type { AssessmentCommand, AssessmentItemInput, AssessmentPlan, AssessmentPlanPreview } from "@/lib/assessment/types";

export interface AssessmentFormState { error?: string; message?: string; preview?: AssessmentPlanPreview }

export async function submitAssessmentCommand(_previous: AssessmentFormState, form: FormData): Promise<AssessmentFormState> {
  await requirePermission("manage_course");
  try {
    const input = JSON.parse(String(form.get("command"))) as Record<string, unknown>;
    input.reason = String(form.get("reason") ?? "").trim();
    for (const field of ["sitting_date", "sitting_term_id", "previous_result_unavailable", "note", "disposition", "identity_override_reason"]) {
      if (form.get(field)) input[field] = String(form.get(field));
    }
    if (form.get("score")) input.score = Number(form.get("score"));
    if (form.get("pass_mark")) input.pass_mark = Number(form.get("pass_mark"));
    if (form.has("value")) {
      const value = String(form.get("value"));
      input.value = input.kind === "credits" ? Number(value) : input.kind === "indicator" ? value === "true" : value;
    }
    const items: AssessmentItemInput[] = [];
    for (const kind of ["mcq", "physics", "coursework", "viva"] as const) {
      if (!form.has(`item.${kind}.score`) && !form.has(`item.${kind}.carry`)) continue;
      const carried = String(form.get(`item.${kind}.carry`) ?? "");
      items.push(carried ? { kind, carried_from_item_id: carried } : { kind, score: Number(form.get(`item.${kind}.score`)) });
      if (!carried && String(form.get(`item.${kind}.score`) ?? "").trim() === "") throw new Error(`Enter ${kind} or explicitly carry it forward.`);
    }
    if (["AddManualAttempt", "CorrectManualAttempt", "ReplaceSourceResult"].includes(String(input.type))) input.items = items;
    const result = await executeAssessmentCommand(input as AssessmentCommand, Number(form.get("expected_revision")));
    revalidatePath("/", "layout");
    return { message: result.pass_reversed ? "Warning: the calculated Pass was reversed. Review status and awarded credits." : "Assessment saved." };
  } catch (error) { return { error: error instanceof Error ? error.message : "Assessment could not be saved." }; }
}

export async function submitAssessmentPlan(_previous: AssessmentFormState, form: FormData): Promise<AssessmentFormState> {
  await requirePermission("manage_course");
  try {
    await saveModuleAssessmentPlan({
      module_id: String(form.get("module_id")), theory_scheme: String(form.get("theory_scheme")) as AssessmentPlan["theory_scheme"],
      requires_coursework: form.get("requires_coursework") === "on", requires_viva: form.get("requires_viva") === "on",
      physics_weighting: form.get("physics_weighting") === "on", theory_pass_mark: Number(form.get("theory_pass_mark")),
      practical_pass_mark: form.has("practical_pass_mark") ? Number(form.get("practical_pass_mark")) : null, reason: String(form.get("reason") ?? "")
    }, String(form.get("expected_plan_id") ?? "") || null);
    revalidatePath("/", "layout");
    return { message: "New plan version saved for future enrolments." };
  } catch (error) { return { error: error instanceof Error ? error.message : "Plan could not be saved." }; }
}

export async function previewAssessmentPlan(_previous: AssessmentFormState, form: FormData): Promise<AssessmentFormState> {
  await requirePermission("manage_course");
  try { return { preview: await previewEnrolmentAssessmentPlan(String(form.get("enrolment_id")), String(form.get("plan_id"))) }; }
  catch (error) { return { error: error instanceof Error ? error.message : "Preview unavailable." }; }
}

export async function submitAssessmentBackfill(_previous: AssessmentFormState, form: FormData): Promise<AssessmentFormState> {
  await requirePermission("manage_course");
  try {
    const approvals = form.getAll("approval").map(value=>JSON.parse(String(value)) as {legacy_result_id:string;legacy_hash:string});
    if (!approvals.length) throw new Error("Select reviewed rows to backfill.");
    const result=await backfillAssessmentResults(approvals,String(form.get("reason")??""));
    revalidatePath("/", "layout");
    return {message:`${result.imported} results backfilled; ${result.already_backfilled} already imported.`};
  } catch (error) { return {error:error instanceof Error?error.message:"Backfill failed."}; }
}
