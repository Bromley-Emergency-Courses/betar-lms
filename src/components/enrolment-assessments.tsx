import Link from "next/link";
import { AssessmentCommandForm, AssessmentScoreForm } from "./assessment-forms";
import { readAssessmentWorkspace, readAssessmentTable } from "@/lib/assessment";
import { assessmentWorkflowMode } from "@/lib/assessment/feature";

export async function EnrolmentAssessments({ studentId, editMode, terms }: { studentId?: string; editMode: boolean; terms: Array<{id:string;name:string}> }) {
  const { outcomes, attempts, sources } = await readAssessmentWorkspace(studentId);
  const [revisions, histories, arrangements, auditEvents] = await Promise.all([
    readAssessmentTable<Record<string, unknown>>("assessment_revision_history"),
    readAssessmentTable<Record<string, unknown>>("enrolment_assessment_history"),
    readAssessmentTable<Record<string, unknown>>("module_assessment_arrangements"),
    readAssessmentTable<Record<string, unknown>>("audit_events", {column:"entity_type",value:"enrolment_assessment"})
  ]);
  return <section className="section"><h2>Module assessments</h2>
    <p>Manual import matching is disabled. Automatic imports continue; unresolved evidence remains pending reconciliation. Correct, exclude or restore existing results through <Link href={studentId ? `/students/${studentId}?tab=modules` : "/assessments"}>Results history in the assessment workspace</Link>.</p>
    {assessmentWorkflowMode() === "shadow" ? <p role="status">Shadow workflow: legacy results remain authoritative during reconciliation and pilot review.</p> : null}
    {outcomes.map(outcome => {
      const assessment = outcome.assessment;
      const enrolmentAttempts = attempts.filter(attempt=>attempt.enrolment_id===outcome.enrolment_id).sort((first,second)=>first.ordinal-second.ordinal);
      const base = {enrolment_id:outcome.enrolment_id};
      const history = histories.filter(event=>event.enrolment_id===outcome.enrolment_id);
      return <details className="panel" key={outcome.enrolment_id} open={assessment.needs_plan}>
        <summary><strong>{outcome.original_cohort} · {outcome.module_code}</strong> · {outcome.student_name}
          {assessment.needs_plan ? " · Plan review required" : <> · Theory {assessment.components.theory.score ?? "Pending"} · Practical {assessment.plan.mode === "online" ? "N/A" : assessment.components.practical?.score ?? "Pending"}
            · {assessment.effective_status} · {assessment.awarded_credits} credits · {assessment.components.theory.attempt_count} Theory attempts{assessment.components.practical ? ` / ${assessment.components.practical.attempt_count} Practical attempts` : ""}</>}
        </summary>
        <Link href={`/students/${outcome.student_id}`}>Student profile</Link>
        {history.some(event=>(event.projection as {pass_reversed?:boolean}).pass_reversed) ? <p role="alert">A calculated Pass has been reversed in this enrolment’s history. Review current status and credits.</p> : null}
        {!assessment.needs_plan ? <>
          <p>{assessment.effective_indicators.join(" · ") || "No current indicators"}</p>
          {assessment.overrides.length ? <div role="status"><strong>Administrator override active</strong><p>Calculated recommendation: {assessment.calculated_status} · {assessment.calculated_credits} credits · {assessment.calculated_indicators.join(" · ") || "No indicators"}. Credit recommendation from effective status: {assessment.recommended_credits}.</p>
            {assessment.overrides.map(override=><div key={override.kind+override.indicator}><p>{override.kind} {override.indicator}: {String(override.value)} — {override.reason}</p>{editMode ? <AssessmentCommandForm revision={assessment.revision} label="Clear override" command={{...base,type:"ClearAssessmentOverride",kind:override.kind,indicator:override.indicator}} /> : null}</div>)}
          </div> : null}
          <p>Attendance {assessment.attendance_actual}/{assessment.attendance_required}. Presentation {assessment.presentation_pending ? "pending" : "satisfied / not required"}.</p>
          {Object.values(assessment.components).map(result=><div key={result.component} className="panel grid"><h3>{result.component === "theory" ? "Theory" : "Practical"}</h3>
            <p>{result.score ?? "Not recorded"}{result.score !== null ? `% · pass mark ${result.pass_mark}%` : ""} · {result.arrangement_state === "active" ? `${result.arrangement_kind}: ${result.note}` : "No active arrangement"}</p>
            {editMode ? <>
              {result.passed !== true ? <details><summary>Add exam score</summary><AssessmentScoreForm assessment={assessment} component={result.component} attempts={enrolmentAttempts} terms={terms} /></details> : null}
              {result.arrangement_state === "active" ? <details><summary>Cancel arrangement</summary><AssessmentCommandForm revision={assessment.revision} label="Cancel arrangement" command={{...base,type:result.arrangement_kind==="resit_schedule"?"CancelResit":"ClearAssessmentDeferral",component:result.component}} /></details> : <>
                {result.passed === false ? <details><summary>Schedule resit</summary><AssessmentCommandForm revision={assessment.revision} label="Schedule resit" command={{...base,type:"ScheduleResit",component:result.component}}><label>When is it arranged?<textarea className="textarea" name="note" required /></label></AssessmentCommandForm></details> : null}
                {result.passed !== true ? <details><summary>Defer assessment after teaching ends</summary><AssessmentCommandForm revision={assessment.revision} label="Defer assessment" command={{...base,type:"DeferAssessment",component:result.component}}><label>Deferral note<textarea className="textarea" name="note" required /></label></AssessmentCommandForm></details> : null}
              </>}
            </> : null}
          </div>)}
          <h3>Attempt and correction history</h3>
          {enrolmentAttempts.map(attempt=><details className="panel" key={attempt.id}><summary>{attempt.component} · Attempt {attempt.sequence ?? "unknown"} · {attempt.score}% · {attempt.origin} · {attempt.sitting_date} · {attempt.active ? attempt.is_current ? "Current" : "Historical" : "Withdrawn"}</summary>
            <p>Sitting term {attempt.sitting_term ?? "not recorded"} · revision {attempt.revision} · {attempt.reason}</p>
            {attempt.previous_result_unavailable ? <p>Previous result unavailable: {attempt.previous_result_unavailable}</p> : null}
            <ul>{attempt.items.map(item=><li key={item.id}>{item.kind}: {item.score}%{item.carried_from_item_id ? ` · Carried from item ${item.carried_from_item_id}` : " · Newly assessed"}</li>)}</ul>
            <details><summary>All immutable revisions</summary>{revisions.filter(revision=>revision.attempt_id===attempt.id).sort((first,second)=>Number(first.revision)-Number(second.revision)).map(revision=><div key={String(revision.id)}><p>Revision {String(revision.revision)} · {String(revision.score)}% · {String(revision.sitting_date)} · {String(revision.reason)} · actor {String(revision.actor_id)} · {String(revision.created_at)}</p><pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(revision.items,null,2)}</pre></div>)}</details>
            {editMode && attempt.active && attempt.origin === "Manual" ? <details><summary>Correct score</summary><AssessmentScoreForm assessment={assessment} component={attempt.component} attempts={enrolmentAttempts} correction={attempt} terms={terms} /></details> : null}
            {attempt.source_id ? <p>Source evidence: {attempt.source_id} {sources.find(source=>source.id===attempt.source_id)?.state}</p> : null}
          </details>)}
          {editMode ? <>
            <details><summary>Enrolment disposition</summary><AssessmentCommandForm revision={assessment.revision} label="Set disposition" command={{...base,type:"SetEnrolmentDisposition"}}><label>Disposition<select className="select" name="disposition"><option>Abandoned</option><option>Module deferred</option></select></label></AssessmentCommandForm>
              {assessment.disposition ? <AssessmentCommandForm revision={assessment.revision} label="Resume enrolment" command={{...base,type:"ClearEnrolmentDisposition"}} /> : null}
            </details>
            <details><summary>Exceptional status or credit override</summary><AssessmentCommandForm revision={assessment.revision} label="Set status override" command={{...base,type:"SetAssessmentOverride",kind:"status"}}><label>Status<select className="select" name="value">{["Planned","In progress","Abandoned","Pass","Fail","Module deferred","Assessment deferred"].map(status=><option key={status}>{status}</option>)}</select></label></AssessmentCommandForm>
              <AssessmentCommandForm revision={assessment.revision} label="Set exceptional credit override" command={{...base,type:"SetAssessmentOverride",kind:"credits"}}><label>Awarded credits<input className="input" name="value" type="number" min="0" step="1" required /></label></AssessmentCommandForm>
            </details>
            <details><summary>Indicator overrides</summary>{["Attendance non-compliance","Presentation incomplete","theory:Resit required","theory:Resit scheduled",...(assessment.plan.mode==="practical"?["practical:Resit required","practical:Resit scheduled"]:[])].map(indicator=><details key={indicator}><summary>{indicator}</summary><AssessmentCommandForm revision={assessment.revision} label="Set indicator override" command={{...base,type:"SetAssessmentOverride",kind:"indicator",indicator}}><select className="select" name="value"><option value="true">Show indicator</option><option value="false">Suppress indicator</option></select></AssessmentCommandForm></details>)}</details>
          </> : null}
        </> : <p>Configure and review this module’s assessment plan before recording results.</p>}
        {editMode ? <p>Assessment schemes, weighting and pass marks are managed in <Link href={`/course/assessment-plans/${assessment.module_id}`}>Course configuration</Link>, not this profile.</p> : null}
        <details><summary>Audit and arrangement history</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify({arrangements:arrangements.filter(event=>event.enrolment_id===outcome.enrolment_id),outcomes:history,events:auditEvents.filter(event=>event.entity_id===outcome.enrolment_id)},null,2)}</pre></details>
        {outcome.legacy_final_mark !== null || outcome.legacy_grade !== null ? <details><summary>Legacy reconciliation (read-only)</summary><p>Final mark: {outcome.legacy_final_mark ?? "not recorded"} · Grade: {outcome.legacy_grade ?? "not recorded"}. These values do not determine assessment outcomes.</p></details> : null}
      </details>;
    })}
  </section>;
}
