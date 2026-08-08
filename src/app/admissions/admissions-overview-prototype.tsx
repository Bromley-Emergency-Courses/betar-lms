"use client";

// Three variants of the shared Admissions landing and navigation, switchable
// via `?variant=`, on the existing `/admissions` route. PROTOTYPE — throw away.

import {
  AlertTriangle,
  ArrowRight,
  Bell,
  FileWarning,
  Filter,
  LayoutDashboard,
  MailWarning,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  UserCheck
} from "lucide-react";
import { useState } from "react";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import styles from "./admissions-overview-prototype.module.css";

const variants = [
  { key: "A", name: "Two-workspace gateway" },
  { key: "B", name: "Combined priority inbox" },
  { key: "C", name: "Focused workspace preview" }
];

const newQueues = [
  ["Ready for application review", 18, true],
  ["Corrections resubmitted", 9, true],
  ["Evidence or data problems", 13, true],
  ["Overdue offer or registration", 12, true],
  ["Awaiting applicant", 164, false]
] as const;

const returningQueues = [
  ["Ready to confirm", 28, true],
  ["Contact problems", 8, true],
  ["Study-break follow-up", 19, true],
  ["Additional-study check", 6, true],
  ["Awaiting response", 87, false]
] as const;

const attentionItems = [
  { name: "Daniel Okafor", workflow: "New students", detail: "Evidence rejected · correction required", action: "Request correction", time: "42m" },
  { name: "Amara Johnson", workflow: "Returning students", detail: "Two module selections ready", action: "Confirm modules", time: "24m" },
  { name: "Ahmed Rahman", workflow: "New students", detail: "Offer overdue by 3 days", action: "Review lapse", time: "1h" },
  { name: "Chinedu Eze", workflow: "Returning students", detail: "Second contact attempt failed", action: "Resolve contact", time: "1d" },
  { name: "Laura Bennett", workflow: "New students", detail: "Corrections resubmitted", action: "Review corrections", time: "1d" },
  { name: "Daisy Cooper", workflow: "Returning students", detail: "Study break · return point not agreed", action: "Follow up", time: "1d" },
  { name: "Thomas Reid", workflow: "New students", detail: "Registration ready to convert", action: "Convert", time: "2d" }
];

function PrototypeBanner({ variant }: { variant: string }) {
  return <div className={styles.prototypeBanner}><span><strong>Throwaway prototype</strong> · Read-only sample data · Variant {variant}</span><span>Question: how should staff enter and move between two distinct Admissions workflows?</span></div>;
}

function LocalNav({ active = "Overview" }: { active?: "Overview" | "New students" | "Returning students" }) {
  return <nav className={styles.localNav} aria-label="Admissions sections">
    <button className={active === "Overview" ? styles.navActive : ""} type="button"><LayoutDashboard size={14} /> Overview</button>
    <button className={active === "New students" ? styles.navActive : ""} type="button"><UserCheck size={14} /> New students <span className={styles.alertBadge}>77</span></button>
    <button className={active === "Returning students" ? styles.navActive : ""} type="button"><RotateCcw size={14} /> Returning students <span className={styles.alertBadge}>46</span></button>
  </nav>;
}

function QueueList({ items }: { items: ReadonlyArray<readonly [string, number, boolean]> }) {
  return <div className={styles.queueList}><span className={styles.queueTitle}>Workload snapshot</span>{items.map(([label, count, attention]) => <div className={styles.queueRow} key={label}><span>{label}</span><strong className={attention ? styles.alertCount : ""}>{count}</strong></div>)}</div>;
}

function VariantA() {
  return <>
    <LocalNav />
    <div className={styles.pageIntro}><div><h2>Admissions overview</h2><p>Choose the workflow you are handling. Counts summarise current workload; records and actions remain inside their own workspace.</p></div><button className={styles.button} type="button"><Bell size={14} /> Recent activity</button></div>
    <div className={styles.workspaceGrid}>
      <section className={styles.workspaceCard}>
        <div className={styles.cardHeader}><div className={styles.cardIdentity}><span className={styles.cardIcon}><UserCheck size={19} /></span><div><h2>New students</h2><p>Enquiry through application, offer, registration and conversion</p></div></div><span className={styles.newBadge}>Live intake · Sep 2026</span></div>
        <div className={styles.cardMetrics}><div className={styles.cardMetric}><span>Active records</span><strong>293</strong></div><div className={`${styles.cardMetric} ${styles.cardMetricAlert}`}><span>Needs attention</span><strong>77</strong></div><div className={styles.cardMetric}><span>Ready to progress</span><strong>36</strong></div></div>
        <QueueList items={newQueues} />
        <div className={styles.cardFooter}><button className={styles.button} type="button"><Plus size={13} /> New enquiry</button><button className={styles.primaryButton} type="button">Open new-student workspace <ArrowRight size={13} /></button></div>
      </section>
      <section className={styles.workspaceCard}>
        <div className={styles.cardHeader}><div className={styles.cardIdentity}><span className={`${styles.cardIcon} ${styles.returningIcon}`}><RotateCcw size={19} /></span><div><h2>Returning students</h2><p>Term cycle participation, contact, response and confirmation</p></div></div><span className={styles.returningBadge}>Sep 2026 · Open · 6 days</span></div>
        <div className={styles.cardMetrics}><div className={styles.cardMetric}><span>Participants</span><strong>238</strong></div><div className={`${styles.cardMetric} ${styles.cardMetricAlert}`}><span>Needs attention</span><strong>46</strong></div><div className={styles.cardMetric}><span>Ready to confirm</span><strong>28</strong></div></div>
        <QueueList items={returningQueues} />
        <div className={styles.cardFooter}><button className={styles.button} type="button"><RefreshCw size={13} /> Change cycle</button><button className={styles.primaryButton} type="button">Open returning-student workspace <ArrowRight size={13} /></button></div>
      </section>
    </div>
    <section className={styles.exceptionSurface}><div className={styles.exceptionHeader}><h2>Cross-workflow exceptions</h2><p>Only system problems that can prevent valid work appear here; normal queues stay inside each workspace.</p></div><div className={styles.exceptionList}>
      <div className={styles.exceptionRow}><span className={styles.exceptionIcon}><FileWarning size={13} /></span><div><strong>2 data inconsistencies</strong><span>New-student source records require repair</span></div></div>
      <div className={styles.exceptionRow}><span className={styles.exceptionIcon}><MailWarning size={13} /></span><div><strong>8 contact failures</strong><span>Returning-student messages need attention</span></div></div>
      <div className={styles.exceptionRow}><span className={styles.exceptionIcon}><AlertTriangle size={13} /></span><div><strong>3 overdue background actions</strong><span>Operational batches have unresolved failures</span></div></div>
    </div></section>
  </>;
}

function VariantB() {
  const [queue, setQueue] = useState("All attention");
  return <div className={styles.cockpit}>
    <aside className={styles.cockpitRail}><h2>Admissions</h2><div className={styles.railLabel}>Priority</div>{[["All attention", 123], ["Due today", 31], ["Overdue", 20], ["System exceptions", 13]].map(([label, count]) => <button className={`${styles.railButton} ${queue === label ? styles.railActive : ""}`} onClick={() => setQueue(String(label))} type="button" key={label}><span>{label}</span><strong>{count}</strong></button>)}<div className={styles.railLabel}>Workspaces</div><button className={styles.railButton} type="button"><span>New students</span><strong>77</strong></button><button className={styles.railButton} type="button"><span>Returning students</span><strong>46</strong></button><div className={styles.railLabel}>Tools</div><button className={styles.railButton} type="button"><span>Background actions</span><strong>3</strong></button><button className={styles.railButton} type="button"><span>History</span></button></aside>
    <section className={styles.inbox}><div className={styles.cockpitHeader}><div><h2>{queue}</h2><p>Combined and prioritised across both workflows</p></div><button className={styles.button} type="button"><Bell size={13} /> Activity</button></div><div className={styles.inboxToolbar}><label className={styles.search}><Search size={13} /><input placeholder="Search admissions" aria-label="Search admissions" /></label><button className={styles.button} type="button"><Filter size={12} /> Filters</button></div><div className={styles.inboxRows}>{attentionItems.map((item) => <div className={styles.inboxRow} key={`${item.workflow}-${item.name}`}><div className={styles.inboxIdentity}><div className={styles.pills}><span className={item.workflow === "New students" ? styles.newBadge : styles.returningBadge}>{item.workflow}</span><span className={styles.alertBadge}>{item.action}</span></div><strong>{item.name}</strong><p>{item.detail}</p></div><span className={styles.inboxTime}>{item.time}</span></div>)}</div></section>
    <aside className={styles.cockpitSummary}><h2>Workload now</h2><p>Workflow summaries remain separate even though the inbox is combined.</p><div className={styles.summaryBlock}><div className={styles.summaryBlockHeader}><strong>New students</strong><span className={styles.newBadge}>293 active</span></div><div className={styles.summaryMetrics}><div className={styles.summaryMetric}><span>Attention</span><strong>77</strong></div><div className={styles.summaryMetric}><span>Ready</span><strong>36</strong></div><div className={styles.summaryMetric}><span>Waiting</span><strong>164</strong></div><div className={styles.summaryMetric}><span>Overdue</span><strong>12</strong></div></div><div className={styles.summaryBlockFooter}><button className={styles.linkButton} type="button">Open workspace <ArrowRight size={11} /></button></div></div><div className={styles.summaryBlock}><div className={styles.summaryBlockHeader}><strong>Returning students</strong><span className={styles.returningBadge}>Sep · Open</span></div><div className={styles.summaryMetrics}><div className={styles.summaryMetric}><span>Attention</span><strong>46</strong></div><div className={styles.summaryMetric}><span>Confirm</span><strong>28</strong></div><div className={styles.summaryMetric}><span>Waiting</span><strong>87</strong></div><div className={styles.summaryMetric}><span>Failures</span><strong>8</strong></div></div><div className={styles.summaryBlockFooter}><button className={styles.linkButton} type="button">Open workspace <ArrowRight size={11} /></button></div></div></aside>
  </div>;
}

function FocusNew() {
  return <><div className={styles.focusHeader}><div><span className={styles.newBadge}>New students</span><h2 style={{ marginTop: 7 }}>September 2026 intake</h2><p>Enquiry through conversion · updated just now</p></div><div className={styles.actions}><button className={styles.button} type="button"><Plus size={13} /> New enquiry</button><button className={styles.primaryButton} type="button">Open workspace <ArrowRight size={13} /></button></div></div><div className={styles.focusMetrics}><div className={styles.focusMetric}><span>Active</span><strong>293</strong></div><div className={styles.focusMetric}><span>Attention</span><strong>77</strong></div><div className={styles.focusMetric}><span>Waiting</span><strong>164</strong></div><div className={styles.focusMetric}><span>Ready</span><strong>36</strong></div></div><div className={styles.focusContent}><section className={styles.focusSection}><h3>Priority queues</h3><div className={styles.focusQueue}>{newQueues.map(([label, count]) => <div className={styles.focusQueueRow} key={label}><span>{label}</span><strong>{count}</strong></div>)}</div></section><section className={styles.focusSection}><h3>Recent activity</h3><div className={styles.activity}><div className={styles.activityRow}><i className={styles.activityDot} /><div><strong>Corrections resubmitted</strong><span>Laura Bennett · yesterday</span></div></div><div className={styles.activityRow}><i className={styles.activityDot} /><div><strong>Application submitted</strong><span>Maya Patel · yesterday</span></div></div><div className={styles.activityRow}><i className={styles.activityDot} /><div><strong>Offer accepted</strong><span>Emily Chen · 2 days ago</span></div></div></div></section></div></>;
}

function FocusReturning() {
  return <><div className={styles.focusHeader}><div><span className={styles.returningBadge}>Returning students</span><h2 style={{ marginTop: 7 }}>September 2026 cycle</h2><p>Open · 238 participants · closes in 6 days</p></div><div className={styles.actions}><button className={styles.button} type="button"><RefreshCw size={13} /> Change cycle</button><button className={styles.primaryButton} type="button">Open workspace <ArrowRight size={13} /></button></div></div><div className={styles.focusMetrics}><div className={styles.focusMetric}><span>Participants</span><strong>238</strong></div><div className={styles.focusMetric}><span>Attention</span><strong>46</strong></div><div className={styles.focusMetric}><span>Responses</span><strong>151</strong></div><div className={styles.focusMetric}><span>Confirm</span><strong>28</strong></div></div><div className={styles.focusContent}><section className={styles.focusSection}><h3>Priority queues</h3><div className={styles.focusQueue}>{returningQueues.map(([label, count]) => <div className={styles.focusQueueRow} key={label}><span>{label}</span><strong>{count}</strong></div>)}</div></section><section className={styles.focusSection}><h3>Module demand</h3><div className={styles.activity}><div className={styles.activityRow}><i className={styles.activityDot} /><div><strong>POCUS701 · 84 / 72</strong><span>12 above planned capacity</span></div></div><div className={styles.activityRow}><i className={styles.activityDot} /><div><strong>POCUS702 · 62 / 60</strong><span>2 above planned capacity</span></div></div><div className={styles.activityRow}><i className={styles.activityDot} /><div><strong>POCUS703 · 45 / 48</strong><span>3 within planned capacity</span></div></div></div></section></div></>;
}

function VariantC() {
  const [workspace, setWorkspace] = useState<"new" | "returning">("new");
  return <>
    <LocalNav active={workspace === "new" ? "New students" : "Returning students"} />
    <div className={styles.focusLayout}><aside className={styles.focusSelector}><h2>Choose workspace</h2><button className={`${styles.workspaceChoice} ${workspace === "new" ? styles.choiceActive : ""}`} onClick={() => setWorkspace("new")} type="button"><span><span className={styles.inline}><UserCheck size={14} /> New students</span><strong className={styles.alertBadge}>77</strong></span><p>Enquiries, applications, offers and registration</p></button><button className={`${styles.workspaceChoice} ${workspace === "returning" ? styles.choiceActive : ""}`} onClick={() => setWorkspace("returning")} type="button"><span><span className={styles.inline}><RotateCcw size={14} /> Returning students</span><strong className={styles.alertBadge}>46</strong></span><p>Term cycles, responses, module demand and confirmation</p></button><div className={styles.railLabel}>Shared</div><button className={styles.railButton} type="button"><span>System exceptions</span><strong>13</strong></button><button className={styles.railButton} type="button"><span>Background actions</span><strong>3</strong></button></aside><main className={styles.focusPane}>{workspace === "new" ? <FocusNew /> : <FocusReturning />}</main></div>
  </>;
}

export function AdmissionsOverviewPrototype({ variant }: { variant: string }) {
  const safe = variants.some((item) => item.key === variant) ? variant : "A";
  return <div className={styles.prototype}><PrototypeBanner variant={safe} />{safe === "A" ? <VariantA /> : null}{safe === "B" ? <VariantB /> : null}{safe === "C" ? <VariantC /> : null}<PrototypeSwitcher variants={variants} current={safe} /></div>;
}
