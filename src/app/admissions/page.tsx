import { ClipboardCheck, Eye, ListChecks, Pencil } from "lucide-react";
import Link from "next/link";
import { AdmissionsBoard, AdmissionsRecords, AdmissionsTools } from "@/components/admissions-records";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { requirePermission } from "@/lib/auth";
import { getLmsData } from "@/lib/lms-data";
import { NewStudentsPrototype } from "./new-students-prototype";

export default async function AdmissionsPage({
  searchParams
}: {
  searchParams: Promise<{ mode?: string; invited?: string; variant?: string }>;
}) {
  await requirePermission("manage_admissions");
  const { mode, invited, variant } = await searchParams;
  const editMode = mode === "edit";
  const data = await getLmsData();

  if (process.env.NODE_ENV !== "production" && variant && ["A", "B", "C"].includes(variant)) {
    return (
      <AppShell
        title="New-student admissions"
        subtitle="Understand the workload, focus attention, and progress valid applications"
        actions={<span className="status-pill warning">Prototype · read only</span>}
      >
        <NewStudentsPrototype variant={variant} />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Admissions Pipeline"
      subtitle="Interest through CCCU registration"
      actions={
        (
          <div className="toolbar">
            <Link className="button" href="/admissions/reviews">
              <ClipboardCheck size={16} />
              Review applications
            </Link>
            <Link className="button" href="/admissions/preferences">
              <ListChecks size={16} />
              Module preferences
            </Link>
            {editMode ? (
              <Link className="button" href="/admissions">
                <Eye size={16} />
                View mode
              </Link>
            ) : (
              <Link className="button primary" href="/admissions?mode=edit">
                <Pencil size={16} />
                Edit mode
              </Link>
            )}
          </div>
        )
      }
    >
      {editMode ? (
        <>
          {invited ? (
            <div className="apply-success" role="status">
              {invited === "demo"
                ? "Application invitation simulated in demo mode."
                : invited === "email_disabled"
                  ? "Application invitation was created, but email delivery is disabled."
                : invited === "email_failed"
                  ? "Application invitation was created, but the email could not be sent."
                  : "Application invitation sent."}
            </div>
          ) : null}
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
