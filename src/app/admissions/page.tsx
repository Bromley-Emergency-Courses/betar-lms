import { Eye, Pencil } from "lucide-react";
import Link from "next/link";
import { AdmissionsBoard, AdmissionsRecords, AdmissionsTools } from "@/components/admissions-records";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { requirePermission } from "@/lib/auth";
import { getLmsData } from "@/lib/lms-data";

export default async function AdmissionsPage({
  searchParams
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  await requirePermission("manage_admissions");
  const { mode } = await searchParams;
  const editMode = mode === "edit";
  const data = await getLmsData();

  return (
    <AppShell
      title="Admissions Pipeline"
      subtitle="Interest through CCCU registration"
      actions={
        editMode ? (
          <Link className="button" href="/admissions">
            <Eye size={16} />
            View mode
          </Link>
        ) : (
          <Link className="button primary" href="/admissions?mode=edit">
            <Pencil size={16} />
            Edit mode
          </Link>
        )
      }
    >
      {editMode ? (
        <>
          <AdmissionsTools data={data} />
          {data.admissionLeads.length === 0 ? (
            <EmptyState title="No admission leads yet" detail="Create a lead or import later-stage student records." />
          ) : (
            <AdmissionsRecords data={data} />
          )}
        </>
      ) : data.admissionLeads.length === 0 ? (
        <EmptyState title="No admission leads yet" detail="Enter edit mode to add lightweight leads before student conversion." />
      ) : (
        <AdmissionsBoard data={data} />
      )}
    </AppShell>
  );
}
