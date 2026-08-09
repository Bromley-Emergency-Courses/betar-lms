import { AlertTriangle, CircleCheck, Clock3, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { AdmissionsOperationsTable } from "@/components/admissions-operations-table";
import { AdmissionsLocalNavigation } from "@/components/admissions-workspace-shell";
import styles from "@/components/admissions-workspace.module.css";
import { AppShell } from "@/components/app-shell";
import { admissionsStaffWorkspacesEnabled } from "@/lib/admissions-feature";
import { parseNewStudentWorkspaceQuery } from "@/lib/admissions-workspace";
import { getAdmissionsOverviewData, getNewStudentWorkspacePage } from "@/lib/admissions-workspace-data";
import { requirePermission } from "@/lib/auth";

export default async function NewStudentsAdmissionsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("manage_admissions");
  if (!admissionsStaffWorkspacesEnabled()) redirect("/admissions");

  const query = parseNewStudentWorkspaceQuery(await searchParams);
  const [overview, page] = await Promise.all([
    getAdmissionsOverviewData(),
    getNewStudentWorkspacePage(query)
  ]);

  return (
    <AppShell title="New-student admissions" subtitle="Enquiry through application, offer, registration and conversion">
      <div className={styles.workspace}>
        <AdmissionsLocalNavigation
          active="new_students"
          newAttention={overview.newStudents.attention}
          returningAttention={overview.returningStudents.attention}
        />
        <div className={styles.workspaceHeader}>
          <div>
            <h2>New students</h2>
            <p>Derived stages and primary next actions keep hundreds of admissions records scannable without direct status editing.</p>
          </div>
          <span className={styles.workspaceBadge}>Current admissions records</span>
        </div>
        <div className={styles.metrics}>
          <div className={styles.metric}><span>Active admissions</span><strong>{overview.newStudents.active}</strong><small><Users size={13} /> Current workflow</small></div>
          <div className={`${styles.metric} ${styles.alertMetric}`}><span>Needs staff attention</span><strong>{overview.newStudents.attention}</strong><small><AlertTriangle size={13} /> Factual indicators</small></div>
          <div className={styles.metric}><span>Awaiting applicant</span><strong>{overview.newStudents.waiting}</strong><small><Clock3 size={13} /> External response</small></div>
          <div className={styles.metric}><span>Ready to progress</span><strong>{overview.newStudents.ready}</strong><small><CircleCheck size={13} /> Valid next action</small></div>
        </div>
        <AdmissionsOperationsTable
          workspace="new_students"
          items={page.items}
          total={page.total}
          query={query}
          stageCounts={overview.newStudents.stages}
        />
      </div>
    </AppShell>
  );
}
