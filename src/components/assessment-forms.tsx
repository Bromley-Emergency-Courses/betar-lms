"use client";

import { startTransition, useActionState, useId, useState, type ReactNode } from "react";
import { submitAssessmentCommand, submitAssessmentPlan, previewAssessmentPlan, submitAssessmentBackfill, type AssessmentFormState } from "@/app/assessments/actions";
import type { AssessmentAttempt, AssessmentComponent, AssessmentEvaluation, AssessmentPlan } from "@/lib/assessment/types";

function Feedback({ state }: { state: AssessmentFormState }) {
  return <>{state.error ? <p role="alert">{state.error}</p> : null}{state.message ? <p role="status">{state.message}</p> : null}</>;
}
export function AssessmentCommandForm({ command, revision, label, children }: { command: Record<string, unknown>; revision: number; label: string; children?: ReactNode }) {
  const [state, action, pending] = useActionState(submitAssessmentCommand, {});
  return <form onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); startTransition(() => action(fields)); }} className="grid">
    <input type="hidden" name="command" value={JSON.stringify(command)} />
    <input type="hidden" name="expected_revision" value={revision} />
    {children}
    <label>Reason<textarea className="textarea" name="reason" required /></label>
    <Feedback state={state} />
    <button className="button" disabled={pending}>{pending ? "Saving…" : label}</button>
  </form>;
}

export function AssessmentPlanForm({ moduleId, mode, currentPlan }: { moduleId: string; mode: string; currentPlan?: AssessmentPlan }) {
  const [scheme, setScheme] = useState(currentPlan?.theory_scheme ?? "mcq");
  const [state, action, pending] = useActionState(submitAssessmentPlan, {});
  return <form action={action} className="grid">
    <input type="hidden" name="module_id" value={moduleId} />
    <input type="hidden" name="expected_plan_id" value={currentPlan?.id ?? ""} />
    <p>{mode === "online" ? "Online · Theory only" : "Practical · Theory and Practical"} · Current plan {currentPlan?.version ?? "not reviewed"}</p>
    <label>Theory scheme<select className="select" name="theory_scheme" value={scheme} onChange={event => setScheme(event.target.value as AssessmentPlan["theory_scheme"])}>
      <option value="mcq">MCQ</option><option value="coursework_viva">Coursework / Viva</option>
    </select></label>
    {scheme === "mcq" ? <label><input type="checkbox" name="physics_weighting" defaultChecked={currentPlan?.physics_weighting} /> Physics/equipment contributes 50%</label> : <>
      <label><input type="checkbox" name="requires_coursework" defaultChecked={currentPlan?.requires_coursework} /> Coursework required</label>
      <label><input type="checkbox" name="requires_viva" defaultChecked={currentPlan?.requires_viva} /> Viva required</label>
      <p>Select at least one supporting item. Staff supply the combined Theory score.</p>
    </>}
    <label>Theory pass mark<input className="input" name="theory_pass_mark" type="number" min="0" max="100" step="0.01" defaultValue={currentPlan?.theory_pass_mark ?? 50} required /></label>
    {mode === "practical" ? <label>Practical pass mark<input className="input" name="practical_pass_mark" type="number" min="0" max="100" step="0.01" defaultValue={currentPlan?.practical_pass_mark ?? 50} required /></label> : null}
    <p>Saving creates a new version for future enrolments. Existing enrolments retain their inherited plan.</p>
    <label>Review reason<textarea className="textarea" name="reason" required /></label>
    <Feedback state={state} /><button className="button" disabled={pending}>Save reviewed plan version</button>
  </form>;
}

function ItemField({ kind, attempts, correction }: { kind: "mcq" | "physics" | "coursework" | "viva"; attempts: AssessmentAttempt[]; correction?: AssessmentAttempt }) {
  const [carry, setCarry] = useState("");
  const priorItems = attempts.filter(attempt => attempt.active && (!correction || attempt.ordinal < correction.ordinal)).flatMap(attempt => attempt.items.filter(item => item.kind === kind).map(item => ({ ...item, attempt })));
  return <div className="grid">
    <label>{kind === "physics" ? "Physics / equipment" : kind.toUpperCase()}
      {kind !== "mcq" && priorItems.length ? <select className="select" name={`item.${kind}.carry`} value={carry} onChange={event => setCarry(event.target.value)}>
        <option value="">Newly assessed score</option>
        {priorItems.map(item => <option key={item.id} value={item.id}>Carry {item.score}% from attempt {item.attempt.sequence ?? "unknown"}, {item.attempt.sitting_date}</option>)}
      </select> : null}
      {!carry ? <input className="input" type="number" min="0" max="100" step="0.01" name={`item.${kind}.score`} defaultValue={correction?.items.find(item => item.kind === kind)?.score} required /> : null}
    </label>
  </div>;
}

export function AssessmentScoreForm({ assessment, component, attempts, correction, terms }: {
  assessment: AssessmentEvaluation; component: AssessmentComponent; attempts: AssessmentAttempt[]; correction?: AssessmentAttempt;
  terms: Array<{ id: string; name: string }>;
}) {
  const plan = assessment.plan;
  const componentAttempts = attempts.filter(attempt => attempt.component === component);
  const preceding = componentAttempts.filter(attempt => attempt.active).at(-1);
  return <AssessmentCommandForm label={correction ? "Save correction" : "Add exam score"} revision={assessment.revision} command={{
    type: correction ? "CorrectManualAttempt" : "AddManualAttempt", enrolment_id: assessment.enrolment_id, component,
    ...(correction ? { attempt_id: correction.id } : {})
  }}>
    {preceding && !correction ? <p>Preceding attempt: {preceding.sequence ?? "Previous result unavailable"} · {preceding.score}% · {preceding.sitting_date}. Choose new or carried-forward supporting scores explicitly.</p> : null}
    {component === "theory" ? <>
      {plan.theory_scheme === "mcq" ? <><ItemField kind="mcq" attempts={componentAttempts} correction={correction} />{plan.physics_weighting ? <ItemField kind="physics" attempts={componentAttempts} correction={correction} /> : null}</> : <>
        {plan.requires_coursework ? <ItemField kind="coursework" attempts={componentAttempts} correction={correction} /> : null}
        {plan.requires_viva ? <ItemField kind="viva" attempts={componentAttempts} correction={correction} /> : null}
      </>}
    </> : null}
    {component === "practical" || plan.theory_scheme === "coursework_viva" ? <label>{component === "theory" ? "Authoritative combined Theory score (entered by staff)" : "Practical score"}<input className="input" name="score" type="number" min="0" max="100" step="0.01" defaultValue={correction?.score} required /></label> : <p>{plan.physics_weighting ? "Theory = (MCQ + physics/equipment) / 2." : "Theory = MCQ score."}</p>}
    <p>Pass mark: {correction?.pass_mark ?? (component === "theory" ? plan.theory_pass_mark : plan.practical_pass_mark)}%. New results inherit the course plan; corrections preserve the recorded threshold.</p>
    <label>Sitting date<input className="input" name="sitting_date" type="date" defaultValue={correction?.sitting_date} required /></label>
    <label>Sitting term<select className="select" name="sitting_term_id" defaultValue={correction?.sitting_term_id ?? ""}><option value="">Not recorded</option>{terms.map(term => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label>
    {!preceding && !correction ? <label>Previous result unavailable — reason/reference, only if known to be a resit<input className="input" name="previous_result_unavailable" /></label> : null}
  </AssessmentCommandForm>;
}

export function PlanMigrationForm({ assessment, plans }: { assessment: AssessmentEvaluation; plans: AssessmentPlan[] }) {
  const planFieldId = useId();
  const [state, action, pending] = useActionState(previewAssessmentPlan, {});
  const [planId, setPlanId] = useState("");
  const preview = state.preview;
  const currentPreview = preview?.after.plan.id === planId && assessment.plan?.id !== planId;
  return <div className="grid"><form className="grid" onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); startTransition(() => action(fields)); }}>
    <input type="hidden" name="enrolment_id" value={assessment.enrolment_id} />
    <label htmlFor={planFieldId}>Reviewed plan version</label><select id={planFieldId} className="select" name="plan_id" required disabled={pending} value={planId} onChange={event=>setPlanId(event.target.value)}><option value="">Select plan</option>{plans.filter(plan => plan.id !== assessment.plan?.id).map(plan=><option value={plan.id} key={plan.id}>Version {plan.version} · {plan.theory_scheme === "mcq" ? plan.physics_weighting ? "MCQ + physics" : "MCQ" : "Coursework / Viva"} · Theory pass {plan.theory_pass_mark}%{plan.mode === "practical" ? ` · Practical pass ${plan.practical_pass_mark}%` : ""}</option>)}</select>
    <button className="button" disabled={pending}>Preview plan impact</button><Feedback state={state} />
  </form>{!pending && currentPreview && preview ? <section aria-label="Plan impact preview" className="panel grid">
    <h3>Review this enrolment’s plan change</h3>
    <p>Plan {preview.before.plan ? `v${preview.before.plan.version}` : "not assigned"} → v{preview.after.plan.version}. Only this enrolment changes; other enrolments keep their inherited version.</p>
    <p>Outcome: {preview.before.effective_status ?? "Plan review required"} → {preview.after.effective_status}. Credits: {preview.before.awarded_credits ?? 0} → {preview.after.awarded_credits ?? 0}.</p>
    <p>Calculated outcome: {preview.before.calculated_status ?? "Plan review required"} → {preview.after.calculated_status}. Calculated credits: {preview.before.calculated_credits ?? 0} → {preview.after.calculated_credits ?? 0}.</p>
    <p>Warning flags: {preview.before.effective_indicators?.join(", ") || "None"} → {preview.after.effective_indicators?.join(", ") || "None"}. Existing exceptional decisions remain active.</p>
    <p>{preview.attempts.length} recorded attempt(s) retained. Existing scores, supporting items and recorded pass marks do not change. New attempts use the selected plan.</p>
    {preview.incompatible_attempts.length ? <p role="alert">Cannot apply: {preview.incompatible_attempts.length} accepted attempt(s) have items incompatible with this plan. Review their evidence; do not exclude valid results just to force a plan change.</p> : <AssessmentCommandForm key={`${planId}:${preview.before.revision}`} label="Apply reviewed plan change" revision={preview.before.revision} command={{type:"ChangeEnrolmentAssessmentPlan",enrolment_id:assessment.enrolment_id,plan_id:planId,preview}} />}
  </section> : null}</div>;
}

export function AssessmentBackfillForm({ candidates }: {candidates:Array<{legacy_result_id:string;legacy_hash:string;review_reason:string|null;legacy_snapshot:Record<string,unknown>}>}) {
  const [state,action,pending]=useActionState(submitAssessmentBackfill,{});
  return <form action={action} className="grid"><p>Review source identities, supporting evidence and sitting order. Import predecessors before later attempts. Original records are preserved.</p>
    {candidates.map(candidate=><label key={candidate.legacy_result_id} className="panel"><input type="checkbox" name="approval" disabled={Boolean(candidate.review_reason)} value={JSON.stringify({legacy_result_id:candidate.legacy_result_id,legacy_hash:candidate.legacy_hash})}/>
      {String(candidate.legacy_snapshot.source_attempt_id)} · {String(candidate.legacy_snapshot.component_type)} · {String(candidate.legacy_snapshot.score)}% · {String(candidate.legacy_snapshot.taken_on)} · Attempt {String(candidate.legacy_snapshot.attempt_number)} · {candidate.review_reason??"Eligible for reviewed backfill"}
    </label>)}
    <label>Review reference and reason<textarea className="textarea" name="reason" required/></label><Feedback state={state}/><button className="button" disabled={pending}>Backfill selected reviewed rows</button>
  </form>;
}
