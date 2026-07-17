import { Download } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { requirePermission } from "@/lib/auth";

const templates = [
  {
    name: "students",
    label: "Students and prospects",
    columns: "temporary_id,cccu_student_id,first_name,last_name,email,phone,status,admission_stage,programme"
  },
  {
    name: "enrolments",
    label: "Enrolments",
    columns: "student_identifier,module_code,term_name,status,final_mark,grade,credits_awarded"
  },
  {
    name: "finance",
    label: "Finance reconciliation",
    columns: "student_identifier,term_name,expected_amount,invoice_status,invoice_amount,payment_status,paid_amount,notes"
  },
  {
    name: "attendance",
    label: "Historic attendance",
    columns: "student_identifier,module_code,term_name,session_date,status,checked_in_at,checked_out_at"
  }
];

export default async function ImportsPage() {
  await requirePermission("manage_everything");
  return (
    <AppShell title="Imports" subtitle="CSV templates for initial records and manual backfill">
      <section className="grid grid-2">
        {templates.map((template) => (
          <div className="panel" key={template.name}>
            <div className="section-header">
              <div>
                <h2>{template.label}</h2>
                <p>{template.columns}</p>
              </div>
              <a className="button" href={`/api/import-templates/${template.name}`}>
                <Download size={16} />
                Template
              </a>
            </div>
          </div>
        ))}
      </section>
      <section className="panel grid">
        <div className="field">
          <label htmlFor="import-type">Import type</label>
          <select id="import-type" className="select">
            {templates.map((template) => (
              <option key={template.name}>{template.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="csv-file">CSV file</label>
          <input id="csv-file" className="input" type="file" accept=".csv" />
        </div>
        <button className="button primary">Validate import</button>
      </section>
    </AppShell>
  );
}
