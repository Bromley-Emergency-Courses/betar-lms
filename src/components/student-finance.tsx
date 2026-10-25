"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, X } from "lucide-react";
import { loadWorkspaceFinance, saveWorkspaceFinance } from "@/app/students/finance-actions";
import { financePence, invoiceStatuses, paymentStatuses, type FinanceSnapshot } from "@/lib/student-finance";
import type { StudentWorkspaceData } from "@/lib/student-workspace";
import { useTaskDialogGuard } from "./use-task-dialog-guard";
import styles from "./student-workspace.module.css";

const money = (amount: number | undefined) => amount === undefined ? "Not recorded" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amount / 100);
const pounds = (pence: number | null | undefined) => pence == null ? "" : (pence / 100).toFixed(2);

function FinanceDialog({ studentId, recordId, snapshot, termId, close, saved }: {
  studentId: string; recordId?: string; snapshot: FinanceSnapshot; termId: string | null; close: () => void; saved: (message: string) => void;
}) {
  const [initial] = useState(snapshot);
  const [newId] = useState(() => crypto.randomUUID());
  const record = initial.records.find(candidate => candidate.id === recordId);
  const [selectedTerm, setSelectedTerm] = useState(() => record?.term_id ?? initial.terms.find(candidate => candidate.id === termId)?.id ?? (initial.terms.length === 1 ? initial.terms[0].id : ""));
  const term = initial.terms.find(candidate => candidate.id === selectedTerm);
  const [error, setError] = useState("");
  const router = useRouter(); const titleId = useId();
  const { dialog, keepEditing, dirtyRef, pendingRef, dirty, pending, setPending, exitTarget, setExitTarget, requestClose, discard, markDirty } = useTaskDialogGuard(close);
  const ready = Boolean(record || term);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || !ready) return;
    const fields = new FormData(event.currentTarget);
    pendingRef.current = true; setPending(true); setError("");
    try {
      const result = await saveWorkspaceFinance({ id: record?.id ?? newId, student_id: studentId, term_id: selectedTerm,
        expected_version: record?.version ?? null, term_token: record ? null : term!.token,
        expected_amount_pence: financePence(String(fields.get("expected"))), invoice_amount_pence: financePence(String(fields.get("invoice")), true),
        paid_amount_pence: financePence(String(fields.get("paid")), true), invoice_status: fields.get("invoiceStatus"), payment_status: fields.get("paymentStatus"),
        notes: String(fields.get("notes")).trim() || null });
      if (!result.ok) { setError(result.error); return; }
      dirtyRef.current = false; saved(result.message); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The save could not be confirmed. Review finance records before retrying."); }
    finally { pendingRef.current = false; setPending(false); }
  }
  return <dialog ref={dialog} className={`${styles.dialog} ${styles.financeDialog}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className={styles.dialogHeader}><h2 id={titleId}>{record ? "Edit finance record" : "Add finance record"}</h2><button type="button" className={styles.iconButton} onClick={requestClose} disabled={pending} aria-label="Close editor"><X size={22} /></button></header>
    <form className={styles.dialogBody} onSubmit={submit} data-unsaved={dirty}>
      <fieldset className={styles.taskFields} disabled={pending || Boolean(exitTarget)}>
        <p className={styles.notice}>Update the reconciliation record only. Saving does not send an invoice or collect a payment. Blank invoice and payment amounts mean not recorded, not £0.</p>
        {record ? <p><strong>{record.term}</strong> · Student and term are fixed here. Reassignment and deletion remain in the finance workspace.</p> : <label>Term<select value={selectedTerm} disabled={dirty} onChange={event => setSelectedTerm(event.target.value)}><option value="">Choose an enrolled term</option>{initial.terms.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label>}
        {!ready ? <p className={styles.muted}>{initial.terms.length ? "Choose a term to record its expected fees." : "No enrolled terms are missing a finance record. Edit an existing record instead."}</p> : <div className={styles.taskFields} key={selectedTerm} onChange={markDirty}>
          {!record ? <p className={styles.muted}>Expected fees are suggested from enrolled offering prices, excluding deferred enrolments. Review the amount before saving.</p> : null}
          <label>Expected amount (GBP)<input name="expected" type="number" min="0" max="21474836.47" step="0.01" required defaultValue={pounds(record?.expected_amount_pence ?? term?.suggestedAmountPence)} /></label>
          <div className={styles.profileGroup}><label>Invoice amount (GBP)<input name="invoice" type="number" min="0" max="21474836.47" step="0.01" defaultValue={pounds(record?.invoice_amount_pence)} /></label><label>Invoice status<select name="invoiceStatus" defaultValue={record?.invoice_status ?? "not_requested"}>{Object.entries(invoiceStatuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
          <div className={styles.profileGroup}><label>Paid amount (GBP)<input name="paid" type="number" min="0" max="21474836.47" step="0.01" defaultValue={pounds(record?.paid_amount_pence)} /></label><label>Payment status<select name="paymentStatus" defaultValue={record?.payment_status ?? "not_due"}>{Object.entries(paymentStatuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
          <div><label htmlFor={`${titleId}-notes`}>Notes</label><textarea id={`${titleId}-notes`} name="notes" maxLength={10000} defaultValue={record?.notes ?? ""} /></div>
        </div>}
      </fieldset>
      {error ? <div role="alert" className={styles.notice}><p>{error}</p><p>Your entries have been kept. Discard and reopen to review newer records.</p></div> : null}
      {exitTarget ? <div role="alert" className={styles.notice}><strong>Discard unsaved changes?</strong><p>Your entries have not been saved.</p><div className={styles.toolbar}><button type="button" ref={keepEditing} className={styles.button} onClick={() => setExitTarget(null)}>Keep editing</button><button type="button" className={styles.button} onClick={discard}>Discard changes</button></div></div> : <footer className={styles.toolbar}><button type="submit" className={styles.primaryButton} disabled={pending || !ready}>{pending ? "Saving…" : "Save finance record"}</button><button type="button" className={styles.button} disabled={pending} onClick={requestClose}>Cancel</button></footer>}
    </form>
  </dialog>;
}

export function StudentFinanceSection({ studentId, records }: { studentId: string; records: StudentWorkspaceData["finance"] }) {
  const params = useSearchParams();
  const [task, setTask] = useState<{ recordId?: string; snapshot: FinanceSnapshot } | null>(null);
  const [loading, setLoading] = useState(false); const [message, setMessage] = useState("");
  const expected = records.reduce((sum, record) => sum + record.expectedAmountPence, 0);
  const paid = records.reduce((sum, record) => sum + (record.paidAmountPence ?? 0), 0);
  const incomplete = records.some(record => record.paidAmountPence === undefined);
  async function open(recordId?: string) {
    setLoading(true); setMessage("");
    try {
      const result = await loadWorkspaceFinance(studentId);
      if (!result.ok) setMessage(result.error);
      else if (recordId && !result.snapshot.records.some(record => record.id === recordId)) setMessage("This finance record was moved or deleted. Refresh to review the latest records.");
      else setTask({ recordId, snapshot: result.snapshot });
    } catch { setMessage("Finance records could not be loaded. Please try again."); }
    finally { setLoading(false); }
  }
  return <section className={styles.panel}>
    <div className={styles.sectionHeading}><div><h2>Finance</h2><p className={styles.muted}>Term records, separate from assessment outcomes.</p></div><button className={styles.button} disabled={loading} onClick={() => open()}>Add finance record</button></div>
    <Link className={styles.textButton} href={`/finance?student=${encodeURIComponent(studentId)}${params.get("term") ? `&term=${encodeURIComponent(params.get("term")!)}` : ""}`}>Open finance workspace <ArrowUpRight size={15} /></Link>
    {loading ? <p role="status">Loading current finance records…</p> : null}{message ? <p role="status" className={styles.notice}>{message}</p> : null}
    <div className={styles.financeTotals}><div><span>Expected fees</span><strong>{money(records.length ? expected : undefined)}</strong></div><div><span>Recorded payments</span><strong>{money(records.some(record => record.paidAmountPence !== undefined) ? paid : undefined)}</strong>{incomplete ? <small>Some amounts not recorded</small> : null}</div><div><span>Balance</span><strong>{!records.length ? "Not recorded" : incomplete ? "Incomplete" : money(expected - paid)}</strong></div></div>
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Student finance"><table className={styles.table}><thead><tr><th>Term</th><th>Expected</th><th>Invoiced</th><th>Paid</th><th>Status</th><th>Actions</th></tr></thead><tbody>{records.map(record => <tr key={record.id}><td><strong>{record.term}</strong><small>{record.notes}</small></td><td>{money(record.expectedAmountPence)}</td><td>{money(record.invoiceAmountPence)}</td><td>{money(record.paidAmountPence)}</td><td>{paymentStatuses[record.paymentStatus]}<small>Invoice: {invoiceStatuses[record.invoiceStatus]}</small></td><td><button className={styles.textButton} disabled={loading} onClick={() => open(record.id)} aria-label={`Edit finance for ${record.term}`}>Edit</button></td></tr>)}</tbody></table></div>
    {!records.length ? <p className={styles.empty}>No finance records yet.</p> : null}
    {task ? <FinanceDialog {...task} studentId={studentId} termId={params.get("term")} close={() => setTask(null)} saved={value => { setTask(null); setMessage(value); }} /> : null}
  </section>;
}
