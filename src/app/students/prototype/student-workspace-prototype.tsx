"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, CalendarCheck, Camera, Check, CheckCircle2, ChevronRight, CreditCard, FlaskConical, LayoutDashboard, Mail, MessageSquare, Pencil, Plus, UserRound, X } from "lucide-react";
import { AssessmentUiPrototype } from "@/app/assessments/prototype/assessment-ui-prototype";
import type { AssessmentAttempt, AssessmentOutcome } from "@/lib/assessment/types";
import type { Student } from "@/lib/types";
import { previewAttendance, previewFinance, previewNotes, previewOutcomes, type AttendancePreview, type FinancePreview, type WorkspaceData } from "./workspace-data";
import styles from "./student-workspace-prototype.module.css";

type Tab = "overview" | "modules" | "attendance" | "notes" | "finance";
type Variant = "A" | "B" | "C";
type Edit = { type: "attendance"; record: AttendancePreview } | { type: "finance"; record: FinancePreview } | { type: "note" } | { type: "photo" };
const sections = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "modules" as const, label: "Modules & results", icon: BookOpen },
  { id: "attendance" as const, label: "Attendance", icon: CalendarCheck },
  { id: "notes" as const, label: "Teaching notes", icon: MessageSquare },
  { id: "finance" as const, label: "Finance", icon: CreditCard }
];
const designs: Record<Variant, string> = { A: "Tabbed student profile", B: "Split student workspace", C: "Overview & quick panels" };
const money = (pence: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(pence / 100);
const day = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const attendanceLabels: Record<string, string> = { attended: "Attended", partial: "Part attended", missed: "Missed", expected: "Expected" };

function Modal({ title, children, close, drawer = false }: { title: string; children: ReactNode; close: () => void; drawer?: boolean }) {
  const reference = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { const element = reference.current; const previous = document.activeElement; element?.showModal(); return () => { element?.close(); if (previous instanceof HTMLElement) previous.focus(); }; }, []);
  return <dialog ref={reference} className={`${styles.dialog} ${drawer ? styles.drawer : ""}`} aria-labelledby={id} onCancel={close}><header><div><small>STUDENT WORKSPACE · PREVIEW</small><h2 id={id}>{title}</h2></div><button aria-label="Close panel" className={styles.close} onClick={close}><X size={20} /></button></header><div className={styles.dialogBody}>{children}</div></dialog>;
}

export function StudentWorkspacePrototype({ student, data, outcomes, attempts, variant, examples, canEdit, canFinance, canTeach, staffName }: {
  student: Student; data: WorkspaceData; outcomes: AssessmentOutcome[]; attempts: AssessmentAttempt[]; variant: Variant; examples: boolean; canEdit: boolean; canFinance: boolean; canTeach: boolean; staffName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initialTab = sections.find(section => section.id === params.get("tab") && (section.id !== "finance" || canFinance))?.id ?? "overview";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [attendance, setAttendance] = useState(() => previewAttendance(data, student, examples));
  const [finance, setFinance] = useState(() => canFinance ? previewFinance(data, student, examples) : []);
  const [notes, setNotes] = useState(() => previewNotes(data, student, examples));
  const [modules] = useState(() => previewOutcomes(outcomes, examples));
  const [edit, setEdit] = useState<Edit | null>(null);
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [term, setTerm] = useState("all");
  const [attendanceStatus, setAttendanceStatus] = useState("attended");
  const [concern, setConcern] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const name = examples ? "Amelia Taylor" : `${student.firstName} ${student.lastName}`;
  const email = examples ? "amelia.taylor@example.test" : student.email;
  const identifier = examples ? "DEMO-001" : student.cccuStudentId || student.temporaryId;
  const initials = name.split(" ").map(part => part[0]).slice(0,2).join("");
  const photoSrc = photo ?? (!examples && student.photoUrl ? `/api/students/${student.id}/photo` : null);
  const availableTabs = sections.filter(section => section.id !== "finance" || canFinance);
  const passed = modules.filter(row => row.assessment.effective_status === "Pass").length;
  const attention = modules.filter(row => row.assessment.effective_status === "Fail");
  const credits = modules.reduce((sum, row) => sum + row.assessment.awarded_credits, 0);
  const balance = finance.reduce((sum, row) => sum + row.expected - row.paid, 0);
  const missingAttendance = attendance.filter(record => record.status === "missed").length;
  const visibleAttendance = attendance.filter(record => term === "all" || record.term === term);

  function navigate(next: Tab) {
    setTab(next);
    const query = new URLSearchParams(params.toString()); query.set("tab", next);
    window.history.replaceState(null, "", `${pathname}?${query}`);
  }
  function switchDesign(direction: number) {
    const keys: Variant[] = ["A", "B", "C"];
    const query = new URLSearchParams(params.toString());
    query.set("variant", keys[(keys.indexOf(variant) + direction + 3) % 3]);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || document.querySelector("dialog[open]") || event.target instanceof HTMLElement && event.target.closest("input,textarea,select,button,[role=tab],[contenteditable]")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); switchDesign(event.key === "ArrowRight" ? 1 : -1); }
    }
    window.addEventListener("keydown", handleKey); return () => window.removeEventListener("keydown", handleKey);
  });
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (edit?.type === "attendance") {
      setAttendance(current => current.map(record => record.id === edit.record.id ? { ...record, status: attendanceStatus, note: String(fields.get("reason")) } : record));
      setMessage("Attendance preview updated. The live workflow will recalculate affected modules; assessment outcomes are unchanged in this design demo.");
    } else if (edit?.type === "finance") {
      setFinance(current => current.map(record => record.id === edit.record.id ? { ...record, invoiced: Math.round(Number(fields.get("invoiced")) * 100), paid: Math.round(Number(fields.get("paid")) * 100), invoiceStatus: String(fields.get("invoice")), paymentStatus: String(fields.get("payment")), note: String(fields.get("reason")) } : record));
      setMessage("Finance preview updated. No invoice was issued and no payment was processed.");
    } else if (edit?.type === "note") {
      setNotes(current => [{ id: `preview-${Date.now()}`, date: new Date().toISOString().slice(0,10), author: staffName, category: "Teaching observation", module: String(fields.get("module")), text: String(fields.get("text")), concern: concern ? "watch" : "none" }, ...current]);
      setMessage("Teaching note added to this preview only.");
    }
    setEdit(null);
  }
  const identity = <div className={styles.identity}><div className={styles.avatar}>{photoSrc ? <Image src={photoSrc} alt={`${name} profile photo`} width={78} height={78} unoptimized /> : <span>{initials}</span>}{canEdit ? <button aria-label="Change profile photo" onClick={() => setEdit({ type: "photo" })}><Camera size={13} /></button> : null}</div><div><div className={styles.nameLine}><h2>{name}</h2><span className={styles.good}>{examples ? "Active student" : student.status.replaceAll("_", " ")}</span></div><p>{identifier} <span>·</span> {student.programme === "pgcert" ? "PGCert POCUS" : "Microcredential"}</p><span className={styles.email}><Mail size={13} />{email}</span></div></div>;
  const tabs = <nav className={styles.tabs} aria-label="Student sections">{availableTabs.map(section => { const Icon = section.icon; return <button key={section.id} aria-current={tab === section.id ? "page" : undefined} onClick={() => navigate(section.id)}><Icon size={16} />{section.label}{section.id === "modules" ? <small>{modules.length}</small> : section.id === "notes" && notes.length ? <small>{notes.length}</small> : null}</button>; })}</nav>;
  const metrics = <div className={styles.metrics}><button onClick={() => navigate("modules")}><span>Module progress</span><strong>{passed}<small> / {modules.length} passed</small></strong><span>{credits} credits awarded</span></button><button onClick={() => navigate("attendance")}><span>Attendance records</span><strong>{attendance.filter(record => record.status === "attended").length}<small> attended</small></strong><span className={missingAttendance ? styles.amberText : ""}>{missingAttendance ? `${missingAttendance} missed · review records` : "No missed sessions recorded"}</span></button>{canFinance ? <button onClick={() => navigate("finance")}><span>Recorded balance</span><strong>{money(balance)}</strong><span>{balance > 0 ? "Expected fees less recorded payments" : balance < 0 ? "Recorded payments exceed expected fees" : finance.length ? "No balance outstanding" : "No finance records yet"}</span></button> : <button onClick={() => navigate("notes")}><span>Teaching records</span><strong>{notes.length}</strong><span>Observations & formative feedback</span></button>}</div>;
  const heading = (title: string, description: string, action?: ReactNode) => <div className={styles.sectionHeading}><div><h3>{title}</h3><p>{description}</p></div>{action}</div>;
  const empty = (text: string) => <div className={styles.empty}>{text}</div>;
  const moduleSummary = <div className={styles.moduleList}>{modules.map(row => <button key={row.enrolment_id} onClick={() => navigate("modules")}><span><strong>{row.module_title}</strong><small>{row.module_code} · {row.original_cohort}</small></span><span className={row.assessment.effective_status === "Pass" ? styles.good : row.assessment.effective_status === "Fail" ? styles.bad : styles.purple}>{row.assessment.effective_status === "Pass" ? "Passed" : row.assessment.effective_status === "Fail" ? "Failed" : row.assessment.effective_status}</span><ChevronRight size={15} /></button>)}</div>;
  const notesSummary = <div className={styles.noteList}>{notes.slice(0,2).map(note => <article key={note.id}><div><span className={note.concern === "none" ? styles.neutral : styles.amber}>{note.concern === "none" ? note.category : "Follow-up needed"}</span><small>{day(note.date)}</small></div><p>{note.text}</p><small>{note.author} · {note.module}</small></article>)}{!notes.length ? empty("No teaching notes recorded yet.") : null}</div>;
  const overview = <div className={styles.overview}>
    {metrics}
    {attention.length || missingAttendance ? <section className={styles.attention}><div><span className={styles.amber}>Needs attention</span><h3>{missingAttendance ? "Review attendance before changing the outcome" : "Follow up outstanding assessments"}</h3><p>{missingAttendance ? "An attendance warning links to session records, not to an outcome override." : "Resit bookings and results remain attached to the original enrolment."}</p></div><button className={styles.button} onClick={() => navigate(missingAttendance ? "attendance" : "modules")}>{missingAttendance ? "Review attendance" : "Review assessments"}<ArrowRight size={15} /></button></section> : null}
    <div className={styles.overviewGrid}><section className={styles.panel}>{heading("Modules at a glance", "Each module has its own outcome.", <button className={styles.textButton} onClick={() => navigate("modules")}>All results <ArrowUpRight size={14} /></button>)}{moduleSummary}</section><section className={styles.panel}>{heading("Latest teaching notes", "Clinical learning, kept separate from exam results.", <button className={styles.textButton} onClick={() => navigate("notes")}>View all</button>)}{notesSummary}</section></div>
  </div>;
  const attendancePanel = <section className={styles.panel}>{heading("Attendance", "Edit the session record. Do not override a result to correct attendance.", <label className={styles.selectLabel}><span>Term</span><select aria-label="Attendance term" value={term} onChange={event => setTerm(event.target.value)}><option value="all">All terms</option>{[...new Set(attendance.map(record => record.term))].map(value => <option key={value}>{value}</option>)}</select></label>)}
    <div className={styles.info}>Session attendance may support more than one module in the same term. Changes must be reflected everywhere.</div>
    {visibleAttendance.length ? <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Session</th><th>Term / location</th><th>Attendance</th><th>Note</th>{canEdit ? <th><span className={styles.srOnly}>Actions</span></th> : null}</tr></thead><tbody>{visibleAttendance.map(record => <tr key={record.id}><td><strong>{day(record.date)}</strong><small>{record.time}</small></td><td>{record.term}<small>{record.location}</small></td><td><span className={record.status === "attended" ? styles.good : record.status === "missed" ? styles.bad : styles.amber}>{attendanceLabels[record.status]}</span></td><td>{record.note || "—"}</td>{canEdit ? <td><button className={styles.button} aria-label={`Edit attendance ${record.date}`} onClick={() => { setAttendanceStatus(record.status); setEdit({ type: "attendance", record }); }}><Pencil size={13} />Edit</button></td> : null}</tr>)}</tbody></table></div> : empty("No sessions are available for this term.")}
  </section>;
  const notesPanel = <section className={styles.panel}>{heading("Teaching notes", "Observations, formative feedback and presentation comments.", canTeach ? <button className={styles.primary} onClick={() => { setConcern(false); setEdit({ type: "note" }); }}><Plus size={15} />Add teaching note</button> : null)}<div className={styles.fullNotes}>{notes.map(note => <article key={note.id}><div className={styles.noteAvatar}>{note.author.split(" ").slice(-2).map(part => part[0]).join("")}</div><div><header><strong>{note.author}</strong><span>{day(note.date)}</span></header><small>{note.module} · {note.category}</small><p>{note.text}</p>{note.concern !== "none" ? <span className={styles.amber}>Follow-up needed</span> : null}</div></article>)}{!notes.length ? empty("No teaching notes yet.") : null}</div></section>;
  const financePanel = canFinance ? <section className={styles.panel}>{heading("Finance", "Term-level records · separate from assessment outcomes.")}<div className={styles.financeTotals}><div><span>Expected fees</span><strong>{money(finance.reduce((sum, row) => sum + row.expected, 0))}</strong></div><div><span>Recorded payments</span><strong>{money(finance.reduce((sum, row) => sum + row.paid, 0))}</strong></div><div><span>Balance</span><strong>{money(balance)}</strong></div></div>{finance.length ? <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Term</th><th>Expected</th><th>Invoiced</th><th>Paid</th><th>Payment status</th><th /></tr></thead><tbody>{finance.map(record => <tr key={record.id}><td><strong>{record.term}</strong><small>{record.note}</small></td><td>{money(record.expected)}</td><td>{money(record.invoiced)}</td><td>{money(record.paid)}</td><td><span className={record.paymentStatus === "paid" ? styles.good : styles.amber}>{record.paymentStatus.replaceAll("_", " ")}</span></td><td><button className={styles.button} aria-label={`Edit finance ${record.term}`} onClick={() => setEdit({ type: "finance", record })}><Pencil size={13} />Edit</button></td></tr>)}</tbody></table></div> : empty("No finance records for this student.")}<p className={styles.caption}>Changing an assessment outcome does not create an invoice or alter these payment records.</p></section> : null;
  const modulePanel = <section className={styles.modulePanel}><AssessmentUiPrototype outcomes={modules} attempts={examples ? [] : attempts} variant="A" canEdit={canEdit} embedded onAttendance={cohort => { setTerm(attendance.some(record => record.term === cohort) ? cohort : "all"); navigate("attendance"); }} /><p className={styles.caption}>This is the same assessment interface used in the all-student register, filtered to one student. Table and board show the same records.</p></section>;
  const panels = <><div hidden={tab !== "overview"}>{overview}</div><div hidden={tab !== "modules"}>{modulePanel}</div><div hidden={tab !== "attendance"}>{attendancePanel}</div><div hidden={tab !== "notes"}>{notesPanel}</div>{canFinance ? <div hidden={tab !== "finance"}>{financePanel}</div> : null}</>;
  const dashboard = <><div className={styles.dashboardTitle}><div><small>ONE STUDENT, ONE WORKSPACE</small><h2>Everything you need, nothing extra.</h2></div><span className={styles.neutral}>Open a panel to work on a record</span></div>{metrics}<div className={styles.dashboardGrid}><section className={styles.panel}>{heading("Module progress", `${passed} passed · ${attention.length} needing attention`, <button className={styles.button} onClick={() => navigate("modules")}>Open results <ArrowUpRight size={14} /></button>)}{moduleSummary}</section><section className={styles.panel}>{heading("Attendance", "Teaching sessions, not exam bookings.")}<div className={styles.largeNumber}>{missingAttendance}<span>missed sessions</span></div><p className={styles.caption}>Review the underlying dates before deciding what action is needed.</p><button className={styles.button} onClick={() => navigate("attendance")}>Review attendance <ArrowRight size={14} /></button></section><section className={styles.panel}>{heading("Teaching notes", "Latest feedback")}{notesSummary}<button className={styles.textButton} onClick={() => navigate("notes")}>Open teaching notes <ArrowUpRight size={14} /></button></section>{canFinance ? <section className={styles.panel}>{heading("Finance", "Staff-only reconciliation")}<div className={styles.largeNumber}>{money(balance)}<span>recorded balance</span></div><p className={styles.caption}>Invoice and payment details stay in this panel, not on every module card.</p><button className={styles.button} onClick={() => navigate("finance")}>Open finance <ArrowRight size={14} /></button></section> : null}</div></>;

  return <div className={styles.workspace}>
    <div className={styles.previewBanner}><FlaskConical size={17} /><div><strong>Student workspace preview</strong><span>{examples ? "Fictional example records" : "Local records"} · All edits are simulated; navigation or reload may reset them.</span></div><label><input type="checkbox" checked={examples} onChange={event => { const query = new URLSearchParams(params.toString()); query.set("cases", event.target.checked ? "examples" : "local"); router.replace(`${pathname}?${query}`); }} />Example data</label></div>
    <div className={styles.breadcrumb}><Link href="/students?variant=A"><ArrowLeft size={13} />Students directory</Link><span>/</span><span>{name}</span><Link className={styles.globalLink} href="/assessments?variant=A&workspace=1">All-student assessments <ArrowUpRight size={13} /></Link></div>
    {message ? <div className={styles.feedback} role="status"><CheckCircle2 size={16} /><span>{message} No database changes.</span><button aria-label="Dismiss message" onClick={() => setMessage("")}><X size={14} /></button></div> : null}
    {variant === "A" ? <><header className={styles.profileHeader}>{identity}<span className={styles.profileHint}>Student status ≠ module outcome</span></header>{tabs}<div className={styles.content}>{panels}</div></> : variant === "B" ? <div className={styles.split}><aside className={styles.contextRail}>{identity}<hr />{tabs}<div className={styles.railContext}><small>AT A GLANCE</small><strong>{passed} of {modules.length} modules passed</strong><span>{credits} credits awarded</span>{canFinance ? <span>{money(balance)} recorded balance</span> : null}<p>Choose a section to work on one task at a time.</p></div></aside><main className={styles.splitMain}>{panels}</main></div> : <><header className={styles.profileHeader}>{identity}</header><div className={styles.content}>{dashboard}</div>{tab !== "overview" ? <Modal key={`drawer-${tab}`} title={sections.find(section => section.id === tab)?.label ?? "Student details"} close={() => navigate("overview")} drawer>{panels}</Modal> : null}</>}
    {edit ? <Modal title={edit.type === "attendance" ? "Update attendance" : edit.type === "finance" ? "Update finance record" : edit.type === "photo" ? "Profile picture" : "Add teaching note"} close={() => setEdit(null)}>
      {edit.type === "photo" ? <div className={styles.photoEditor}><div className={styles.largeAvatar}>{photoSrc ? <Image src={photoSrc} alt={`${name} profile photo preview`} width={140} height={140} unoptimized /> : initials}</div><label className={styles.upload}>Choose a picture<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) { setPhotoError("Choose a PNG, JPEG or WebP image smaller than 5 MB."); return; } const reader = new FileReader(); reader.onload = () => { setPhoto(String(reader.result)); setPhotoError(""); setMessage("Profile picture changed in memory only. Nothing was uploaded."); }; reader.readAsDataURL(file); }} /></label>{photoError ? <p role="alert">{photoError}</p> : null}<p className={styles.caption}>Local preview only. The existing private photo storage remains unchanged.</p></div> : <form className={styles.form} onSubmit={save}>
        {edit.type === "attendance" ? <><div className={styles.info}>{day(edit.record.date)} · {edit.record.term} · {edit.record.location}</div><fieldset className={styles.radioOptions}><legend>Attendance for this session</legend>{Object.entries(attendanceLabels).map(([value,label]) => <label key={value} className={attendanceStatus === value ? styles.radioSelected : ""}><input type="radio" name="attendance" value={value} checked={attendanceStatus === value} onChange={() => setAttendanceStatus(value)} />{label}</label>)}</fieldset><p className={styles.caption}>This changes the session record, not the number of days the student is required to attend.</p></> : edit.type === "finance" ? <><div className={styles.info}>{edit.record.term} · Expected fees {money(edit.record.expected)}</div><div className={styles.formColumns}><label>Invoice amount (£)<input name="invoiced" type="number" min="0" step="0.01" required defaultValue={edit.record.invoiced / 100} /></label><label>Recorded amount paid (£)<input name="paid" type="number" min="0" step="0.01" required defaultValue={edit.record.paid / 100} /></label><label>Invoice status<select name="invoice" defaultValue={edit.record.invoiceStatus}>{["not_requested","requested","sent","corrected"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label>Payment status<select name="payment" defaultValue={edit.record.paymentStatus}>{["not_due","outstanding","paid","disputed"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label></div><p className={styles.caption}>Records only. This does not send an invoice or take a payment.</p></> : <><label>Module<select name="module" required>{modules.map(row => <option key={row.enrolment_id} value={row.module_title}>{row.module_title}</option>)}{!modules.length ? <option>General teaching</option> : null}</select></label><label>Teaching observation<textarea name="text" rows={4} required placeholder="What went well? What should the student work on next?" /></label><label className={styles.toggleLabel}><input type="checkbox" role="switch" checked={concern} onChange={event => setConcern(event.target.checked)} /><span>Flag for staff follow-up</span></label><p className={styles.caption}>Recorded by {staffName}. A teaching note does not change exam results.</p></>}
        {edit.type !== "note" ? <label>Reason / note<textarea name="reason" rows={2} required defaultValue={edit.record.note} placeholder="Briefly explain the change" /></label> : null}
        <footer className={styles.formFooter}><span>Preview only · not saved</span><button type="button" className={styles.button} onClick={() => setEdit(null)}>Cancel</button><button type="submit" className={styles.primary}><Check size={14} />Apply to preview</button></footer>
      </form>}
    </Modal> : null}
    {process.env.NODE_ENV !== "production" ? <nav className={styles.switcher} aria-label="Student workspace designs"><button aria-label="Previous workspace design" onClick={() => switchDesign(-1)}><ArrowLeft size={17} /></button><div><small>STUDENT WORKSPACE · DESIGN {variant}</small><strong>{designs[variant]}</strong></div><button aria-label="Next workspace design" onClick={() => switchDesign(1)}><ArrowRight size={17} /></button></nav> : null}
  </div>;
}

export function StudentDirectoryPrototype({ students, outcomes }: { students: Student[]; outcomes: AssessmentOutcome[] }) {
  const [query, setQuery] = useState("");
  const visible = students.filter(student => `${student.firstName} ${student.lastName} ${student.cccuStudentId} ${student.temporaryId}`.toLowerCase().includes(query.toLowerCase()));
  return <div className={styles.workspace}><div className={styles.previewBanner}><FlaskConical size={17} /><span><strong>Connected workspace preview</strong> · One row per student. Open a profile to manage their records.</span></div><div className={styles.sectionHeading}><div><h3>Students directory</h3><p>Find the person first. Module outcomes live in their profile and the assessments register.</p></div><Link className={styles.button} href="/assessments?variant=A&workspace=1">Assessments table / board <ArrowUpRight size={14} /></Link></div><label className={styles.search}>Find a student<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or student ID" /></label><div className={styles.panel}><div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Student</th><th>Programme</th><th>Student status</th><th>Module progress</th><th>Follow-up</th><th /></tr></thead><tbody>{visible.map(student => {
    const modules = outcomes.filter(row => row.student_id === student.id);
    const failed = modules.filter(row => row.assessment.effective_status === "Fail").length;
    return <tr key={student.id}><td><div className={styles.directoryIdentity}><div className={styles.smallAvatar}>{student.photoUrl ? <Image src={`/api/students/${student.id}/photo`} alt="" width={36} height={36} unoptimized /> : <UserRound size={19} />}</div><div><strong>{student.firstName} {student.lastName}</strong><small>{student.cccuStudentId || student.temporaryId}</small></div></div></td><td>{student.programme === "pgcert" ? "PGCert POCUS" : "Microcredential"}</td><td><span className={styles.neutral}>{student.status}</span></td><td>{modules.filter(row => row.assessment.effective_status === "Pass").length} / {modules.length} passed</td><td><span className={failed ? styles.amber : styles.good}>{failed ? `${failed} modules to review` : "No failed modules"}</span></td><td><Link className={styles.button} href={`/students/${student.id}?variant=A`}>Open profile <ChevronRight size={14} /></Link></td></tr>;
  })}</tbody></table></div>{!visible.length ? <p className={styles.empty}>No matching students.</p> : null}</div></div>;
}
