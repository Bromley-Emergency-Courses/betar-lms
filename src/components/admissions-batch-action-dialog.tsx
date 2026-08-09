"use client";

import { ArchiveX, MailPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "@/components/admissions-workspace.module.css";
import {
  batchScopeForSelection,
  type AdmissionsBatchPreview,
  type ImplementedNewStudentBatchAction
} from "@/lib/admissions-batch-review";

interface AdmissionsBatchActionDialogProps {
  selectedIds: string[];
  allMatching: boolean;
  total: number;
  filters: { search: string; attention: string; stage: string };
}

const actionContent = {
  invite_application: {
    title: "Invite applicants",
    description: "Issue or replace application access and deliberately attempt one email per eligible applicant.",
    confirm: "Queue invitation batch"
  },
  close_abandoned: {
    title: "Close as abandoned",
    description: "Close eligible enquiries and unsubmitted applications without archiving or deleting them.",
    confirm: "Queue abandonment batch"
  }
} satisfies Record<ImplementedNewStudentBatchAction, { title: string; description: string; confirm: string }>;

export function AdmissionsBatchActionDialog({ selectedIds, allMatching, total, filters }: AdmissionsBatchActionDialogProps) {
  const router = useRouter();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [action, setAction] = useState<ImplementedNewStudentBatchAction | null>(null);
  const [preview, setPreview] = useState<AdmissionsBatchPreview | null>(null);
  const [reason, setReason] = useState("");
  const [subject, setSubject] = useState("Your BETAR application invitation");
  const [body, setBody] = useState("You have been invited to complete your BETAR application.\n\nUse this secure link to sign in and continue:\n{{action_link}}\n\nRegards,\nBETAR Admissions");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = batchScopeForSelection(allMatching, selectedIds.length);

  useEffect(() => {
    if (!action) return;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setAction(null);
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (first && last && event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (first && last && !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [action, busy]);

  useEffect(() => {
    if (!action && restoreFocusRef.current) {
      restoreFocusRef.current.focus();
      restoreFocusRef.current = null;
    }
  }, [action]);

  function requestBody(requestKey?: string) {
    return {
      workspace: "new_students",
      action,
      scope,
      selected_ids: allMatching ? [] : selectedIds,
      filters,
      action_reason: action === "close_abandoned" ? reason : null,
      rendered_subject: action === "invite_application" ? subject : null,
      rendered_body: action === "invite_application" ? body : null,
      request_key: requestKey
    };
  }

  function open(nextAction: ImplementedNewStudentBatchAction) {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAction(nextAction);
    setPreview(null);
    setError(null);
    setReason("");
  }

  function close() {
    setAction(null);
    setPreview(null);
    setError(null);
  }

  async function review() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admissions/batches/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody())
      });
      const result = await response.json() as AdmissionsBatchPreview & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The action preview could not be prepared.");
      setPreview(result);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The action preview could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview || !action) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admissions/batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody(crypto.randomUUID()))
      });
      const result = await response.json() as { batchId?: string; error?: string };
      if (!response.ok || !result.batchId) throw new Error(result.error ?? "The operational batch could not be queued.");
      router.push(`/admissions/batches/${result.batchId}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The operational batch could not be queued.");
      setBusy(false);
    }
  }

  const matchingTooLarge = (allMatching ? total : selectedIds.length) > 500;
  const representativeTarget = preview?.targets.find((target) => target.eligible);
  return (
    <>
      <button className={styles.secondaryButton} type="button" onClick={() => open("invite_application")} disabled={matchingTooLarge}>
        <MailPlus size={13} /> Invite to apply
      </button>
      <button className={styles.secondaryButton} type="button" onClick={() => open("close_abandoned")} disabled={matchingTooLarge}>
        <ArchiveX size={13} /> Close as abandoned
      </button>
      {matchingTooLarge ? <span className={styles.selectionLimit}>{allMatching ? "Narrow filters" : "Reduce the explicit selection"} to 500 or fewer records before running this action.</span> : null}

      {action ? (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) close();
        }}>
          <section className={styles.reviewDialog} role="dialog" aria-modal="true" aria-labelledby="batch-review-title" ref={dialogRef}>
            <div className={styles.drawerHeader}>
              <div>
                <h2 id="batch-review-title">{actionContent[action].title}</h2>
                <p>{actionContent[action].description}</p>
              </div>
              <button className={styles.iconButton} type="button" onClick={close} disabled={busy} ref={closeRef} aria-label="Close action review"><X size={16} /></button>
            </div>
            <div className={styles.reviewBody}>
              <div className={styles.reviewScope}>
                <span>Reviewed scope</span>
                <strong>{allMatching ? `All ${total} records matching the visible filters` : `${selectedIds.length} explicitly selected record${selectedIds.length === 1 ? "" : "s"}`}</strong>
              </div>
              {action === "invite_application" ? (
                <div className={styles.reviewFields}>
                  <label><span>Email subject</span><input value={subject} onChange={(event) => { setSubject(event.target.value); setPreview(null); }} maxLength={300} /></label>
                  <label><span>Reviewed message</span><textarea value={body} onChange={(event) => { setBody(event.target.value); setPreview(null); }} rows={8} maxLength={12000} /></label>
                  <p className={styles.dialogHelp}>Keep <code>{"{{action_link}}"}</code> in the message. The secure link is generated only during delivery and is never stored in the batch snapshot.</p>
                </div>
              ) : (
                <div className={styles.reviewFields}>
                  <label><span>Reason applied to every eligible record</span><textarea value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); }} rows={4} maxLength={4000} required /></label>
                  <p className={styles.dialogHelp}>Each record gets its own reasoned abandonment history and can be reopened individually later.</p>
                </div>
              )}
              {preview ? (
                <div className={styles.previewResults} aria-live="polite">
                  <div className={styles.previewCounts}>
                    <div><span>Reviewed</span><strong>{preview.reviewedCount}</strong></div>
                    <div><span>Eligible</span><strong>{preview.eligibleCount}</strong></div>
                    <div><span>Excluded</span><strong>{preview.excludedCount}</strong></div>
                  </div>
                  {representativeTarget ? (
                    <div className={styles.reviewScope}>
                      <span>Representative eligible record</span>
                      <strong>{representativeTarget.recipient_name ?? "Admissions record"}</strong>
                      {representativeTarget.recipient_email ? <small>{representativeTarget.recipient_email}</small> : null}
                    </div>
                  ) : null}
                  {preview.targets.filter((target) => !target.eligible).length > 0 ? (
                    <div className={styles.exclusionList}>
                      <strong>Excluded before execution</strong>
                      {preview.targets.filter((target) => !target.eligible).slice(0, 8).map((target) => (
                        <p key={target.entity_id}>{target.recipient_name ?? target.entity_id}: {target.exclusion_reason}</p>
                      ))}
                      {preview.excludedCount > 8 ? <p>And {preview.excludedCount - 8} more excluded records in the durable results.</p> : null}
                    </div>
                  ) : null}
                  <p className={styles.dialogHelp}>Eligibility is checked again as each record executes. Newly invalid records will be excluded, not forced through.</p>
                </div>
              ) : null}
              {error ? <div className={styles.dialogError} role="alert">{error}</div> : null}
            </div>
            <div className={styles.reviewFooter}>
              <button className={styles.secondaryButton} type="button" onClick={close} disabled={busy}>Cancel</button>
              {!preview ? (
                <button className={styles.primaryLink} type="button" onClick={review} disabled={busy}>{busy ? "Reviewing…" : "Preview eligible records"}</button>
              ) : (
                <button className={styles.primaryLink} type="button" onClick={confirm} disabled={busy || preview.eligibleCount === 0}>{busy ? "Queueing…" : actionContent[action].confirm}</button>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
