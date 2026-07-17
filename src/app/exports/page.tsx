import { Download } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { requirePermission } from "@/lib/auth";

const exports = [
  {
    href: "/api/exports/cccu-exam-results",
    label: "CCCU exam results",
    detail: "Student, term, module, component, mark, pass/fail, resit requirement"
  },
  {
    href: "/api/exports/finance-reconciliation",
    label: "Finance reconciliation",
    detail: "Expected amount, CCCU invoice status, payment status, paid amount, balance due"
  }
];

export default async function ExportsPage() {
  await requirePermission("manage_everything");
  return (
    <AppShell title="Exports" subtitle="Operational exports and CCCU-ready data outputs">
      <section className="grid grid-2">
        {exports.map((exportItem) => (
          <div className="panel" key={exportItem.href}>
            <div className="section-header">
              <div>
                <h2>{exportItem.label}</h2>
                <p>{exportItem.detail}</p>
              </div>
              <a className="button primary" href={exportItem.href}>
                <Download size={16} />
                Download
              </a>
            </div>
          </div>
        ))}
      </section>
    </AppShell>
  );
}
