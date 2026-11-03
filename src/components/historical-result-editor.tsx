"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { saveWorkspaceAssessment } from "@/app/assessments/workspace-actions";
import type { AssessmentComponent, AssessmentEvaluation, AssessmentItemKind, HistoricalAssessmentResult } from "@/lib/assessment/types";
import { useTaskDialogGuard } from "./use-task-dialog-guard";
import styles from "./student-workspace.module.css";

export type HistoricalResultTask = { component: AssessmentComponent; entryKind: "missing" | "resit"; correction?: HistoricalAssessmentResult };
const itemLabels = { mcq: "MCQ", physics: "Physics / equipment", coursework: "Coursework", viva: "Viva" };

export function HistoricalResultEditor({ task, assessment, close, saved }: {
  task: HistoricalResultTask; assessment: AssessmentEvaluation; close: () => void;
  saved: (assessment: AssessmentEvaluation, message: string) => void;
}) {
  const [snapshot] = useState(assessment);
  const [error, setError] = useState("");
  const router = useRouter();
  const titleId = useId();
  const { pending, setPending, exitTarget, setExitTarget, dirty, dirtyRef, pendingRef, dialog, keepEditing, requestClose, discard, markDirty } = useTaskDialogGuard(close);
  const correction = task.correction;
  const plan = correction?.amendment_plan ?? snapshot.historical?.score_plan;
  const usesPlan = correction ? correction.original_score == null && correction.is_resit : task.entryKind === "resit";
  const requiredItems: AssessmentItemKind[] = usesPlan && task.component === "theory" && plan
    ? plan.theory_scheme === "mcq" ? ["mcq", ...(plan.physics_weighting ? ["physics" as const] : [])]
      : [...(plan.requires_coursework ? ["coursework" as const] : []), ...(plan.requires_viva ? ["viva" as const] : [])] : [];
  const totalRequired = !usesPlan || task.component === "practical" || plan?.theory_scheme === "coursework_viva";
  const passMark = correction?.pass_mark ?? (task.component === "theory" ? plan?.theory_pass_mark : plan?.practical_pass_mark);
  const title = correction ? "Correct historical result" : task.entryKind === "resit" ? "Record historical enrolment resit" : "Add missing historical result";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    const fields = new FormData(event.currentTarget);
    const command = {
      enrolment_id: snapshot.enrolment_id, reason: String(fields.get("reason") ?? ""),
      ...(correction ? { type: "CorrectHistoricalScore", result_id: correction.id }
        : { type: "RecordHistoricalScore", component: task.component, entry_kind: task.entryKind, expected_plan_id: plan?.id, sitting_date: String(fields.get("sitting_date")) }),
      ...(totalRequired ? { score: Number(fields.get("score")) } : {}),
      items: requiredItems.map(kind => ({ kind, score: Number(fields.get(`item.${kind}`)) }))
    };
    pendingRef.current = true; setPending(true); setError("");
    try {
      const result = await saveWorkspaceAssessment({ command, expectedRevision: snapshot.revision });
      if (!result.ok) { setError(result.error); return; }
      dirtyRef.current = false;
      saved(result.assessment, result.message);
      router.refresh();
    } catch { setError("The save could not be confirmed. Review the saved history before retrying; your draft is retained."); }
    finally { pendingRef.current = false; setPending(false); }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); requestClose(); }}>
    <header className={styles.dialogHeader}><div><p>{task.component === "theory" ? "Theory" : "Practical"} · Audited historical amendment</p><h2 id={titleId}>{title}</h2></div><button type="button" className={styles.iconButton} aria-label="Close editor" onClick={requestClose} disabled={pending}><X size={22} /></button></header>
    <form className={styles.dialogBody} onSubmit={submit} onChange={markDirty} data-unsaved={dirty}>
      <fieldset className={styles.taskFields} disabled={pending || Boolean(exitTarget)}>
        <p className={styles.notice}>Saving recalculates the exam outcome using the latest result for each required component. Historical attendance and presentation requirements are not reapplied. Existing positive credit awards and exceptional decisions remain protected. Original scores and every earlier attempt stay in history.</p>
        <p>Current outcome: {snapshot.effective_status} · {snapshot.awarded_credits} credits. Pass mark: {passMark ?? "Global plan review required"}%.</p>
        {correction ? <p>This corrects the same sitting ({correction.taken_on}) and attempt ({correction.attempt_number}); it does not create a resit.</p> : <label>Sitting date<input type="date" name="sitting_date" max={new Date().toISOString().slice(0, 10)} required /></label>}
        {!usesPlan ? <p>Enter the documented component total. Missing historical MCQ, physics, coursework or viva breakdowns are not invented. {correction ? "The original pass mark is retained." : "The reviewed global plan supplies the pass mark."}</p> : <p>Resit requirements come from the course plan and cannot be changed here. Enter the supporting scores for this sitting.</p>}
        {requiredItems.map(kind => <label key={kind}>{itemLabels[kind]} score (%)<input name={`item.${kind}`} type="number" min="0" max="100" step="0.01" required defaultValue={correction?.amendment_items?.find(item => item.kind === kind)?.score} /></label>)}
        {totalRequired ? <label>{usesPlan && task.component === "theory" ? "Authoritative combined Theory score (%)" : "Component score (%)"}<input name="score" type="number" min="0" max="100" step="0.01" required defaultValue={correction?.score} /></label> : <p>{plan?.physics_weighting ? "Theory = (MCQ + physics/equipment) / 2." : "Theory = MCQ score."}</p>}
        <label>Reason / evidence reference<textarea name="reason" maxLength={4000} required /></label>
      </fieldset>
      {error ? <p role="alert" className={styles.notice}>{error} If another user saved changes, reopen this editor to review the latest record.</p> : null}
      {exitTarget ? <div role="alert" className={styles.notice}><strong>Discard unsaved changes?</strong><div className={styles.toolbar}><button ref={keepEditing} type="button" className={styles.button} onClick={() => setExitTarget(null)}>Keep editing</button><button type="button" className={styles.button} onClick={discard}>Discard changes</button></div></div> : <footer className={styles.toolbar}><button className={styles.primaryButton} type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button><button className={styles.button} type="button" disabled={pending} onClick={requestClose}>Cancel</button></footer>}
    </form>
  </dialog>;
}
