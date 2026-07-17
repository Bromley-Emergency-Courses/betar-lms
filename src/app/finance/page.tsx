import { Eye, Pencil } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { FinanceOverview, FinanceRecords, FinanceTools } from "@/components/finance-records";
import { requirePermission } from "@/lib/auth";
import { getLmsData } from "@/lib/lms-data";

export default async function FinancePage({
  searchParams
}: {
  searchParams: Promise<{ mode?: string; student?: string }>;
}) {
  await requirePermission("manage_finance");
  const { mode, student } = await searchParams;
  const editMode = mode === "edit";
  const data = await getLmsData();
  const selectedStudent = student ? data.students.find((candidate) => candidate.id === student) : undefined;

  return (
    <AppShell
      title="Finance Reconciliation"
      subtitle={
        selectedStudent
          ? `Finance records for ${selectedStudent.firstName} ${selectedStudent.lastName}`
          : "Expected module costs, CCCU invoice status, payments, and notes"
      }
      actions={
        editMode ? (
          <Link className="button" href={student ? `/finance?student=${student}` : "/finance"}>
            <Eye size={16} />
            View mode
          </Link>
        ) : (
          <Link className="button primary" href={student ? `/finance?mode=edit&student=${student}` : "/finance?mode=edit"}>
            <Pencil size={16} />
            Edit mode
          </Link>
        )
      }
    >
      {editMode ? (
        <>
          <FinanceTools data={data} />
          {data.financeRecords.length === 0 ? (
            <EmptyState title="No finance records yet" detail="Generate expected rows for a term or add a manual finance record." />
          ) : (
            <FinanceRecords data={data} studentId={student} />
          )}
        </>
      ) : data.financeRecords.length === 0 ? (
        <EmptyState title="No finance records yet" detail="Enter edit mode to generate expected invoice rows from enrolments." />
      ) : (
        <FinanceOverview data={data} studentId={student} />
      )}
    </AppShell>
  );
}
