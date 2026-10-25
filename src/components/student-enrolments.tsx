"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { loadWorkspaceEnrolments, saveWorkspaceEnrolment } from "@/app/students/enrolment-actions";
import type { EnrolmentWorkspace } from "@/lib/student-enrolment";
import { useTaskDialogGuard } from "./use-task-dialog-guard";
import styles from "./student-workspace.module.css";

function EnrolmentDialog({ studentId, studentName, workspace, creating, close, saved }: {
  studentId: string; studentName: string; workspace: EnrolmentWorkspace; creating: boolean; close: () => void; saved: (message: string) => void;
}) {
  const [snapshot] = useState(workspace);
  const [newId] = useState(() => crypto.randomUUID());
  const [selectedId, setSelectedId] = useState(creating ? "" : snapshot.enrolments.find(row => !row.cancellation)?.id ?? "");
  const [showCancelled, setShowCancelled] = useState(false);
  const [task, setTask] = useState("requirements");
  const [error, setError] = useState("");
  const titleId = useId();
  const router = useRouter();
  const { dialog, keepEditing, dirtyRef, pendingRef, dirty, pending, setPending, exitTarget, setExitTarget, requestClose, discard, markDirty } = useTaskDialogGuard(close);
  const enrolment = snapshot.enrolments.find(row => row.id === selectedId);
  const offering = creating ? snapshot.offerings.find(row => row.id === selectedId) : enrolment?.offering;
  const practical = (creating ? offering?.mode : enrolment?.assessment?.plan.mode) === "practical";
  const visibleEnrolments = snapshot.enrolments.filter(row => showCancelled || !row.cancellation);
  const blocked = !offering || Boolean(enrolment?.cancellation) || (creating ? !offering.ready : task === "cancel" ? Boolean(enrolment?.cancellationReasons.length) : !enrolment?.assessment || (task === "requirements" && !practical) || (task === "resume" && !enrolment.assessment.disposition));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || blocked) return;
    const fields = new FormData(event.currentTarget);
    const base = { enrolment_id: creating ? newId : enrolment!.id, student_id: studentId, reason: String(fields.get("reason") ?? "") };
    const requirements = { attendance_days: String(fields.get("days") ?? "").trim() === "" ? null : Number(fields.get("days")), presentation_required: fields.get("presentation") === "true" ? true : fields.get("presentation") === "false" ? false : null };
    const existing = { ...base, expected_token: enrolment?.token };
    const command = creating ? { ...base, ...requirements, type: "CreateModuleEnrolment", offering_id: offering!.id, offering_token: offering!.token } :
      task === "requirements" ? { ...existing, ...requirements, type: "SetEnrolmentRequirements" } :
      task === "cancel" ? { ...existing, type: "CancelMistakenEnrolment", confirmed: fields.get("confirmed") === "on" } :
      task === "resume" ? { ...existing, type: "ClearEnrolmentDisposition" } :
      { ...existing, type: "SetEnrolmentDisposition", disposition: task === "defer" ? "Module deferred" : "Abandoned" };
    pendingRef.current = true; setPending(true); setError("");
    try {
      const result = await saveWorkspaceEnrolment({ command, expectedRevision: creating ? 0 : enrolment!.revision });
      if (!result.ok) { setError(result.error); return; }
      dirtyRef.current = false; saved(result.message); router.refresh();
    } catch { setError("The save could not be confirmed. Your entries have been kept; review saved records before retrying."); }
    finally { pendingRef.current = false; setPending(false); }
  }
  return <dialog ref={dialog} className={`${styles.dialog} ${styles.enrolmentDialog}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className={styles.dialogHeader}><h2 id={titleId}>{creating ? "Add enrolment" : "Manage enrolment"}</h2><button className={styles.iconButton} type="button" aria-label="Close editor" disabled={pending} onClick={requestClose}><X size={22} /></button></header>
    <form className={styles.dialogBody} onSubmit={submit} data-unsaved={dirty}>
      <fieldset className={styles.taskFields} disabled={pending || Boolean(exitTarget)}>
        {!creating ? <label className={styles.confirmation}><input type="checkbox" checked={showCancelled} disabled={dirty} onChange={event => { setShowCancelled(event.target.checked); if (!event.target.checked && enrolment?.cancellation) setSelectedId(snapshot.enrolments.find(row => !row.cancellation)?.id ?? ""); }} />Show cancelled enrolments</label> : null}
        <label>{creating ? "Teaching offering / cohort" : "Module enrolment"}<select value={selectedId} disabled={dirty} onChange={event => { setSelectedId(event.target.value); setError(""); }}>{creating ? <><option value="">Choose a teaching offering</option>{snapshot.offerings.map(row => <option key={row.id} value={row.id}>{row.label}{row.ready ? "" : " — plan needs review"}</option>)}</> : <><option value="">Choose a module enrolment</option>{visibleEnrolments.map(row => <option key={row.id} value={row.id}>{row.offering.label}{row.cancellation ? " — Added in error (cancelled)" : ""}</option>)}</>}</select></label>
        {!creating && !enrolment?.cancellation ? <label>Action<select value={task} disabled={dirty} onChange={event => { setTask(event.target.value); setError(""); }}><option value="requirements">Attendance / presentation requirements</option><option value="defer">Defer module teaching</option><option value="abandon">Mark module abandoned</option><option value="resume">Resume module</option><option value="cancel">Added in error — cancel enrolment</option></select></label> : null}
        {dirty ? <p className={styles.muted}>Save or discard this draft before choosing a different enrolment or action.</p> : null}
        <div key={`${selectedId}:${task}`} className={styles.taskFields} onChange={markDirty}>
          {enrolment?.cancellation ? <div className={styles.notice}><strong>Added in error — cancelled</strong><p>{enrolment.cancellation.reason}</p><p>Recorded by {enrolment.cancellation.actorName} · {new Date(enrolment.cancellation.createdAt).toLocaleString("en-GB")}</p><p>This enrolment and its history are retained read-only. It is excluded from normal module lists and calculations. It cannot be resumed or added again through this editor.</p></div> : creating ? <p className={styles.notice}>Add a teaching enrolment in the selected cohort. An assessment-only resit stays on the original enrolment: use Add exam score or Schedule resit instead. This does not record attendance, create fees or change the student’s lifecycle.</p> : enrolment?.assessment ? <p>Current outcome: <strong>{enrolment.assessment.effective_status}</strong> · Module participation: {enrolment.assessment.disposition ?? "Not deferred or abandoned"}<br />Calculated term attendance: {enrolment.assessment.attendance_actual} / {enrolment.assessment.attendance_required} days.</p> : enrolment ? <p className={styles.notice}>This legacy enrolment needs review through Course configuration before its requirements or participation can be edited.</p> : null}
          {enrolment?.cancellation ? null : task === "cancel" && !creating ? <>
            <p className={styles.notice}>Use only for an enrolment created by mistake, not a genuine withdrawal. No records will be deleted. This enrolment will be excluded from normal module lists, assessment queues, credits, attendance requirements and academic exports. Other module requirements will be recalculated. Existing finance and shared attendance will not be changed.</p>
            {enrolment?.cancellationReasons.length ? <div className={styles.notice}><strong>Cancellation requires separate review.</strong><ul>{enrolment.cancellationReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>{enrolment.assessment?.overrides.length ? <div aria-label="Active cancellation blockers"><strong>Active exceptional decisions</strong><ul>{enrolment.assessment.overrides.map(decision => <li key={`${decision.kind}-${decision.indicator}`}>{decision.kind === "status" ? "Outcome" : decision.kind === "credits" ? "Credits" : `Warning flag: ${decision.indicator}`}: {typeof decision.value === "boolean" ? decision.value ? "Show flag" : "Suppress flag" : decision.value} — {decision.reason}</li>)}</ul><p>To resolve: close this dialog, open this module’s View results → Exceptional decision, select the decision above and choose Restore automatic calculation. Save with a reason, then reopen Manage enrolment. Repeat for each active decision.</p><p>Clearing a decision preserves its history. Other evidence, including previously awarded credits, can still block cancellation.</p></div> : null}<p>Do not delete results or teaching, attendance or finance evidence to bypass safeguards. Use abandon only for a genuine withdrawal.</p></div> : enrolment ? <label className={styles.confirmation}><input type="checkbox" name="confirmed" required />I confirm {enrolment.offering.label} was added to {studentName} by mistake. Cancel it and retain its audit history.</label> : null}
          </> : creating || task === "requirements" ? <>
            <p className={styles.notice}>These are individual completion requirements, not outcome or warning-flag overrides. Changes can affect this student’s other practical modules. Exam scores and exceptional decisions are preserved. Assessment scheme, weighting and pass marks belong in Course configuration.</p>
            {practical ? <><p className={styles.muted}>Offering defaults: {offering?.firstDays} days for the first practical module; {offering?.subsequentDays} for subsequent modules. Presentation {offering?.presentationRequired ? "required" : "not required"}. Attendance is calculated across practical enrolments; this field is not the whole-term total.</p><label>Attendance days exception<input type="number" name="days" min={0} max={2147483647} step={1} defaultValue={creating ? "" : enrolment?.attendanceDays ?? ""} placeholder="Inherit offering requirements" /></label><p className={styles.muted}>Leave blank to inherit; 0 explicitly removes this enrolment’s attendance-day contribution.</p><label>Presentation requirement<select name="presentation" defaultValue={creating || enrolment?.presentationRequired === null ? "inherit" : String(enrolment?.presentationRequired)}><option value="inherit">Inherit offering requirement</option><option value="true">Required for this student</option><option value="false">Not required for this student</option></select></label></> : <p className={styles.muted}>Online modules have no practical attendance or presentation requirement. Saving uses inherited requirements.</p>}
          </> : <p className={styles.notice}>{task === "resume" ? "Clear the module teaching deferral or abandonment. The outcome will be calculated from existing evidence; this does not guarantee Pass." : "This changes module teaching participation, not an assessment sitting or the student’s overall lifecycle. Existing results and exceptional decisions remain."} Shared attendance requirements for other practical modules will be recalculated.</p>}
          {creating && offering && !offering.ready ? <p className={styles.notice}>Review this module’s assessment plan in Course configuration first.</p> : null}
          {!offering ? <p className={styles.empty}>{creating ? snapshot.offerings.length ? "Choose a teaching offering to continue." : "No other teaching offerings are available." : "No module enrolments yet."}</p> : null}
          {!blocked ? <label>Reason<textarea name="reason" maxLength={4000} required /></label> : null}
        </div>
      </fieldset>
      {error ? <p role="alert" className={styles.notice}>{error} Your entries have been kept. Discard and reopen to review newer records.</p> : null}
      {exitTarget ? <div role="alert" className={styles.notice}><strong>Discard unsaved changes?</strong><p>Your entries have not been saved.</p><div className={styles.toolbar}><button type="button" ref={keepEditing} className={styles.button} onClick={() => setExitTarget(null)}>Keep editing</button><button type="button" className={styles.button} onClick={discard}>Discard changes</button></div></div> : <footer className={styles.toolbar}><button type="submit" className={styles.primaryButton} disabled={pending || blocked}>{pending ? "Saving…" : "Save changes"}</button><button type="button" className={styles.button} disabled={pending} onClick={requestClose}>Cancel</button></footer>}
    </form>
  </dialog>;
}

export function StudentEnrolmentActions({ studentId, studentName }: { studentId: string; studentName: string }) {
  const [task, setTask] = useState<{ workspace: EnrolmentWorkspace; creating: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  async function open(creating: boolean) {
    setLoading(true); setMessage("");
    try { const result = await loadWorkspaceEnrolments(studentId); if (result.ok) setTask({ workspace: result.workspace, creating }); else setMessage(result.error); }
    catch { setMessage("Enrolments could not be loaded. Please try again."); }
    finally { setLoading(false); }
  }
  return <><div className={styles.toolbar}><button className={styles.button} disabled={loading} onClick={() => open(true)}>Add enrolment</button><button className={styles.button} disabled={loading} onClick={() => open(false)}>Manage enrolment</button>{loading ? <span role="status">Loading current enrolments…</span> : null}</div>{message ? <p role="status" className={styles.notice}>{message}</p> : null}{task ? <EnrolmentDialog {...task} studentId={studentId} studentName={studentName} close={() => setTask(null)} saved={value => { setTask(null); setMessage(value); }} /> : null}</>;
}
