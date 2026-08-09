import { AlertTriangle, MailCheck, MessageSquareReply, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { AdmissionsOperationsTable } from "@/components/admissions-operations-table";
import { AdmissionsLocalNavigation } from "@/components/admissions-workspace-shell";
import styles from "@/components/admissions-workspace.module.css";
import { AppShell } from "@/components/app-shell";
import { admissionsStaffWorkspacesEnabled } from "@/lib/admissions-feature";
import { parseReturningStudentWorkspaceQuery, plainLanguageAdmissionsLabel } from "@/lib/admissions-workspace";
import { getAdmissionsOverviewData, getReturningStudentWorkspacePage } from "@/lib/admissions-workspace-data";
import { requirePermission } from "@/lib/auth";

export default async function ReturningStudentsAdmissionsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("manage_admissions");
  if (!admissionsStaffWorkspacesEnabled()) redirect("/admissions");

  const query = parseReturningStudentWorkspaceQuery(await searchParams);
  const [overview, page] = await Promise.all([
    getAdmissionsOverviewData(),
    getReturningStudentWorkspacePage(query)
  ]);
  const cycle = overview.returningStudents;

  return (
    <AppShell title="Returning-student admissions" subtitle="Participant contact, response, demand and confirmation for the Published target term">
      <div className={styles.workspace}>
        <AdmissionsLocalNavigation
          active="returning_students"
          newAttention={overview.newStudents.attention}
          returningAttention={overview.returningStudents.attention}
        />
        <div className={styles.workspaceHeader}>
          <div>
            <h2>{cycle.targetTermName ? `${cycle.targetTermName} returning-student cycle` : "Returning-student cycle"}</h2>
            <p>Current facts stay visible beside the inclusion snapshot; planned capacity remains advisory.</p>
          </div>
          <span className={`${styles.workspaceBadge} ${styles.returningBadge}`}>
            {cycle.phase ? plainLanguageAdmissionsLabel(cycle.phase) : "No cycle underway"}
          </span>
        </div>
        <div className={styles.metrics}>
          <div className={styles.metric}><span>Participants</span><strong>{cycle.participants}</strong><small><Users size={13} /> Included now</small></div>
          <div className={styles.metric}><span>Successfully contacted</span><strong>{cycle.contacted}</strong><small><MailCheck size={13} /> Latest attempt sent</small></div>
          <div className={styles.metric}><span>Awaiting response</span><strong>{cycle.waiting}</strong><small><MessageSquareReply size={13} /> Response workflow</small></div>
          <div className={`${styles.metric} ${styles.alertMetric}`}><span>Needs staff attention</span><strong>{cycle.attention}</strong><small><AlertTriangle size={13} /> Eligibility or contact</small></div>
        </div>
        <AdmissionsOperationsTable
          workspace="returning_students"
          items={page.items}
          total={page.total}
          query={query}
        />
      </div>
    </AppShell>
  );
}
