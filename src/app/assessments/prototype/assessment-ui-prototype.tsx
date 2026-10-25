"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarClock, Check, CheckCircle2, ChevronRight, CircleHelp, Clock3, FlaskConical, History, PauseCircle, Search, Settings2, ShieldCheck, X, XCircle } from "lucide-react";
import type { AssessmentAttempt, AssessmentOutcome, AssessmentPlan, AssessmentStatus } from "@/lib/assessment/types";
import styles from "./assessment-ui-prototype.module.css";

type Variant = "A" | "B" | "C";
type ComponentName = "Theory" | "Practical";
type Tone = "green" | "red" | "amber" | "blue" | "purple" | "grey";
type Action = "details" | "score" | "schedule" | "cancel" | "defer" | "resumeAssessment" | "enrolment" | "exception" | "history";
type Result = { name: ComponentName; score: number | null; passMark: number; scheduled: string | null; deferred: string | null; count: number };
type Entry = { title: string; detail: string; date: string; reason: string };
type Row = {
  id: string; studentId: string; name: string; identifier: string; module: string; title: string; cohort: string;
  status: AssessmentStatus; calculated: AssessmentStatus; credits: number; plan: AssessmentPlan;
  results: Result[]; reasons: string[]; attendance: string | null; exception: string | null;
  disposition: string | null; history: Entry[]; needsPlan: boolean;
};
type OpenAction = (row: Row, action?: Action, component?: ComponentName) => void;
type VariantProps = { rows: Row[]; open: OpenAction; canEdit: boolean; studentScoped?: boolean };
const variantNames: Record<Variant, string> = { A: "Compact register", B: "Review workspace", C: "Follow-up board" };
const statusTone: Record<AssessmentStatus, Tone> = { Pass: "green", Fail: "red", "In progress": "blue", Planned: "grey", Abandoned: "grey", "Module deferred": "purple", "Assessment deferred": "purple" };
const statusLabel: Record<AssessmentStatus, string> = { Pass: "Passed", Fail: "Failed", "In progress": "In progress", Planned: "Not started", Abandoned: "Abandoned", "Module deferred": "Module deferred", "Assessment deferred": "Assessment deferred" };

function humanIndicator(indicator: string) {
  if (indicator === "Attendance non-compliance") return "Attendance requirement not met";
  if (indicator === "Presentation incomplete") return "Presentation not completed";
  return indicator.replace("theory:", "Theory · ").replace("practical:", "Practical · ");
}

function initialRows(outcomes: AssessmentOutcome[], attempts: AssessmentAttempt[]): Row[] {
  return outcomes.map(outcome => {
    const assessment = outcome.assessment;
    return {
      id: outcome.enrolment_id, studentId: outcome.student_id, name: outcome.student_name, identifier: outcome.student_identifier,
      module: outcome.module_code, title: outcome.module_title, cohort: outcome.original_cohort,
      status: assessment.effective_status ?? "Planned", calculated: assessment.calculated_status ?? "Planned",
      credits: assessment.awarded_credits ?? 0, plan: assessment.plan, needsPlan: Boolean(assessment.needs_plan),
      results: Object.values(assessment.components ?? {}).map(result => ({ name: result.component === "theory" ? "Theory" : "Practical", score: result.score, passMark: result.pass_mark ?? (result.component === "theory" ? assessment.plan.theory_pass_mark : assessment.plan.practical_pass_mark) ?? 50,
        scheduled: result.arrangement_kind === "resit_schedule" && result.arrangement_state === "active" ? result.note || "Sitting arranged" : null,
        deferred: result.arrangement_kind === "assessment_deferral" && result.arrangement_state === "active" ? result.note || "Assessment postponed" : null, count: result.attempt_count })),
      reasons: (assessment.calculated_indicators ?? []).filter(indicator => !indicator.includes(":Resit")).map(humanIndicator),
      attendance: assessment.attendance_required ? `${assessment.attendance_actual} of ${assessment.attendance_required} required days recorded` : null,
      exception: assessment.overrides?.length ? assessment.overrides.map(override => override.kind === "indicator" ? `${humanIndicator(override.indicator)}: ${override.value ? "flag shown" : "flag hidden"}. ${override.reason}` : `${override.kind === "credits" ? "Credits" : "Status"} changed to ${override.value}. ${override.reason}`).join(" · ") : null,
      disposition: assessment.disposition,
      history: attempts.filter(attempt => attempt.enrolment_id === outcome.enrolment_id).map(attempt => ({
        title: `${attempt.component === "theory" ? "Theory" : "Practical"} ${attempt.score}% · ${attempt.passed ? "Passed" : "Failed"}`,
        detail: `${attempt.sequence ? `Attempt ${attempt.sequence}` : "Earlier result unavailable"} · ${attempt.origin} · ${!attempt.active ? "Withdrawn" : attempt.is_current ? "Current result" : "Earlier result"}`,
        date: attempt.sitting_date, reason: attempt.reason
      }))
    };
  });
}

function exampleRows(base: Row[]): Row[] {
  const template = base.find(row => !row.needsPlan);
  if (!template) return base;
  const result = (name: ComponentName, score: number | null, scheduled: string | null = null, deferred: string | null = null): Result => ({ name, score, scheduled, deferred, passMark: 50, count: score === null ? 0 : 1 });
  const example = (index: number, name: string, status: AssessmentStatus, results: Result[], extra: Partial<Row> = {}): Row => ({
    ...template, id: `example-${index}`, name, identifier: `DEMO-00${index}`, module: "POCUS-02", title: "Abdominal ultrasound", cohort: "Autumn 2026 · Example cohort", status, calculated: status,
    plan: { ...template.plan, mode: "practical", theory_scheme: "mcq", physics_weighting: false, requires_coursework: false, requires_viva: false },
    results, reasons: [], attendance: null, exception: null, disposition: null, credits: status === "Pass" ? 10 : 0, history: [], ...extra
  });
  return [
    example(1, "Amelia Taylor", "Fail", [result("Theory", 42), result("Practical", 76)]),
    example(2, "Daniel Morgan", "Fail", [result("Theory", 81), result("Practical", 38, "12 Nov · 10:00, skills centre")]),
    example(3, "Priya Shah", "Pass", [result("Theory", 84), result("Practical", 72)]),
    example(4, "James Wilson", "Fail", [result("Theory", 80), result("Practical", 70)], { reasons: ["Attendance requirement not met"], attendance: "1 of 3 required days recorded" }),
    example(5, "Sofia Bennett", "Assessment deferred", [result("Theory", 68), result("Practical", null, null, "Postponed until December · medical leave")]),
    example(6, "Oliver Clarke", "Module deferred", [result("Theory", null), result("Practical", null)], { disposition: "Module deferred" }),
    example(7, "Grace Williams", "Abandoned", [result("Theory", 35), result("Practical", null)], { disposition: "Abandoned" })
  ];
}

function failed(result: Result) { return result.score !== null && result.score < result.passMark; }
function inactive(row: Row) { return row.status === "Abandoned" || row.status === "Module deferred"; }
function explanation(row: Row) {
  if (row.needsPlan) return "Assessment requirements need review";
  if (row.status === "Abandoned") return "No longer taking this module";
  if (row.status === "Module deferred") return "Teaching postponed";
  if (row.exception && row.status !== row.calculated) return `Staff decision · calculated outcome: ${statusLabel[row.calculated].toLowerCase()}`;
  const failures = row.results.filter(failed).map(result => `${result.name} below ${result.passMark}%`);
  if (row.status === "Fail") return [...failures, ...row.reasons].join(" · ") || "Staff decision — review details";
  if (row.status === "Assessment deferred") return `${row.results.find(result => result.deferred)?.name ?? "Assessment"} postponed`;
  if (row.status === "Pass") return "Requirements met";
  return "Awaiting remaining requirements";
}
function nextStep(row: Row): { text: string; tone: Tone; action: Action; component?: ComponentName } {
  if (row.needsPlan) return { text: "Review requirements", tone: "amber", action: "details" };
  if (inactive(row)) return { text: row.status === "Abandoned" ? "No action required" : "Review when ready", tone: "grey", action: "details" };
  const needsResit = row.results.find(result => failed(result) && !result.scheduled);
  if (needsResit) return { text: `${needsResit.name} resit needed`, tone: "amber", action: "schedule", component: needsResit.name };
  const arranged = row.results.find(result => failed(result) && result.scheduled);
  if (arranged) return { text: `${arranged.name} resit arranged`, tone: "blue", action: "details", component: arranged.name };
  if (row.status === "Fail") return { text: "Review requirements", tone: "amber", action: "details" };
  if (row.status === "Assessment deferred") return { text: "Assessment postponed", tone: "purple", action: "details" };
  const missing = row.results.find(result => result.score === null);
  if (missing) return { text: "Record result", tone: "blue", action: "score", component: missing.name };
  return { text: "Up to date", tone: "green", action: "details" };
}

function Badge({ children, tone = "grey" }: { children: React.ReactNode; tone?: Tone }) {
  const Icon = tone === "green" ? CheckCircle2 : tone === "red" ? XCircle : tone === "purple" ? PauseCircle : tone === "grey" ? CircleHelp : tone === "amber" ? Clock3 : CalendarClock;
  return <span className={`${styles.badge} ${styles[tone]}`}><Icon size={13} aria-hidden="true" />{children}</span>;
}
function Status({ row }: { row: Row }) { return <Badge tone={row.needsPlan ? "amber" : statusTone[row.status]}>{row.needsPlan ? "Plan review" : statusLabel[row.status]}</Badge>; }
function Score({ result }: { result?: Result }) {
  if (!result) return <span className={styles.muted}>Not required</span>;
  if (result.score === null) return <span className={styles.pending}>{result.deferred ? "Deferred" : "Awaiting result"}</span>;
  return <span className={`${styles.score} ${failed(result) ? styles.scoreFail : styles.scorePass}`}>
    {failed(result) ? <XCircle size={14} aria-label="Failed" /> : <CheckCircle2 size={14} aria-label="Passed" />}{result.score}%
  </span>;
}
function NextAction({ row, open, canEdit }: { row: Row; open: OpenAction; canEdit: boolean }) {
  const next = nextStep(row);
  const name = canEdit && next.action === "schedule" ? "Arrange resit" : canEdit && next.action === "score" ? "Record result" : "View details";
  return <button className={next.action === "schedule" && canEdit ? styles.primary : styles.button} onClick={() => open(row, canEdit ? next.action : "details", next.component)}>{name}<ChevronRight size={14} aria-hidden="true" /></button>;
}

export function VariantA({ rows, open, canEdit, studentScoped }: VariantProps) {
  return <div className={styles.tableWrap}><table className={styles.register}>
    <thead><tr><th>{studentScoped ? "Module" : "Student / module"}</th><th>Theory</th><th>Practical</th><th>Outcome & reason</th><th>Next step</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
    <tbody>{rows.map(row => { const next = nextStep(row); return <tr key={row.id}>
      <td><button className={styles.nameButton} onClick={() => open(row)}>{studentScoped ? row.title : row.name}</button><span className={styles.subline}>{row.module} · {row.cohort}</span></td>
      <td><Score result={row.results.find(result => result.name === "Theory")} /></td><td><Score result={row.results.find(result => result.name === "Practical")} /></td>
      <td><Status row={row} />{row.exception ? <span className={styles.exceptionMarker} title="A staff decision is active">Staff decision</span> : null}<span className={styles.subline}>{explanation(row)}</span></td>
      <td><span className={`${styles.next} ${styles[`${next.tone}Text`]}`}>{next.text}</span>{row.results.some(result => result.scheduled) && !inactive(row) ? <span className={styles.subline}>{row.results.find(result => result.scheduled)?.scheduled}</span> : null}</td>
      <td><NextAction row={row} open={open} canEdit={canEdit} /></td>
    </tr>; })}</tbody>
  </table></div>;
}

export function VariantB({ rows, open, canEdit }: VariantProps) {
  const [selected, setSelected] = useState(rows[0]?.id);
  const row = rows.find(candidate => candidate.id === selected) ?? rows[0];
  return <div className={styles.workspace}>
    <div className={styles.studentList}><div className={styles.listHeading}>ENROLMENTS <span>{rows.length}</span></div>{rows.map(candidate => <button key={candidate.id} className={`${styles.studentChoice} ${candidate.id === row?.id ? styles.selected : ""}`} onClick={() => setSelected(candidate.id)}>
      <strong>{candidate.name}</strong><span>{candidate.module}</span><Status row={candidate} /><ChevronRight size={16} className={styles.choiceArrow} aria-hidden="true" />
    </button>)}</div>
    {row ? <article className={styles.reviewPane}>
      <div className={styles.reviewHeading}><div><span className={styles.eyebrow}>{row.module} · {row.cohort}</span><h2>{row.name}</h2><p>{row.title}</p></div><Status row={row} /></div>
      <div className={`${styles.outcomeNotice} ${row.status === "Fail" ? styles.noticeFail : ""}`}><strong>{explanation(row)}</strong><span>{nextStep(row).text}</span></div>
      <ResultTiles row={row} open={open} canEdit={canEdit} />
      <div className={styles.reviewFacts}><div><span>Awarded credits</span><strong>{row.credits}</strong></div>{row.attendance ? <div><span>Attendance</span><strong>{row.attendance}</strong></div> : null}</div>
      {row.exception ? <div className={styles.exceptionNote}><ShieldCheck size={17} /><div><strong>Staff decision active</strong><p>{row.exception}</p><p>Calculated outcome: {statusLabel[row.calculated]}</p></div></div> : null}
      <div className={styles.paneFooter}><button className={styles.button} onClick={() => open(row, "history")}><History size={15} />Result history</button>{canEdit ? <button className={styles.button} onClick={() => open(row, "enrolment")}><Settings2 size={15} />Manage enrolment</button> : null}<button className={styles.textButton} onClick={() => open(row)}>All details <ArrowUpRight size={14} /></button></div>
    </article> : null}
  </div>;
}

function boardGroup(row: Row) {
  if (inactive(row) || row.status === "Assessment deferred") return "On hold / closed";
  if (row.status === "Pass") return "Complete";
  if (row.results.some(result => failed(result) && !result.scheduled) || row.reasons.length || row.needsPlan) return "Needs attention";
  return "Arranged / pending";
}
export function VariantC({ rows, open, canEdit, studentScoped }: VariantProps) {
  return <div className={styles.board}>{(["Needs attention", "Arranged / pending", "On hold / closed", "Complete"] as const).map((group, index) => {
    const members = rows.filter(row => boardGroup(row) === group);
    return <section className={styles.lane} key={group}><h2><span className={`${styles.laneDot} ${styles[["amber", "blue", "purple", "green"][index]]}`} />{group}<span className={styles.count}>{members.length}</span></h2>
      {members.map(row => <article className={styles.boardCard} key={row.id}><Status row={row} /><button className={styles.nameButton} onClick={() => open(row)}>{studentScoped ? row.title : row.name}</button><p>{row.module} · {studentScoped ? row.cohort : row.title}</p>
        <div className={styles.boardScores}>{row.results.map(result => <div key={result.name}><span>{result.name}</span><Score result={result} /></div>)}</div>
        <p className={styles.boardReason}>{explanation(row)}</p>{row.exception ? <span className={styles.exceptionMarker}>Staff decision active</span> : null}
        {!inactive(row) && row.results.some(result => result.scheduled) ? <p className={styles.booking}><CalendarClock size={14} />{row.results.find(result => result.scheduled)?.scheduled}</p> : null}
        <NextAction row={row} open={open} canEdit={canEdit} />
      </article>)}{!members.length ? <p className={styles.emptyLane}>Nothing here — all caught up.</p> : null}
    </section>;
  })}</div>;
}

function ResultTiles({ row, open, canEdit }: { row: Row; open: OpenAction; canEdit: boolean }) {
  return <div className={styles.resultTiles}>{row.results.map(result => <section key={result.name} className={styles.resultTile}>
    <div className={styles.tileHeading}><h3>{result.name}</h3><Score result={result} /></div>
    <p>Pass mark {result.passMark}%{result.count ? ` · ${result.count === 1 ? "1 attempt" : `${result.count} attempts`}` : ""}</p>
    {result.scheduled ? <><Badge tone="blue">Resit arranged</Badge><p>{result.scheduled}</p></> : failed(result) && !inactive(row) ? <Badge tone="amber">Resit needed</Badge> : result.deferred ? <><Badge tone="purple">Assessment deferred</Badge><p>{result.deferred}</p></> : null}
    {canEdit && !inactive(row) && !row.needsPlan ? <div className={styles.tileActions}>
      {result.score === null || failed(result) ? <button className={styles.textButton} onClick={() => open(row, "score", result.name)}>Record {failed(result) ? "resit" : "result"}</button> : null}
      {failed(result) ? <button className={styles.textButton} onClick={() => open(row, result.scheduled ? "cancel" : "schedule", result.name)}>{result.scheduled ? "Cancel booking" : "Arrange resit"}</button> : result.score === null ? <button className={styles.textButton} onClick={() => open(row, result.deferred ? "resumeAssessment" : "defer", result.name)}>{result.deferred ? "Clear postponement" : "Postpone assessment"}</button> : null}
    </div> : null}
  </section>)}{!row.results.some(result => result.name === "Practical") && !row.needsPlan ? <section className={`${styles.resultTile} ${styles.notRequired}`}><h3>Practical</h3><p>Not required for this online module.</p></section> : null}</div>;
}

function PrototypeSwitcher({ variant }: { variant: Variant }) {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  function cycle(direction: number) {
    const variants: Variant[] = ["A", "B", "C"];
    const next = variants[(variants.indexOf(variant) + direction + variants.length) % variants.length];
    const params = new URLSearchParams(search.toString());
    params.set("variant", next);
    router.replace(`${path}?${params}`, { scroll: false });
  }
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.querySelector("dialog[open]") || (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,button,[contenteditable],[role=tab]"))) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); cycle(event.key === "ArrowRight" ? 1 : -1); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });
  if (process.env.NODE_ENV === "production") return null;
  return <nav className={styles.switcher} aria-label="Prototype designs"><button aria-label="Previous design" onClick={() => cycle(-1)}><ArrowLeft size={17} /></button><div><small>DESIGN EXPLORATION · {variant} / C</small><strong>{variant} · {variantNames[variant]}</strong></div><button aria-label="Next design" onClick={() => cycle(1)}><ArrowRight size={17} /></button></nav>;
}

function PrototypeDialog({ row, action, component, close, open, save, canEdit, onAttendance, showProfileLink }: { row: Row; action: Action; component?: ComponentName; close: () => void; open: OpenAction; save: (row: Row, title: string, reason: string) => void; canEdit: boolean; onAttendance?: (cohort: string) => void; showProfileLink?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [choice, setChoice] = useState("Module deferred");
  const [exceptionKind, setExceptionKind] = useState("status");
  const [carryCoursework, setCarryCoursework] = useState(false);
  const [carryViva, setCarryViva] = useState(false);
  const [carryPhysics, setCarryPhysics] = useState(false);
  const [mcq, setMcq] = useState("");
  const [physics, setPhysics] = useState("");
  const result = row.results.find(candidate => candidate.name === component) ?? row.results[0];
  const labels: Record<Action, string> = { details: "Enrolment details", history: "Result history", score: `Record ${component?.toLowerCase() ?? "assessment"} result`, schedule: `Arrange ${component?.toLowerCase() ?? "assessment"} resit`, cancel: "Cancel resit booking", defer: "Postpone assessment", resumeAssessment: "Clear assessment postponement", enrolment: "Manage enrolment", exception: "Exceptional decision" };
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = structuredClone(row);
    const selected = next.results.find(candidate => candidate.name === result?.name);
    const reason = String(data.get("reason") ?? "").trim();
    if (!reason) return;
    let description = labels[action];
    if (action === "score" && selected) {
      const weighted = selected.name === "Theory" && row.plan.theory_scheme === "mcq" && row.plan.physics_weighting;
      selected.score = weighted ? (Number(data.get("mcq")) + Number(data.get("physics"))) / 2 : Number(data.get("score"));
      selected.count += 1; selected.scheduled = null; selected.deferred = null;
      description = `${selected.name} recorded: ${selected.score}%`;
      next.history.unshift({ title: `${selected.name} ${selected.score}% · ${failed(selected) ? "Failed" : "Passed"}`, detail: `Attempt ${selected.count} · Manual · Preview only`, date: String(data.get("date")), reason });
      next.calculated = next.disposition ? next.disposition as AssessmentStatus : next.results.some(failed) || next.reasons.length ? "Fail" : next.results.some(candidate => candidate.deferred) ? "Assessment deferred" : next.results.every(candidate => candidate.score !== null) ? "Pass" : "In progress";
      if (!next.exception) next.status = next.calculated;
      next.credits = next.status === "Pass" ? 10 : 0;
    }
    if (action === "schedule" && selected) selected.scheduled = String(data.get("note"));
    if (action === "cancel" && selected) selected.scheduled = null;
    if (action === "defer" && selected) { selected.deferred = String(data.get("note")); if (!next.results.some(failed) && !next.reasons.length) { next.calculated = "Assessment deferred"; if (!next.exception) next.status = next.calculated; } }
    if (action === "resumeAssessment" && selected) { selected.deferred = null; next.calculated = next.results.some(failed) || next.reasons.length ? "Fail" : "In progress"; if (!next.exception) next.status = next.calculated; }
    if (action === "enrolment") {
      next.disposition = choice === "resume" ? null : choice;
      next.calculated = next.disposition as AssessmentStatus ?? (next.results.some(failed) || next.reasons.length ? "Fail" : next.results.some(candidate => candidate.deferred) ? "Assessment deferred" : next.results.every(candidate => candidate.score !== null) ? "Pass" : "In progress");
      if (!next.exception) next.status = next.calculated;
      next.credits = next.status === "Pass" ? 10 : 0;
      description = choice === "resume" ? "Enrolment resumed" : choice === "Abandoned" ? "Module marked abandoned" : "Module deferred";
    }
    if (action === "exception") {
      if (exceptionKind === "clear") { next.exception = null; next.status = next.calculated; next.credits = next.status === "Pass" ? 10 : 0; }
      else if (exceptionKind === "credits") { next.credits = Number(data.get("credits")); next.exception = `Credits changed to ${next.credits}. ${reason}`; }
      else { next.status = String(data.get("status")) as AssessmentStatus; next.credits = next.status === "Pass" ? 10 : 0; next.exception = `Status changed to ${next.status}. ${reason}`; }
    }
    save(next, description, reason);
  }
  const editable = action !== "details" && action !== "history";
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={close} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } }}>
    <header className={styles.dialogHeader}><div><span className={styles.eyebrow}>{row.name} · {row.module}</span><h2 id={titleId}>{labels[action]}</h2></div><button className={styles.close} aria-label="Close dialog" onClick={close}><X size={20} /></button></header>
    <div className={styles.dialogBody}>
      {action === "details" ? <>
        <div className={styles.detailOutcome}><Status row={row} /><span>{row.credits} credits awarded</span></div><p className={styles.detailReason}>{explanation(row)}</p>
        {row.attendance ? <div className={styles.factLine}><CalendarClock size={16} /><span>Attendance: {row.attendance}</span>{onAttendance ? <button className={styles.textButton} onClick={() => { close(); onAttendance(row.cohort); }}>Review attendance</button> : showProfileLink ? <Link className={styles.textButton} href={`/students/${row.studentId}?variant=A&tab=attendance`}>Review attendance</Link> : null}</div> : null}
        {showProfileLink ? <Link className={styles.textButton} href={`/students/${row.studentId}?variant=A&tab=modules`}>Open student workspace <ArrowUpRight size={14} /></Link> : null}
        {row.exception ? <div className={styles.exceptionNote}><ShieldCheck size={18} /><div><strong>Staff decision active</strong><p>{row.exception}</p><p>Calculated outcome: {statusLabel[row.calculated]}. Hiding a warning does not change the outcome.</p></div></div> : null}
        <ResultTiles row={row} open={open} canEdit={canEdit} />
        <div className={styles.detailLinks}><button className={styles.button} onClick={() => open(row, "history")}><History size={15} />Result history</button>{canEdit ? <><button className={styles.button} onClick={() => open(row, "enrolment")}><PauseCircle size={15} />Manage enrolment</button><button className={styles.textButton} onClick={() => open(row, "exception")}><ShieldCheck size={15} />Exceptional decision</button></> : null}</div>
        <p className={styles.helper}>Teaching cohort: {row.cohort}. Existing results are retained if the module is deferred or abandoned.</p>
      </> : null}
      {action === "history" ? <><p className={styles.helper}>Earlier results remain here. Only the current result for each component determines its pass or fail.</p>{row.history.length ? <ol className={styles.timeline}>{row.history.map((entry, index) => <li key={`${entry.date}-${index}`}><span className={styles.timelineDot} /><div><strong>{entry.title}</strong><span>{entry.date} · {entry.detail}</span><p>{entry.reason}</p></div></li>)}</ol> : <div className={styles.emptyState}><History size={24} /><h3>No result history in this preview</h3><p>Record a result to try the history view.</p></div>}</> : null}
      {editable ? <form className={styles.form} onSubmit={submit}>
        <div className={styles.miniSummary}><Status row={row} /><span>{component ?? row.title}{result && component ? ` · ${result.score === null ? "No result yet" : `Current result ${result.score}%`}` : ""}</span></div>
        {action === "score" ? <>
          {result && failed(result) ? <p className={styles.formHint}>This records a new sitting, not a correction. The earlier result stays in history.</p> : null}
          {component === "Theory" && row.plan.theory_scheme === "coursework_viva" ? <div className={styles.supporting}>
            <strong>Supporting assessments</strong><p className={styles.helper}>The combined Theory result is supplied by staff, not calculated.</p>
            {row.plan.requires_coursework ? <label>Coursework score (%)<input name="coursework" type="number" min="0" max="100" step="0.01" required={!carryCoursework} disabled={carryCoursework} />{result?.count ? <span className={styles.checkbox}><input type="checkbox" checked={carryCoursework} onChange={event => setCarryCoursework(event.target.checked)} />Use previous coursework score (preview)</span> : null}</label> : null}
            {row.plan.requires_viva ? <label>Viva score (%)<input name="viva" type="number" min="0" max="100" step="0.01" required={!carryViva} disabled={carryViva} />{result?.count ? <span className={styles.checkbox}><input type="checkbox" checked={carryViva} onChange={event => setCarryViva(event.target.checked)} />Use previous viva score (preview)</span> : null}</label> : null}
          </div> : null}
          {component === "Theory" && row.plan.theory_scheme === "mcq" && row.plan.physics_weighting ? <><div className={styles.fieldPair}><label>MCQ score (%)<input name="mcq" type="number" min="0" max="100" step="0.01" value={mcq} onChange={event => setMcq(event.target.value)} required /></label><label>Physics / equipment (%)<input name="physics" type="number" min="0" max="100" step="0.01" value={physics} onChange={event => setPhysics(event.target.value)} required /></label></div>{result?.count ? <label className={styles.checkbox}><input type="checkbox" checked={carryPhysics} onChange={event => setCarryPhysics(event.target.checked)} />This physics score is carried from the previous sitting (preview)</label> : null}<p className={styles.formHint}>Theory result: {mcq !== "" && physics !== "" ? `${(Number(mcq) + Number(physics)) / 2}%` : "enter both scores"} · Equal weighting</p></> : <label>{component === "Theory" && row.plan.theory_scheme === "coursework_viva" ? "Combined Theory result (%)" : `${component} score (%)`}<input name="score" type="number" min="0" max="100" step="0.01" placeholder="e.g. 65" required /></label>}
          <label>Sitting date<input type="date" name="date" max={new Date().toISOString().slice(0,10)} required /></label>
        </> : null}
        {action === "schedule" ? <><p className={styles.formHint}>Keep the failed result until the resit is completed. Booking a resit does not change the score.</p><label>When and where?<input name="note" placeholder="e.g. 12 Nov, 10:00 · Skills centre" required /></label></> : null}
        {action === "cancel" ? <p className={styles.formHint}>The result will stay Failed and the component will return to “Resit needed”.</p> : null}
        {action === "defer" ? <><p className={styles.formHint}>Use after teaching has finished when only this assessment is postponed. No failed result is created.</p><label>Follow-up plan<input name="note" placeholder="e.g. Review in December after medical leave" required /></label></> : null}
        {action === "resumeAssessment" ? <p className={styles.formHint}>Remove the postponement. The assessment will be awaiting a result; no score is added.</p> : null}
        {action === "enrolment" ? <><p className={styles.formHint}>Change the student’s participation in this module, not their exam scores.</p><fieldset className={styles.choices}><legend>What has changed?</legend>{[{ value: "Module deferred", label: "Defer module", help: "Teaching is postponed; keep all existing results." }, { value: "Abandoned", label: "Mark abandoned", help: "The student is no longer pursuing this module." }, ...(row.disposition ? [{ value: "resume", label: "Resume enrolment", help: "Return to the outcome calculated from current results." }] : [])].map(option => <label className={choice === option.value ? styles.choiceActive : ""} key={option.value}><input type="radio" name="disposition" value={option.value} checked={choice === option.value} onChange={() => setChoice(option.value)} /><span><strong>{option.label}</strong><small>{option.help}</small></span></label>)}</fieldset>{row.exception ? <p className={styles.warning}>A staff override is active. It stays in place until cleared separately.</p> : null}</> : null}
        {action === "exception" ? <><p className={styles.warning}>Exceptional use only. This does not correct scores or attendance. The calculated outcome remains visible.</p><div className={styles.segmented} role="group" aria-label="Decision type">{[{ value: "status", label: "Outcome" }, { value: "credits", label: "Credits" }, ...(row.exception ? [{ value: "clear", label: "Clear decision" }] : [])].map(option => <button type="button" aria-pressed={exceptionKind === option.value} key={option.value} onClick={() => setExceptionKind(option.value)}>{option.label}</button>)}</div>
          {exceptionKind === "status" ? <><label>Use this outcome<select name="status" defaultValue={row.status}>{Object.entries(statusLabel).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><p className={styles.helper}>A Pass normally awards the module credits. Other outcomes award zero. Existing warning flags are not removed.</p></> : exceptionKind === "credits" ? <label>Awarded credits<input name="credits" type="number" min="0" step="1" required defaultValue={row.credits} /></label> : <p className={styles.helper}>Return to the calculated outcome: {statusLabel[row.calculated]}. This preview clears all simulated decisions together.</p>}</> : null}
        <label>Reason<textarea name="reason" rows={2} placeholder="Briefly explain this decision" required maxLength={1000} /></label>
        <footer className={styles.formFooter}><span>Preview only · not saved</span><button type="button" className={styles.button} onClick={close}>Cancel</button><button className={styles.primary} type="submit"><Check size={15} />Apply to preview</button></footer>
      </form> : null}
    </div>
  </dialog>;
}

export function AssessmentUiPrototype({ outcomes, attempts, variant, canEdit, embedded = false, connected = false, onAttendance }: { outcomes: AssessmentOutcome[]; attempts: AssessmentAttempt[]; variant: Variant; canEdit: boolean; embedded?: boolean; connected?: boolean; onAttendance?: (cohort: string) => void }) {
  const search = useSearchParams();
  const [examples, setExamples] = useState(!embedded && search.get("cases") === "examples");
  const [rows, setRows] = useState(() => !embedded && search.get("cases") === "examples" ? exampleRows(initialRows(outcomes, attempts)) : initialRows(outcomes, attempts));
  const [layout, setLayout] = useState<Variant>(variant === "C" ? "C" : "A");
  const activeVariant = embedded || connected ? layout : variant;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState<{ id: string; action: Action; component?: ComponentName } | null>(null);
  const [notice, setNotice] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  function open(row: Row, action: Action = "details", component?: ComponentName) {
    if (!modal && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
    setModal({ id: row.id, action, component });
  }
  function close() { setModal(null); requestAnimationFrame(() => opener.current?.focus()); }
  const visible = rows.filter(row => `${row.name} ${row.identifier} ${row.module} ${row.title} ${row.cohort}`.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || filter === "attention" && !inactive(row) && (row.status === "Fail" || row.needsPlan) || filter === "pass" && row.status === "Pass" || filter === "hold" && ["Abandoned", "Module deferred", "Assessment deferred"].includes(row.status)));
  const selected = rows.find(row => row.id === modal?.id);
  const counts = { all: rows.length, attention: rows.filter(row => !inactive(row) && (row.status === "Fail" || row.needsPlan)).length, pass: rows.filter(row => row.status === "Pass").length, hold: rows.filter(row => ["Abandoned", "Module deferred", "Assessment deferred"].includes(row.status)).length };
  return <div className={styles.prototype} style={embedded || connected ? { paddingBottom: 0 } : undefined}>
    {!embedded ? <div className={styles.previewBanner}><FlaskConical size={17} aria-hidden="true" /><div><strong>Design preview</strong><span>{examples ? "Fictional examples" : "Local assessment data"} · Try the buttons. Changes stay in this browser and reset on reload.</span></div><button onClick={() => { setRows(examples ? exampleRows(initialRows(outcomes, attempts)) : initialRows(outcomes, attempts)); setNotice("Preview reset. No database records changed."); }}>Reset preview</button></div> : null}
    <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>STUDENT PROGRESS</span><h2>{activeVariant === "C" ? "What needs doing?" : activeVariant === "B" ? "Review an enrolment" : "Module outcomes"}</h2><p>{activeVariant === "A" ? "See the result, understand the reason, take the next step." : activeVariant === "B" ? "One student at a time. Only the details you need." : "Results grouped by the next step — not by technical status."}</p></div>{embedded || connected ? <div className={styles.segmented} role="group" aria-label="Assessment view"><button aria-pressed={layout === "A"} onClick={() => setLayout("A")}>Table</button><button aria-pressed={layout === "C"} onClick={() => setLayout("C")}>Board</button></div> : <label className={styles.exampleToggle}><input type="checkbox" role="switch" checked={examples} onChange={event => { setExamples(event.target.checked); setRows(event.target.checked ? exampleRows(initialRows(outcomes, attempts)) : initialRows(outcomes, attempts)); setNotice(""); setFilter("all"); }} /><span>Show example cases</span></label>}</div>
    <div className={styles.controls}><div className={styles.filters} role="group" aria-label="Filter enrolments">{[{ key: "all", label: "All enrolments" }, { key: "attention", label: "Needs attention" }, { key: "pass", label: "Passed" }, { key: "hold", label: "Deferred / abandoned" }].map(option => <button aria-pressed={filter === option.key} key={option.key} onClick={() => setFilter(option.key)}>{option.label}<span>{counts[option.key as keyof typeof counts]}</span></button>)}</div><label className={styles.search}><Search size={16} /><span className={styles.srOnly}>Search students or modules</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find student or module…" /></label></div>
    {notice ? <div className={styles.feedback} role="status"><CheckCircle2 size={17} /><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={15} /></button></div> : null}
    {!visible.length ? <div className={styles.emptyState}><Search size={24} /><h3>No matching enrolments</h3><p>Try another name, module or filter.</p></div> : activeVariant === "A" ? <VariantA rows={visible} open={open} canEdit={canEdit} studentScoped={embedded} /> : activeVariant === "B" ? <VariantB rows={visible} open={open} canEdit={canEdit} /> : <VariantC rows={visible} open={open} canEdit={canEdit} studentScoped={embedded} />}
    <div className={styles.footnote}><span>{visible.length} of {rows.length} enrolments · {embedded ? "Student workspace preview" : examples ? "Fictional examples for design review" : "Local shadow workflow"}</span><span><ShieldCheck size={14} />Audit evidence stays in the backend, not on this page.</span></div>
    {selected && modal ? <PrototypeDialog key={`${selected.id}-${modal.action}-${modal.component}`} row={selected} action={modal.action} component={modal.component} open={open} close={close} canEdit={canEdit} onAttendance={onAttendance} showProfileLink={!embedded && !examples} save={(next, title, reason) => { setRows(current => current.map(row => row.id === next.id ? next : row)); setNotice(`${title}. ${next.name}: ${statusLabel[next.status]}, ${next.credits} credits. Reason: ${reason}. Preview only — no database changes.`); close(); }} /> : null}
    {!embedded && !connected ? <PrototypeSwitcher variant={variant} /> : null}
  </div>;
}
