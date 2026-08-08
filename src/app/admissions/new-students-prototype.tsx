"use client";

// Three variants of the new-student admissions workspace, switchable via
// `?variant=`, on the existing `/admissions` route. PROTOTYPE — throw away.

import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Filter,
  ListFilter,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import styles from "./new-students-prototype.module.css";

type JourneyStage = "Enquiry" | "Application" | "Review" | "Offer" | "Registration" | "Complete" | "Closed";
type AttentionTone = "critical" | "warning" | "quiet";

type PrototypeApplicant = {
  id: string;
  name: string;
  email: string;
  stage: JourneyStage;
  programme: "PGCert" | "Microcredential";
  intake: string;
  attention: string;
  attentionTone: AttentionTone;
  nextAction: string;
  lastActivity: string;
  deadline: string;
  moduleInterest: string;
  source: string;
};

const stageData: Array<{ stage: JourneyStage; count: number; attention: number; waiting: number }> = [
  { stage: "Enquiry", count: 86, attention: 14, waiting: 52 },
  { stage: "Application", count: 74, attention: 21, waiting: 44 },
  { stage: "Review", count: 63, attention: 27, waiting: 19 },
  { stage: "Offer", count: 41, attention: 8, waiting: 31 },
  { stage: "Registration", count: 29, attention: 7, waiting: 18 },
  { stage: "Complete", count: 24, attention: 0, waiting: 0 },
  { stage: "Closed", count: 9, attention: 0, waiting: 0 }
];

const applicants: PrototypeApplicant[] = [
  { id: "AR-1048", name: "Maya Patel", email: "maya.patel@example.com", stage: "Review", programme: "PGCert", intake: "Sep 2026", attention: "Ready for decision", attentionTone: "warning", nextAction: "Review application", lastActivity: "18 min ago", deadline: "Today", moduleInterest: "Core POCUS, Clinical Practice", source: "Website enquiry" },
  { id: "AR-1047", name: "Daniel Okafor", email: "daniel.okafor@example.com", stage: "Review", programme: "PGCert", intake: "Sep 2026", attention: "Evidence rejected", attentionTone: "critical", nextAction: "Request correction", lastActivity: "42 min ago", deadline: "Overdue 2d", moduleInterest: "Core POCUS", source: "Referral" },
  { id: "AR-1046", name: "Sophie Williams", email: "sophie.w@example.com", stage: "Application", programme: "PGCert", intake: "Sep 2026", attention: "Draft inactive 9d", attentionTone: "warning", nextAction: "Send reminder", lastActivity: "9 days ago", deadline: "12 Aug", moduleInterest: "Physics, Clinical Practice", source: "Open day" },
  { id: "AR-1045", name: "Ahmed Rahman", email: "ahmed.rahman@example.com", stage: "Offer", programme: "PGCert", intake: "Sep 2026", attention: "Offer overdue", attentionTone: "critical", nextAction: "Review lapse", lastActivity: "13 days ago", deadline: "Overdue 3d", moduleInterest: "Core POCUS, Physics", source: "Website enquiry" },
  { id: "AR-1044", name: "Emily Chen", email: "emily.chen@example.com", stage: "Registration", programme: "PGCert", intake: "Sep 2026", attention: "Awaiting applicant", attentionTone: "quiet", nextAction: "Send reminder", lastActivity: "Yesterday", deadline: "16 Aug", moduleInterest: "Core POCUS", source: "Employer" },
  { id: "AR-1043", name: "Joseph Mensah", email: "j.mensah@example.com", stage: "Enquiry", programme: "Microcredential", intake: "Jan 2027", attention: "Follow-up due", attentionTone: "warning", nextAction: "Send invitation", lastActivity: "Yesterday", deadline: "Today", moduleInterest: "Physics", source: "Conference" },
  { id: "AR-1042", name: "Laura Bennett", email: "laura.bennett@example.com", stage: "Review", programme: "PGCert", intake: "Sep 2026", attention: "Corrections resubmitted", attentionTone: "warning", nextAction: "Review corrections", lastActivity: "Yesterday", deadline: "Today", moduleInterest: "Core POCUS", source: "Website enquiry" },
  { id: "AR-1041", name: "Priya Shah", email: "priya.shah@example.com", stage: "Application", programme: "Microcredential", intake: "Sep 2026", attention: "Awaiting applicant", attentionTone: "quiet", nextAction: "Wait for submission", lastActivity: "2 days ago", deadline: "20 Aug", moduleInterest: "Clinical Practice", source: "Referral" },
  { id: "AR-1040", name: "Thomas Reid", email: "thomas.reid@example.com", stage: "Registration", programme: "PGCert", intake: "Sep 2026", attention: "Ready to convert", attentionTone: "warning", nextAction: "Convert individually", lastActivity: "2 days ago", deadline: "Today", moduleInterest: "Core POCUS, Physics", source: "Employer" },
  { id: "AR-1039", name: "Fatima Noor", email: "fatima.noor@example.com", stage: "Offer", programme: "PGCert", intake: "Sep 2026", attention: "Awaiting applicant", attentionTone: "quiet", nextAction: "Wait for response", lastActivity: "3 days ago", deadline: "19 Aug", moduleInterest: "Core POCUS", source: "Website enquiry" },
  { id: "AR-1038", name: "Oliver Grant", email: "oliver.grant@example.com", stage: "Enquiry", programme: "PGCert", intake: "Jan 2027", attention: "No invitation sent", attentionTone: "quiet", nextAction: "Send invitation", lastActivity: "4 days ago", deadline: "—", moduleInterest: "Core POCUS", source: "Email" },
  { id: "AR-1037", name: "Rachel Moore", email: "rachel.moore@example.com", stage: "Closed", programme: "PGCert", intake: "Sep 2026", attention: "Rejected", attentionTone: "quiet", nextAction: "No action", lastActivity: "5 days ago", deadline: "—", moduleInterest: "Core POCUS", source: "Website enquiry" }
];

const variants = [
  { key: "A", name: "Operations table" },
  { key: "B", name: "Triage desk" },
  { key: "C", name: "Journey control room" }
];

function StagePill({ stage }: { stage: JourneyStage }) {
  return <span className={styles.stagePill}>{stage}</span>;
}

function AttentionPill({ applicant }: { applicant: PrototypeApplicant }) {
  const className = [
    styles.attentionPill,
    applicant.attentionTone === "critical" ? styles.attentionCritical : "",
    applicant.attentionTone === "quiet" ? styles.attentionQuiet : ""
  ].filter(Boolean).join(" ");
  return (
    <span className={className}>
      {applicant.attentionTone === "critical" ? <CircleAlert size={12} /> : null}
      {applicant.attention}
    </span>
  );
}

function WorkspaceTabs() {
  return (
    <div className={styles.workspaceTabs} aria-label="Admissions workspaces">
      <button className={styles.activeTab} type="button">New students</button>
      <button type="button">Returning students</button>
    </div>
  );
}

function PrototypeBanner({ variant }: { variant: string }) {
  return (
    <div className={styles.prototypeBanner}>
      <span><strong>Throwaway prototype</strong> · Read-only sample data · Variant {variant}</span>
      <span>Question: which information hierarchy makes hundreds of applications easiest to operate?</span>
    </div>
  );
}

function Metrics() {
  return (
    <div className={styles.metrics}>
      <div className={styles.metric}><span>Active admissions</span><strong>293</strong><small>326 including complete and closed</small></div>
      <div className={`${styles.metric} ${styles.metricAlert}`}><span>Needs staff attention</span><strong>77</strong><small>18 due today · 12 overdue</small></div>
      <div className={styles.metric}><span>Awaiting applicant</span><strong>164</strong><small>Across applications, offers and registration</small></div>
      <div className={styles.metric}><span>Ready to progress</span><strong>36</strong><small>Decision or registration action available</small></div>
    </div>
  );
}

function StageStrip({ current, onChange }: { current: JourneyStage | "All"; onChange: (stage: JourneyStage | "All") => void }) {
  return (
    <div className={styles.stageStrip} aria-label="Journey stage filter">
      {stageData.map((item) => (
        <button
          className={`${styles.stageButton} ${current === item.stage ? styles.stageButtonActive : ""}`}
          key={item.stage}
          onClick={() => onChange(current === item.stage ? "All" : item.stage)}
          type="button"
        >
          <span>{item.stage}</span>
          <strong>{item.count}</strong>
          <small>{item.attention > 0 ? `${item.attention} need attention` : "No active attention"}</small>
        </button>
      ))}
    </div>
  );
}

function SearchBox({ query, onChange, placeholder = "Search name, email or ID" }: { query: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className={styles.searchBox}>
      <Search size={15} aria-hidden="true" />
      <input value={query} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

function SelectionBar({ selectedCount, allMatching, onAllMatching, onClear }: { selectedCount: number; allMatching: boolean; onAllMatching: () => void; onClear: () => void }) {
  if (selectedCount === 0 && !allMatching) return null;
  return (
    <div className={styles.selectionBar}>
      <div>
        <strong>{allMatching ? "63 matching records selected" : `${selectedCount} selected`}</strong>
        {!allMatching ? <button className={styles.quietButton} type="button" onClick={onAllMatching}>Select all 63 matching</button> : null}
      </div>
      <div className={styles.actions}>
        <button className={styles.button} type="button"><Mail size={14} /> Send message</button>
        <button className={styles.button} type="button"><Clock3 size={14} /> Mark overdue as lapsed</button>
        <button className={styles.iconButton} type="button" aria-label="More bulk actions"><MoreHorizontal size={16} /></button>
        <button className={styles.quietButton} type="button" onClick={onClear}>Clear</button>
      </div>
    </div>
  );
}

function ApplicantDossier({ applicant, onClose, inline = false }: { applicant: PrototypeApplicant; onClose?: () => void; inline?: boolean }) {
  const stageIndex = stageData.findIndex((stage) => stage.stage === applicant.stage);
  const content = (
    <>
      <div className={inline ? styles.dossierHeader : styles.drawerHeader}>
        <div>
          <h2>{applicant.name}</h2>
          <p>{applicant.id} · {applicant.email}</p>
          <div className={styles.inlineMeta} style={{ marginTop: 8 }}><StagePill stage={applicant.stage} /><AttentionPill applicant={applicant} /></div>
        </div>
        {onClose ? <button className={styles.iconButton} type="button" onClick={onClose} aria-label="Close applicant dossier"><X size={16} /></button> : <button className={styles.button} type="button">Open full record <ArrowRight size={14} /></button>}
      </div>
      <div className={inline ? styles.dossierBody : styles.drawerBody}>
        <div className={styles.nextActionCard}>
          <span>Primary next action</span>
          <strong>{applicant.nextAction}</strong>
          <button className={styles.primaryButton} type="button">{applicant.nextAction} <ArrowRight size={14} /></button>
        </div>
        <div className={styles.detailBlock}>
          <span>Journey</span>
          <div className={styles.journey} aria-label={`Journey progress: ${applicant.stage}`}>
            {stageData.map((stage, index) => <i className={`${styles.journeyStep} ${index <= stageIndex ? styles.journeyStepDone : ""}`} key={stage.stage} />)}
          </div>
          <p>{applicant.stage} · Last activity {applicant.lastActivity}</p>
        </div>
        <div className={styles.keyFacts}>
          <div className={styles.fact}><span>Programme</span><strong>{applicant.programme}</strong></div>
          <div className={styles.fact}><span>Intake</span><strong>{applicant.intake}</strong></div>
          <div className={styles.fact}><span>Deadline</span><strong>{applicant.deadline}</strong></div>
          <div className={styles.fact}><span>Source</span><strong>{applicant.source}</strong></div>
        </div>
        <div className={styles.detailBlock}>
          <span>Application snapshot</span>
          <h3>Module interest</h3>
          <p>{applicant.moduleInterest}</p>
          <h3>Evidence</h3>
          <p>{applicant.attention === "Evidence rejected" ? "2 verified · 1 rejected · correction not yet requested" : "3 required · 3 received · 3 verified"}</p>
        </div>
        <div className={styles.detailBlock}>
          <span>Recent history</span>
          <p><strong>{applicant.lastActivity}</strong> · Applicant record updated</p>
          <p><strong>3 days ago</strong> · Application correspondence sent</p>
          <button className={styles.button} type="button">View full history</button>
        </div>
      </div>
    </>
  );

  if (inline) return <section className={styles.dossier}>{content}</section>;
  return (
    <>
      <button className={styles.drawerBackdrop} type="button" aria-label="Close dossier" onClick={onClose} />
      <aside className={styles.drawer}>{content}</aside>
    </>
  );
}

function usePrototypeRecords() {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<JourneyStage | "All">("All");
  const [selected, setSelected] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [focusedId, setFocusedId] = useState<string>(applicants[0].id);
  const filtered = useMemo(() => applicants.filter((applicant) => {
    const matchesStage = stage === "All" || applicant.stage === stage;
    const term = query.trim().toLowerCase();
    const matchesQuery = !term || `${applicant.name} ${applicant.email} ${applicant.id}`.toLowerCase().includes(term);
    return matchesStage && matchesQuery;
  }), [query, stage]);

  function toggleSelected(id: string) {
    setAllMatching(false);
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function clearSelection() {
    setSelected([]);
    setAllMatching(false);
  }

  return { query, setQuery, stage, setStage, selected, setSelected, allMatching, setAllMatching, focusedId, setFocusedId, filtered, toggleSelected, clearSelection };
}

function VariantA() {
  const state = usePrototypeRecords();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const focused = applicants.find((applicant) => applicant.id === state.focusedId) ?? applicants[0];
  const visibleSelected = state.filtered.length > 0 && state.filtered.every((applicant) => state.selected.includes(applicant.id));

  return (
    <>
      <WorkspaceTabs />
      <Metrics />
      <StageStrip current={state.stage} onChange={(stage) => { state.setStage(stage); state.clearSelection(); }} />
      <section className={styles.surface}>
        <div className={styles.surfaceHeader}>
          <div><h2>All admissions records</h2><p>Sorted by primary next action, then oldest activity</p></div>
          <div className={styles.actions}><button className={styles.button} type="button"><SlidersHorizontal size={14} /> Saved views <ChevronDown size={13} /></button><button className={styles.primaryButton} type="button"><Plus size={14} /> New enquiry</button></div>
        </div>
        <div className={styles.tableToolbar}>
          <div className={styles.toolbarGroup}><SearchBox query={state.query} onChange={state.setQuery} /><button className={styles.button} type="button"><Filter size={14} /> Filters <span className={styles.queuePill}>3</span></button></div>
          <div className={styles.filterPills}><span className={styles.filterPill}>Sep 2026 <X size={12} /></span><span className={styles.filterPill}>Needs attention <X size={12} /></span><button className={styles.quietButton} type="button">Clear</button></div>
        </div>
        <SelectionBar selectedCount={state.selected.length} allMatching={state.allMatching} onAllMatching={() => state.setAllMatching(true)} onClear={state.clearSelection} />
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th><input type="checkbox" checked={visibleSelected} onChange={() => state.setSelected(visibleSelected ? [] : state.filtered.map((item) => item.id))} aria-label="Select visible records" /></th><th>Applicant</th><th>Journey stage</th><th>Attention</th><th>Programme</th><th>Last activity</th><th>Deadline</th><th>Primary next action</th><th /></tr></thead>
            <tbody>
              {state.filtered.map((applicant) => (
                <tr key={applicant.id} className={state.focusedId === applicant.id ? styles.focusedRow : ""} onClick={() => { state.setFocusedId(applicant.id); setDrawerOpen(true); }}>
                  <td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={state.selected.includes(applicant.id)} onChange={() => state.toggleSelected(applicant.id)} aria-label={`Select ${applicant.name}`} /></td>
                  <td><div className={styles.nameCell}><strong>{applicant.name}</strong><small>{applicant.id} · {applicant.email}</small></div></td>
                  <td><StagePill stage={applicant.stage} /></td>
                  <td><AttentionPill applicant={applicant} /></td>
                  <td><span className={styles.programmePill}>{applicant.programme}</span></td>
                  <td>{applicant.lastActivity}</td><td>{applicant.deadline}</td><td><strong>{applicant.nextAction}</strong></td>
                  <td><button className={styles.actionButton} type="button">Open <ArrowRight size={12} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.pagination}><span>Showing 1–{state.filtered.length} of {state.stage === "All" ? "326" : stageData.find((item) => item.stage === state.stage)?.count}</span><div className={styles.actions}><select aria-label="Rows per page" defaultValue="50"><option>25 rows</option><option>50 rows</option><option>100 rows</option></select><button className={styles.iconButton} type="button"><ChevronLeft size={15} /></button><span>Page 1 of 7</span><button className={styles.iconButton} type="button"><ChevronRight size={15} /></button></div></div>
      </section>
      {drawerOpen ? <ApplicantDossier applicant={focused} onClose={() => setDrawerOpen(false)} /> : null}
    </>
  );
}

const triageQueues = [
  { label: "Needs attention", count: 77 },
  { label: "Ready for review", count: 18 },
  { label: "Corrections returned", count: 9 },
  { label: "Overdue deadlines", count: 12 },
  { label: "Ready to progress", count: 36 },
  { label: "Waiting for applicant", count: 164 }
];

function VariantB() {
  const state = usePrototypeRecords();
  const [queue, setQueue] = useState("Needs attention");
  const focused = applicants.find((applicant) => applicant.id === state.focusedId) ?? applicants[0];
  return (
    <>
      <div className={styles.surfaceHeader} style={{ border: "1px solid var(--line)", borderRadius: 8, background: "white" }}>
        <WorkspaceTabs />
        <div className={styles.inlineMeta}><span className={styles.attentionPill}><AlertTriangle size={12} /> 77 need attention</span><span className={styles.stagePill}>293 active</span><button className={styles.primaryButton} type="button"><Plus size={14} /> New enquiry</button></div>
      </div>
      <div className={styles.splitLayout}>
        <aside className={styles.queueRail}>
          <h2>Work queues</h2>
          <div className={styles.queueGroup}>
            <span className={styles.queueGroupLabel}>My work</span>
            {triageQueues.map((item) => <button className={`${styles.queueButton} ${queue === item.label ? styles.queueActive : ""}`} type="button" key={item.label} onClick={() => setQueue(item.label)}><span>{item.label}</span><strong>{item.count}</strong></button>)}
          </div>
          <div className={styles.queueGroup}>
            <span className={styles.queueGroupLabel}>Journey stage</span>
            {stageData.slice(0, 5).map((item) => <button className={styles.queueButton} type="button" key={item.stage} onClick={() => state.setStage(item.stage)}><span>{item.stage}</span><strong>{item.count}</strong></button>)}
          </div>
          <button className={styles.queueButton} type="button"><span><ListFilter size={13} /> Manage views</span></button>
        </aside>
        <section className={styles.worklist}>
          <div className={styles.worklistHeader}>
            <div><h2>{queue}</h2><p>Highest priority first · 77 records</p></div>
            <SearchBox query={state.query} onChange={state.setQuery} placeholder="Search this queue" />
            <div className={styles.inlineMeta}><button className={styles.button} type="button"><Filter size={13} /> Refine</button><button className={styles.button} type="button"><Check size={13} /> Select</button></div>
          </div>
          <SelectionBar selectedCount={state.selected.length} allMatching={state.allMatching} onAllMatching={() => state.setAllMatching(true)} onClear={state.clearSelection} />
          <div className={styles.worklistRows}>
            {state.filtered.map((applicant) => (
              <div className={`${styles.worklistRow} ${state.focusedId === applicant.id ? styles.worklistRowActive : ""}`} key={applicant.id} onClick={() => state.setFocusedId(applicant.id)}>
                <input type="checkbox" checked={state.selected.includes(applicant.id)} onChange={() => state.toggleSelected(applicant.id)} onClick={(event) => event.stopPropagation()} aria-label={`Select ${applicant.name}`} />
                <div><h3>{applicant.name}</h3><p>{applicant.id} · {applicant.programme} · {applicant.intake}</p><div className={styles.worklistMeta}><StagePill stage={applicant.stage} /><AttentionPill applicant={applicant} /></div></div>
                <span className={styles.worklistTime}>{applicant.lastActivity}</span>
              </div>
            ))}
          </div>
          <div className={styles.pagination}><span>1–12 of 77</span><div className={styles.actions}><button className={styles.iconButton} type="button"><ChevronLeft size={14} /></button><button className={styles.iconButton} type="button"><ChevronRight size={14} /></button></div></div>
        </section>
        <ApplicantDossier applicant={focused} inline />
      </div>
    </>
  );
}

function VariantC() {
  const state = usePrototypeRecords();
  const selectedStage = state.stage === "All" ? "Review" : state.stage;
  const selectedStageData = stageData.find((item) => item.stage === selectedStage) ?? stageData[2];
  const stageApplicants = applicants.filter((applicant) => applicant.stage === selectedStage);
  return (
    <>
      <div className={styles.surfaceHeader} style={{ border: "1px solid var(--line)", borderRadius: 8, background: "white" }}>
        <div><WorkspaceTabs /><p style={{ marginTop: 9 }}>A stage-level control room: start with flow health, then open the work.</p></div>
        <div className={styles.actions}><button className={styles.button} type="button"><Bell size={14} /> Activity</button><button className={styles.primaryButton} type="button"><Plus size={14} /> New enquiry</button></div>
      </div>
      <section className={styles.surface}>
        <div className={styles.surfaceHeader}><div><h2>Admissions journey</h2><p>326 records · 77 need attention · updated just now</p></div><div className={styles.filterPills}><span className={styles.filterPill}>Sep 2026 <X size={12} /></span><span className={styles.filterPill}>All programmes <ChevronDown size={12} /></span></div></div>
        <div className={styles.journeyMatrix} style={{ padding: 14 }}>
          {stageData.map((item) => (
            <button className={`${styles.matrixRow} ${selectedStage === item.stage ? styles.matrixRowActive : ""}`} type="button" key={item.stage} onClick={() => { state.setStage(item.stage); state.clearSelection(); }}>
              <span className={styles.matrixStage}><strong>{item.stage}</strong><span>{item.stage === "Review" ? "Submitted through decision" : item.stage === "Application" ? "Invited or drafting" : item.stage === "Registration" ? "Accepted through conversion" : "Journey records"}</span></span>
              <span className={styles.matrixCount}>{item.count}</span>
              <span className={styles.matrixBar}><span className={styles.barTrack}><span className={styles.barFill} style={{ width: `${Math.max(8, item.count)}%` }} /></span><small>{Math.round((item.count / 326) * 100)}% of all records</small></span>
              <span className={styles.matrixAttention}><strong>{item.attention > 0 ? `${item.attention} need attention` : "Clear"}</strong><small>{item.waiting > 0 ? `${item.waiting} awaiting applicant` : "No waiting work"}</small></span>
              <span className={styles.actionButton}>Open stage <ArrowRight size={12} /></span>
            </button>
          ))}
        </div>
      </section>
      <div className={styles.stageFocus}>
        <section className={styles.surface}>
          <div className={styles.surfaceHeader}><div><h2>{selectedStage} worklist</h2><p>{selectedStageData.count} records · priority actions grouped first</p></div><div className={styles.actions}><SearchBox query={state.query} onChange={state.setQuery} /><button className={styles.button} type="button"><Filter size={13} /> Filters</button></div></div>
          <SelectionBar selectedCount={state.selected.length} allMatching={state.allMatching} onAllMatching={() => state.setAllMatching(true)} onClear={state.clearSelection} />
          <div className={styles.tableWrap}>
            <table className={styles.table} style={{ minWidth: 720 }}>
              <thead><tr><th /><th>Applicant</th><th>Attention</th><th>Deadline</th><th>Next action</th><th /></tr></thead>
              <tbody>{stageApplicants.length > 0 ? stageApplicants.map((applicant) => (
                <tr key={applicant.id} onClick={() => state.setFocusedId(applicant.id)}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={state.selected.includes(applicant.id)} onChange={() => state.toggleSelected(applicant.id)} aria-label={`Select ${applicant.name}`} /></td><td><div className={styles.nameCell}><strong>{applicant.name}</strong><small>{applicant.id} · {applicant.programme}</small></div></td><td><AttentionPill applicant={applicant} /></td><td>{applicant.deadline}</td><td><strong>{applicant.nextAction}</strong></td><td><button className={styles.actionButton} type="button">Open</button></td></tr>
              )) : <tr><td colSpan={6}><span className={styles.muted}>Sample records are not populated for this stage. The production table would show the full filtered result.</span></td></tr>}</tbody>
            </table>
          </div>
          <div className={styles.pagination}><span>Showing representative records from {selectedStageData.count}</span><div className={styles.actions}><button className={styles.iconButton} type="button"><ChevronLeft size={14} /></button><button className={styles.iconButton} type="button"><ChevronRight size={14} /></button></div></div>
        </section>
        <aside className={styles.stageSummary}>
          <div><h2>{selectedStage} at a glance</h2><p>What is holding this stage up?</p></div>
          <div className={styles.actionGroups}>
            <div className={styles.actionGroup}><div><strong>Ready for staff action</strong><span>Decision or review is available</span></div><strong>{Math.max(0, Math.round(selectedStageData.attention * 0.55))}</strong></div>
            <div className={styles.actionGroup}><div><strong>Overdue</strong><span>Applicant deadline has passed</span></div><strong>{Math.max(0, Math.round(selectedStageData.attention * 0.25))}</strong></div>
            <div className={styles.actionGroup}><div><strong>Awaiting applicant</strong><span>No staff action currently due</span></div><strong>{selectedStageData.waiting}</strong></div>
            <div className={styles.actionGroup}><div><strong>Data inconsistency</strong><span>Source record requires repair</span></div><strong>{selectedStage === "Review" ? 2 : 0}</strong></div>
          </div>
          <button className={styles.primaryButton} type="button"><Send size={14} /> Contact eligible group</button>
          <button className={styles.button} type="button"><SlidersHorizontal size={14} /> Configure this view</button>
        </aside>
      </div>
    </>
  );
}

export function NewStudentsPrototype({ variant }: { variant: string }) {
  const safeVariant = variants.some((item) => item.key === variant) ? variant : "A";
  return (
    <div className={styles.prototype}>
      <PrototypeBanner variant={safeVariant} />
      {safeVariant === "A" ? <VariantA /> : null}
      {safeVariant === "B" ? <VariantB /> : null}
      {safeVariant === "C" ? <VariantC /> : null}
      <PrototypeSwitcher variants={variants} current={safeVariant} />
    </div>
  );
}
