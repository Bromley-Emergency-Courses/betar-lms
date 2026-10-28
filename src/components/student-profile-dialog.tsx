"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { Student } from "@/lib/types";
import { admissionStages, studentStatuses } from "@/lib/student-details";
import { saveWorkspaceStudent } from "@/app/students/workspace-actions";
import { useTaskDialogGuard } from "./use-task-dialog-guard";
import styles from "./student-workspace.module.css";

export function StudentProfileDialog({ student, terms, close, saved }: {
  student: Student; terms: Array<{ id: string; name: string }>; close: () => void; saved: (message: string) => void;
}) {
  const [snapshot] = useState(student);
  const [error, setError] = useState("");
  const { dialog, keepEditing, dirtyRef, pendingRef, dirty, pending, setPending, exitTarget, setExitTarget, requestClose, discard, markDirty } = useTaskDialogGuard(close);
  const titleId = useId();
  const notesId = useId();
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    const fields = new FormData(event.currentTarget);
    const details = Object.fromEntries(Array.from(fields.entries(), ([key, value]) => [key, String(value).trim()]));
    const nullable = Object.fromEntries(["cccu_student_id", "phone", "start_term_id", "notes"].map(key => [key, details[key] || null]));
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const result = await saveWorkspaceStudent({ studentId: snapshot.id, expectedRevision: snapshot.profileRevision, details: { ...details, ...nullable } });
      if (!result.ok) { setError(result.error); return; }
      dirtyRef.current = false;
      saved(result.message);
      router.refresh();
    } catch {
      setError("The save could not be confirmed. Your entries have been kept. Review the saved record before retrying.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className={styles.dialogHeader}><div><p>{snapshot.firstName} {snapshot.lastName} · {snapshot.cccuStudentId || snapshot.temporaryId}</p><h2 id={titleId}>Edit student details</h2></div><button type="button" className={styles.iconButton} onClick={requestClose} disabled={pending} aria-label="Close editor"><X size={22} /></button></header>
    <form className={styles.dialogBody} onSubmit={submit} onChange={markDirty} data-unsaved={dirty}>
      <fieldset className={styles.taskFields} disabled={pending || Boolean(exitTarget)}>
        <fieldset className={styles.profileGroup}><legend>Identity</legend>
          <label>First name<input name="first_name" defaultValue={snapshot.firstName} maxLength={80} required /></label>
          <label>Last name<input name="last_name" defaultValue={snapshot.lastName} maxLength={80} required /></label>
          <label>Temporary ID<input name="temporary_id" defaultValue={snapshot.temporaryId} minLength={2} maxLength={80} required /></label>
          <label>CCCU student ID<input name="cccu_student_id" defaultValue={snapshot.cccuStudentId ?? ""} /></label>
        </fieldset>
        <fieldset className={styles.profileGroup}><legend>Contact</legend>
          <label>Email<input name="email" type="email" defaultValue={snapshot.email} required /></label>
          <label>Phone<input name="phone" type="tel" defaultValue={snapshot.phone ?? ""} /></label>
        </fieldset>
        <fieldset className={styles.profileGroup}><legend>Programme & lifecycle</legend>
          <label>Programme<select name="programme" defaultValue={snapshot.programme}><option value="pgcert">PGCert</option><option value="microcredential">Microcredential</option></select></label>
          <label>Start term<select name="start_term_id" defaultValue={snapshot.startTermId ?? ""}><option value="">Not set</option>{terms.map(term => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label>
          <label>Student status<select name="status" defaultValue={snapshot.status}>{studentStatuses.map(status => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</select></label>
          <label>Admission stage<select name="admission_stage" defaultValue={snapshot.admissionStage}>{admissionStages.map(stage => <option key={stage} value={stage}>{stage.replaceAll("_", " ")}</option>)}</select></label>
        </fieldset>
        <p className={styles.muted}>Student lifecycle is separate from module outcomes. This does not change enrolments, assessment plans, scores or credits, and sends no email.</p>
        <div className={styles.taskField}><label htmlFor={notesId}>Notes</label><textarea id={notesId} name="notes" defaultValue={snapshot.notes ?? ""} /></div>
      </fieldset>
      {error ? <div role="alert" className={styles.notice}><p>{error}</p><p>Your entries have been kept. To review newer saved details, cancel and discard this draft, then reopen the editor.</p></div> : null}
      {snapshot.profileRevision === undefined ? <p role="alert">Profile editing is not available until the database migration is applied.</p> : null}
      {exitTarget ? <div className={styles.notice} role="alert"><strong>Discard unsaved changes?</strong><p>Your entries have not been saved.</p><div className={styles.toolbar}><button ref={keepEditing} type="button" className={styles.button} onClick={() => { setExitTarget(null); requestAnimationFrame(() => dialog.current?.querySelector<HTMLInputElement>('input[name="first_name"]')?.focus()); }}>Keep editing</button><button type="button" className={styles.button} onClick={discard}>Discard changes</button></div></div> : <footer className={styles.toolbar}><button className={styles.primaryButton} type="submit" disabled={pending || snapshot.profileRevision === undefined}>{pending ? "Saving…" : "Save changes"}</button><button className={styles.button} type="button" onClick={requestClose} disabled={pending}>Cancel</button></footer>}
    </form>
  </dialog>;
}
