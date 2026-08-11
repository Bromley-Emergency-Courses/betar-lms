"use client";

import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  revealApplicationSupportNeeds,
  type RevealApplicationSupportNeedsState
} from "@/app/admissions/new-students/actions";
import {
  requestApplicationCorrections,
  reviewApplicationCorrections
} from "@/app/admissions/reviews/actions";
import { DocumentOpenButton } from "@/app/admissions/reviews/document-open-button";
import styles from "@/components/admissions-record.module.css";
import { plainLanguageAdmissionsLabel } from "@/lib/admissions-workspace";

export function AdmissionsRecordSubmitButton({
  children,
  danger = false,
  disabled = false,
  confirmMessage
}: {
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  confirmMessage?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={danger ? styles.dangerButton : styles.primaryButton}
      type="submit"
      disabled={disabled || pending}
      onClick={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

const initialSupportNeedsState: RevealApplicationSupportNeedsState = { status: "idle" };

export function RestrictedSupportNeedsReveal({ admissionId, applicationId }: { admissionId: string; applicationId: string }) {
  const [state, action, pending] = useActionState(revealApplicationSupportNeeds, initialSupportNeedsState);
  if (state.status === "revealed") {
    return (
      <div className={styles.restrictedDetail} role="region" aria-label="Restricted support-needs detail">
        <p><strong>Support detail</strong></p>
        <p>{state.supportDetail ?? "No detail supplied."}</p>
        <p><strong>Requested adjustments</strong></p>
        <p>{state.requestedAdjustments ?? "No adjustments supplied."}</p>
      </div>
    );
  }
  return (
    <form action={action} className={styles.inlineAction}>
      <input type="hidden" name="admission_id" value={admissionId} />
      <input type="hidden" name="application_id" value={applicationId} />
      <button className={styles.secondaryButton} type="submit" disabled={pending}>
        <ShieldCheck size={14} aria-hidden="true" /> {pending ? "Opening…" : "Reveal restricted detail"}
      </button>
      <p className={styles.helpText} aria-live="polite">
        {state.message ?? "Opening this information creates a redacted access audit event."}
      </p>
    </form>
  );
}

interface CorrectionTargetOption {
  type: "application_field" | "document_slot";
  key: string;
  label: string;
}

interface CorrectionDraftItem extends CorrectionTargetOption {
  instructions: string;
}

export function CorrectionRequestComposer({
  admissionId,
  applicationId,
  fieldOptions,
  documentOptions,
  defaultDueDate
}: {
  admissionId: string;
  applicationId: string;
  fieldOptions: Array<{ key: string; label: string }>;
  documentOptions: Array<{ key: string; label: string }>;
  defaultDueDate: string;
}) {
  const options = useMemo<CorrectionTargetOption[]>(() => [
    ...fieldOptions.map((option) => ({ ...option, type: "application_field" as const })),
    ...documentOptions.map((option) => ({ ...option, type: "document_slot" as const }))
  ], [documentOptions, fieldOptions]);
  const [selectedTarget, setSelectedTarget] = useState(options[0] ? `${options[0].type}:${options[0].key}` : "");
  const [items, setItems] = useState<CorrectionDraftItem[]>([]);

  function addItem() {
    const option = options.find((candidate) => `${candidate.type}:${candidate.key}` === selectedTarget);
    if (!option || items.some((item) => item.type === option.type && item.key === option.key)) return;
    setItems((current) => [...current, { ...option, instructions: "" }]);
  }

  return (
    <form action={requestApplicationCorrections} className={styles.actionForm}>
      <input type="hidden" name="admission_id" value={admissionId} />
      <input type="hidden" name="application_id" value={applicationId} />
      <input type="hidden" name="items_json" value={JSON.stringify(items.map((item) => ({
        target_type: item.type,
        target_key: item.key,
        instructions: item.instructions
      })))} />
      <div className={styles.fieldRow}>
        <label className={styles.growField}>
          <span>Field or evidence item</span>
          <select value={selectedTarget} onChange={(event) => setSelectedTarget(event.target.value)}>
            <optgroup label="Application fields">
              {options.filter((option) => option.type === "application_field").map((option) => (
                <option value={`${option.type}:${option.key}`} key={`${option.type}:${option.key}`}>{option.label}</option>
              ))}
            </optgroup>
            <optgroup label="Evidence">
              {options.filter((option) => option.type === "document_slot").map((option) => (
                <option value={`${option.type}:${option.key}`} key={`${option.type}:${option.key}`}>{option.label}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <button className={styles.secondaryButton} type="button" onClick={addItem} disabled={!selectedTarget}>
          <Plus size={14} aria-hidden="true" /> Add item
        </button>
      </div>
      {items.length > 0 ? (
        <div className={styles.correctionItems}>
          {items.map((item, index) => (
            <div className={styles.correctionItem} key={`${item.type}:${item.key}`}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.type === "document_slot" ? "Evidence" : "Application field"}</span>
              </div>
              <label className={styles.growField}>
                <span>What must the applicant correct?</span>
                <textarea
                  value={item.instructions}
                  onChange={(event) => setItems((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, instructions: event.target.value } : candidate))}
                  required
                  rows={2}
                  maxLength={4000}
                />
              </label>
              <button className={styles.iconButton} type="button" onClick={() => setItems((current) => current.filter((_, candidateIndex) => candidateIndex !== index))} aria-label={`Remove ${item.label}`}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : <p className={styles.helpText}>Add each specific field or evidence item the applicant must address.</p>}
      <div className={styles.twoColumns}>
        <label>
          <span>Request summary (optional)</span>
          <textarea name="summary" rows={3} maxLength={4000} />
        </label>
        <label>
          <span>Due date</span>
          <input type="date" name="due_at" defaultValue={defaultDueDate} required />
        </label>
      </div>
      <AdmissionsRecordSubmitButton disabled={items.length === 0 || items.some((item) => item.instructions.trim().length === 0)}>
        Send correction request
      </AdmissionsRecordSubmitButton>
    </form>
  );
}

export function CorrectionReviewForm({
  admissionId,
  applicationId,
  requestId,
  items
}: {
  admissionId: string;
  applicationId: string;
  requestId: string;
  items: Array<{
    id: string;
    targetKey: string;
    instructions: string;
    applicantResponseNote?: string;
    proposedValue?: unknown;
    replacementManagedFileId?: string;
    replacementFilename?: string;
  }>;
}) {
  const [reviews, setReviews] = useState(() => items.map((item) => ({ item_id: item.id, outcome: "accepted" as "accepted" | "revise", review_note: "" })));
  return (
    <form action={reviewApplicationCorrections} className={styles.actionForm}>
      <input type="hidden" name="admission_id" value={admissionId} />
      <input type="hidden" name="application_id" value={applicationId} />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="reviews_json" value={JSON.stringify(reviews)} />
      <div className={styles.correctionItems}>
        {items.map((item, index) => (
          <div className={styles.reviewCorrectionItem} key={item.id}>
            <div>
              <strong>{plainLanguageAdmissionsLabel(item.targetKey)}</strong>
              <p>{item.instructions}</p>
              <p><span>Applicant response:</span> {item.applicantResponseNote ?? (item.replacementManagedFileId ? "Replacement evidence supplied" : String(item.proposedValue ?? "No response recorded"))}</p>
              {item.replacementManagedFileId ? (
                <div className={styles.buttonRow}>
                  <span>{item.replacementFilename ?? "Replacement evidence"}</span>
                  <DocumentOpenButton fileId={item.replacementManagedFileId} label="Open replacement" />
                </div>
              ) : null}
            </div>
            <label>
              <span>Outcome</span>
              <select value={reviews[index]?.outcome} onChange={(event) => setReviews((current) => current.map((review, candidateIndex) => candidateIndex === index ? { ...review, outcome: event.target.value as "accepted" | "revise" } : review))}>
                <option value="accepted">Accept</option>
                <option value="revise">Needs another revision</option>
              </select>
            </label>
            <label>
              <span>{reviews[index]?.outcome === "revise" ? "Revised instructions" : "Review note (optional)"}</span>
              <textarea
                value={reviews[index]?.review_note ?? ""}
                onChange={(event) => setReviews((current) => current.map((review, candidateIndex) => candidateIndex === index ? { ...review, review_note: event.target.value } : review))}
                required={reviews[index]?.outcome === "revise"}
                rows={2}
                maxLength={4000}
              />
            </label>
          </div>
        ))}
      </div>
      <AdmissionsRecordSubmitButton disabled={reviews.some((review) => review.outcome === "revise" && review.review_note.trim().length === 0)}>
        Record correction review
      </AdmissionsRecordSubmitButton>
    </form>
  );
}
