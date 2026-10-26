"use client";

import { useId, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTaskDialogGuard } from "@/components/use-task-dialog-guard";
import type { TeachingPlanOptions } from "@/lib/teaching-plans";
import { loadTeachingPlans, saveTeachingPlan } from "./plan-actions";
import styles from "@/components/student-workspace.module.css";

function PlanDialog({ studentId, offeringId, options, close, saved }: { studentId: string; offeringId: string; options: TeachingPlanOptions; close: () => void; saved: (message: string) => void }) {
  const [kind, setKind] = useState("attendance");
  const [operation, setOperation] = useState("plan");
  const [error, setError] = useState("");
  const title = useId();
  const router = useRouter();
  const { dialog, keepEditing, dirtyRef, pendingRef, dirty, pending, setPending, exitTarget, setExitTarget, requestClose, discard, markDirty } = useTaskDialogGuard(close);
  const offering = options.offerings.find(candidate => candidate.id === offeringId)!;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const sessions = options.sessions.filter(session => session.termId === offering.termId);
  const expected = sessions.filter(session => session.expected && !session.hasRecord);
  const future = sessions.filter(session => session.date >= today && (kind === "presentation" || !session.hasRecord));
  const label = (session: TeachingPlanOptions["sessions"][number]) => `${session.date} · ${session.startsAt.slice(0, 5)}–${session.endsAt.slice(0, 5)} · ${session.location}`;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pendingRef.current) return;
    const fields = new FormData(event.currentTarget);
    pendingRef.current = true; setPending(true); setError("");
    try {
      const result = await saveTeachingPlan({ studentId, offeringId, token: options.token, kind, expected: kind === "presentation" || operation !== "cancel",
        sessionId: kind === "presentation" && operation === "cancel" ? null : String(fields.get("sessionId")), fromSessionId: kind === "attendance" && operation === "move" ? String(fields.get("fromSessionId")) : null });
      if (!result.ok) { setError(result.error ?? "Save could not be confirmed."); return; }
      dirtyRef.current = false; saved(result.message!); router.refresh();
    } catch { setError("Save could not be confirmed. Your draft is kept; review current plans before retrying."); }
    finally { pendingRef.current = false; setPending(false); }
  }
  return <dialog ref={dialog} className={`${styles.dialog} ${styles.teachingDialog}`} aria-labelledby={title} onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className={styles.dialogHeader}><h2 id={title}>Plan teaching dates</h2><button className={styles.button} disabled={pending} onClick={requestClose}>Close</button></header>
    <form className={styles.dialogBody} onSubmit={submit}>
      <fieldset className={styles.taskFields} disabled={pending || Boolean(exitTarget)}>
        <p>{offering.label}</p><p className={styles.notice}>Attendance is term-wide. Presentation plans belong to this module. Planning one does not plan the other or record completed attendance. Administrators manage the calendar.</p>
        <label>Plan type<select aria-label="Plan type" value={kind} disabled={dirty} onChange={event => { setKind(event.target.value); setOperation("plan"); }}><option value="attendance">Attendance</option>{offering.canPresent ? <option value="presentation">Presentation</option> : null}</select></label>
        {kind === "presentation" && offering.plannedSessionId ? <p>Currently planned: {sessions.find(session => session.id === offering.plannedSessionId)?.date ?? "Calendar date unavailable"}</p> : null}
        <label>Action<select aria-label="Action" value={operation} disabled={dirty} onChange={event => setOperation(event.target.value)}><option value="plan">{kind === "presentation" && offering.plannedSessionId ? "Move presentation plan" : "Plan a date"}</option>{kind === "attendance" && expected.length ? <option value="move">Move attendance plan</option> : null}{(kind === "attendance" ? expected.length > 0 : Boolean(offering.plannedSessionId)) ? <option value="cancel">Cancel plan</option> : null}</select></label>
        <div className={styles.taskFields} key={`${kind}:${operation}`} onChange={markDirty}>
          {operation === "move" ? <label>Move from<select aria-label="Move from" name="fromSessionId" defaultValue="" required><option value="">Choose planned attendance</option>{expected.map(session => <option key={session.id} value={session.id}>{label(session)}</option>)}</select></label> : null}
          {kind !== "presentation" || operation !== "cancel" ? <label>{operation === "cancel" ? "Cancel date" : "Teaching date"}<select aria-label={operation === "cancel" ? "Cancel date" : "Teaching date"} name="sessionId" defaultValue="" required><option value="">Choose a calendar date</option>{(operation === "cancel" ? expected : future).map(session => <option key={session.id} value={session.id}>{label(session)}{session.expected ? " · Attendance planned" : ""}</option>)}</select></label> : <p>Cancel this module’s presentation plan only. Attendance expectations remain unchanged.</p>}
        </div>
        {!future.length && operation !== "cancel" ? <p>No available future teaching dates. Ask an administrator to update the calendar.</p> : null}
      </fieldset>
      {error ? <p className={styles.notice} role="alert">{error} Your draft has been kept.</p> : null}
      {exitTarget ? <div className={styles.notice} role="alert"><p>Discard unsaved changes?</p><button type="button" ref={keepEditing} className={styles.button} onClick={() => setExitTarget(null)}>Keep editing</button><button type="button" className={styles.button} onClick={discard}>Discard changes</button></div> : <footer className={styles.toolbar}><button className={styles.primaryButton} disabled={pending}>{pending ? "Saving…" : "Save plan"}</button><button type="button" className={styles.button} disabled={pending} onClick={requestClose}>Cancel</button></footer>}
    </form>
  </dialog>;
}

export function CompanionPlanning({ studentId, offeringId }: { studentId: string; offeringId: string }) {
  const [options, setOptions] = useState<TeachingPlanOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  async function open() {
    setLoading(true); setMessage("");
    try {
      const result = await loadTeachingPlans(studentId);
      if (!result.ok) setMessage(result.error);
      else if (!result.options.offerings.some(offering => offering.id === offeringId)) setMessage("This enrolment is no longer eligible for plans. Refresh to review.");
      else setOptions(result.options);
    } catch { setMessage("Planning options could not be loaded."); }
    finally { setLoading(false); }
  }
  return <><button type="button" style={{ minHeight: 44, fontSize: 16 }} disabled={loading} onClick={open}>Plan teaching dates</button>{message ? <p role="status">{message}</p> : null}{options ? createPortal(<PlanDialog studentId={studentId} offeringId={offeringId} options={options} close={() => setOptions(null)} saved={value => { setOptions(null); setMessage(value); }} />, document.body) : null}</>;
}
