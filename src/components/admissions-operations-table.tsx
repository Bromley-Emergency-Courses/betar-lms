"use client";

import clsx from "clsx";
import { ArrowRight, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "@/components/admissions-workspace.module.css";
import { AdmissionsBatchActionDialog } from "@/components/admissions-batch-action-dialog";
import { AdmissionsEmailPilotControls } from "@/components/admissions-email-pilot-controls";
import {
  newStudentJourneyStageLabels,
  newStudentJourneyStages
} from "@/lib/admissions-staff-workflow";
import {
  admissionsAttentionFilters,
  plainLanguageAdmissionsLabel,
  returningStudentWorkspaceStatuses,
  type NewStudentWorkspaceQuery,
  type ReturningStudentWorkspaceQuery,
  type StaffNewStudentAdmissionsOperation,
  type StaffReturningStudentAdmissionsOperation
} from "@/lib/admissions-workspace";

type OperationsTableProps =
  | {
      workspace: "new_students";
      items: StaffNewStudentAdmissionsOperation[];
      total: number;
      query: NewStudentWorkspaceQuery;
      stageCounts: Record<string, number>;
    }
  | {
      workspace: "returning_students";
      items: StaffReturningStudentAdmissionsOperation[];
      total: number;
      query: ReturningStudentWorkspaceQuery;
      email: { enabled: boolean; mode: string; missing: string[] };
    };

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

function statusClass(value: string) {
  return clsx(styles.pill, {
    [styles.pillAttention]: ["failed", "resolve_eligibility_blocker", "repair_inconsistency"].includes(value),
    [styles.pillReady]: ["sent", "succeeded", "ready_for_decision"].includes(value),
    [styles.pillQueued]: ["queued", "running"].includes(value),
    [styles.pillWaiting]: ["awaiting_response", "not_contacted", "removed"].includes(value)
  });
}

function NewStudentDrawer({ item }: { item: StaffNewStudentAdmissionsOperation }) {
  return (
    <>
      <div className={styles.nextAction}>
        <span>Primary next action</span>
        <strong>{plainLanguageAdmissionsLabel(item.primaryNextAction)}</strong>
      </div>
      <div className={styles.facts}>
        <div className={styles.fact}><span>Journey stage</span><strong>{newStudentJourneyStageLabels[item.journeyStage]}</strong></div>
        <div className={styles.fact}><span>Programme</span><strong>{item.programme === "pgcert" ? "PGCert" : "Microcredential"}</strong></div>
        <div className={styles.fact}><span>Last activity</span><strong>{formatDate(item.lastActivityAt)}</strong></div>
        <div className={styles.fact}><span>Current deadline</span><strong>{formatDate(item.currentDeadlineAt)}</strong></div>
      </div>
      <section className={styles.drawerSection}>
        <span>Attention</span>
        <div className={styles.pillRow}>
          {item.attentionIndicators.length > 0
            ? item.attentionIndicators.map((indicator) => <span className={statusClass(indicator)} key={indicator}>{plainLanguageAdmissionsLabel(indicator)}</span>)
            : <span className={styles.pill}>No current indicator</span>}
        </div>
      </section>
      <section className={styles.drawerSection}>
        <span>Authoritative workflow state</span>
        <p>Application: <strong>{plainLanguageAdmissionsLabel(item.applicationStatus ?? "not_started")}</strong></p>
        <p>Offer: <strong>{plainLanguageAdmissionsLabel(item.offerStatus ?? "not_started")}</strong></p>
        <p>Registration: <strong>{plainLanguageAdmissionsLabel(item.registrationStatus ?? "not_started")}</strong></p>
      </section>
      <Link className={styles.primaryLink} href={`/admissions/new-students/${item.admissionLeadId}`}>
        Open full admissions record <ArrowRight size={13} />
      </Link>
    </>
  );
}

function ReturningStudentDrawer({
  item,
  email
}: {
  item: StaffReturningStudentAdmissionsOperation;
  email: { enabled: boolean; mode: string; missing: string[] };
}) {
  return (
    <>
      <div className={styles.nextAction}>
        <span>Primary next action</span>
        <strong>{plainLanguageAdmissionsLabel(item.primaryNextAction)}</strong>
      </div>
      <div className={styles.facts}>
        <div className={styles.fact}><span>Current status</span><strong>{plainLanguageAdmissionsLabel(item.currentStatus)}</strong></div>
        <div className={styles.fact}><span>Formally awarded credits</span><strong>{item.currentAwardedCredits}</strong></div>
        <div className={styles.fact}><span>Status at inclusion</span><strong>{plainLanguageAdmissionsLabel(item.snapshotStatus)}</strong></div>
        <div className={styles.fact}><span>Credits at inclusion</span><strong>{item.snapshotAwardedCredits}</strong></div>
      </div>
      <section className={styles.drawerSection}>
        <span>Contact</span>
        <div className={styles.pillRow}>
          <span className={statusClass(item.contactState)}>{plainLanguageAdmissionsLabel(item.contactState)}</span>
          <span className={styles.pill}>{item.contactAttemptCount} attempt{item.contactAttemptCount === 1 ? "" : "s"}</span>
        </div>
        <p>{item.latestContactRecipientEmail ?? item.currentEmail ?? "No usable recipient address"}</p>
      </section>
      <section className={styles.drawerSection}>
        <span>Response</span>
        <div className={styles.pillRow}><span className={statusClass(item.responseState)}>{plainLanguageAdmissionsLabel(item.responseState)}</span></div>
        <p>Replacement returning-student response and confirmation records land in the complete cycle-workflow slice.</p>
      </section>
      <section className={styles.drawerSection}>
        <span>Eligibility and membership</span>
        <p>Included by: <strong>{plainLanguageAdmissionsLabel(item.inclusionBasis)}</strong></p>
        <p>Current email: <strong>{item.currentEmail ?? "Missing"}</strong></p>
        {item.hasEligibilityChange ? <p><strong>Current eligibility facts differ from the inclusion snapshot.</strong></p> : null}
        {item.blockingReason ? <p><strong>{plainLanguageAdmissionsLabel(item.blockingReason)}</strong></p> : null}
      </section>
      <section className={styles.drawerSection}>
        <span>Email pilot safety</span>
        <AdmissionsEmailPilotControls
          recordType="returning_student"
          entityId={item.studentId}
          displayName={item.studentName}
          recipientEmail={item.currentEmail}
          recipientAllowlisted={item.pilotRecipientAllowlisted}
          emailEnabled={email.enabled}
          emailMode={email.mode}
          configurationReady={email.missing.length === 0}
          testRecord={item.pilotTestRecord}
        />
      </section>
    </>
  );
}

function RecordDrawer({
  item,
  workspace,
  onClose,
  closeButtonRef,
  drawerRef,
  emailConfig
}: {
  item: StaffNewStudentAdmissionsOperation | StaffReturningStudentAdmissionsOperation;
  workspace: "new_students" | "returning_students";
  onClose: () => void;
  closeButtonRef: React.RefObject<HTMLButtonElement | null>;
  drawerRef: React.RefObject<HTMLElement | null>;
  emailConfig?: { enabled: boolean; mode: string; missing: string[] };
}) {
  const name = workspace === "new_students"
    ? (item as StaffNewStudentAdmissionsOperation).applicantName
    : (item as StaffReturningStudentAdmissionsOperation).studentName;
  const reference = workspace === "new_students"
    ? (item as StaffNewStudentAdmissionsOperation).admissionLeadId
    : (item as StaffReturningStudentAdmissionsOperation).studentReference;
  const email = workspace === "new_students"
    ? (item as StaffNewStudentAdmissionsOperation).email
    : (item as StaffReturningStudentAdmissionsOperation).currentEmail;

  return (
    <>
      <div className={styles.drawerBackdrop} aria-hidden="true" onClick={onClose} />
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="admissions-drawer-title" ref={drawerRef}>
        <div className={styles.drawerHeader}>
          <div>
            <h2 id="admissions-drawer-title">{name}</h2>
            <p>{reference} · {email ?? "No usable email"}</p>
          </div>
          <button className={styles.iconButton} onClick={onClose} ref={closeButtonRef} type="button" aria-label="Close record drawer"><X size={16} /></button>
        </div>
        <div className={styles.drawerBody}>
          {workspace === "new_students"
            ? <NewStudentDrawer item={item as StaffNewStudentAdmissionsOperation} />
            : <ReturningStudentDrawer item={item as StaffReturningStudentAdmissionsOperation} email={emailConfig ?? { enabled: false, mode: "disabled", missing: [] }} />}
        </div>
      </aside>
    </>
  );
}

export function AdmissionsOperationsTable(props: OperationsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const currentSearchParams = useSearchParams();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const materialQueryKey = props.workspace === "new_students"
    ? `${props.query.search}|${props.query.attention}|${props.query.stage}|${props.query.pageSize}`
    : `${props.query.search}|${props.query.attention}|${props.query.status}|${props.query.pageSize}`;
  const [selection, setSelection] = useState<{
    queryKey: string;
    ids: Set<string>;
    allMatching: boolean;
  }>(() => ({ queryKey: materialQueryKey, ids: new Set(), allMatching: false }));
  const selectionIsCurrent = selection.queryKey === materialQueryKey;
  const selectedIds = selectionIsCurrent ? selection.ids : new Set<string>();
  const allMatching = selectionIsCurrent && selection.allMatching;

  useEffect(() => {
    if (!focusedId) return;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setFocusedId(null);
      }
      if (event.key === "Tab" && drawerRef.current) {
        const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (first && last && event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (first && last && !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [focusedId]);

  useEffect(() => {
    if (!focusedId && restoreFocusRef.current) {
      restoreFocusRef.current.focus();
      restoreFocusRef.current = null;
    }
  }, [focusedId]);

  const itemIds = useMemo(
    () => props.items.map((item) => props.workspace === "new_students"
      ? (item as StaffNewStudentAdmissionsOperation).admissionLeadId
      : (item as StaffReturningStudentAdmissionsOperation).participantId),
    [props.items, props.workspace]
  );
  const visibleAllSelected = itemIds.length > 0 && itemIds.every((id) => selectedIds.has(id));
  const focusedItem = props.items.find((item) =>
    props.workspace === "new_students"
      ? (item as StaffNewStudentAdmissionsOperation).admissionLeadId === focusedId
      : (item as StaffReturningStudentAdmissionsOperation).participantId === focusedId
  );
  const selectedCount = allMatching ? props.total : selectedIds.size;
  const totalPages = Math.max(1, Math.ceil(props.total / props.query.pageSize));
  const page = Math.min(props.query.page, totalPages);
  const start = props.total === 0 ? 0 : (page - 1) * props.query.pageSize + 1;
  const end = Math.min(page * props.query.pageSize, props.total);

  function confirmMaterialFilterChange(): boolean {
    if (selectedCount === 0) return true;
    return window.confirm("Changing this filter will clear the current admissions selection. Continue?");
  }

  function navigate(changes: Record<string, string | null>, material = false) {
    if (material && !confirmMaterialFilterChange()) return;
    if (material) {
      setSelection({ queryKey: materialQueryKey, ids: new Set(), allMatching: false });
    }
    const params = new URLSearchParams(currentSearchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === "all") params.delete(key);
      else params.set(key, value);
    }
    if (material) params.delete("page");
    router.replace(params.size > 0 ? `${pathname}?${params}` : pathname, { scroll: false });
  }

  function toggleVisible() {
    setSelection((current) => {
      const next = new Set(current.queryKey === materialQueryKey ? current.ids : []);
      if (visibleAllSelected) itemIds.forEach((id) => next.delete(id));
      else itemIds.forEach((id) => next.add(id));
      return { queryKey: materialQueryKey, ids: next, allMatching: false };
    });
  }

  function toggleOne(id: string) {
    setSelection((current) => {
      const next = new Set(current.queryKey === materialQueryKey ? current.ids : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { queryKey: materialQueryKey, ids: next, allMatching: false };
    });
  }

  function openDrawer(id: string, trigger: HTMLElement) {
    restoreFocusRef.current = trigger;
    setFocusedId(id);
  }

  return (
    <>
      {props.workspace === "new_students" ? (
        <div className={styles.stageStrip} aria-label="New-student journey stages">
          {newStudentJourneyStages.map((stage) => (
            <button
              className={clsx(styles.stageButton, props.query.stage === stage && styles.stageActive)}
              onClick={() => navigate({ stage }, true)}
              type="button"
              key={stage}
              aria-pressed={props.query.stage === stage}
            >
              <strong>{props.stageCounts[stage] ?? 0}</strong>
              <span>{newStudentJourneyStageLabels[stage]}</span>
            </button>
          ))}
        </div>
      ) : null}

      <section className={styles.surface}>
        <div className={styles.surfaceHeader}>
          <div>
            <h2>{props.workspace === "new_students" ? "Admissions records" : "Cycle participants"}</h2>
            <p>{props.total} matching record{props.total === 1 ? "" : "s"} · source state and primary next action</p>
          </div>
        </div>

        <div className={styles.filterRow}>
          <form
            className={styles.filterGroup}
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              navigate({ q: String(formData.get("q") ?? "").trim() || null }, true);
            }}
          >
            <label className={styles.search}>
              <Search size={14} aria-hidden="true" />
              <input name="q" defaultValue={props.query.search} key={props.query.search} placeholder="Search name, email or reference" aria-label="Search admissions records" />
            </label>
            <button className={styles.secondaryButton} type="submit">Search</button>
          </form>
          <div className={styles.filterGroup}>
            {props.workspace === "returning_students" ? (
              <select
                className={styles.filterSelect}
                value={props.query.status}
                onChange={(event) => navigate({ status: event.target.value }, true)}
                aria-label="Current or membership status"
              >
                {returningStudentWorkspaceStatuses.map((status) => <option value={status} key={status}>{plainLanguageAdmissionsLabel(status)}</option>)}
              </select>
            ) : (
              <button className={styles.secondaryButton} onClick={() => navigate({ stage: null }, true)} type="button">All stages</button>
            )}
            {admissionsAttentionFilters.map((filter) => (
              <button
                className={clsx(styles.filterButton, props.query.attention === filter && styles.filterButtonActive)}
                onClick={() => navigate({ attention: filter }, true)}
                type="button"
                aria-pressed={props.query.attention === filter}
                key={filter}
              >
                {plainLanguageAdmissionsLabel(filter)}
              </button>
            ))}
          </div>
        </div>

        {selectedCount > 0 ? (
          <div className={styles.selectionBar} role="status" aria-live="polite">
            <div>
              <strong>{allMatching ? `${props.total} matching records selected` : `${selectedIds.size} selected`}</strong>
              <p>{allMatching ? "Scope: all eligible records matching the current visible filters." : "Scope: explicitly selected records across visited pages."}</p>
            </div>
            <div className={styles.selectionActions}>
              {props.workspace === "new_students" ? (
                <AdmissionsBatchActionDialog
                  selectedIds={[...selectedIds]}
                  allMatching={allMatching}
                  total={props.total}
                  filters={{ search: props.query.search, attention: props.query.attention, stage: props.query.stage }}
                />
              ) : null}
              {!allMatching && selectedIds.size < props.total ? (
                <button className={styles.linkButton} onClick={() => setSelection({ queryKey: materialQueryKey, ids: new Set(), allMatching: true })} type="button">
                  Select all {props.total} matching
                </button>
              ) : null}
              <button className={styles.linkButton} onClick={() => setSelection({ queryKey: materialQueryKey, ids: new Set(), allMatching: false })} type="button">Clear</button>
            </div>
          </div>
        ) : null}

        <div className={styles.tableWrap}>
          <table className={styles.operationsTable}>
            <thead>
              {props.workspace === "new_students" ? (
                <tr><th><input type="checkbox" checked={visibleAllSelected} onChange={toggleVisible} aria-label="Select visible records" /></th><th>Applicant</th><th>Stage</th><th>Programme</th><th>Attention</th><th>Deadline / activity</th><th>Primary next action</th><th><span className={styles.srOnly}>Open</span></th></tr>
              ) : (
                <tr><th><input type="checkbox" checked={visibleAllSelected} onChange={toggleVisible} aria-label="Select visible participants" /></th><th>Participant</th><th>Status / credits</th><th>Contact</th><th>Response</th><th>Eligibility</th><th>Primary next action</th><th><span className={styles.srOnly}>Open</span></th></tr>
              )}
            </thead>
            <tbody>
              {props.items.map((item) => {
                if (props.workspace === "new_students") {
                  const row = item as StaffNewStudentAdmissionsOperation;
                  return (
                    <tr className={focusedId === row.admissionLeadId ? styles.focusedRow : undefined} key={row.admissionLeadId}>
                      <td><input type="checkbox" checked={selectedIds.has(row.admissionLeadId)} onChange={() => toggleOne(row.admissionLeadId)} aria-label={`Select ${row.applicantName}`} /></td>
                      <td><div className={styles.nameCell}><strong>{row.applicantName}</strong><small>{row.email} · {row.admissionLeadId.slice(0, 8)}</small></div></td>
                      <td><span className={styles.pill}>{newStudentJourneyStageLabels[row.journeyStage]}</span></td>
                      <td><div className={styles.detailCell}><strong>{row.programme === "pgcert" ? "PGCert" : "Microcredential"}</strong><small>{row.targetTermId ? `Term ${row.targetTermId.slice(0, 8)}` : "Intake not selected"}</small></div></td>
                      <td>{row.leadingAttentionIndicator ? <span className={`${styles.pill} ${styles.pillAttention}`}>{plainLanguageAdmissionsLabel(row.leadingAttentionIndicator)}</span> : <span className={styles.pill}>No indicator</span>}</td>
                      <td><div className={styles.detailCell}><strong>{formatDate(row.currentDeadlineAt)}</strong><small>Activity {formatDate(row.lastActivityAt)}</small></div></td>
                      <td><strong>{plainLanguageAdmissionsLabel(row.primaryNextAction)}</strong></td>
                      <td><button className={styles.smallButton} onClick={(event) => openDrawer(row.admissionLeadId, event.currentTarget)} type="button">Open <ArrowRight size={11} /></button></td>
                    </tr>
                  );
                }
                const row = item as StaffReturningStudentAdmissionsOperation;
                return (
                  <tr className={focusedId === row.participantId ? styles.focusedRow : undefined} key={row.participantId}>
                    <td><input type="checkbox" checked={selectedIds.has(row.participantId)} onChange={() => toggleOne(row.participantId)} aria-label={`Select ${row.studentName}`} /></td>
                    <td><div className={styles.nameCell}><strong>{row.studentName}</strong><small>{row.studentReference} · {row.currentEmail ?? "No usable email"}</small></div></td>
                    <td><div className={styles.pillRow}><span className={styles.pill}>{plainLanguageAdmissionsLabel(row.currentStatus)}</span><span className={styles.pill}>{row.currentAwardedCredits} cr</span></div></td>
                    <td><span className={statusClass(row.contactState)}>{plainLanguageAdmissionsLabel(row.contactState)} · {row.contactAttemptCount}</span></td>
                    <td><span className={statusClass(row.responseState)}>{plainLanguageAdmissionsLabel(row.responseState)}</span></td>
                    <td>{row.blockingReason ? <span className={`${styles.pill} ${styles.pillAttention}`}>{plainLanguageAdmissionsLabel(row.blockingReason)}</span> : row.hasEligibilityChange ? <span className={`${styles.pill} ${styles.pillWaiting}`}>Changed since inclusion</span> : <span className={styles.pill}>Current</span>}</td>
                    <td><strong>{plainLanguageAdmissionsLabel(row.primaryNextAction)}</strong></td>
                    <td><button className={styles.smallButton} onClick={(event) => openDrawer(row.participantId, event.currentTarget)} type="button">Open <ArrowRight size={11} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {props.items.length === 0 ? <div className={styles.emptyRows}>No records match the current filters.</div> : null}
        </div>

        <div className={styles.pagination}>
          <span>Showing {start}–{end} of {props.total}</span>
          <div className={styles.paginationControls}>
            <select className={styles.pageSelect} value={props.query.pageSize} onChange={(event) => navigate({ page_size: event.target.value }, true)} aria-label="Rows per page">
              <option value="25">25 rows</option><option value="50">50 rows</option><option value="100">100 rows</option>
            </select>
            <button className={styles.iconButton} onClick={() => navigate({ page: String(Math.max(1, page - 1)) })} type="button" disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={14} /></button>
            <span>Page {page} of {totalPages}</span>
            <button className={styles.iconButton} onClick={() => navigate({ page: String(Math.min(totalPages, page + 1)) })} type="button" disabled={page >= totalPages} aria-label="Next page"><ChevronRight size={14} /></button>
          </div>
        </div>
      </section>

      {focusedItem ? (
        <RecordDrawer
          item={focusedItem}
          workspace={props.workspace}
          onClose={() => setFocusedId(null)}
          closeButtonRef={closeButtonRef}
          drawerRef={drawerRef}
          emailConfig={props.workspace === "returning_students" ? props.email : undefined}
        />
      ) : null}
    </>
  );
}
