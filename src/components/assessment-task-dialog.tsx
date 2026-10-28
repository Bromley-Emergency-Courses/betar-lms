"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { saveWorkspaceAssessment } from "@/app/assessments/workspace-actions";
import { assessmentIndicators, assessmentStatuses } from "@/lib/assessment/workspace-command";
import type { AssessmentAttempt, AssessmentComponent, AssessmentEvaluation, AssessmentItemKind, AssessmentSourceEvidence as SourceEvidence } from "@/lib/assessment/types";
import { AssessmentSourceEvidence } from "./assessment-source-evidence";
import { useTaskDialogGuard } from "./use-task-dialog-guard";
import styles from "./student-workspace.module.css";

export type AssessmentTask =
  | { kind: "decision" }
  | { kind: "lifecycle"; component: AssessmentComponent; attempt: AssessmentAttempt; operation: "exclude" | "restore" }
  | { kind: "score"; component: AssessmentComponent; correction?: AssessmentAttempt }
  | { kind: "arrangement"; component: AssessmentComponent; command: "ScheduleResit" | "CancelResit" | "DeferAssessment" | "ClearAssessmentDeferral" };

const arrangementLabels = { ScheduleResit: "Arrange resit", CancelResit: "Cancel resit", DeferAssessment: "Postpone assessment", ClearAssessmentDeferral: "Clear postponement" };
const itemLabels = { mcq: "MCQ", physics: "Physics / equipment", coursework: "Coursework", viva: "Viva" };
const flagLabel = (value: string) => value.replace("theory:", "Theory · ").replace("practical:", "Practical · ");

function ScoreItem({ kind, attempts, correction }: { kind: AssessmentItemKind; attempts: AssessmentAttempt[]; correction?: AssessmentAttempt }) {
  const original = correction?.items.find(item => item.kind === kind);
  const [carry, setCarry] = useState(original?.carried_from_item_id ?? "");
  const available = attempts.filter(attempt => attempt.active && (!correction || attempt.ordinal < correction.ordinal)).flatMap(attempt => attempt.items.filter(item => item.kind === kind).map(item => ({ ...item, attempt })));
  return <div className={styles.taskField}>
    {kind !== "mcq" && available.length ? <label>{itemLabels[kind]} evidence<select name={`item.${kind}.carry`} value={carry} onChange={event => setCarry(event.target.value)}><option value="">Newly assessed score</option>{available.map(item => <option value={item.id} key={item.id}>Carry {item.score}% · attempt {item.attempt.sequence ?? "unknown"} · {item.attempt.sitting_date}</option>)}</select></label> : null}
    {!carry ? <label>{itemLabels[kind]} score (%)<input name={`item.${kind}.score`} type="number" min="0" max="100" step="0.01" defaultValue={original?.score} required /></label> : null}
  </div>;
}

export function AssessmentTaskDialog({ task, assessment, attempts, terms, source, close, saved }: {
  task: AssessmentTask; assessment: AssessmentEvaluation; attempts: AssessmentAttempt[]; terms: Array<{ id: string; name: string }>;
  source?: SourceEvidence;
  close: () => void; saved: (assessment: AssessmentEvaluation, message: string) => void;
}) {
  const [snapshot] = useState(assessment);
  const preservedCredits = snapshot.activation?.preserved_credits;
  const [sourceSnapshot] = useState(source);
  const [decision, setDecision] = useState<"status" | "credits" | "indicator">("status");
  const [indicator, setIndicator] = useState<string>(assessmentIndicators[0]);
  const [operation, setOperation] = useState("set");
  const [error, setError] = useState("");
  const { pending, setPending, exitTarget, setExitTarget, dirty, dirtyRef, pendingRef, dialog, keepEditing, requestClose, discard, markDirty } = useTaskDialogGuard(close);
  const form = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const router = useRouter();
  const correction = task.kind === "score" ? task.correction : undefined;
  const importedCorrection = Boolean(correction && correction.origin !== "Manual");
  const component = task.kind === "decision" ? "theory" : task.component;
  const componentAttempts = attempts.filter(attempt => attempt.component === component);
  const currentDecision = snapshot.overrides.find(override => override.kind === decision && (decision !== "indicator" || override.indicator === indicator));
  const decisionBasis = snapshot.historical?.protected ? "Preserved historical record" : decision === "credits" && preservedCredits != null ? "Preserved credit award" : "Automatic";
  const title = task.kind === "lifecycle" ? task.operation === "exclude" ? "Exclude result" : "Restore excluded result" : task.kind === "decision" ? "Exceptional decision" : task.kind === "arrangement" ? arrangementLabels[task.command] : correction ? "Correct result" : componentAttempts.some(attempt => attempt.active) ? "Record resit" : "Record result";
  const componentLabel = component === "theory" ? "Theory" : "Practical";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    const fields = new FormData(event.currentTarget);
    const command: Record<string, unknown> = { enrolment_id: snapshot.enrolment_id, reason: String(fields.get("reason") ?? "") };
    if (task.kind === "decision") {
      command.type = operation === "clear" ? "ClearAssessmentOverride" : "SetAssessmentOverride";
      command.kind = decision;
      if (decision === "indicator") command.indicator = indicator;
      if (operation !== "clear") command.value = decision === "credits" ? Number(fields.get("value")) : decision === "indicator" ? fields.get("value") === "true" : String(fields.get("value"));
    } else if (task.kind === "lifecycle") {
      command.type = task.operation === "exclude" ? "ExcludeAttempt" : "RestoreAttempt";
      command.attempt_id = task.attempt.id;
      if (sourceSnapshot) command.expected_source_revision = sourceSnapshot.revision;
      if (task.operation === "exclude") command.category = String(fields.get("category"));
      else {
        command.exclusion_id = task.attempt.lifecycle?.[0]?.id;
        if (sourceSnapshot && fields.get("review_source") === "on") command.reviewed_source_version_id = sourceSnapshot.versions.at(-1)?.id;
      }
    } else if (task.kind === "arrangement") {
      command.type = task.command;
      command.component = component;
      if (fields.has("note")) command.note = String(fields.get("note"));
    } else {
      command.type = importedCorrection ? "CorrectImportedAttempt" : correction ? "CorrectManualAttempt" : "AddManualAttempt";
      if (correction) command.attempt_id = correction.id;
      else command.component = component;
      if (importedCorrection) {
        command.source_id = sourceSnapshot?.id;
        command.expected_source_revision = sourceSnapshot?.revision;
      } else {
        command.sitting_date = correction?.sitting_date ?? String(fields.get("sitting_date"));
        const term = correction ? correction.sitting_term_id : String(fields.get("sitting_term_id") ?? "");
        if (term) command.sitting_term_id = term;
      }
      if (fields.has("score")) command.score = Number(fields.get("score"));
      command.items = Object.keys(itemLabels).flatMap(kind => {
        const carried = String(fields.get(`item.${kind}.carry`) ?? "");
        if (carried) return [{ kind, carried_from_item_id: carried } as Record<string, unknown>];
        if (fields.has(`item.${kind}.score`)) return [{ kind, score: Number(fields.get(`item.${kind}.score`)) }];
        return [];
      });
      const unavailable = String(fields.get("previous_result_unavailable") ?? "").trim();
      if (unavailable) command.previous_result_unavailable = unavailable;
    }
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const result = await saveWorkspaceAssessment({ command, expectedRevision: snapshot.revision });
      if (!result.ok) { setError(result.error); return; }
      dirtyRef.current = false;
      saved(result.assessment, result.message);
      router.refresh();
    } catch {
      setError("The save could not be confirmed. Your entries have been kept. Review the saved records before retrying.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); requestClose(); }}>
    <header className={styles.dialogHeader}><div><p>{task.kind === "decision" ? "One independent, audited decision" : `${componentLabel} · ${snapshot.plan.theory_scheme === "mcq" ? "MCQ plan" : "Coursework / Viva plan"}`}</p><h2 id={titleId}>{title}</h2></div><button type="button" className={styles.iconButton} onClick={requestClose} disabled={pending} aria-label="Close editor"><X size={22} /></button></header>
    <form ref={form} className={styles.dialogBody} onSubmit={submit} data-unsaved={dirty} onChange={markDirty}>
      <fieldset className={styles.taskFields} disabled={pending || Boolean(exitTarget)}>
        {task.kind === "lifecycle" ? <>
          <p className={styles.notice}>{task.operation === "exclude" ? "Exclude this result from accepted outcomes and official result exports without deleting its evidence or history. No result is moved to another student or enrolment." : "Restore this exact result to its original enrolment, with the same score, sitting and attempt number. A newer source value will not be adopted."}</p>
          <p><strong>{componentLabel} · {task.attempt.score}%</strong> · Pass mark {task.attempt.pass_mark}%<br />Sitting {task.attempt.sitting_date} · Attempt {task.attempt.sequence ?? "unknown"} · {task.attempt.origin}</p>
          <p>Current outcome: {snapshot.effective_status} · {snapshot.awarded_credits} credits. Saving recalculates the outcome; existing protected credit awards and independent exceptional decisions remain unchanged.</p>
          {task.operation === "exclude" ? <><label>Exclusion category<select name="category" defaultValue="invalid"><option value="invalid">Duplicate or invalid result</option><option value="incorrect_ownership">Incorrect student or enrolment</option></select></label><p className={styles.muted}>Incorrectly attached imported evidence stays pending for later reconciliation. Duplicate or invalid imported evidence is marked Voided.</p></> : <>
            <p>Exclusion reason: {task.attempt.lifecycle?.[0]?.reason}</p>
            {sourceSnapshot && task.attempt.lifecycle?.[0]?.source_version_id !== sourceSnapshot.versions.at(-1)?.id ? <p className={styles.notice}>The imported evidence has changed since exclusion. Review all source versions below. Restoration retains {task.attempt.score}%, not the refreshed source score.</p> : null}
          </>}
          {sourceSnapshot ? <AssessmentSourceEvidence source={sourceSnapshot} /> : null}
          {task.operation === "restore" ? <label className={styles.confirmation}><input type="checkbox" name={sourceSnapshot ? "review_source" : "confirm_restore"} required />{sourceSnapshot ? "I have reviewed the latest source evidence and confirm restoring the original accepted score and ownership." : "I have reviewed the exclusion and confirm restoring this result to its original enrolment."}</label> : null}
        </> : task.kind === "decision" ? <>
          <label>Decision<select value={decision} onChange={event => setDecision(event.target.value as typeof decision)}><option value="status">Outcome</option><option value="credits">Credits</option><option value="indicator">Warning flags</option></select></label>
          {decision === "indicator" ? <label>Warning flag<select value={indicator} onChange={event => setIndicator(event.target.value)}>{assessmentIndicators.filter(flag => snapshot.historical?.protected || snapshot.plan?.mode === "practical" || !flag.startsWith("practical:")).map(flag => <option key={flag} value={flag}>{flagLabel(flag)}</option>)}</select></label> : null}
          <div className={styles.notice}><p>{snapshot.historical?.protected ? "Historical baseline" : "Calculated recommendation"}: <strong>{decision === "status" ? snapshot.historical?.status ?? snapshot.calculated_status : decision === "credits" ? snapshot.historical?.protected ? `${snapshot.historical.credits} recorded credits` : `${snapshot.recommended_credits} credits for the effective outcome (${snapshot.calculated_credits} calculated)` : snapshot.calculated_indicators.includes(indicator) ? "Show flag" : "No flag"}</strong></p><p>Current decision: {currentDecision ? `${String(currentDecision.value)} — ${currentDecision.reason}` : decisionBasis}</p><p>Other decisions remain unchanged. A warning override does not change a score or satisfy attendance.</p>{snapshot.historical?.protected ? <p>Changing the outcome does not change recorded credits. Amend credits separately if needed. Missing historical attendance does not automatically create a failure or warning.</p> : null}</div>
          {preservedCredits != null ? <p className={styles.notice}>The existing {preservedCredits}-credit award is retained independently of the calculated outcome. Clearing a credit decision restores {preservedCredits} credits, even when the outcome is Fail. Outcome and warning decisions do not change that award.</p> : null}
          <label>Action<select value={operation} onChange={event => setOperation(event.target.value)}><option value="set">Set exceptional decision</option><option value="clear" disabled={!currentDecision}>{snapshot.historical?.protected ? "Restore historical baseline" : decision === "credits" && preservedCredits != null ? "Restore preserved credit award" : "Restore automatic calculation"}</option></select></label>
          {decision === "indicator" && indicator.includes(":Resit ") ? <p>Showing this flag also clears the opposing resit override for this component: required and scheduled cannot both be shown.</p> : null}
          {operation !== "clear" ? <div key={`${decision}-${indicator}`}>
            {decision === "status" ? <label>Outcome<select name="value" required defaultValue={String(currentDecision?.value ?? (snapshot.effective_status === "Historical" ? "" : snapshot.effective_status))}><option value="" disabled>Choose amended outcome</option>{assessmentStatuses.map(status => <option key={status}>{status}</option>)}</select></label> : decision === "credits" ? <label>Awarded credits<input name="value" type="number" min="0" step="1" required defaultValue={Number(currentDecision?.value ?? snapshot.awarded_credits)} /></label> : <label>Flag visibility<select name="value" defaultValue={String(currentDecision?.value ?? snapshot.effective_indicators.includes(indicator))}><option value="true">Show flag</option><option value="false">Suppress flag</option></select></label>}
          </div> : <p>Only this {decision === "indicator" ? "warning flag" : decision === "status" ? "outcome" : "credit"} override will be cleared.</p>}
        </> : task.kind === "score" ? <>
          {importedCorrection ? <p className={styles.notice}>Correcting {correction?.origin} evidence creates a linked Manual replacement on this same attempt. Student, enrolment, component and sitting stay fixed. The original imported values remain in history; nothing changes unless the entire save succeeds.</p> : null}
          {sourceSnapshot ? <AssessmentSourceEvidence source={sourceSnapshot} /> : null}
          <p className={styles.notice}>Pass mark: <strong>{correction?.pass_mark ?? (component === "theory" ? snapshot.plan.theory_pass_mark : snapshot.plan.practical_pass_mark)}%</strong>. {correction ? "This correction preserves the same sitting and attempt number; the previous score remains in history." : "Assessment configuration is inherited from the course and cannot be changed here."}</p>
          {component === "theory" ? (snapshot.plan.theory_scheme === "mcq" ? ["mcq", ...(snapshot.plan.physics_weighting ? ["physics"] : [])] : [...(snapshot.plan.requires_coursework ? ["coursework"] : []), ...(snapshot.plan.requires_viva ? ["viva"] : [])]).map(kind => <ScoreItem key={kind} kind={kind as AssessmentItemKind} attempts={componentAttempts} correction={correction} />) : null}
          {component === "practical" || snapshot.plan.theory_scheme === "coursework_viva" ? <label>{component === "practical" ? "Practical score (%)" : "Authoritative combined Theory score (%)"}<input name="score" type="number" min="0" max="100" step="0.01" required defaultValue={correction?.score} /></label> : <p>{snapshot.plan.physics_weighting ? "Theory = (MCQ + physics/equipment) / 2." : "Theory = MCQ score."}</p>}
          {correction ? <p>Sitting: {correction.sitting_date} · {correction.sitting_term ?? "Term not recorded"} · Attempt {correction.sequence ?? "unknown"}</p> : <>
            <label>Sitting date<input name="sitting_date" type="date" max={new Date().toISOString().slice(0, 10)} required /></label>
            <label>Sitting term<select name="sitting_term_id" defaultValue={snapshot.original_term_id}><option value="">Not recorded</option>{terms.map(term => <option value={term.id} key={term.id}>{term.name}</option>)}</select></label>
            {!componentAttempts.some(attempt => attempt.active) ? <label>Previous result unavailable (only for a known resit)<input name="previous_result_unavailable" placeholder="Reason or archive reference; otherwise leave blank" /></label> : null}
          </>}
        </> : <>
          <p>{componentLabel} · {snapshot.components[component]?.score == null ? "No completed score" : `Current score ${snapshot.components[component]?.score}%`}</p>
          {task.command === "ScheduleResit" || task.command === "DeferAssessment" ? <label>{task.command === "ScheduleResit" ? "When is the resit arranged?" : "Postponement details"}<textarea name="note" required placeholder="Record the date, session details or agreed arrangements." /></label> : <p>Current arrangement: {snapshot.components[component]?.note}</p>}
          <p>No assessment attempt is created until a completed score is recorded.</p>
          {task.command === "DeferAssessment" ? <p>An existing failure still takes precedence over postponement; this action does not erase a failed result.</p> : null}
        </>}
        <label>Reason<textarea name="reason" required maxLength={4000} placeholder="Explain the evidence and reason for this change." /></label>
      </fieldset>
      {error ? <div role="alert" className={styles.notice}><p>{error}</p><p>Your draft is unchanged. If another user has saved changes, cancel or discard this draft, then reopen the task to review the latest record.</p></div> : null}
      {exitTarget ? <div className={styles.notice} role="alert"><strong>Discard unsaved changes?</strong><p>Your entries have not been saved.</p><div className={styles.toolbar}><button ref={keepEditing} type="button" className={styles.button} onClick={() => { setExitTarget(null); requestAnimationFrame(() => form.current?.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')?.focus()); }}>Keep editing</button><button type="button" className={styles.button} onClick={discard}>Discard changes</button></div></div> : <footer className={styles.toolbar}><button type="submit" className={styles.primaryButton} disabled={pending || (task.kind === "decision" && operation === "clear" && !currentDecision)}>{pending ? "Saving…" : "Save changes"}</button><button type="button" className={styles.button} onClick={requestClose} disabled={pending}>Cancel</button></footer>}
    </form>
  </dialog>;
}
