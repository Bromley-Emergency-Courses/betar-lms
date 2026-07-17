"use client";

import { SlidersHorizontal } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { StatusPill } from "@/components/status-pill";
import { StudentLink } from "@/components/student-link";
import { deleteFinanceRecord, updateFinanceRecord } from "@/lib/admin-actions";
import { externalStudentIdentifier, financeDiscrepancy, formatCurrency, studentDisplayName } from "@/lib/rules";
import type { AppData, FinanceRecord, Student, Term } from "@/lib/types";

type BalanceFilter = "all" | "problem" | "due" | "balanced" | "overpaid";
type SortMode = "issues" | "balance" | "student" | "term";

interface FinanceRow {
  record: FinanceRecord;
  student: Student;
  term: Term;
  balanceDue: number;
  hasProblem: boolean;
}

function pounds(pence?: number): string {
  return typeof pence === "number" ? String(pence / 100) : "";
}

function hasFinanceProblem(record: FinanceRecord, balanceDue: number): boolean {
  return (
    balanceDue !== 0 ||
    record.invoiceStatus === "not_requested" ||
    record.invoiceStatus === "requested" ||
    record.paymentStatus === "outstanding" ||
    record.paymentStatus === "disputed"
  );
}

function compareProblemPriority(a: FinanceRow, b: FinanceRow): number {
  const aDue = a.balanceDue > 0 ? 0 : 1;
  const bDue = b.balanceDue > 0 ? 0 : 1;
  if (aDue !== bDue) {
    return aDue - bDue;
  }
  if (a.hasProblem !== b.hasProblem) {
    return a.hasProblem ? -1 : 1;
  }
  return Math.abs(b.balanceDue) - Math.abs(a.balanceDue);
}

function rowSearchText(row: FinanceRow): string {
  return [
    studentDisplayName(row.student),
    externalStudentIdentifier(row.student),
    row.term.name,
    row.record.invoiceStatus,
    row.record.paymentStatus,
    row.record.notes ?? ""
  ]
    .join(" ")
    .toLowerCase();
}

function RowSaveButton({ dirty, formId }: { dirty: boolean; formId?: string }) {
  return (
    <button className="button primary compact-save" form={formId} type="submit" style={{ visibility: dirty ? "visible" : "hidden" }}>
      Save
    </button>
  );
}

function LockedStudentTermFields({ record }: { record: FinanceRecord }) {
  return (
    <>
      <input type="hidden" name="student_id" value={record.studentId} />
      <input type="hidden" name="term_id" value={record.termId} />
    </>
  );
}

function AmountInput({
  id,
  name,
  value,
  formId,
  required,
  onDirty
}: {
  id: string;
  name: string;
  value: string;
  formId: string;
  required?: boolean;
  onDirty: () => void;
}) {
  return (
    <input
      id={id}
      form={formId}
      name={name}
      className="input finance-amount-input"
      type="number"
      min="0"
      step="0.01"
      defaultValue={value}
      required={required}
      onChange={onDirty}
    />
  );
}

export function FinanceReconciliationTable({
  data,
  editable = false,
  initialStudentId = "all"
}: {
  data: AppData;
  editable?: boolean;
  initialStudentId?: string;
}) {
  const [query, setQuery] = useState("");
  const [studentFilter, setStudentFilter] = useState(initialStudentId);
  const [termFilter, setTermFilter] = useState("all");
  const [invoiceFilter, setInvoiceFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("issues");
  const [dirtyRows, setDirtyRows] = useState<Set<string>>(() => new Set());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());

  const sortedStudents = useMemo(
    () => [...data.students].sort((a, b) => studentDisplayName(a).localeCompare(studentDisplayName(b))),
    [data.students]
  );

  const rows = useMemo<FinanceRow[]>(() => {
    return data.financeRecords.flatMap((record) => {
      const student = data.students.find((candidate) => candidate.id === record.studentId);
      const term = data.terms.find((candidate) => candidate.id === record.termId);
      if (!student || !term) {
        return [];
      }
      const balanceDue = financeDiscrepancy(record);
      return [
        {
          record,
          student,
          term,
          balanceDue,
          hasProblem: hasFinanceProblem(record, balanceDue)
        }
      ];
    });
  }, [data.financeRecords, data.students, data.terms]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (normalizedQuery && !rowSearchText(row).includes(normalizedQuery)) {
          return false;
        }
        if (studentFilter !== "all" && row.record.studentId !== studentFilter) {
          return false;
        }
        if (termFilter !== "all" && row.record.termId !== termFilter) {
          return false;
        }
        if (invoiceFilter !== "all" && row.record.invoiceStatus !== invoiceFilter) {
          return false;
        }
        if (paymentFilter !== "all" && row.record.paymentStatus !== paymentFilter) {
          return false;
        }
        if (balanceFilter === "problem" && !row.hasProblem) {
          return false;
        }
        if (balanceFilter === "due" && row.balanceDue <= 0) {
          return false;
        }
        if (balanceFilter === "balanced" && row.balanceDue !== 0) {
          return false;
        }
        if (balanceFilter === "overpaid" && row.balanceDue >= 0) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortMode === "balance") {
          return b.balanceDue - a.balanceDue;
        }
        if (sortMode === "student") {
          return studentDisplayName(a.student).localeCompare(studentDisplayName(b.student));
        }
        if (sortMode === "term") {
          return a.term.name.localeCompare(b.term.name) || studentDisplayName(a.student).localeCompare(studentDisplayName(b.student));
        }
        return compareProblemPriority(a, b) || studentDisplayName(a.student).localeCompare(studentDisplayName(b.student));
      });
  }, [balanceFilter, invoiceFilter, paymentFilter, query, rows, sortMode, studentFilter, termFilter]);

  function markDirty(recordId: string) {
    setDirtyRows((current) => new Set(current).add(recordId));
  }

  function toggleExpanded(recordId: string) {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(recordId)) {
        next.delete(recordId);
      } else {
        next.add(recordId);
      }
      return next;
    });
  }

  return (
    <div className="finance-reconciliation">
      <div className="finance-filter-panel">
        <div className="finance-filter-title">
          <SlidersHorizontal size={18} />
          <strong>Filters</strong>
          <span className="muted small">
            Showing {filteredRows.length} of {rows.length}
          </span>
        </div>
        <div className="finance-filters">
          <label className="field">
            <span>Search</span>
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Student name or ID"
            />
          </label>
          <label className="field">
            <span>Student</span>
            <select className="select" value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)}>
              <option value="all">All students</option>
              {sortedStudents.map((student) => (
                <option key={student.id} value={student.id}>
                  {studentDisplayName(student)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Term</span>
            <select className="select" value={termFilter} onChange={(event) => setTermFilter(event.target.value)}>
              <option value="all">All terms</option>
              {data.terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Invoice</span>
            <select className="select" value={invoiceFilter} onChange={(event) => setInvoiceFilter(event.target.value)}>
              <option value="all">All invoices</option>
              <option value="not_requested">Not recorded</option>
              <option value="requested">Requested</option>
              <option value="sent">Sent</option>
              <option value="corrected">Corrected</option>
            </select>
          </label>
          <label className="field">
            <span>Payment</span>
            <select className="select" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
              <option value="all">All payments</option>
              <option value="not_due">Not due</option>
              <option value="outstanding">Outstanding</option>
              <option value="paid">Paid</option>
              <option value="disputed">Disputed</option>
            </select>
          </label>
          <label className="field">
            <span>Balance</span>
            <select className="select" value={balanceFilter} onChange={(event) => setBalanceFilter(event.target.value as BalanceFilter)}>
              <option value="all">All records</option>
              <option value="problem">Unresolved/problem</option>
              <option value="due">Balance due</option>
              <option value="balanced">Balanced</option>
              <option value="overpaid">Overpaid</option>
            </select>
          </label>
          <label className="field">
            <span>Sort</span>
            <select className="select" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="issues">Unresolved first</option>
              <option value="balance">Highest balance</option>
              <option value="student">Student A-Z</option>
              <option value="term">Term</option>
            </select>
          </label>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="empty-state panel">
          <h2>No matching finance records</h2>
          <p>Adjust the search or filters to broaden the results.</p>
        </div>
      ) : (
        <div className="table-wrap finance-table-wrap">
          <table className={editable ? "finance-table editable" : "finance-table"}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Term</th>
                <th>Expected</th>
                <th>Invoice</th>
                <th>Payment</th>
                <th>Paid</th>
                <th>Balance due</th>
                <th>Notes</th>
                {editable ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const { record, student, term, balanceDue } = row;
                const rowFormId = `finance-row-${record.id}`;
                const advancedFormId = `finance-advanced-${record.id}`;
                const dirty = dirtyRows.has(record.id);
                const expanded = expandedRows.has(record.id);

                return (
                  <Fragment key={record.id}>
                    <tr className={row.hasProblem ? "finance-problem-row" : undefined}>
                      <td>
                        <form id={rowFormId} action={updateFinanceRecord}>
                          <input type="hidden" name="finance_record_id" value={record.id} />
                          <LockedStudentTermFields record={record} />
                        </form>
                        <StudentLink student={student} />
                      </td>
                      <td>{term.name}</td>
                      <td>
                        {editable ? (
                          <AmountInput
                            id={`finance-expected-${record.id}`}
                            name="expected_amount"
                            value={pounds(record.expectedAmountPence)}
                            formId={rowFormId}
                            required
                            onDirty={() => markDirty(record.id)}
                          />
                        ) : (
                          formatCurrency(record.expectedAmountPence)
                        )}
                      </td>
                      <td>
                        {editable ? (
                          <div className="finance-inline-stack">
                            <select
                              form={rowFormId}
                              name="invoice_status"
                              className="select"
                              defaultValue={record.invoiceStatus === "not_requested" ? "" : record.invoiceStatus}
                              onChange={() => markDirty(record.id)}
                            >
                              <option value="">Not recorded</option>
                              <option value="requested">Requested</option>
                              <option value="sent">Sent</option>
                              <option value="corrected">Corrected</option>
                            </select>
                            <AmountInput
                              id={`finance-invoice-amount-${record.id}`}
                              name="invoice_amount"
                              value={pounds(record.invoiceAmountPence)}
                              formId={rowFormId}
                              onDirty={() => markDirty(record.id)}
                            />
                          </div>
                        ) : (
                          <>
                            <StatusPill value={record.invoiceStatus} />
                            <br />
                            <span className="muted small">
                              {record.invoiceAmountPence === undefined ? "No amount" : formatCurrency(record.invoiceAmountPence)}
                            </span>
                          </>
                        )}
                      </td>
                      <td>
                        {editable ? (
                          <select
                            form={rowFormId}
                            name="payment_status"
                            className="select"
                            defaultValue={record.paymentStatus}
                            onChange={() => markDirty(record.id)}
                          >
                            <option value="not_due">Not due</option>
                            <option value="outstanding">Outstanding</option>
                            <option value="paid">Paid</option>
                            <option value="disputed">Disputed</option>
                          </select>
                        ) : (
                          <StatusPill value={record.paymentStatus} />
                        )}
                      </td>
                      <td>
                        {editable ? (
                          <AmountInput
                            id={`finance-paid-amount-${record.id}`}
                            name="paid_amount"
                            value={pounds(record.paidAmountPence)}
                            formId={rowFormId}
                            onDirty={() => markDirty(record.id)}
                          />
                        ) : (
                          <span className="muted small">
                            {record.paidAmountPence === undefined ? "No payment" : formatCurrency(record.paidAmountPence)}
                          </span>
                        )}
                      </td>
                      <td>
                        <strong>{formatCurrency(balanceDue)}</strong>
                      </td>
                      <td>
                        {editable ? (
                          <textarea
                            form={rowFormId}
                            name="notes"
                            className="textarea finance-notes-input"
                            defaultValue={record.notes ?? ""}
                            rows={2}
                            onChange={() => markDirty(record.id)}
                          />
                        ) : (
                          record.notes ?? ""
                        )}
                      </td>
                      {editable ? (
                        <td>
                          <div className="finance-row-actions">
                            <RowSaveButton dirty={dirty} formId={rowFormId} />
                            <button className="button" type="button" onClick={() => toggleExpanded(record.id)}>
                              {expanded ? "Close" : "Advanced"}
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                    {editable && expanded ? (
                      <tr className="finance-advanced-row">
                        <td colSpan={9}>
                          <div className="finance-advanced-panel">
                            <form className="grid" id={advancedFormId} action={updateFinanceRecord} onChange={() => markDirty(record.id)}>
                              <input type="hidden" name="finance_record_id" value={record.id} />
                              <div className="form-grid">
                                <div className="field">
                                  <label htmlFor={`advanced-student-${record.id}`}>Student</label>
                                  <select
                                    id={`advanced-student-${record.id}`}
                                    name="student_id"
                                    className="select"
                                    defaultValue={record.studentId}
                                    required
                                  >
                                    {sortedStudents.map((candidate) => (
                                      <option key={candidate.id} value={candidate.id}>
                                        {studentDisplayName(candidate)}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="field">
                                  <label htmlFor={`advanced-term-${record.id}`}>Term</label>
                                  <select id={`advanced-term-${record.id}`} name="term_id" className="select" defaultValue={record.termId} required>
                                    {data.terms.map((candidate) => (
                                      <option key={candidate.id} value={candidate.id}>
                                        {candidate.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <div className="form-grid">
                                <div className="field">
                                  <label htmlFor={`advanced-expected-${record.id}`}>Expected amount GBP</label>
                                  <input
                                    id={`advanced-expected-${record.id}`}
                                    name="expected_amount"
                                    className="input"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    defaultValue={pounds(record.expectedAmountPence)}
                                    required
                                  />
                                </div>
                                <div className="field">
                                  <label htmlFor={`advanced-invoice-amount-${record.id}`}>Invoice amount GBP</label>
                                  <input
                                    id={`advanced-invoice-amount-${record.id}`}
                                    name="invoice_amount"
                                    className="input"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    defaultValue={pounds(record.invoiceAmountPence)}
                                  />
                                </div>
                              </div>
                              <div className="form-grid">
                                <div className="field">
                                  <label htmlFor={`advanced-invoice-status-${record.id}`}>Invoice status</label>
                                  <select
                                    id={`advanced-invoice-status-${record.id}`}
                                    name="invoice_status"
                                    className="select"
                                    defaultValue={record.invoiceStatus === "not_requested" ? "" : record.invoiceStatus}
                                  >
                                    <option value="">Not recorded</option>
                                    <option value="requested">Requested</option>
                                    <option value="sent">Sent</option>
                                    <option value="corrected">Corrected</option>
                                  </select>
                                </div>
                                <div className="field">
                                  <label htmlFor={`advanced-payment-status-${record.id}`}>Payment status</label>
                                  <select
                                    id={`advanced-payment-status-${record.id}`}
                                    name="payment_status"
                                    className="select"
                                    defaultValue={record.paymentStatus}
                                  >
                                    <option value="not_due">Not due</option>
                                    <option value="outstanding">Outstanding</option>
                                    <option value="paid">Paid</option>
                                    <option value="disputed">Disputed</option>
                                  </select>
                                </div>
                              </div>
                              <div className="form-grid">
                                <div className="field">
                                  <label htmlFor={`advanced-paid-amount-${record.id}`}>Paid amount GBP</label>
                                  <input
                                    id={`advanced-paid-amount-${record.id}`}
                                    name="paid_amount"
                                    className="input"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    defaultValue={pounds(record.paidAmountPence)}
                                  />
                                </div>
                                <div className="field">
                                  <label htmlFor={`advanced-notes-${record.id}`}>Notes</label>
                                  <textarea
                                    id={`advanced-notes-${record.id}`}
                                    name="notes"
                                    className="textarea"
                                    defaultValue={record.notes ?? ""}
                                  />
                                </div>
                              </div>
                              <RowSaveButton dirty={dirty} />
                            </form>
                            <form className="finance-delete-form" action={deleteFinanceRecord}>
                              <input type="hidden" name="student_id" value={record.studentId} />
                              <div className="delete-warning">
                                <input type="hidden" name="finance_record_id" value={record.id} />
                                <label>
                                  <input name="confirm_delete" type="checkbox" required /> Delete {studentDisplayName(student)} {term.name}
                                </label>
                                <p>This is permanent. Deletion may be blocked if other records depend on it.</p>
                              </div>
                              <button className="button danger">Delete finance record</button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
