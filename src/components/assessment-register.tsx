"use client";

import Link from "next/link";
import { componentScoreText, indicatorLabel } from "@/lib/assessment/display";
import { useEffect, useId, useRef, useState } from "react";
import { CalendarCheck, ChevronRight, History, LayoutList, Columns3, X } from "lucide-react";
import type { AssessmentAttempt, AssessmentEvaluation, AssessmentOutcome, AssessmentRevision, AssessmentStatus, ComponentResult } from "@/lib/assessment/types";
import styles from "./student-workspace.module.css";
import { AssessmentTaskDialog, type AssessmentTask } from "./assessment-task-dialog";
import type { AssessmentDecision, AssessmentSourceEvidence as SourceEvidence } from "@/lib/assessment/types";
import { AssessmentSourceEvidence } from "./assessment-source-evidence";

export { indicatorLabel } from "@/lib/assessment/display";

const statusLabels: Record<AssessmentStatus, string> = { Planned: "Not started", "In progress": "In progress", Pass: "Passed", Fail: "Failed", Abandoned: "Abandoned", "Module deferred": "Module deferred", "Assessment deferred": "Assessment deferred" };
const groups = ["Needs attention", "Arranged / pending", "On hold / closed", "Complete"];

function groupFor(assessment: AssessmentEvaluation) {
  if (["Abandoned", "Module deferred", "Assessment deferred"].includes(assessment.effective_status)) return "On hold / closed";
  if (assessment.needs_plan) return "Needs attention";
  if (assessment.effective_status === "Pass") return "Complete";
  if (assessment.effective_indicators?.some(indicator => !indicator.endsWith("Resit scheduled"))) return "Needs attention";
  if (assessment.effective_status === "Fail" && !assessment.effective_indicators?.some(indicator => indicator.endsWith("Resit scheduled"))) return "Needs attention";
  return "Arranged / pending";
}

export function OutcomeBadge({ assessment }: { assessment: AssessmentEvaluation }) {
  const status = assessment.effective_status;
  return <span className={`${styles.badge} ${status === "Pass" ? styles.good : status === "Fail" ? styles.bad : styles.neutral}`}>{assessment.needs_plan ? "Plan review required" : statusLabels[status] ?? "Awaiting review"}</span>;
}

function ComponentScore({ result, notRequired = false }: { result?: ComponentResult; notRequired?: boolean }) {
  return <span className={notRequired ? styles.muted : result?.passed === false ? styles.failedScore : styles.score}>{componentScoreText(result, notRequired)}</span>;
}

function dateLabel(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function correctionRestriction(attempt: AssessmentAttempt, attempts: AssessmentAttempt[], sources: SourceEvidence[]) {
  if (attempts.some(later => later.active && later.component === attempt.component && later.ordinal > attempt.ordinal)) return "A later attempt exists. Review dependent results before correcting this earlier sitting.";
  if (attempt.origin === "Manual") return null;
  const source = sources.find(source => source.id === attempt.source_id);
  if (!source || source.state !== "Matched") return "This imported evidence is not currently accepted for correction.";
  if (source.conflict) return "The source has an unresolved conflict. Review its evidence before correction.";
  return null;
}

function ResultHistory({ attempts, revisions, sourceEvidence, onCorrect, onLifecycle }: { attempts: AssessmentAttempt[]; revisions: AssessmentRevision[]; sourceEvidence: SourceEvidence[]; onCorrect?: (attempt: AssessmentAttempt) => void; onLifecycle?: (attempt: AssessmentAttempt, operation: "exclude" | "restore") => void }) {
  if (!attempts.length) return <p className={styles.empty}>No completed assessment attempts recorded.</p>;
  return <ol className={styles.history}>{[...attempts].sort((first, second) => first.component.localeCompare(second.component) || second.ordinal - first.ordinal).map(attempt => {
    const changes = revisions.filter(revision => revision.attempt_id === attempt.id).sort((first, second) => first.revision - second.revision);
    const source = sourceEvidence.find(source => source.id === attempt.source_id);
    const restriction = correctionRestriction(attempt, attempts, sourceEvidence);
    const hasLater = attempts.some(later => later.active && later.component === attempt.component && later.ordinal > attempt.ordinal);
    return <li key={attempt.id} className={styles.historyItem}>
      <div className={styles.sectionHeading}><strong>{attempt.component === "theory" ? "Theory" : "Practical"} · {attempt.sequence === null ? "Previous result unavailable" : `Attempt ${attempt.sequence}`}</strong><span className={`${styles.badge} ${attempt.active && attempt.is_current ? styles.good : styles.neutral}`}>{!attempt.active ? "Excluded / withdrawn" : attempt.is_current ? "Current result" : "Earlier result"}</span></div>
      <p><strong>{attempt.score}% · {attempt.passed ? "Passed" : "Failed"}</strong> <span className={styles.muted}>Pass mark {attempt.pass_mark}%</span></p>
      <p>{dateLabel(attempt.sitting_date)} · {attempt.sitting_term ?? "Sitting term not recorded"} · {attempt.origin}{attempt.origin === "Manual" && attempt.source_id ? " replacement of imported evidence" : ""}</p>
      {attempt.previous_result_unavailable ? <p>Earlier result reference: {attempt.previous_result_unavailable}</p> : null}
      <p>{attempt.reason}</p>
      {onCorrect && attempt.active ? <><button className={styles.button} disabled={Boolean(restriction)} onClick={() => onCorrect(attempt)}>Correct this result</button>{restriction ? <p className={styles.muted}>{restriction}</p> : null}</> : null}
      {onLifecycle && (attempt.active || attempt.lifecycle?.[0]?.kind === "exclude") ? <div className={styles.taskActions}><button className={styles.button} disabled={hasLater} onClick={() => onLifecycle(attempt, attempt.active ? "exclude" : "restore")}>{attempt.active ? "Exclude result" : "Restore excluded result"}</button>{hasLater ? <p className={styles.muted}>Review later active attempts before excluding or restoring this result.</p> : null}</div> : null}
      {onLifecycle && !attempt.active && !attempt.lifecycle?.length ? <p className={styles.muted}>Withdrawn through the earlier workflow. Review its reconciliation history before restoration.</p> : null}
      {attempt.lifecycle?.length ? <details className={styles.revisions}><summary>Exclusion / restoration history ({attempt.lifecycle.length})</summary>{attempt.lifecycle.map(event => <article key={event.id}><strong>{event.kind === "exclude" ? "Excluded" : "Restored"} · {event.category === "incorrect_ownership" ? "Incorrect student or enrolment" : "Duplicate or invalid result"}</strong><p>{event.reason}</p><p className={styles.muted}>{event.actor_name} · {dateLabel(event.created_at)}</p></article>)}</details> : null}
      {source ? <AssessmentSourceEvidence source={source} /> : null}
      {attempt.items.length ? <ul className={styles.itemScores}>{attempt.items.map(item => <li key={item.id}>{item.kind === "mcq" ? "MCQ" : item.kind === "physics" ? "Physics / equipment" : item.kind}: {item.score}%{item.carried_from_item_id ? " · Carried forward" : ""}</li>)}</ul> : null}
      <details className={styles.revisions}><summary>Score history · {changes.length} recorded {changes.length === 1 ? "version" : "versions"}</summary>{changes.map(revision => <article key={revision.id}>
        <strong>Version {revision.revision} · {revision.score}% · {revision.passed ? "Passed" : "Failed"}</strong>
        <p>Pass mark {revision.pass_mark}% · Sitting {dateLabel(revision.sitting_date)} · {revision.source_version_id ? "Imported evidence" : "Manual entry / correction"}</p>
        <p>{revision.reason}</p>
        <p className={styles.muted}>Recorded {dateLabel(revision.created_at)}</p>
        {revision.items.length ? <p>{revision.items.map(item => `${item.kind}: ${item.score}%${item.carried_from_item_id ? " (carried forward)" : ""}`).join(" · ")}</p> : null}
      </article>)}</details>
    </li>;
  })}</ol>;
}

function AssessmentDetails({ outcome, attempts, revisions, sourceEvidence, close, onAttendance, canEdit, terms, decisions }: { outcome: AssessmentOutcome; attempts: AssessmentAttempt[]; revisions: AssessmentRevision[]; sourceEvidence: SourceEvidence[]; close: () => void; onAttendance?: (termId: string) => void; canEdit: boolean; terms: Array<{ id: string; name: string }>; decisions: AssessmentDecision[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [history, setHistory] = useState(false);
  const [task, setTask] = useState<AssessmentTask | null>(null);
  const [savedAssessment, setSavedAssessment] = useState<AssessmentEvaluation | null>(null);
  const [message, setMessage] = useState("");
  const assessment = savedAssessment && savedAssessment.revision >= outcome.assessment.revision ? savedAssessment : outcome.assessment;
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }}>
    <header className={styles.dialogHeader}><div><p>{outcome.student_name} · {outcome.original_cohort}</p><h2 id={titleId}>{outcome.module_title}</h2></div><button className={styles.iconButton} onClick={close} aria-label="Close result details"><X size={22} /></button></header>
    <div className={styles.dialogBody}>
      {message ? <p role="status" className={styles.notice}>{message}</p> : null}
      <div className={styles.toolbar}><OutcomeBadge assessment={assessment} /><span>{assessment.awarded_credits ?? 0} credits awarded</span></div>
      {assessment.needs_plan ? <p className={styles.notice}>This module needs a reviewed assessment plan in Course configuration.</p> : <>
        <div className={styles.indicators}>{assessment.effective_indicators?.map(indicator => <span key={indicator} className={styles.flag}>{indicatorLabel(indicator)}</span>)}</div>
        <div className={styles.attendanceLink}><CalendarCheck size={18} /><span>Attendance: {assessment.attendance_actual} of {assessment.attendance_required} required days recorded</span>{onAttendance ? <button className={styles.textButton} onClick={() => { close(); onAttendance(assessment.original_term_id); }}>Review attendance</button> : <Link href={`/students/${outcome.student_id}?tab=attendance&term=${assessment.original_term_id}`}>Review attendance</Link>}</div>
        <div className={styles.resultTiles}>{["theory", "practical"].map(component => {
          const result = assessment.components?.[component as "theory" | "practical"];
          const notRequired = component === "practical" && assessment.plan?.mode === "online";
          const currentAttempt = attempts.find(attempt => attempt.id === result?.id && attempt.active);
          const restriction = currentAttempt ? correctionRestriction(currentAttempt, attempts, sourceEvidence) : null;
          return <section key={component}><div className={styles.sectionHeading}><h3>{component === "theory" ? "Theory" : "Practical"}</h3><ComponentScore result={result} notRequired={notRequired} /></div>{notRequired ? <p>Not required for this module.</p> : <>
            <p>Pass mark {result?.pass_mark ?? (component === "theory" ? assessment.plan?.theory_pass_mark : assessment.plan?.practical_pass_mark)}% · {result?.attempt_count ?? 0} attempts</p>
            {result?.arrangement_state === "active" ? <p className={styles.notice}><strong>{result.arrangement_kind === "resit_schedule" ? "Resit arranged" : "Assessment postponed"}</strong><br />{result.note}</p> : null}
            {canEdit && result ? <div className={styles.taskActions}>
              {result.passed !== true ? <button className={styles.button} onClick={() => setTask({ kind: "score", component: result.component })}>{result.attempt_count ? "Record resit" : "Record result"}</button> : null}
              {currentAttempt ? <><button className={styles.button} disabled={Boolean(restriction)} onClick={() => setTask({ kind: "score", component: result.component, correction: currentAttempt })}>Correct result</button>{restriction ? <p className={styles.muted}>{restriction}</p> : null}</> : null}
              {result.arrangement_state === "active" ? <button className={styles.button} onClick={() => setTask({ kind: "arrangement", component: result.component, command: result.arrangement_kind === "resit_schedule" ? "CancelResit" : "ClearAssessmentDeferral" })}>{result.arrangement_kind === "resit_schedule" ? "Cancel resit" : "Clear postponement"}</button> : <>
                {result.passed === false ? <button className={styles.button} onClick={() => setTask({ kind: "arrangement", component: result.component, command: "ScheduleResit" })}>Arrange resit</button> : null}
                {result.passed !== true ? <button className={styles.button} onClick={() => setTask({ kind: "arrangement", component: result.component, command: "DeferAssessment" })}>Postpone assessment</button> : null}
              </>}
            </div> : null}
          </>}</section>;
        })}</div>
        {assessment.overrides?.length ? <section className={styles.notice}><strong>Exceptional decisions active</strong><p>Calculated outcome: {statusLabels[assessment.calculated_status]} · {assessment.calculated_credits} credits</p><p>Calculated flags: {assessment.calculated_indicators.map(indicatorLabel).join(" · ") || "None"}</p>{assessment.overrides.map(override => <p key={`${override.kind}-${override.indicator}`}><strong>{override.kind === "status" ? "Outcome" : override.kind === "credits" ? "Credits" : indicatorLabel(override.indicator)}: {typeof override.value === "boolean" ? override.value ? "Show flag" : "Suppress flag" : override.value}</strong> — {override.reason}</p>)}</section> : null}
        {canEdit ? <button className={styles.button} onClick={() => setTask({ kind: "decision" })}>Exceptional decision</button> : null}
        {decisions.length ? <details className={styles.revisions}><summary>Decision history ({decisions.length})</summary>{[...decisions].sort((first, second) => second.event_order - first.event_order).map(decision => <article key={decision.id}><strong>{decision.kind === "status" ? "Outcome" : decision.kind === "credits" ? "Credits" : indicatorLabel(decision.indicator)} · {decision.value === null ? "Restored automatic calculation" : typeof decision.value === "boolean" ? decision.value ? "Show flag" : "Suppress flag" : decision.value}</strong><p>{decision.reason}</p><p className={styles.muted}>{decision.actor_name} · {dateLabel(decision.created_at)}</p></article>)}</details> : null}
      </>}
      <button className={styles.button} aria-expanded={history} onClick={() => setHistory(value => !value)}><History size={17} />Result history ({attempts.length})</button>
      {history ? <section aria-label="Result history"><p className={styles.muted}>All recorded sittings remain here. Corrections keep the same attempt; only the latest valid attempt determines each component’s current result. Excluded results stay visible but do not contribute to accepted outcomes or official result exports.</p><ResultHistory attempts={attempts} revisions={revisions} sourceEvidence={sourceEvidence} onCorrect={canEdit ? attempt => setTask({ kind: "score", component: attempt.component, correction: attempt }) : undefined} onLifecycle={canEdit ? (attempt, operation) => setTask({ kind: "lifecycle", component: attempt.component, attempt, operation }) : undefined} /></section> : null}
      <Link className={styles.textButton} href={`/students/${outcome.student_id}?tab=modules`}>Open student workspace <ChevronRight size={16} /></Link>
    </div>
    {task ? <AssessmentTaskDialog task={task} assessment={assessment} attempts={attempts} terms={terms} source={sourceEvidence.find(source => source.id === (task.kind === "score" ? task.correction?.source_id : task.kind === "lifecycle" ? task.attempt.source_id : undefined))} close={() => setTask(null)} saved={(updated, notice) => { setSavedAssessment(updated); setMessage(notice); setTask(null); }} /> : null}
  </dialog>;
}

export function AssessmentRegister({ outcomes, attempts, revisions, sourceEvidence = [], studentScoped = false, onAttendance, canEdit = false, terms = [], decisions = [] }: { outcomes: AssessmentOutcome[]; attempts: AssessmentAttempt[]; revisions: AssessmentRevision[]; sourceEvidence?: SourceEvidence[]; studentScoped?: boolean; onAttendance?: (termId: string) => void; canEdit?: boolean; terms?: Array<{ id: string; name: string }>; decisions?: AssessmentDecision[] }) {
  const [view, setView] = useState<"table" | "board">("table");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [teachingTerm, setTeachingTerm] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const teachingTerms = terms.filter(term => outcomes.some(outcome => outcome.original_cohort === term.name));
  const visible = outcomes.filter(outcome => `${outcome.student_name} ${outcome.student_identifier} ${outcome.temporary_identifier ?? ""} ${outcome.module_code} ${outcome.module_title} ${outcome.original_cohort}`.toLowerCase().includes(query.toLowerCase()) && (status === "all" || outcome.assessment.effective_status === status) && (!teachingTerm || outcome.original_cohort === teachingTerm));
  const chosen = outcomes.find(outcome => outcome.enrolment_id === selected);
  return <section className={styles.register} aria-label={studentScoped ? "Modules and results" : "All-student assessments"}>
    <div className={styles.sectionHeading}><div><h2>{studentScoped ? "Modules & results" : "Assessment records"}</h2><p className={styles.muted}>Current outcomes, earlier sittings and recorded decisions.</p></div><div className={styles.viewToggle} aria-label="Assessment view"><button aria-pressed={view === "table"} onClick={() => setView("table")}><LayoutList size={16} />Table</button><button aria-pressed={view === "board"} onClick={() => setView("board")}><Columns3 size={16} />Board</button></div></div>
    <div className={styles.filters}><label>Find {studentScoped ? "a module" : "a student or module"}<input value={query} onChange={event => setQuery(event.target.value)} placeholder={studentScoped ? "Module or cohort" : "Name, ID, module or cohort"} /></label><label>Teaching term<select value={teachingTerm} onChange={event => setTeachingTerm(event.target.value)}><option value="">All terms</option>{teachingTerms.map(term => <option key={term.id} value={term.name}>{term.name}</option>)}</select></label><label>Outcome<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All outcomes</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><span className={styles.muted}>{visible.length} enrolments</span></div>
    <p className={styles.muted}>Includes past and current teaching terms. Later resits stay with the original teaching term; earlier results remain in Result history.</p>
    {!visible.length ? <p className={styles.empty}>No matching module enrolments.</p> : view === "table" ? <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Assessment table"><table className={styles.table}><thead><tr>{!studentScoped ? <th>Student</th> : null}<th>Module / teaching cohort</th><th>Theory</th><th>Practical</th><th>Outcome</th><th>Credits</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead><tbody>{visible.map(outcome => <tr key={outcome.enrolment_id}>
      {!studentScoped ? <td><Link href={`/students/${outcome.student_id}`}><strong>{outcome.student_name}</strong></Link><small>{outcome.student_identifier}</small></td> : null}
      <td><strong>{outcome.module_title}</strong><small>{outcome.module_code} · {outcome.original_cohort}</small></td><td><ComponentScore result={outcome.assessment.components?.theory} /></td><td><ComponentScore result={outcome.assessment.components?.practical} notRequired={outcome.assessment.plan?.mode === "online"} /></td>
      <td><OutcomeBadge assessment={outcome.assessment} />{outcome.assessment.effective_indicators?.map(indicator => <small key={indicator}>{indicatorLabel(indicator)}</small>)}{outcome.assessment.overrides?.length ? <small>Staff decision active</small> : null}</td><td>{outcome.assessment.awarded_credits ?? 0}</td><td><button className={styles.button} aria-label={`View results for ${outcome.module_title}${studentScoped ? "" : ` — ${outcome.student_name}`}`} onClick={() => setSelected(outcome.enrolment_id)}>View results <ChevronRight size={15} /></button></td>
    </tr>)}</tbody></table></div> : <div className={styles.board}>{groups.map(group => <section className={styles.lane} key={group}><h3>{group} <small>{visible.filter(outcome => groupFor(outcome.assessment) === group).length}</small></h3>{visible.filter(outcome => groupFor(outcome.assessment) === group).map(outcome => <article className={styles.boardCard} key={outcome.enrolment_id}>
      <OutcomeBadge assessment={outcome.assessment} /><h4>{studentScoped ? outcome.module_title : outcome.student_name}</h4><p>{outcome.module_code} · {studentScoped ? outcome.original_cohort : outcome.module_title}</p>{!studentScoped ? <p className={styles.muted}>Teaching term: {outcome.original_cohort}</p> : null}<div className={styles.toolbar}><span>Theory <ComponentScore result={outcome.assessment.components?.theory} /></span><span>Practical <ComponentScore result={outcome.assessment.components?.practical} notRequired={outcome.assessment.plan?.mode === "online"} /></span></div>{outcome.assessment.effective_indicators?.map(indicator => <p key={indicator} className={styles.muted}>{indicatorLabel(indicator)}</p>)}<button className={styles.button} onClick={() => setSelected(outcome.enrolment_id)}>View results</button>
    </article>)}</section>)}</div>}
    {chosen ? <AssessmentDetails key={chosen.enrolment_id} outcome={chosen} attempts={attempts.filter(attempt => attempt.enrolment_id === chosen.enrolment_id)} revisions={revisions} sourceEvidence={sourceEvidence} close={() => setSelected(null)} onAttendance={onAttendance} canEdit={canEdit} terms={terms} decisions={decisions.filter(decision => decision.enrolment_id === chosen.enrolment_id)} /> : null}
  </section>;
}
