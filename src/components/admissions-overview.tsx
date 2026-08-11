import { AlertTriangle, ArrowRight, MailWarning, RotateCcw, ShieldCheck, UserCheck } from "lucide-react";
import Link from "next/link";
import { AdmissionsLocalNavigation } from "@/components/admissions-workspace-shell";
import styles from "@/components/admissions-workspace.module.css";
import { returningStudentAdmissionsWorkspaceEnabled } from "@/lib/admissions-feature";
import { plainLanguageAdmissionsLabel } from "@/lib/admissions-workspace";
import type { AdmissionsOverviewData } from "@/lib/admissions-workspace-data";

function QueueList({ items }: { items: Array<{ label: string; count: number }> }) {
  return (
    <div className={styles.queueList}>
      <span className={styles.queueTitle}>Workload snapshot</span>
      {items.map((item) => (
        <div className={styles.queueRow} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.count}</strong>
        </div>
      ))}
    </div>
  );
}

export function AdmissionsOverview({ data }: { data: AdmissionsOverviewData }) {
  const returningStudentsEnabled = returningStudentAdmissionsWorkspaceEnabled();
  const emailLabel = data.email.mode === "pilot"
    ? "Pilot email mode"
    : data.email.mode === "live"
      ? "Live email mode"
      : "Email delivery disabled";

  return (
    <div className={styles.workspace}>
      <AdmissionsLocalNavigation
        active="overview"
        newAttention={data.newStudents.attention}
        returningAttention={data.returningStudents.attention}
      />

      <div className={styles.modeBanner} role="status">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>{emailLabel}</strong>
          <span>
            {data.email.mode === "pilot"
              ? "Only allowlisted recipients linked to explicitly marked fake records can receive admissions email."
              : data.email.mode === "live"
                ? "Genuine recipients are enabled by deliberate configuration. Monitor delivery exceptions below."
                : "Workflow records and correspondence attempts are retained, but no email will leave the system."}
          </span>
        </div>
      </div>

      <div className={styles.pageIntro}>
        <div>
          <h2>Admissions overview</h2>
          <p>Choose the workflow you are handling. Counts summarise current workload; records, filters, selections and actions stay inside their own workspace.</p>
        </div>
      </div>

      <div className={styles.workspaceGrid}>
        <section className={styles.workspaceCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIdentity}>
              <span className={styles.cardIcon}><UserCheck size={19} aria-hidden="true" /></span>
              <div><h2>New students</h2><p>Enquiry through application, offer, registration and conversion</p></div>
            </div>
            <span className={styles.workspaceBadge}>Current intake</span>
          </div>
          <div className={styles.cardMetrics}>
            <div className={styles.cardMetric}><span>Active records</span><strong>{data.newStudents.active}</strong></div>
            <div className={`${styles.cardMetric} ${styles.alertMetric}`}><span>Needs attention</span><strong>{data.newStudents.attention}</strong></div>
            <div className={styles.cardMetric}><span>Ready to progress</span><strong>{data.newStudents.ready}</strong></div>
          </div>
          <QueueList items={[
            { label: "Ready to progress", count: data.newStudents.ready },
            { label: "Awaiting applicant", count: data.newStudents.waiting },
            { label: "Review stage", count: data.newStudents.stages.review ?? 0 },
            { label: "Offer stage", count: data.newStudents.stages.offer ?? 0 },
            { label: "Registration stage", count: data.newStudents.stages.registration ?? 0 }
          ]} />
          <div className={styles.cardFooter}>
            <Link className={styles.secondaryButton} href="/admissions/new-students?stage=enquiry">New enquiries</Link>
            <Link className={styles.primaryLink} href="/admissions/new-students">Open new-student workspace <ArrowRight size={13} /></Link>
          </div>
        </section>

        {returningStudentsEnabled ? <section className={styles.workspaceCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIdentity}>
              <span className={`${styles.cardIcon} ${styles.returningIcon}`}><RotateCcw size={19} aria-hidden="true" /></span>
              <div><h2>Returning students</h2><p>Term cycle participation, contact, response and confirmation</p></div>
            </div>
            <span className={`${styles.workspaceBadge} ${styles.returningBadge}`}>
              {data.returningStudents.targetTermName ?? "No cycle"}{data.returningStudents.phase ? ` · ${plainLanguageAdmissionsLabel(data.returningStudents.phase)}` : ""}
            </span>
          </div>
          <div className={styles.cardMetrics}>
            <div className={styles.cardMetric}><span>Participants</span><strong>{data.returningStudents.participants}</strong></div>
            <div className={`${styles.cardMetric} ${styles.alertMetric}`}><span>Needs attention</span><strong>{data.returningStudents.attention}</strong></div>
            <div className={styles.cardMetric}><span>Contacted</span><strong>{data.returningStudents.contacted}</strong></div>
          </div>
          <QueueList items={[
            { label: "Needs staff attention", count: data.returningStudents.attention },
            { label: "Successfully contacted", count: data.returningStudents.contacted },
            { label: "Awaiting response", count: data.returningStudents.waiting },
            { label: "Contact or eligibility problems", count: data.exceptions.returningStudentBlockers }
          ]} />
          <div className={styles.cardFooter}>
            <span className={styles.phaseBadge}>{data.returningStudents.phase ? plainLanguageAdmissionsLabel(data.returningStudents.phase) : "Setup not started"}</span>
            <Link className={styles.primaryLink} href="/admissions/returning-students">Open returning-student workspace <ArrowRight size={13} /></Link>
          </div>
        </section> : null}
      </div>

      <section className={styles.exceptionSurface}>
        <h2>Cross-workflow exceptions</h2>
        <p>Only system problems that can prevent valid work appear here; normal work queues remain inside each workspace.</p>
        <div className={styles.exceptionList}>
          <Link className={styles.exceptionRow} href="/admissions/new-students?attention=needs_attention">
            <AlertTriangle size={16} aria-hidden="true" />
            <div><strong>{data.exceptions.newStudentInconsistencies} data inconsistencies</strong><span>New-student source records requiring repair</span></div>
          </Link>
          {returningStudentsEnabled ? <Link className={styles.exceptionRow} href="/admissions/returning-students?attention=needs_attention">
            <MailWarning size={16} aria-hidden="true" />
            <div><strong>{data.exceptions.returningStudentBlockers} returning-student blockers</strong><span>Identity, email or eligibility needs attention</span></div>
          </Link> : null}
          {data.exceptions.failedBatches.length > 0 ? (
            <Link className={styles.exceptionRow} href={`/admissions/batches/${data.exceptions.failedBatches[0].id}`}>
              <AlertTriangle size={16} aria-hidden="true" />
              <div><strong>{data.exceptions.failedBatches.reduce((sum, batch) => sum + batch.failedCount, 0)} failed batch targets</strong><span>Open the latest operational result</span></div>
            </Link>
          ) : (
            <div className={styles.exceptionRow}>
              <ShieldCheck size={16} aria-hidden="true" />
              <div><strong>No failed operational batches</strong><span>Durable actions have no unresolved target failures</span></div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
