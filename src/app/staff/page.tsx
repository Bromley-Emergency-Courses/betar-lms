import { AppShell } from "@/components/app-shell";
import { requirePermission } from "@/lib/auth";
import { getLmsData } from "@/lib/lms-data";
import { StaffWorkflow } from "./staff-workflow";
import { MobileStaffPrototype } from "./prototype/mobile-staff-prototype";
import { staffCompanionEnabled } from "@/lib/assessment/feature";
import { readStaffCompanion } from "@/lib/staff-companion-store";
import { StaffCompanion } from "./companion";
import Link from "next/link";

export default async function StaffPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("record_teaching");
  const parameters = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const { studentId, offeringId, variant, tablet } = parameters;

  if (process.env.NODE_ENV === "development" && ["A", "B", "C"].includes(variant ?? "")) {
    return <MobileStaffPrototype variant={variant as "A" | "B" | "C"} tablet={tablet === "1"} />;
  }

  if (staffCompanionEnabled() && parameters.view !== "legacy") {
    let companion;
    try {
      companion = await readStaffCompanion(parameters);
    } catch {
      return <AppShell title="Staff Teaching" workspace focused workspaceLabel="Teaching companion"><section role="alert" className="panel"><h2>Teaching records could not be loaded</h2><p>No results have been inferred or changed. Check your filters or try again.</p><Link className="button" href="/staff">Reload companion</Link><Link className="button" href="/staff?view=legacy">Existing staff workflow</Link></section></AppShell>;
    }
    return <AppShell title="Staff Teaching" workspace focused workspaceLabel="Teaching companion" hideTitle><StaffCompanion data={companion} /></AppShell>;
  }

  const data = await getLmsData();

  return (
    <AppShell title="Staff Teaching" subtitle="Encounter logs, formative assessments, and presentation scores">
      <StaffWorkflow data={data} selectedStudentId={studentId} selectedOfferingId={offeringId} />
    </AppShell>
  );
}
