import { ClipboardCheck, Eye, ListChecks, Pencil } from "lucide-react";
import Link from "next/link";
import { AdmissionsBoard, AdmissionsRecords, AdmissionsTools } from "@/components/admissions-records";
import { AdmissionsOverview } from "@/components/admissions-overview";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { admissionsStaffWorkspacesEnabled } from "@/lib/admissions-feature";
import { getAdmissionsOverviewData } from "@/lib/admissions-workspace-data";
import { requirePermission } from "@/lib/auth";
import { getLmsData } from "@/lib/lms-data";

export default async function AdmissionsPage({
  searchParams
}: {
  searchParams: Promise<{ mode?: string; invited?: string }>;
}) {
  await requirePermission("manage_admissions");
  const { mode, invited } = await searchParams;
  if (admissionsStaffWorkspacesEnabled()) {
    const overview = await getAdmissionsOverviewData();
    return (
      <AppShell title="Admissions" subtitle="New-student intake and returning-student study cycles">
        <AdmissionsOverview data={overview} />
      </AppShell>
    );
  }
  const editMode = mode === "edit";
  const data = await getLmsData();

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
