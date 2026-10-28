"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, X } from "lucide-react";
import { createWorkspaceSession, saveWorkspaceAttendance } from "@/app/students/attendance-actions";
import { formatAttendanceTimestamp, workspaceAttendanceLabels, workspaceAttendanceStatuses } from "@/lib/student-attendance";
import type { WorkspaceAttendance } from "@/lib/student-workspace";
import { useTaskDialogGuard } from "./use-task-dialog-guard";
import styles from "./student-workspace.module.css";

type Term = { id: string; name: string };
type AttendanceTask = { kind: "attendance"; record: WorkspaceAttendance } | { kind: "session"; term: Term };
const displayDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const displayTime = formatAttendanceTimestamp;

function AttendanceTaskDialog({ task, studentId, studentName, close, saved }: {
  task: AttendanceTask; studentId: string; studentName: string; close: () => void; saved: (message: string, attendance?: WorkspaceAttendance) => void;
}) {
  const [snapshot] = useState(task);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState(snapshot.kind === "attendance" ? snapshot.record.status : "not_recorded");
  const [error, setError] = useState("");
  const { dialog, keepEditing, dirtyRef, pendingRef, dirty, pending, setPending, exitTarget, setExitTarget, requestClose, discard, markDirty } = useTaskDialogGuard(close);
  const titleId = useId();
  const noteId = useId();
  const router = useRouter();
  const title = snapshot.kind === "attendance" ? "Edit attendance" : "Add session to this term";
  const clearing = snapshot.kind === "attendance" && snapshot.record.hasRecord && ["not_recorded", "expected"].includes(status);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    const fields = new FormData(event.currentTarget);
    const reason = String(fields.get("reason") ?? "");
    pendingRef.current = true; setPending(true); setError("");
    try {
      const result = snapshot.kind === "attendance" ? await saveWorkspaceAttendance({
        studentId, sessionId: snapshot.record.id, expectedRevision: snapshot.record.revision, expectedSessionRevision: snapshot.record.sessionRevision,
        status, expected: fields.get("expected") === "on", note: String(fields.get("note") ?? "").trim() || null, reason, confirmClear: fields.get("confirmClear") === "on"
      }) : await createWorkspaceSession({ studentId, sessionId, termId: snapshot.term.id, date: String(fields.get("date")), startsAt: String(fields.get("startsAt")), endsAt: String(fields.get("endsAt")), location: String(fields.get("location")), reason });
      if (!result.ok) { setError(result.error); return; }
      dirtyRef.current = false; saved(result.message, result.attendance); router.refresh();
    } catch { setError("The save could not be confirmed. Your entries have been kept. Review the saved records before retrying."); }
    finally { pendingRef.current = false; setPending(false); }
  }
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className={styles.dialogHeader}><div><p>{snapshot.kind === "attendance" ? studentName : snapshot.term.name}</p><h2 id={titleId}>{title}</h2></div><button className={styles.iconButton} type="button" disabled={pending} onClick={requestClose} aria-label="Close editor"><X size={22} /></button></header>
    <form className={styles.dialogBody} onSubmit={submit} onChange={markDirty} data-unsaved={dirty}>
      <fieldset className={styles.taskFields} disabled={pending || Boolean(exitTarget)}>
        {snapshot.kind === "attendance" ? <>
          <p><strong>{displayDate(snapshot.record.date)} · {snapshot.record.startsAt.slice(0, 5)}–{snapshot.record.endsAt.slice(0, 5)}</strong><br />{snapshot.record.term} · {snapshot.record.location}</p>
          <p className={styles.notice}>This changes only this student’s attendance. It may change outcomes and credits for several modules in the term; it does not change exam scores or exceptional decisions.</p>
          <label>Attendance status<select value={status} onChange={event => setStatus(event.target.value as typeof status)}>{workspaceAttendanceStatuses.map(value => <option key={value} value={value}>{workspaceAttendanceLabels[value]}</option>)}</select></label>
          {["attended", "partial"].includes(status) ? <label className={styles.confirmation}><input name="expected" type="checkbox" defaultChecked={snapshot.record.expected} />Also keep this student on the expected list</label> : <p className={styles.muted}>{status === "not_recorded" ? "No attendance record and not on the expected list." : status === "expected" ? "On the expected list, but no attendance has been recorded." : "Missed attendance also keeps this student on the expected list."}</p>}
          <div className={styles.taskField}><label htmlFor={noteId}>Attendance note</label><textarea id={noteId} name="note" defaultValue={snapshot.record.note ?? ""} maxLength={500} disabled={["not_recorded", "expected"].includes(status)} /></div>
          {snapshot.record.checkedInAt || snapshot.record.checkedOutAt ? <p>Reception evidence (London time):<br />Checked in: {snapshot.record.checkedInAt ? displayTime(snapshot.record.checkedInAt) : "Not recorded"}<br />Checked out: {snapshot.record.checkedOutAt ? displayTime(snapshot.record.checkedOutAt) : "Not recorded"}<br />Status corrections retain these timestamps; they do not invent new check-in/out times.</p> : null}
          {clearing ? <label className={styles.confirmation}><input type="checkbox" name="confirmClear" required />Clear this recorded attendance, note and check-in/out details from the current register. The previous values remain in the administrator audit history.</label> : null}
        </> : <>
          <p className={styles.notice}>This is a shared teaching session for <strong>{snapshot.term.name}</strong>, visible in the term register and relevant student profiles. It is not a private student date. Nobody is marked expected or attending automatically.</p>
          <label>Date<input type="date" name="date" required /></label>
          <div className={styles.profileGroup}><label>Start time<input type="time" name="startsAt" defaultValue="09:00" required /></label><label>End time<input type="time" name="endsAt" defaultValue="17:00" required /></label></div>
          <label>Location<input name="location" minLength={2} maxLength={160} required /></label>
          <p className={styles.muted}>After saving, record this student’s attendance separately. Edit or delete shared sessions through the term register.</p>
        </>}
        <label>Reason<textarea name="reason" maxLength={4000} required /></label>
      </fieldset>
      {error ? <div role="alert" className={styles.notice}><p>{error}</p><p>Your entries have been kept. Discard and reopen to review newer attendance or session details.</p></div> : null}
      {exitTarget ? <div role="alert" className={styles.notice}><strong>Discard unsaved changes?</strong><p>Your entries have not been saved.</p><div className={styles.toolbar}><button type="button" ref={keepEditing} className={styles.button} onClick={() => { setExitTarget(null); requestAnimationFrame(() => dialog.current?.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')?.focus()); }}>Keep editing</button><button type="button" className={styles.button} onClick={discard}>Discard changes</button></div></div> : <footer className={styles.toolbar}><button type="submit" className={styles.primaryButton} disabled={pending}>{pending ? "Saving…" : "Save changes"}</button><button type="button" className={styles.button} disabled={pending} onClick={requestClose}>Cancel</button></footer>}
    </form>
  </dialog>;
}

export function StudentAttendanceSection({ studentId, studentName, records, terms, sessionTerms, canEdit }: {
  studentId: string; studentName: string; records: WorkspaceAttendance[]; terms: Term[]; sessionTerms: Term[]; canEdit: boolean;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const term = params.get("term") ?? "all";
  const [task, setTask] = useState<AttendanceTask | null>(null);
  const [message, setMessage] = useState("");
  const [savedRecords, setSavedRecords] = useState<Record<string, WorkspaceAttendance>>({});
  const rows = records.map(record => {
    const saved = savedRecords[record.id];
    return saved && (saved.revision ?? -1) >= (record.revision ?? 0) && (saved.sessionRevision ?? -1) >= (record.sessionRevision ?? 0) ? saved : record;
  }).filter(record => term === "all" || record.termId === term);
  const selectedTerm = sessionTerms.find(candidate => candidate.id === term);
  return <section className={styles.panel}>
    <div className={styles.sectionHeading}><div><h2>Attendance</h2><p className={styles.muted}>Teaching sessions are shared across the term; attendance belongs to this student.</p></div></div>
    {message ? <p className={styles.notice} role="status">{message}</p> : null}
    <div className={styles.filters}><label>Term<select value={term} onChange={event => { const query = new URLSearchParams(window.location.search); query.set("term", event.target.value); window.history.replaceState(null, "", `${pathname}?${query}`); }}><option value="all">All enrolled terms</option>{terms.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
      {canEdit ? <><Link className={styles.button} href={`/attendance?mode=edit${term === "all" ? "" : `&term=${encodeURIComponent(term)}`}`}>Open term register <ArrowUpRight size={15} /></Link><button className={styles.button} disabled={!selectedTerm} onClick={() => { if (selectedTerm) setTask({ kind: "session", term: selectedTerm }); }}>Add session to this term</button></> : null}
    </div>
    {canEdit && !selectedTerm ? <p className={styles.muted}>Select a term with a participating module enrolment to add a shared session.</p> : null}
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Student attendance"><table className={styles.table}><thead><tr><th>Session</th><th>Term / location</th><th>Attendance</th><th>Note</th>{canEdit ? <th>Action</th> : null}</tr></thead><tbody>{rows.map(record => <tr key={record.id}>
      <td><strong>{displayDate(record.date)}</strong><small>{record.startsAt.slice(0, 5)}–{record.endsAt.slice(0, 5)}</small></td><td>{record.term}<small>{record.location}</small></td>
      <td><span className={`${styles.badge} ${record.status === "attended" ? styles.good : record.status === "missed" ? styles.bad : styles.neutral}`}>{workspaceAttendanceLabels[record.status]}</span>{record.checkedInAt ? <small>Checked in {displayTime(record.checkedInAt)}</small> : null}{record.checkedOutAt ? <small>Checked out {displayTime(record.checkedOutAt)}</small> : null}</td><td>{record.note || "—"}</td>
      {canEdit ? <td>{record.canEdit && record.revision !== undefined ? <button className={styles.button} onClick={() => setTask({ kind: "attendance", record })} aria-label={`Edit attendance for ${record.date} at ${record.startsAt.slice(0, 5)}`}>Edit attendance</button> : <span className={styles.muted}>Review in term register</span>}</td> : null}
    </tr>)}</tbody></table></div>
    {!rows.length ? <p className={styles.empty}>No teaching sessions for this selection.</p> : null}
    {task && canEdit ? <AttendanceTaskDialog task={task} studentId={studentId} studentName={studentName} close={() => setTask(null)} saved={(value, attendance) => { if (attendance) setSavedRecords(current => ({ ...current, [attendance.id]: attendance })); setTask(null); setMessage(value); }} /> : null}
  </section>;
}
