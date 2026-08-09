import clsx from "clsx";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { AdmissionsBatchRefresh } from "@/components/admissions-batch-refresh";
import { AdmissionsBatchRetry } from "@/components/admissions-batch-retry";
import { AdmissionsLocalNavigation } from "@/components/admissions-workspace-shell";
import styles from "@/components/admissions-workspace.module.css";
import { AppShell } from "@/components/app-shell";
import { admissionsStaffWorkspacesEnabled } from "@/lib/admissions-feature";
import { admissionsBatchStatuses, parseAdmissionsBatchResultsQuery, plainLanguageAdmissionsLabel } from "@/lib/admissions-workspace";
import { getAdmissionsBatchDetail } from "@/lib/admissions-workspace-data";
import { requirePermission } from "@/lib/auth";

function formatDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function resultClass(status: string) {
  return clsx(styles.pill, {
    [styles.pillSucceeded]: status === "succeeded" || status === "sent",
    [styles.pillFailed]: status === "failed",
    [styles.pillExcluded]: status === "excluded",
    [styles.pillQueued]: status === "queued",
    [styles.pillRunning]: status === "running"
  });
}

export default async function AdmissionsBatchPage({
  params,
  searchParams
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("manage_admissions");
  if (!admissionsStaffWorkspacesEnabled()) redirect("/admissions");
  const { batchId: rawBatchId } = await params;
  const parsedId = z.string().uuid().safeParse(rawBatchId);
  if (!parsedId.success) notFound();
  const query = parseAdmissionsBatchResultsQuery(await searchParams);
  const result = await getAdmissionsBatchDetail(parsedId.data, query);
  if (!result.batch) notFound();

  const batch = result.batch;
  const completed = batch.succeededCount + batch.failedCount + batch.excludedCount;
  const progress = batch.reviewedCount > 0 ? Math.round((completed / batch.reviewedCount) * 100) : 0;
  const totalPages = Math.max(1, Math.ceil(result.total / query.pageSize));
  const sourceHref = batch.workspace === "new_students" ? "/admissions/new-students" : "/admissions/returning-students";

  return (
    <AppShell title="Operational batch" subtitle="Durable progress and a separate result for every reviewed record">
      <div className={styles.workspace}>
        <AdmissionsLocalNavigation active="batch" />
        <div className={styles.pageIntro}>
          <div>
            <Link className={styles.linkButton} href={sourceHref}><ArrowLeft size={12} /> Back to {plainLanguageAdmissionsLabel(batch.workspace)}</Link>
            <h2>{plainLanguageAdmissionsLabel(batch.action)}</h2>
            <p>Batch {batch.id.slice(0, 8)} · {plainLanguageAdmissionsLabel(batch.scope)} scope · queued {formatDateTime(batch.queuedAt)}</p>
          </div>
          <span className={resultClass(batch.status)}>{plainLanguageAdmissionsLabel(batch.status)}</span>
        </div>

        <section className={styles.batchSummary}>
          <div className={styles.resultHeader}>
            <div><h2>Progress</h2><p>Progress and per-record results remain available across navigation and refresh.</p></div>
            <AdmissionsBatchRefresh batchId={batch.id} active={["queued", "running"].includes(batch.status)} status={plainLanguageAdmissionsLabel(batch.status)} completed={completed} total={batch.reviewedCount} />
          </div>
          <div className={styles.progressTrack} aria-hidden="true"><div className={styles.progressFill} style={{ width: `${progress}%` }} /></div>
          <div className={styles.batchMeta}><span>{progress}% complete</span><span>Last progress {formatDateTime(batch.lastProgressAt)}</span>{batch.retryOfBatchId ? <span>Retry of {batch.retryOfBatchId.slice(0, 8)}</span> : null}</div>
          {batch.renderedSubject ? <p className={styles.batchReviewFact}><strong>Reviewed subject:</strong> {batch.renderedSubject}</p> : null}
          {batch.actionReason ? <p className={styles.batchReviewFact}><strong>Action reason:</strong> {batch.actionReason}</p> : null}
        </section>

        <div className={styles.batchMetrics}>
          <div className={styles.batchMetric}><span>Queued</span><strong>{batch.queuedCount}</strong></div>
          <div className={styles.batchMetric}><span>Running</span><strong>{batch.runningCount}</strong></div>
          <div className={styles.batchMetric}><span>Succeeded</span><strong>{batch.succeededCount}</strong></div>
          <div className={`${styles.batchMetric} ${styles.alertMetric}`}><span>Failed</span><strong>{batch.failedCount}</strong></div>
          <div className={styles.batchMetric}><span>Excluded</span><strong>{batch.excludedCount}</strong></div>
        </div>
        {batch.status === "completed" && batch.failedCount > 0 ? <AdmissionsBatchRetry batchId={batch.id} failedCount={batch.failedCount} /> : null}

        <section className={styles.surface}>
          <div className={styles.surfaceHeader}><div><h2>Per-record results</h2><p>{result.total} result{result.total === 1 ? "" : "s"} in this view</p></div></div>
          <div className={styles.filterRow}>
            <div className={styles.filterGroup}>
              {admissionsBatchStatuses.map((status) => (
                <Link
                  className={clsx(styles.filterButton, query.status === status && styles.filterButtonActive)}
                  href={status === "all" ? `/admissions/batches/${batch.id}` : `/admissions/batches/${batch.id}?status=${status}`}
                  aria-current={query.status === status ? "page" : undefined}
                  key={status}
                >
                  {plainLanguageAdmissionsLabel(status)}
                </Link>
              ))}
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.resultsTable}>
              <thead><tr><th>#</th><th>Record / recipient</th><th>Action result</th><th>Delivery</th><th>Reason</th><th>Attempts</th><th>Completed</th></tr></thead>
              <tbody>
                {result.targets.map((target) => (
                  <tr key={target.id}>
                    <td>{target.ordinal}</td>
                    <td><div className={styles.nameCell}><strong>{target.recipientName ?? plainLanguageAdmissionsLabel(target.entityType)}</strong><small>{target.recipientEmail ?? target.entityId}</small></div></td>
                    <td><span className={resultClass(target.status)}>{plainLanguageAdmissionsLabel(target.status)}</span></td>
                    <td>{target.correspondenceStatus ? <span className={resultClass(target.correspondenceStatus)}>{plainLanguageAdmissionsLabel(target.correspondenceStatus)}</span> : "—"}</td>
                    <td className={styles.resultReason}>{target.failureReason ?? target.exclusionReason ?? "—"}</td>
                    <td>{target.attemptCount}</td>
                    <td>{formatDateTime(target.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.targets.length === 0 ? <div className={styles.emptyRows}>No batch targets match this result filter.</div> : null}
          </div>
          <div className={styles.pagination}>
            <span>Page {query.page} of {totalPages}</span>
            <div className={styles.paginationControls}>
              <Link className={styles.iconButton} aria-disabled={query.page <= 1} href={`/admissions/batches/${batch.id}?${new URLSearchParams({ ...(query.status !== "all" ? { status: query.status } : {}), page: String(Math.max(1, query.page - 1)) })}`}><ChevronLeft size={14} /><span className={styles.srOnly}>Previous page</span></Link>
              <Link className={styles.iconButton} aria-disabled={query.page >= totalPages} href={`/admissions/batches/${batch.id}?${new URLSearchParams({ ...(query.status !== "all" ? { status: query.status } : {}), page: String(Math.min(totalPages, query.page + 1)) })}`}><ChevronRight size={14} /><span className={styles.srOnly}>Next page</span></Link>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
