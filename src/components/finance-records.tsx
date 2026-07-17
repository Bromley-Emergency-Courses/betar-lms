import { Download } from "lucide-react";
import Link from "next/link";
import { Field, FormGrid } from "@/components/forms";
import { FinanceReconciliationTable } from "@/components/finance-reconciliation-table";
import { createFinanceRecord, generateFinanceRecordsForTerm } from "@/lib/admin-actions";
import { financeDiscrepancy, formatCurrency, studentDisplayName } from "@/lib/rules";
import type { AppData, FinanceRecord } from "@/lib/types";

function pounds(pence?: number): string {
  return typeof pence === "number" ? String(pence / 100) : "";
}

function FinanceFields({ data, record }: { data: AppData; record?: FinanceRecord }) {
  const sortedStudents = [...data.students].sort((a, b) => studentDisplayName(a).localeCompare(studentDisplayName(b)));

  return (
    <>
      <FormGrid>
        <Field label="Student" htmlFor={`finance-student-${record?.id ?? "new"}`}>
          <select
            id={`finance-student-${record?.id ?? "new"}`}
            name="student_id"
            className="select"
            defaultValue={record?.studentId ?? ""}
            required
          >
            <option value="">Select student</option>
            {sortedStudents.map((student) => (
              <option key={student.id} value={student.id}>
                {studentDisplayName(student)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Term" htmlFor={`finance-term-${record?.id ?? "new"}`}>
          <select id={`finance-term-${record?.id ?? "new"}`} name="term_id" className="select" defaultValue={record?.termId ?? ""} required>
            <option value="">Select term</option>
            {data.terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
              </option>
            ))}
          </select>
        </Field>
      </FormGrid>
      <FormGrid>
        <Field label="Expected amount GBP" htmlFor={`finance-expected-${record?.id ?? "new"}`}>
          <input
            id={`finance-expected-${record?.id ?? "new"}`}
            name="expected_amount"
            className="input"
            type="number"
            min="0"
            step="0.01"
            defaultValue={pounds(record?.expectedAmountPence)}
            required
          />
        </Field>
        <Field label="Invoice amount GBP" htmlFor={`finance-invoice-amount-${record?.id ?? "new"}`}>
          <input
            id={`finance-invoice-amount-${record?.id ?? "new"}`}
            name="invoice_amount"
            className="input"
            type="number"
            min="0"
            step="0.01"
            defaultValue={pounds(record?.invoiceAmountPence)}
          />
        </Field>
      </FormGrid>
      <FormGrid>
        <Field label="Invoice status optional" htmlFor={`finance-invoice-status-${record?.id ?? "new"}`}>
          <select
            id={`finance-invoice-status-${record?.id ?? "new"}`}
            name="invoice_status"
            className="select"
            defaultValue={record?.invoiceStatus === "not_requested" ? "" : (record?.invoiceStatus ?? "")}
          >
            <option value="">Not recorded</option>
            <option value="requested">Requested</option>
            <option value="sent">Sent</option>
            <option value="corrected">Corrected</option>
          </select>
        </Field>
        <Field label="Payment status" htmlFor={`finance-payment-status-${record?.id ?? "new"}`}>
          <select
            id={`finance-payment-status-${record?.id ?? "new"}`}
            name="payment_status"
            className="select"
            defaultValue={record?.paymentStatus ?? "not_due"}
          >
            <option value="not_due">Not due</option>
            <option value="outstanding">Outstanding</option>
            <option value="paid">Paid</option>
            <option value="disputed">Disputed</option>
          </select>
        </Field>
      </FormGrid>
      <FormGrid>
        <Field label="Paid amount GBP" htmlFor={`finance-paid-amount-${record?.id ?? "new"}`}>
          <input
            id={`finance-paid-amount-${record?.id ?? "new"}`}
            name="paid_amount"
            className="input"
            type="number"
            min="0"
            step="0.01"
            defaultValue={pounds(record?.paidAmountPence)}
          />
        </Field>
        <Field label="Notes" htmlFor={`finance-notes-${record?.id ?? "new"}`}>
          <textarea id={`finance-notes-${record?.id ?? "new"}`} name="notes" className="textarea" defaultValue={record?.notes ?? ""} />
        </Field>
      </FormGrid>
    </>
  );
}

export function FinanceTools({ data }: { data: AppData }) {
  return (
    <section className="grid grid-2">
      <form className="panel grid" action={generateFinanceRecordsForTerm}>
        <div className="section-header">
          <div>
            <h2>Generate Expected Rows</h2>
            <p>Create or refresh expected amounts from term enrolments and offering prices</p>
          </div>
        </div>
        <Field label="Term" htmlFor="finance-generate-term">
          <select id="finance-generate-term" name="term_id" className="select" required>
            <option value="">Select term</option>
            {data.terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
              </option>
            ))}
          </select>
        </Field>
        <button className="button primary">Generate expected finance</button>
      </form>

      <form className="panel grid" action={createFinanceRecord}>
        <div className="section-header">
          <div>
            <h2>Add Finance Record</h2>
            <p>Manual reconciliation row for one student and term</p>
          </div>
        </div>
        <FinanceFields data={data} />
        <button className="button primary">Save finance record</button>
      </form>
    </section>
  );
}

export function FinanceRecords({ data, studentId }: { data: AppData; studentId?: string }) {
  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>Finance Records</h2>
          <p>Edit CCCU invoice and payment reconciliation</p>
        </div>
      </div>
      <FinanceReconciliationTable key={studentId ?? "all"} data={data} editable initialStudentId={studentId} />
    </section>
  );
}

export function FinanceOverview({ data, studentId }: { data: AppData; studentId?: string }) {
  const totalExpected = data.financeRecords.reduce((total, record) => total + record.expectedAmountPence, 0);
  const totalInvoiced = data.financeRecords.reduce((total, record) => total + (record.invoiceAmountPence ?? 0), 0);
  const totalPaid = data.financeRecords.reduce((total, record) => total + (record.paidAmountPence ?? 0), 0);
  const balancesDue = data.financeRecords.filter((record) => financeDiscrepancy(record) !== 0).length;

  return (
    <>
      <section className="grid grid-4">
        <div className="card metric">
          <div>
            <span>Expected</span>
            <strong>{formatCurrency(totalExpected)}</strong>
          </div>
        </div>
        <div className="card metric">
          <div>
            <span>Invoiced</span>
            <strong>{formatCurrency(totalInvoiced)}</strong>
          </div>
        </div>
        <div className="card metric">
          <div>
            <span>Paid</span>
            <strong>{formatCurrency(totalPaid)}</strong>
          </div>
        </div>
        <div className="card metric">
          <div>
            <span>Balances due</span>
            <strong>{balancesDue}</strong>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2>Reconciliation</h2>
            <p>Expected module costs, CCCU invoice status, payments, and notes</p>
          </div>
          <Link className="button" href="/api/exports/finance-reconciliation">
            <Download size={16} />
            Export CSV
          </Link>
        </div>
        <FinanceReconciliationTable key={studentId ?? "all"} data={data} initialStudentId={studentId} />
      </section>
    </>
  );
}
