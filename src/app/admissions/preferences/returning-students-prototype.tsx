"use client";

// Three variants of the returning-student admissions workspace, switchable via
// `?variant=`, on the existing `/admissions/preferences` route. PROTOTYPE — throw away.

import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Mail,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings2,
  UserPlus,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import styles from "./returning-students-prototype.module.css";

type LearnerStatus = "Active" | "Deferred" | "Interrupted";
type ContactState = "Not contacted" | "Queued" | "Sent" | "Failed";
type ResponseState = "Awaiting response" | "Modules selected" | "Study break";
type Outcome = "Unresolved" | "Ready to confirm" | "Part confirmed" | "Confirmed" | "Follow-up" | "Blocked";

type Participant = {
  id: string;
  name: string;
  email: string;
  status: LearnerStatus;
  credits: number;
  contact: ContactState;
  attempts: number;
  response: ResponseState;
  selections: string[];
  outcome: Outcome;
  attention: string;
  nextAction: string;
  snapshot: string;
  updated: string;
};

type ModuleDemand = { code: string; name: string; planned: number; selected: number; confirmed: number };

const modules: ModuleDemand[] = [
  { code: "POCUS701", name: "Core Point-of-Care Ultrasound", planned: 72, selected: 84, confirmed: 38 },
  { code: "POCUS702", name: "Ultrasound Physics", planned: 60, selected: 62, confirmed: 31 },
  { code: "POCUS703", name: "Clinical Practice", planned: 48, selected: 45, confirmed: 22 }
];

const participants: Participant[] = [
  { id: "ST-0284", name: "Amara Johnson", email: "amara.j@example.com", status: "Active", credits: 20, contact: "Sent", attempts: 1, response: "Modules selected", selections: ["POCUS701", "POCUS702"], outcome: "Ready to confirm", attention: "Ready to confirm", nextAction: "Confirm 2 modules", snapshot: "Active · 20 credits", updated: "24 min ago" },
  { id: "ST-0279", name: "Ben Thompson", email: "ben.thompson@example.com", status: "Deferred", credits: 40, contact: "Sent", attempts: 2, response: "Modules selected", selections: ["POCUS703"], outcome: "Ready to confirm", attention: "Reactivation will be scheduled", nextAction: "Confirm module", snapshot: "Deferred · 40 credits", updated: "41 min ago" },
  { id: "ST-0271", name: "Chinedu Eze", email: "chinedu.eze@example.com", status: "Interrupted", credits: 20, contact: "Failed", attempts: 2, response: "Awaiting response", selections: [], outcome: "Blocked", attention: "Latest email failed", nextAction: "Resolve contact problem", snapshot: "Interrupted · 20 credits", updated: "Yesterday" },
  { id: "ST-0268", name: "Daisy Cooper", email: "daisy.cooper@example.com", status: "Active", credits: 40, contact: "Sent", attempts: 1, response: "Study break", selections: [], outcome: "Follow-up", attention: "Return point not agreed", nextAction: "Complete study-break follow-up", snapshot: "Active · 40 credits", updated: "Yesterday" },
  { id: "ST-0264", name: "Elias Haddad", email: "elias.h@example.com", status: "Active", credits: 60, contact: "Sent", attempts: 1, response: "Modules selected", selections: ["POCUS701"], outcome: "Blocked", attention: "Confirm additional study", nextAction: "Confirm additional-study intent", snapshot: "Active · 40 credits", updated: "Yesterday" },
  { id: "ST-0258", name: "Farah Ali", email: "farah.ali@example.com", status: "Active", credits: 20, contact: "Not contacted", attempts: 0, response: "Awaiting response", selections: [], outcome: "Unresolved", attention: "Not contacted", nextAction: "Send initial contact", snapshot: "Active · 20 credits", updated: "2 days ago" },
  { id: "ST-0251", name: "George Evans", email: "george.evans@example.com", status: "Deferred", credits: 20, contact: "Queued", attempts: 1, response: "Awaiting response", selections: [], outcome: "Unresolved", attention: "Message queued", nextAction: "Wait for delivery", snapshot: "Deferred · 20 credits", updated: "2 days ago" },
  { id: "ST-0247", name: "Hannah Kim", email: "hannah.kim@example.com", status: "Active", credits: 40, contact: "Sent", attempts: 1, response: "Modules selected", selections: ["POCUS701", "POCUS703"], outcome: "Part confirmed", attention: "1 of 2 modules confirmed", nextAction: "Resolve second module", snapshot: "Active · 40 credits", updated: "3 days ago" },
  { id: "ST-0242", name: "Isaac Brown", email: "isaac.brown@example.com", status: "Interrupted", credits: 20, contact: "Sent", attempts: 2, response: "Awaiting response", selections: [], outcome: "Unresolved", attention: "Reminder due", nextAction: "Send reminder", snapshot: "Interrupted · 20 credits", updated: "5 days ago" },
  { id: "ST-0239", name: "Jasmin Singh", email: "jasmin.singh@example.com", status: "Active", credits: 40, contact: "Sent", attempts: 1, response: "Modules selected", selections: ["POCUS702"], outcome: "Confirmed", attention: "Planned enrolment created", nextAction: "No action", snapshot: "Active · 40 credits", updated: "6 days ago" },
  { id: "ST-0231", name: "Kai Roberts", email: "", status: "Active", credits: 20, contact: "Not contacted", attempts: 0, response: "Awaiting response", selections: [], outcome: "Blocked", attention: "No usable portal email", nextAction: "Set up portal access", snapshot: "Active · 20 credits", updated: "7 days ago" },
  { id: "ST-0228", name: "Layla Morgan", email: "layla.m@example.com", status: "Deferred", credits: 40, contact: "Sent", attempts: 1, response: "Study break", selections: [], outcome: "Follow-up", attention: "Return agreed: Jan 2027", nextAction: "Acknowledge study break", snapshot: "Deferred · 40 credits", updated: "7 days ago" }
];

const variants = [
  { key: "A", name: "Cycle operations table" },
  { key: "B", name: "Response triage desk" },
  { key: "C", name: "Module allocation studio" }
];

function WorkspaceTabs() {
  return <div className={styles.workspaceTabs}><button type="button">New students</button><button className={styles.activeTab} type="button">Returning students</button></div>;
}

function PrototypeBanner({ variant }: { variant: string }) {
  return <div className={styles.prototypeBanner}><span><strong>Throwaway prototype</strong> · Read-only sample data · Variant {variant}</span><span>Question: which structure makes a term cycle easiest to operate at scale?</span></div>;
}

function CycleHeader() {
  return (
    <div className={styles.cycleHeader}>
      <div><WorkspaceTabs /><p style={{ marginTop: 9 }}>Manage one explicit group of returning students for a future term.</p></div>
      <div className={styles.cycleActions}>
        <select className={styles.cycleSelect} defaultValue="sep-2026" aria-label="Returning-student cycle"><option value="sep-2026">September 2026 · Open</option><option value="jan-2027">January 2027 · Draft</option><option value="may-2026">May 2026 · Finalised</option></select>
        <button className={styles.button} type="button"><Settings2 size={14} /> Cycle settings</button>
        <button className={styles.primaryButton} type="button"><Mail size={14} /> Contact participants</button>
      </div>
    </div>
  );
}

function Lifecycle() {
  return <div className={styles.lifecycle}>{[
    ["Draft", "Participants and offerings captured"],
    ["Open", "Responses open · 6 days left"],
    ["Closed", "Review and confirm outcomes"],
    ["Finalised", "Every participant resolved"]
  ].map(([label, detail], index) => <div className={`${styles.lifeStep} ${index === 0 ? styles.lifeDone : ""} ${index === 1 ? styles.lifeActive : ""}`} data-index={index + 1} key={label}><strong>{label}</strong><span>{detail}</span></div>)}</div>;
}

function Metrics() {
  return <div className={styles.metrics}>
    <div className={styles.metric}><span>Participants</span><strong>238</strong><small>177 active · 42 deferred · 19 interrupted</small></div>
    <div className={styles.metric}><span>Successfully contacted</span><strong>207</strong><small>87% · 8 failed or blocked</small></div>
    <div className={styles.metric}><span>Responses</span><strong>151</strong><small>132 modules · 19 study breaks</small></div>
    <div className={`${styles.metric} ${styles.metricAlert}`}><span>Needs staff attention</span><strong>46</strong><small>28 ready to confirm · 18 exceptions</small></div>
  </div>;
}

function DemandStrip() {
  return <div className={styles.demandStrip}>{modules.map((module) => {
    const over = module.selected > module.planned;
    return <div className={styles.demandCard} key={module.code}>
      <div className={styles.demandTop}><div><strong>{module.code} · {module.name}</strong><span>Planned capacity {module.planned}</span></div><span className={`${styles.pill} ${over ? styles.warningPill : ""}`}>{over ? `+${module.selected - module.planned} demand` : `${module.planned - module.selected} spare`}</span></div>
      <div className={styles.bar}><div className={`${styles.barFill} ${over ? styles.barOver : ""}`} style={{ width: `${Math.min(100, (module.selected / module.planned) * 100)}%` }} /></div>
      <div className={styles.demandStats}><span><strong>{module.selected}</strong> selected</span><span><strong>{module.confirmed}</strong> confirmed</span><button className={styles.linkButton} type="button">Review demand</button></div>
    </div>;
  })}</div>;
}

function SearchBox({ value, onChange, placeholder = "Search name, email or ID" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className={styles.search}><Search size={14} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></label>;
}

function StatusPill({ participant }: { participant: Participant }) {
  return <span className={styles.statusPill}>{participant.status}</span>;
}

function ContactPill({ participant }: { participant: Participant }) {
  const extra = participant.contact === "Failed" ? styles.dangerPill : participant.contact === "Not contacted" ? styles.warningPill : "";
  return <span className={`${styles.contactPill} ${extra}`}>{participant.contact}{participant.attempts > 0 ? ` · ${participant.attempts}` : ""}</span>;
}

function ResponsePill({ participant }: { participant: Participant }) {
  return <span className={styles.responsePill}>{participant.response}</span>;
}

function OutcomePill({ participant }: { participant: Participant }) {
  const extra = participant.outcome === "Blocked" ? styles.dangerPill : participant.outcome === "Unresolved" || participant.outcome === "Follow-up" ? styles.warningPill : "";
  return <span className={`${styles.outcomePill} ${extra}`}>{participant.outcome}</span>;
}

function SelectionBar({ count, allMatching, onAll, onClear }: { count: number; allMatching: boolean; onAll: () => void; onClear: () => void }) {
  if (count === 0 && !allMatching) return null;
  return <div className={styles.selectionBar}>
    <div><strong>{allMatching ? "132 matching participants selected" : `${count} selected`}</strong>{!allMatching ? <button className={styles.linkButton} onClick={onAll} type="button">Select all 132 matching</button> : null}</div>
    <div className={styles.actions}><button className={styles.button} type="button"><Mail size={13} /> Contact</button><button className={styles.button} type="button"><Check size={13} /> Confirm valid selections</button><button className={styles.iconButton} type="button" aria-label="More actions"><MoreHorizontal size={15} /></button><button className={styles.linkButton} onClick={onClear} type="button">Clear</button></div>
  </div>;
}

function useParticipants() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LearnerStatus | "All">("All");
  const [selected, setSelected] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [focusedId, setFocusedId] = useState(participants[0].id);
  const filtered = useMemo(() => participants.filter((participant) => {
    const term = query.trim().toLowerCase();
    return (status === "All" || participant.status === status) && (!term || `${participant.name} ${participant.email} ${participant.id}`.toLowerCase().includes(term));
  }), [query, status]);
  function toggle(id: string) { setAllMatching(false); setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function clear() { setSelected([]); setAllMatching(false); }
  return { query, setQuery, status, setStatus, selected, setSelected, allMatching, setAllMatching, focusedId, setFocusedId, filtered, toggle, clear };
}

function ParticipantFocus({ participant, drawer = false, onClose }: { participant: Participant; drawer?: boolean; onClose?: () => void }) {
  const content = <>
    <div className={drawer ? styles.drawerHeader : styles.focusHeader}>
      <div><h2>{participant.name}</h2><p>{participant.id} · {participant.email || "No usable portal email"}</p><div className={styles.pills} style={{ marginTop: 8 }}><StatusPill participant={participant} /><OutcomePill participant={participant} /></div></div>
      {drawer ? <button className={styles.iconButton} onClick={onClose} type="button" aria-label="Close participant"><X size={15} /></button> : <button className={styles.button} type="button">Open full record <ArrowRight size={13} /></button>}
    </div>
    <div className={drawer ? styles.drawerBody : styles.focusBody}>
      <div className={styles.nextCard}><span>Primary next action</span><strong>{participant.nextAction}</strong><button className={styles.primaryButton} type="button">{participant.nextAction} <ArrowRight size={13} /></button></div>
      <div className={styles.facts}>
        <div className={styles.fact}><span>Current status</span><strong>{participant.status}</strong></div><div className={styles.fact}><span>Awarded credits</span><strong>{participant.credits}</strong></div>
        <div className={styles.fact}><span>At inclusion</span><strong>{participant.snapshot}</strong></div><div className={styles.fact}><span>Last updated</span><strong>{participant.updated}</strong></div>
      </div>
      <div className={styles.detail}><span>Contact</span><div className={styles.pills}><ContactPill participant={participant} /><button className={styles.smallButton} type="button">View {participant.attempts} attempt{participant.attempts === 1 ? "" : "s"}</button></div><p>Messages are deliberate and each attempt keeps its recipient address and result.</p></div>
      <div className={styles.detail}><span>Response</span><div className={styles.pills}><ResponsePill participant={participant} /></div><h3>{participant.selections.length ? participant.selections.join(" + ") : participant.response === "Study break" ? "No modules this term" : "No response yet"}</h3><p>{participant.response === "Study break" ? participant.attention : participant.selections.length === 2 ? "Two unranked provisional module selections." : participant.attention}</p></div>
      <div className={styles.detail}><span>Cycle history</span><p><strong>{participant.updated}</strong> · {participant.attention}</p><p><strong>8 Aug</strong> · Included from {participant.snapshot}</p><button className={styles.button} type="button">View full cycle history</button></div>
    </div>
  </>;
  if (!drawer) return <section className={styles.focus}>{content}</section>;
  return <><button className={styles.drawerBackdrop} onClick={onClose} type="button" aria-label="Close participant drawer" /><aside className={styles.drawer}>{content}</aside></>;
}

function VariantA() {
  const state = useParticipants();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const focused = participants.find((participant) => participant.id === state.focusedId) ?? participants[0];
  const visibleSelected = state.filtered.length > 0 && state.filtered.every((item) => state.selected.includes(item.id));
  return <>
    <CycleHeader /><Lifecycle /><Metrics /><DemandStrip />
    <section className={styles.surface}>
      <div className={styles.surfaceHeader}><div><h2>Cycle participants</h2><p>Included snapshot · sorted by primary next action</p></div><div className={styles.actions}><button className={styles.button} type="button"><RefreshCw size={13} /> Refresh eligibility</button><button className={styles.button} type="button"><UserPlus size={13} /> Manage participants</button></div></div>
      <div className={styles.tableToolbar}><div className={styles.actions}><SearchBox value={state.query} onChange={state.setQuery} /><button className={styles.button} type="button"><Filter size={13} /> Filters <span className={styles.pill}>3</span></button></div><div className={styles.pills}>{(["All", "Active", "Deferred", "Interrupted"] as const).map((status) => <button className={`${styles.pill} ${state.status === status ? styles.statusPill : ""}`} onClick={() => { state.setStatus(status); state.clear(); }} type="button" key={status}>{status}</button>)}</div></div>
      <SelectionBar count={state.selected.length} allMatching={state.allMatching} onAll={() => state.setAllMatching(true)} onClear={state.clear} />
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th><input type="checkbox" checked={visibleSelected} onChange={() => state.setSelected(visibleSelected ? [] : state.filtered.map((item) => item.id))} aria-label="Select visible participants" /></th><th>Participant</th><th>Status / credits</th><th>Contact</th><th>Response</th><th>Provisional selection</th><th>Outcome</th><th>Primary next action</th><th /></tr></thead>
        <tbody>{state.filtered.map((participant) => <tr className={state.focusedId === participant.id ? styles.focusedRow : ""} key={participant.id} onClick={() => { state.setFocusedId(participant.id); setDrawerOpen(true); }}>
          <td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={state.selected.includes(participant.id)} onChange={() => state.toggle(participant.id)} aria-label={`Select ${participant.name}`} /></td>
          <td><div className={styles.nameCell}><strong>{participant.name}</strong><small>{participant.id} · {participant.email || "No portal email"}</small></div></td>
          <td><div className={styles.pills}><StatusPill participant={participant} /><span className={styles.pill}>{participant.credits} cr</span></div></td>
          <td><ContactPill participant={participant} /></td><td><ResponsePill participant={participant} /></td>
          <td><div className={styles.selectionCell}><strong>{participant.selections.length ? participant.selections.join(" + ") : "—"}</strong><small>{participant.selections.length === 2 ? "2 modules" : participant.selections.length === 1 ? "1 module" : participant.response === "Study break" ? "Study break" : "No response"}</small></div></td>
          <td><OutcomePill participant={participant} /></td><td><strong>{participant.nextAction}</strong></td><td><button className={styles.smallButton} type="button">Open <ArrowRight size={11} /></button></td>
        </tr>)}</tbody>
      </table></div>
      <div className={styles.pagination}><span>Showing 1–12 of 238 participants</span><div className={styles.actions}><select defaultValue="50" aria-label="Rows per page"><option>25</option><option>50</option><option>100</option></select><button className={styles.iconButton} type="button"><ChevronLeft size={13} /></button><span>Page 1 of 5</span><button className={styles.iconButton} type="button"><ChevronRight size={13} /></button></div></div>
    </section>
    {drawerOpen ? <ParticipantFocus participant={focused} drawer onClose={() => setDrawerOpen(false)} /> : null}
  </>;
}

const queues = [
  ["Ready to confirm", 28], ["Contact problems", 8], ["Study-break follow-up", 19], ["Additional study check", 6], ["Reminder due", 34], ["Awaiting response", 87], ["Resolved", 56]
] as const;

function VariantB() {
  const state = useParticipants();
  const [queue, setQueue] = useState("Ready to confirm");
  const focused = participants.find((participant) => participant.id === state.focusedId) ?? participants[0];
  return <>
    <div className={styles.cycleHeader}><div><WorkspaceTabs /><p style={{ marginTop: 9 }}>September 2026 · Open · 6 days remaining</p></div><div className={styles.cycleActions}><span className={styles.statusPill}>238 participants</span><span className={`${styles.pill} ${styles.warningPill}`}>46 need attention</span><button className={styles.primaryButton} type="button"><Mail size={13} /> Contact</button></div></div>
    <div className={styles.splitDesk}>
      <aside className={styles.queueRail}><h2>Cycle work</h2><div className={styles.queueLabel}>Action queues</div>{queues.slice(0, 5).map(([label, count]) => <button className={`${styles.queueButton} ${queue === label ? styles.queueActive : ""}`} onClick={() => setQueue(label)} type="button" key={label}><span>{label}</span><strong>{count}</strong></button>)}<div className={styles.queueLabel}>Waiting and history</div>{queues.slice(5).map(([label, count]) => <button className={`${styles.queueButton} ${queue === label ? styles.queueActive : ""}`} onClick={() => setQueue(label)} type="button" key={label}><span>{label}</span><strong>{count}</strong></button>)}<div className={styles.queueLabel}>Cycle</div><button className={styles.queueButton} type="button"><span>Module demand</span><strong>3</strong></button><button className={styles.queueButton} type="button"><span>Participants</span><strong>238</strong></button></aside>
      <section className={styles.worklist}><div className={styles.worklistHeader}><div><h2>{queue}</h2><p>September 2026 · highest priority first</p></div><SearchBox value={state.query} onChange={state.setQuery} placeholder="Search this queue" /><div className={styles.actions}><button className={styles.button} type="button"><Filter size={12} /> Refine</button><button className={styles.button} type="button"><Check size={12} /> Select</button></div></div><SelectionBar count={state.selected.length} allMatching={state.allMatching} onAll={() => state.setAllMatching(true)} onClear={state.clear} /><div className={styles.worklistRows}>{state.filtered.map((participant) => <div className={`${styles.workRow} ${state.focusedId === participant.id ? styles.workRowActive : ""}`} key={participant.id} onClick={() => state.setFocusedId(participant.id)}><input type="checkbox" checked={state.selected.includes(participant.id)} onChange={() => state.toggle(participant.id)} onClick={(event) => event.stopPropagation()} aria-label={`Select ${participant.name}`} /><div><h3>{participant.name}</h3><p>{participant.status} · {participant.credits} credits · {participant.selections.join(" + ") || "No module selection"}</p><div className={styles.workMeta}><ContactPill participant={participant} /><ResponsePill participant={participant} /></div></div><span className={styles.workTime}>{participant.updated}</span></div>)}</div><div className={styles.pagination}><span>1–12 of 28</span><div className={styles.actions}><button className={styles.iconButton} type="button"><ChevronLeft size={13} /></button><button className={styles.iconButton} type="button"><ChevronRight size={13} /></button></div></div></section>
      <ParticipantFocus participant={focused} />
    </div>
  </>;
}

function AllocationCard({ participant, module }: { participant: Participant; module?: string }) {
  return <div className={styles.allocationCard}><h4>{participant.name}</h4><p>{participant.status} · {participant.credits} credits</p><div className={styles.allocationCardFooter}><span className={styles.pill}>{participant.outcome}</span>{module ? <button className={styles.smallButton} type="button">Confirm</button> : <button className={styles.smallButton} type="button">Open</button>}</div></div>;
}

function VariantC() {
  return <>
    <CycleHeader /><Lifecycle />
    <div className={styles.allocationSummary}><div className={styles.allocationMetric}><span>Provisional selections</span><strong>194</strong></div><div className={styles.allocationMetric}><span>Confirmed selections</span><strong>91</strong></div><div className={styles.allocationMetric}><span>Unresolved participants</span><strong>87</strong></div></div>
    <section className={styles.surface}><div className={styles.surfaceHeader}><div><h2>Allocation studio</h2><p>Selections are unranked. Planned capacity guides decisions but does not block confirmation.</p></div><div className={styles.actions}><button className={styles.button} type="button"><Filter size={13} /> Status groups <ChevronDown size={12} /></button><button className={styles.primaryButton} type="button"><Check size={13} /> Confirm selected</button></div></div></section>
    <div className={styles.allocationBoard}>
      {modules.map((module) => <section className={styles.allocationColumn} key={module.code}><div className={styles.allocationHeader}><div className={styles.demandTop}><h3>{module.code}</h3><span className={`${styles.pill} ${module.selected > module.planned ? styles.warningPill : ""}`}>{module.selected}/{module.planned}</span></div><p>{module.name}</p><div className={styles.bar}><div className={`${styles.barFill} ${module.selected > module.planned ? styles.barOver : ""}`} style={{ width: `${Math.min(100, module.selected / module.planned * 100)}%` }} /></div><button className={styles.linkButton} type="button">Adjust planned capacity</button></div><div className={styles.allocationList}>{participants.filter((participant) => participant.selections.includes(module.code)).slice(0, 5).map((participant) => <AllocationCard participant={participant} module={module.code} key={`${module.code}-${participant.id}`} />)}</div></section>)}
      <section className={styles.allocationColumn}><div className={styles.allocationHeader}><h3>Study break</h3><p>19 participants · follow-up required</p><span className={`${styles.pill} ${styles.warningPill}`}>7 unresolved</span></div><div className={styles.allocationList}>{participants.filter((participant) => participant.response === "Study break").map((participant) => <AllocationCard participant={participant} key={participant.id} />)}</div></section>
      <section className={styles.allocationColumn}><div className={styles.allocationHeader}><h3>No response</h3><p>87 participants · 34 reminders due</p><span className={`${styles.pill} ${styles.dangerPill}`}>8 contact problems</span></div><div className={styles.allocationList}>{participants.filter((participant) => participant.response === "Awaiting response").slice(0, 6).map((participant) => <AllocationCard participant={participant} key={participant.id} />)}</div></section>
    </div>
  </>;
}

export function ReturningStudentsPrototype({ variant }: { variant: string }) {
  const safe = variants.some((item) => item.key === variant) ? variant : "A";
  return <div className={styles.prototype}><PrototypeBanner variant={safe} />{safe === "A" ? <VariantA /> : null}{safe === "B" ? <VariantB /> : null}{safe === "C" ? <VariantC /> : null}<PrototypeSwitcher variants={variants} current={safe} /></div>;
}
