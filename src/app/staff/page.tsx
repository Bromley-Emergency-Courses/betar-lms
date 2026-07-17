import { AppShell } from "@/components/app-shell";
import { requirePermission } from "@/lib/auth";
import { getLmsData } from "@/lib/lms-data";
import { StaffWorkflow } from "./staff-workflow";

export default async function StaffPage({
  searchParams
}: {
  searchParams: Promise<{ studentId?: string; offeringId?: string }>;
}) {
  await requirePermission("record_teaching");
  const { studentId, offeringId } = await searchParams;
  const data = await getLmsData();

  return (
    <AppShell title="Staff Teaching" subtitle="Encounter logs, formative assessments, and presentation scores">
      <StaffWorkflow data={data} selectedStudentId={studentId} selectedOfferingId={offeringId} />
    </AppShell>
  );
}
