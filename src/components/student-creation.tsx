"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { admissionStages, studentStatuses } from "@/lib/student-details";
import { createWorkspaceStudent } from "@/app/students/creation-actions";
import { useTaskDialogGuard } from "./use-task-dialog-guard";
import styles from "./student-workspace.module.css";

function CreationDialog({ terms, close }: { terms: Array<{ id: string; name: string }>; close: () => void }) {
  const [studentId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const titleId = useId(); const notesId = useId(); const router = useRouter();
  const { dialog, keepEditing, dirtyRef, pendingRef, dirty, pending, setPending, exitTarget, setExitTarget, requestClose, discard, markDirty } = useTaskDialogGuard(close);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pendingRef.current) return;
    const fields = new FormData(event.currentTarget);
    const details = Object.fromEntries(Array.from(fields.entries(), ([key, value]) => [key, String(value).trim()]));
    const nullable = Object.fromEntries(["temporary_id","cccu_student_id","phone","start_term_id","notes"].map(key => [key, details[key] || null]));
    pendingRef.current = true; setPending(true); setError("");
    try {
      const result = await createWorkspaceStudent({ studentId, details: { ...details, ...nullable } });
      if (!result.ok) { setError(result.error); return; }
      const query = new URLSearchParams(window.location.search); query.delete("mode");
      const returnTo = `/students${query.size ? `?${query}` : ""}`;
      dirtyRef.current = false; pendingRef.current = false;
      close(); router.push(`/students/${result.studentId}?returnTo=${encodeURIComponent(returnTo)}`);
    } catch { setError("Creation could not be confirmed. Your entries are kept; retry this unchanged draft to safely recover the saved record."); }
    finally { pendingRef.current = false; setPending(false); }
  }
  return <dialog ref={dialog} className={`${styles.dialog} ${styles.creationDialog}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className={styles.dialogHeader}><h2 id={titleId}>Add student or prospect</h2><button type="button" className={styles.iconButton} aria-label="Close editor" onClick={requestClose} disabled={pending}><X size={22} /></button></header>
    <form className={styles.dialogBody} onSubmit={submit} onChange={markDirty} data-unsaved={dirty}>
      <fieldset className={styles.taskFields} disabled={pending || Boolean(exitTarget)}>
        <p className={styles.notice}>Create a student record only. This does not send an invitation, create a portal account, enrol the student on modules or generate fees.</p>
        <fieldset className={styles.profileGroup}><legend>Identity & contact</legend>
          <label>First name<input name="first_name" maxLength={80} required /></label><label>Last name<input name="last_name" maxLength={80} required /></label>
          <label>Email<input name="email" type="email" required /></label><label>Phone<input name="phone" maxLength={100} /></label>
          <label>Temporary ID<input name="temporary_id" minLength={2} maxLength={80} placeholder="Auto-generated if blank" /></label><label>CCCU student ID<input name="cccu_student_id" maxLength={80} /></label>
        </fieldset>
        <fieldset className={styles.profileGroup}><legend>Programme & lifecycle</legend>
          <label>Programme<select name="programme" defaultValue="pgcert"><option value="pgcert">PGCert</option><option value="microcredential">Microcredential</option></select></label>
          <label>Start term<select name="start_term_id" defaultValue=""><option value="">Not set</option>{terms.map(term => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label>
          <label>Student status<select name="status" defaultValue="prospect">{studentStatuses.map(status => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</select></label>
          <label>Admission stage<select name="admission_stage" defaultValue="interest">{admissionStages.map(stage => <option key={stage} value={stage}>{stage.replaceAll("_"," ")}</option>)}</select></label>
        </fieldset>
        <div className={styles.taskField}><label htmlFor={notesId}>Notes</label><textarea id={notesId} name="notes" maxLength={10000} /></div>
        <p className={styles.muted}>A start term records programme context; it does not create a teaching enrolment. Photos and modules can be added from the saved student workspace.</p>
      </fieldset>
      {error ? <p className={styles.notice} role="alert">{error}</p> : null}
      {exitTarget ? <div className={styles.notice} role="alert"><strong>Discard unsaved changes?</strong><p>This draft will be lost.</p><div className={styles.toolbar}><button ref={keepEditing} type="button" className={styles.button} onClick={() => setExitTarget(null)}>Keep editing</button><button type="button" className={styles.button} onClick={discard}>Discard changes</button></div></div> : <footer className={styles.toolbar}><button type="submit" className={styles.primaryButton} disabled={pending}>{pending ? "Creating…" : "Create student"}</button><button type="button" className={styles.button} disabled={pending} onClick={requestClose}>Cancel</button></footer>}
    </form>
  </dialog>;
}

export function StudentCreation({ terms, initiallyOpen }: { terms: Array<{ id: string; name: string }>; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  function close() {
    setOpen(false);
    const query = new URLSearchParams(window.location.search);
    if (query.get("mode") === "add") { query.delete("mode"); window.history.replaceState(null,"",`/students${query.size ? `?${query}` : ""}`); }
  }
  return <><button className="button primary" onClick={() => setOpen(true)}><Plus size={16} />Add student / prospect</button>{open ? <div className={styles.workspace}><CreationDialog terms={terms} close={close} /></div> : null}</>;
}
