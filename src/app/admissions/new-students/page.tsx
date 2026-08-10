import { AlertTriangle, CircleCheck, Clock3, Plus, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdmissionsRecordSubmitButton } from "@/components/admissions-record-actions";
import recordStyles from "@/components/admissions-record.module.css";
import { AdmissionsOperationsTable } from "@/components/admissions-operations-table";
import { AdmissionsLocalNavigation } from "@/components/admissions-workspace-shell";
import styles from "@/components/admissions-workspace.module.css";
import { AppShell } from "@/components/app-shell";
import { createAdmissionLead } from "@/lib/admin-actions";
import { setNewStudentApplicationDeadline } from "@/app/admissions/new-students/actions";
import { admissionsStaffWorkspacesEnabled } from "@/lib/admissions-feature";
import { parseNewStudentWorkspaceQuery } from "@/lib/admissions-workspace";
import { getAdmissionsOverviewData, getNewStudentApplicationDeadlineConfiguration, getNewStudentWorkspacePage } from "@/lib/admissions-workspace-data";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NewStudentsAdmissionsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("manage_admissions");
  if (!admissionsStaffWorkspacesEnabled()) redirect("/admissions");

  const params = await searchParams;
  const query = parseNewStudentWorkspaceQuery(params);
  const showNewEnquiry = params.new === "1";
  const [overview, page, deadline] = await Promise.all([
    getAdmissionsOverviewData(),
    getNewStudentWorkspacePage(query),
    getNewStudentApplicationDeadlineConfiguration()
  ]);
  const deadlineDate = deadline.applicationDeadlineAt
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(deadline.applicationDeadlineAt))
    : "";

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
          <div className={recordStyles.buttonRow}>
            <span className={styles.workspaceBadge}>Current admissions records</span>
            <Link className={styles.primaryLink} href={showNewEnquiry ? "/admissions/new-students" : "/admissions/new-students?new=1"}>
              <Plus size={13} /> {showNewEnquiry ? "Cancel new enquiry" : "New enquiry"}
            </Link>
          </div>
        </div>
        {params.deadline_updated ? <div className={recordStyles.successBanner} role="status"><CircleCheck size={16} /> Application deadline updated.</div> : null}
        {params.deadline_error ? <div className={recordStyles.warningBanner} role="alert"><AlertTriangle size={16} /> {params.deadline_error === "after_term_start" ? "Choose a deadline before the target term starts." : params.deadline_error === "no_published_term" ? "Publish the target term before setting its application deadline." : params.deadline_error === "invalid" ? "Choose a valid application deadline date." : "The application deadline could not be updated. Please try again."}</div> : null}
        <section className={recordStyles.surface} aria-labelledby="application-deadline-title">
          <div className={recordStyles.sectionHeader}>
            <div>
              <h3 id="application-deadline-title">Application deadline</h3>
              <p>One hard submission deadline for all new applicants to the published target term.</p>
            </div>
            <span className={deadline.state === "overdue" ? `${recordStyles.pill} ${recordStyles.attentionPill}` : recordStyles.pill}>
              {deadline.state === "open" ? "Open" : deadline.state === "overdue" ? "Passed" : deadline.state === "no_published_term" ? "No published term" : "Not configured"}
            </span>
          </div>
          {deadline.targetTermName ? (
            <form action={setNewStudentApplicationDeadline} className={recordStyles.actionForm}>
              <div className={recordStyles.twoColumns}>
                <div className={recordStyles.fact}><span>Target term</span><strong>{deadline.targetTermName}</strong><p>Starts {new Date(`${deadline.targetTermStartsOn}T12:00:00Z`).toLocaleDateString("en-GB")}</p></div>
                <label><span>Applications must be submitted by</span><input type="date" name="application_deadline" defaultValue={deadlineDate} max={deadline.targetTermStartsOn ? new Date(new Date(`${deadline.targetTermStartsOn}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10) : undefined} required /></label>
              </div>
              <p className={recordStyles.helpText}>After 23:59 UK time on this date, final submission and new invitations are blocked. Saving drafts and staff changes to this cohort deadline remain available.</p>
              <AdmissionsRecordSubmitButton confirmMessage="Update the cohort-wide application deadline? This changes submission access for every unsubmitted applicant.">{deadline.applicationDeadlineAt ? "Update deadline" : "Set deadline"}</AdmissionsRecordSubmitButton>
            </form>
          ) : <p className={recordStyles.empty}>Publish the target term before setting the new-student application deadline.</p>}
        </section>
        {showNewEnquiry ? (
          <section className={recordStyles.surface} aria-labelledby="new-enquiry-title">
            <div className={recordStyles.sectionHeader}>
              <div><h3 id="new-enquiry-title">Record a new enquiry</h3><p>Create the admissions record first. Invitation is a separate deliberate action from the full record.</p></div>
            </div>
            <form action={createAdmissionLead} className={recordStyles.actionForm}>
              <div className={recordStyles.twoColumns}>
                <label><span>First name</span><input name="first_name" required maxLength={80} /></label>
                <label><span>Last name</span><input name="last_name" required maxLength={80} /></label>
                <label><span>Email</span><input type="email" name="email" required /></label>
                <label><span>Phone</span><input name="phone" maxLength={40} /></label>
                <label><span>Programme</span><select name="programme" defaultValue="pgcert"><option value="pgcert">PGCert</option><option value="microcredential">Microcredential</option></select></label>
                <label><span>Source</span><input name="source" maxLength={120} /></label>
                <label><span>Last contacted</span><input type="date" name="last_contacted_on" /></label>
                <label><span>Next follow-up</span><input type="date" name="next_action_on" /></label>
                <label className={recordStyles.fullWidth}><span>Operational notes</span><textarea name="notes" rows={3} maxLength={6000} /></label>
              </div>
              <AdmissionsRecordSubmitButton>Create enquiry record</AdmissionsRecordSubmitButton>
            </form>
          </section>
        ) : null}
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
