"use client";

import Image from "next/image";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { saveWorkspacePhoto } from "@/app/students/photo-actions";
import { validateStudentPhoto, type PhotoSnapshot } from "@/lib/student-photo";
import { useTaskDialogGuard } from "./use-task-dialog-guard";
import styles from "./student-workspace.module.css";

export function StudentPhotoDialog({ studentId, studentName, snapshot, close, saved }: {
  studentId: string; studentName: string; snapshot: PhotoSnapshot; close: () => void; saved: (message: string) => void;
}) {
  const [initial] = useState(snapshot);
  const [selection, setSelection] = useState<{ file: File; url: string } | null>(null);
  const [remove, setRemove] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId(); const router = useRouter();
  const { dialog, keepEditing, dirtyRef, pendingRef, dirty, pending, setPending, exitTarget, setExitTarget, requestClose, discard, markDirty } = useTaskDialogGuard(close);
  useEffect(() => () => { if (selection) URL.revokeObjectURL(selection.url); }, [selection]);
  function choose(file?: File) {
    if (!file) return;
    markDirty(); setError(""); setPreviewReady(false); setSelection(null);
    try { validateStudentPhoto(file); setSelection({ file, url: URL.createObjectURL(file) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Choose a supported photo."); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || (!remove && (!selection || !previewReady))) return;
    const fields = new FormData(); fields.set("student_id", studentId); fields.set("expected_revision", String(initial.revision));
    fields.set("operation", remove ? "remove" : "upload"); fields.set("confirm_remove", remove ? "yes" : "no");
    if (!remove && selection) fields.set("photo", selection.file);
    pendingRef.current = true; setPending(true); setError("");
    try {
      const result = await saveWorkspacePhoto(fields);
      if (!result.ok) { setError(result.error); return; }
      dirtyRef.current = false; saved(result.message); router.refresh();
    } catch { setError("The photo change could not be confirmed. Your selection is kept. Reopen the editor to review the saved photo before retrying."); }
    finally { pendingRef.current = false; setPending(false); }
  }
  const preview = !remove && (selection?.url ?? (initial.hasPhoto ? `/api/students/${studentId}/photo?v=${initial.revision}` : null));
  return <dialog ref={dialog} className={`${styles.dialog} ${styles.photoDialog}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className={styles.dialogHeader}><h2 id={titleId}>Manage profile photo</h2><button type="button" className={styles.iconButton} onClick={requestClose} disabled={pending} aria-label="Close editor"><X size={22} /></button></header>
    <form className={styles.dialogBody} data-unsaved={dirty} onSubmit={submit}>
      <fieldset className={styles.taskFields} disabled={pending || Boolean(exitTarget)}>
        <p>{studentName} · Private student photo</p>
        {preview ? <div className={styles.photoPreview}><Image key={preview} src={preview} alt={selection ? "Selected photo preview" : "Current profile photo"} width={240} height={240} unoptimized onLoad={() => { if (selection) setPreviewReady(true); }} onError={() => { setPreviewReady(false); setError("This photo could not be displayed. Choose a valid image before uploading."); }} /></div> : <p className={styles.notice}>{remove ? "The current profile photo will be removed. Initials will appear instead." : "No profile photo yet. Initials are currently displayed."}</p>}
        <label>Choose photo (PNG, JPG or WEBP)<input name="photo" type="file" accept="image/png,image/jpeg,image/webp" disabled={remove} onChange={event => choose(event.target.files?.[0])} /></label>
        <p className={styles.muted}>Maximum 10MB. The preview is not saved until you choose Save photo. Photos remain in private storage and are served only to permitted signed-in staff.</p>
        {initial.hasPhoto ? <label className={styles.confirmation}><input type="checkbox" checked={remove} onChange={event => { setRemove(event.target.checked); markDirty(); setError(""); }} />Remove current photo and use initials instead</label> : null}
      </fieldset>
      {error ? <p role="alert" className={styles.notice}>{error}</p> : null}
      {exitTarget ? <div role="alert" className={styles.notice}><strong>Discard unsaved changes?</strong><p>Your photo selection has not been saved.</p><div className={styles.toolbar}><button type="button" ref={keepEditing} className={styles.button} onClick={() => setExitTarget(null)}>Keep editing</button><button type="button" className={styles.button} onClick={discard}>Discard changes</button></div></div> : <footer className={styles.toolbar}><button type="submit" className={styles.primaryButton} disabled={pending || (!remove && (!selection || !previewReady))}>{pending ? "Saving…" : remove ? "Remove photo" : "Save photo"}</button><button type="button" className={styles.button} disabled={pending} onClick={requestClose}>Cancel</button></footer>}
    </form>
  </dialog>;
}
