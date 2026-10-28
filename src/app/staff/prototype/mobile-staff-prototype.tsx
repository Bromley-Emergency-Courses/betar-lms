"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, BookOpen, Check, ChevronRight, ClipboardPen, GraduationCap, Plus, Search, UserRound, Users, X } from "lucide-react";
import { presentationRubricGroups } from "@/lib/presentation-rubric";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import { attendanceProgress, canRecordTeaching, hereToday, currentTermId, demoDate, enrolments, modules, progress, seedAttendance, seedPresentations, seedRecords, staff, students, terms, type Attendance, type DemoStudent, type Presentation, type RecordKind, type TeachingRecord } from "./demo-data";
import styles from "./mobile-staff-prototype.module.css";

function Avatar({ student }: { student: DemoStudent }) {
  return <span className={styles.avatar} aria-hidden="true">{student.initials}</span>;
}
function formatDate(date: string) {
  return new Date(date + "T12:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function moduleName(code: string) { return modules.find((module) => module.code === code)?.name ?? code; }
function staffName(id: string) { return staff.find((member) => member.id === id)?.name ?? "Unknown staff"; }
function statusClass(status?: string) {
  return status === "Attended" ? styles.ok : status === "Planned" ? styles.planned : status === "Partial" ? styles.late : status === "Missed" ? styles.risk : styles.quiet;
}

function Modal({ title, close, children, drawer = false }: { title: string; close: () => void; children: ReactNode; drawer?: boolean }) {
  const reference = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = reference.current;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = overflow; if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <dialog ref={reference} className={styles.modal + (drawer ? " " + styles.drawer : "")} aria-labelledby={titleId} onCancel={close}>
    <header><div><small>TEACHING COMPANION · PREVIEW</small><h2 id={titleId}>{title}</h2></div><button type="button" aria-label="Close popup" onClick={close}><X size={20} /></button></header>
    <div className={styles.modalBody}>{children}</div>
  </dialog>;
}

function ScoreBreakdown({ record }: { record: TeachingRecord }) {
  const criteria = presentationRubricGroups.flatMap((group) => group.criteria);
  const rawScore = criteria.every((criterion) => record.scores?.[criterion.id] !== undefined) ? criteria.reduce((total, criterion) => total + record.scores![criterion.id], 0) : undefined;
  return <div className={styles.scoreBreakdown}>{presentationRubricGroups.map((group) => <section key={group.name}>
    <strong>{group.name}</strong>{group.criteria.map((criterion) => <div key={criterion.id}><span>{criterion.label}</span><b>{record.scores?.[criterion.id] ?? "Not recorded"}{record.scores?.[criterion.id] !== undefined ? "/5" : ""}</b></div>)}
  </section>)}<dl className={styles.scoreTotals}><dt>Rubric subtotal</dt><dd>{rawScore === undefined ? "Not recorded" : rawScore + "/50"}</dd><dt>Time penalty</dt><dd>−{record.timePenalty ?? 0} points</dd><dt>Final score</dt><dd>{record.score}/50</dd></dl></div>;
}

function TeachingTimeline({ records, staffId, edit }: { records: TeachingRecord[]; staffId: string; edit: (record: TeachingRecord) => void }) {
  return <div className={styles.timeline}>{records.map((record, index) => {
    if (record.kind === "Presentation" && records.slice(0, index).some((candidate) => candidate.presentationId === record.presentationId)) return null;
    const submissions = record.kind === "Presentation" ? records.filter((candidate) => candidate.presentationId === record.presentationId) : [];
    return <details key={record.id} className={styles.record}>
      <summary><span className={styles.recordIcon}>{record.kind === "Encounter" ? <BookOpen size={16} /> : <ClipboardPen size={16} />}</span><span>
        <strong>{record.kind}{record.kind === "Presentation" ? " · " + submissions.length + (submissions.length === 1 ? " score submission" : " score submissions") : record.score !== undefined ? " · " + record.score + "/" + record.maximum : ""}</strong>
        <small>{formatDate(record.date)} · {record.module} · {moduleName(record.module)} · {terms.find((term) => term.id === record.termId)?.name}</small>
        {record.kind !== "Presentation" && <small>{staffName(record.staffId)}{record.kind === "Encounter" ? " · Concern: " + (record.concern ?? "None") : ""}</small>}
      </span><ChevronRight size={16} /></summary>
      <div className={styles.recordBody}>
        {record.kind === "Presentation" ? <>
          <p>{record.presentationType} · {record.duration} minutes</p>
          <p className={styles.quiet}>One presentation · each assessor’s submission is shown separately.</p>
          {submissions.map((submission) => <section className={styles.submission} key={submission.id} aria-label={"Score by " + staffName(submission.staffId)}>
            <div className={styles.sectionTitle}><strong>{staffName(submission.staffId)}</strong><b>{submission.score}/50</b></div>
            <p>{submission.summary || "No additional feedback."}</p>
            <ScoreBreakdown record={submission} />
            {submission.staffId === staffId && canRecordTeaching(submission.studentId, submission.termId, submission.module) ? <button className={styles.addButton} onClick={() => edit(submission)}>Edit my score</button> : <p className={styles.quiet}>{canRecordTeaching(submission.studentId, submission.termId, submission.module) ? "Only " + staffName(submission.staffId) + " can edit this submission." : "Read-only: this module enrolment is not actively studied in an active term."}</p>}
          </section>)}
        </> : <>
          {record.kind === "Encounter" && <dl className={styles.recordMetadata}><dt>Staff</dt><dd>{staffName(record.staffId)}</dd><dt>Module</dt><dd>{record.module} · {moduleName(record.module)}</dd><dt>Concern</dt><dd>{record.concern ?? "None"}</dd><dt>Comment</dt><dd>{record.summary}</dd></dl>}
          {record.kind !== "Encounter" && <p>{record.summary || "No additional notes."}</p>}
          {record.items && <p>{record.items.join(" · ")}</p>}
        </>}
      </div>
    </details>;
  })}</div>;
}

type DialogState = { kind: "edit"; record: TeachingRecord } | { kind: "plan"; type: "Attendance" | "Presentation"; originalDate?: string } | { kind: "day"; studentId: string; date: string } | { kind: "student" } | null;

export function MobileStaffPrototype({ variant, tablet = false }: { variant: "A" | "B" | "C"; tablet?: boolean }) {
  const [view, setView] = useState<"overview" | "profile" | "entry">(tablet && variant === "B" ? "profile" : "overview");
  const [overview, setOverview] = useState<"module" | "term">(tablet && variant === "C" ? "term" : "module");
  const [module, setModule] = useState("VA");
  const [termId, setTermId] = useState(currentTermId);
  const [studentId, setStudentId] = useState(students[0].id);
  const [staffId, setStaffId] = useState(staff[0].id);
  const [records, setRecords] = useState<TeachingRecord[]>(seedRecords);
  const [attendance, setAttendance] = useState<Attendance[]>(seedAttendance);
  const [presentations, setPresentations] = useState<Presentation[]>(seedPresentations);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [kind, setKind] = useState<RecordKind>("Presentation");
  const [message, setMessage] = useState("");
  const [attendanceTermId, setAttendanceTermId] = useState(currentTermId);
  const [dialog, setDialog] = useState<DialogState>(null);
  const term = terms.find((candidate) => candidate.id === termId)!;
  const student = students.find((candidate) => candidate.id === studentId)!;
  const studentEnrolments = enrolments.filter((enrolment) => enrolment.studentId === studentId && enrolment.termId === termId);
  const activeEnrolments = studentEnrolments.filter((enrolment) => canRecordTeaching(studentId, termId, enrolment.module));
  const canWrite = activeEnrolments.length > 0;
  const entryModule = activeEnrolments.some((enrolment) => enrolment.module === module) ? module : activeEnrolments[0]?.module ?? "";
  function riskReasons(candidateId: string) {
    return [...new Set(enrolments.filter((enrolment) => enrolment.studentId === candidateId && enrolment.termId === termId && (overview === "term" || enrolment.module === module) && canRecordTeaching(candidateId, termId, enrolment.module)).flatMap((enrolment) => progress(candidateId, enrolment.module, records, attendance, termId).reasons))];
  }
  const visible = students.filter((candidate) => (candidate.name + " " + candidate.id).toLowerCase().includes(query.toLowerCase()) && enrolments.some((enrolment) => enrolment.studentId === candidate.id && enrolment.termId === termId && (overview === "term" || enrolment.module === module))
    && (filter !== "Here today" || hereToday(candidate.id, termId, attendance))
    && (filter !== "At risk" || riskReasons(candidate.id).length > 0));
  const studentRecords = records.filter((record) => record.studentId === studentId).sort((first, second) => second.date.localeCompare(first.date));
  const history = attendanceProgress(studentId, attendanceTermId, attendance);
  const ownSubmission = records.find((record) => record.kind === "Presentation" && record.studentId === studentId && record.module === entryModule && record.termId === termId && record.staffId === staffId);
  const presentation = presentations.find((candidate) => candidate.studentId === studentId && candidate.module === entryModule && candidate.termId === termId);
  const presentationCompleted = presentation ? records.some((record) => record.presentationId === presentation.id) : false;

  function navigate(next: typeof view) { setView(next); window.scrollTo({ top: 0, behavior: "instant" }); }
  function openStudent(candidate: DemoStudent) { setStudentId(candidate.id); if (tablet && variant === "C") setDialog({ kind: "student" }); else navigate("profile"); }
  function editScore(record: TeachingRecord) {
    if (record.staffId !== staffId || !canRecordTeaching(record.studentId, record.termId, record.module)) return;
    setDialog({ kind: "edit", record });
  }
  function saveRecord(record: TeachingRecord) {
    if (record.staffId !== staffId || !canRecordTeaching(record.studentId, record.termId, record.module)) return;
    const existing = records.find((candidate) => candidate.id === record.id);
    if (existing && existing.staffId !== staffId) return;
    const duplicate = record.kind === "Presentation" && records.find((candidate) => candidate.kind === "Presentation" && candidate.studentId === record.studentId && candidate.module === record.module && candidate.termId === record.termId && candidate.staffId === staffId && candidate.id !== record.id);
    if (duplicate) { setMessage("You already scored this student’s presentation for this module. Edit your existing submission."); editScore(duplicate); return; }
    if (record.kind === "Presentation" && !existing) {
      const linked = presentations.find((candidate) => candidate.id === record.presentationId);
      const event: Presentation = { id: record.presentationId!, studentId: record.studentId, module: record.module, termId: record.termId, date: record.date, type: record.presentationType!, duration: record.duration };
      setPresentations((previous) => linked ? previous.map((candidate) => candidate.id === event.id ? event : candidate) : [...previous, event]);
    }
    setRecords((previous) => existing ? previous.map((candidate) => candidate.id === record.id ? record : candidate) : [record, ...previous]);
    setMessage(existing ? "Your score was updated. Other assessors’ submissions are unchanged." : record.kind + " saved for " + student.name + ". Demo only.");
    setDialog(null);
    if (!existing) navigate("profile");
  }
  function savePlan(type: "Attendance" | "Presentation", date: string, plannedModule: string, alsoAttendance: boolean) {
    if (!canRecordTeaching(studentId, termId, type === "Presentation" ? plannedModule : undefined) || !term.dates.includes(date) || date < demoDate) return;
    const originalDate = dialog?.kind === "plan" ? dialog.originalDate : undefined;
    if (type === "Attendance" && originalDate && !attendance.some((session) => session.studentId === studentId && session.termId === termId && session.date === originalDate && session.status === "Planned" && !session.checkedInAt && session.date >= demoDate)) return;
    if (type === "Presentation") {
      const existing = presentations.find((candidate) => candidate.studentId === studentId && candidate.module === plannedModule && candidate.termId === termId);
      if (existing && records.some((record) => record.presentationId === existing.id)) {
        setMessage("This module presentation has already been delivered. Add your score from Add record.");
        return;
      }
      const event: Presentation = { id: existing?.id ?? crypto.randomUUID(), studentId, termId, module: plannedModule, date, type: existing?.type ?? "Case presentation" };
      setPresentations((previous) => existing ? previous.map((candidate) => candidate.id === existing.id ? event : candidate) : [...previous, event]);
    }
    if (type === "Attendance" || alsoAttendance) setAttendance((previous) => {
      const retained = type === "Attendance" && originalDate && originalDate !== date ? previous.filter((session) => !(session.studentId === studentId && session.termId === termId && session.date === originalDate)) : previous;
      if (retained.some((session) => session.studentId === studentId && session.termId === termId && session.date === date)) return retained;
      return [...retained, { studentId, termId, date, status: "Planned", time: "09:00–16:00 · planned" }];
    });
    setMessage(type + " planned for " + formatDate(date) + (type === "Presentation" ? " · " + plannedModule : "") + ". Demo only.");
    setDialog(null);
  }
  function cancelPresentation(entry: Presentation) {
    if (!canRecordTeaching(entry.studentId, entry.termId, entry.module) || records.some((record) => record.presentationId === entry.id)) return;
    setPresentations((previous) => previous.filter((candidate) => candidate.id !== entry.id));
  }
  function cancelAttendance(session: Attendance) {
    if (!canRecordTeaching(session.studentId, session.termId) || session.status !== "Planned" || session.checkedInAt || session.date < demoDate) return;
    setAttendance((previous) => previous.filter((candidate) => candidate !== session));
  }
  function completedCount(candidateId: string) {
    return enrolments.filter((enrolment) => enrolment.studentId === candidateId && enrolment.termId === termId && enrolment.presentationRequired && records.some((record) => record.kind === "Presentation" && record.studentId === candidateId && record.termId === termId && record.module === enrolment.module)).length;
  }
  const dayStudent = dialog?.kind === "day" ? students.find((candidate) => candidate.id === dialog.studentId)! : student;
  const enrolmentGroups = terms.filter((candidate) => enrolments.some((enrolment) => enrolment.studentId === studentId && enrolment.termId === candidate.id)).map((enrolmentTerm) => <section key={enrolmentTerm.id} className={styles.enrolmentGroup} aria-label={enrolmentTerm.name + " enrolments"}>
    <div className={styles.enrolmentTerm}><h3>{enrolmentTerm.name}</h3><span>{enrolmentTerm.status === "active" ? "Active term" : "Closed · read-only"}</span></div>
    {enrolments.filter((enrolment) => enrolment.studentId === studentId && enrolment.termId === enrolmentTerm.id).map((enrolment) => {
      const editable = canRecordTeaching(studentId, enrolment.termId, enrolment.module);
      const content = <><span className={styles.moduleCode}>{enrolment.module}</span><span><strong>{moduleName(enrolment.module)}</strong><small>{enrolment.status === "completed" ? "Pass" : enrolment.status === "deferred" ? "Module deferred" : "In progress"} · {progress(studentId, enrolment.module, records, attendance, enrolment.termId).presentations ? "Presentation complete" : "Presentation due"}</small><small>{editable ? "Add teaching input" : "Read-only · inactive enrolment or term"}</small></span></>;
      return editable ? <button key={enrolment.module} className={styles.enrolment} onClick={() => { setTermId(enrolment.termId); setAttendanceTermId(enrolment.termId); setModule(enrolment.module); setKind("Presentation"); setDialog(null); navigate("entry"); }}>{content}<ChevronRight size={16} /></button> : <div key={enrolment.module} className={styles.enrolment}>{content}</div>;
    })}
  </section>);

  return <div className={styles.canvas}><div className={styles.app + (tablet ? " " + styles.tabletPreview + " " + (styles["tablet" + variant] ?? "") : "")}>
    <div className={styles.demoBanner}>{tablet ? "TABLET STUDY · " + variant : "APPROVED LAYOUT A"} <span>Fictional data · changes reset on reload</span></div>
    <header className={styles.header}><div className={styles.brand}><span className={styles.brandMark}><GraduationCap size={21} /></span><span>BETAR <small>TEACHING COMPANION</small></span></div><span className={styles.staffAvatar}>{staff.find((member) => member.id === staffId)?.initials}</span></header>
    <main className={styles.main + (tablet && variant === "B" && view !== "overview" ? " " + styles.splitWorkspace : "")}>
      {message && <div className={styles.notice} role="status"><Check size={17} /><span>{message}</span><button aria-label="Dismiss confirmation" onClick={() => setMessage("")}>×</button></div>}
      {(view === "overview" || (tablet && variant === "B")) && <section className={styles.overviewPanel} aria-label="Student register">
        <div className={styles.pageHeading}><div><p className={styles.eyebrow}>{term.name.toUpperCase()} · DEMO</p><h1>{overview === "module" ? "Module overview" : "Term overview"}</h1></div></div>
        <div className={styles.viewTabs}><button aria-pressed={overview === "module"} onClick={() => setOverview("module")}>By module</button><button aria-pressed={overview === "term"} onClick={() => setOverview("term")}>All students · dates</button></div>
        <label className={styles.field}>Teaching term<select aria-label="Teaching term" value={termId} onChange={(event) => { setTermId(event.target.value); setModule("VA"); }}>{terms.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
        {overview === "module" && <div className={styles.moduleTabs} aria-label="Module">{modules.filter((candidate) => enrolments.some((enrolment) => enrolment.module === candidate.code && enrolment.termId === termId)).map((candidate) => <button key={candidate.code} aria-pressed={module === candidate.code} onClick={() => setModule(candidate.code)}>{candidate.code}<small>{candidate.name}</small></button>)}</div>}
        <div className={styles.moduleHeading}><h2>{overview === "module" ? moduleName(module) : "Attendance & presentations"}</h2><span>{visible.length} students</span></div>
        <label className={styles.search}><Search size={17} /><input placeholder="Find a student…" aria-label="Find a student" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className={styles.filters} aria-label="Student filters">{["All", "Here today", "At risk"].map((label) => <button key={label} aria-pressed={filter === label} onClick={() => setFilter(label)}>{label}</button>)}</div>
        <p className={styles.quiet}>Green highlight = checked in now · Demo date {formatDate(demoDate)}. At risk includes academic concerns and attendance planning gaps.</p>
        {!visible.length ? <p className={styles.empty}>No students match. Try another name or filter.</p> : overview === "module" ? <div className={styles.register}>
          <div className={styles.tableLabels} aria-hidden="true"><span>Student</span><span>Term att.</span><span>Pres.</span><span>FA</span><span /></div>
          {visible.map((candidate) => {
            const info = progress(candidate.id, module, records, attendance, termId);
            return <button key={candidate.id} aria-current={tablet && variant === "B" && view !== "overview" && studentId === candidate.id ? "true" : undefined} className={styles.studentRow + (hereToday(candidate.id, termId, attendance) ? " " + styles.here + " " + styles.hereRow : "")} onClick={() => openStudent(candidate)} aria-label={candidate.name + ", attendance " + info.attended + " of " + info.required + ", " + info.presentations + " presentation completed, " + info.formative + " formative assessments"}>
              <span className={styles.identity}><Avatar student={candidate} /><span><strong>{candidate.name}</strong>{hereToday(candidate.id, termId, attendance) && <small className={styles.ok}>● Here today</small>}<small className={riskReasons(candidate.id).length ? styles.risk : styles.quiet}>{riskReasons(candidate.id)[0] ?? (info.attended < info.required ? "Attendance in progress" : "Attendance target met")}</small></span></span>
              <span>{info.attended}<small>/{info.required}</small></span><span className={info.presentations ? styles.check : styles.pending}>{info.presentations ? <Check size={17} /> : "—"}</span><span>{info.formative}</span><ChevronRight size={14} />
            </button>;
          })}
        </div> : <>
          <p className={styles.contextNote}>Swipe dates horizontally. Tap any date cell for details.</p>
          <div className={styles.matrixScroll} role="region" aria-label="Term attendance and presentation register" tabIndex={0}><table className={styles.matrix}>
            <thead><tr><th scope="col">Student</th>{term.dates.map((date) => <th scope="col" key={date}>{formatDate(date).slice(0, 6)}</th>)}</tr></thead>
            <tbody>{visible.map((candidate) => {
              const summary = attendanceProgress(candidate.id, termId, attendance);
              const required = enrolments.filter((enrolment) => enrolment.studentId === candidate.id && enrolment.termId === termId && enrolment.presentationRequired).length;
              return <tr key={candidate.id} className={hereToday(candidate.id, termId, attendance) ? styles.hereRow : undefined}><th scope="row"><button onClick={() => openStudent(candidate)}><strong>{candidate.name}</strong>{hereToday(candidate.id, termId, attendance) && <small className={styles.ok}>● Here today</small>}<small>Attendance {summary.attended}/{summary.required}</small><small>Presentations {completedCount(candidate.id)}/{required}</small></button></th>
                {term.dates.map((date) => {
                  const session = attendance.find((entry) => entry.studentId === candidate.id && entry.termId === termId && entry.date === date);
                  const events = presentations.filter((entry) => entry.studentId === candidate.id && entry.termId === termId && entry.date === date);
                  return <td key={date}><button className={styles.dayCell} onClick={() => setDialog({ kind: "day", studentId: candidate.id, date })} aria-label={candidate.name + ", " + formatDate(date) + ", " + (session?.status ?? "Not planned") + events.map((entry) => ", " + entry.module + (records.some((record) => record.presentationId === entry.id) ? " presented" : " presentation planned")).join("")}>
                    <span className={statusClass(session?.status)}>{session?.status === "Attended" ? "✓ Attended" : session?.status === "Partial" ? "◐ Partial" : session?.status === "Missed" ? "× Missed" : session?.status === "Planned" ? "○ Planned" : "—"}</span>
                    {events.map((entry) => <span key={entry.id} className={records.some((record) => record.presentationId === entry.id) ? styles.presentedBadge : styles.plannedBadge}>{entry.module} · {records.some((record) => record.presentationId === entry.id) ? "Presented" : "Presenting"}</span>)}
                  </button></td>;
                })}
              </tr>;
            })}</tbody>
          </table></div>
          <p className={styles.matrixLegend}><span className={styles.ok}>✓ Attended</span><span className={styles.late}>◐ Partial</span><span className={styles.risk}>× Missed</span><span className={styles.planned}>○ Planned</span></p>
        </>}
        <p className={styles.contextNote}>Attendance is term-wide: attended / required days. Partial days follow the existing LMS counting rule. Planned dates never count as attendance. A presentation tick means one module presentation, regardless of assessor count.</p>
      </section>}
      {view === "profile" && <section className={styles.studentWorkspace} aria-label="Student workspace">
        <button className={styles.back} onClick={() => navigate("overview")}><ArrowLeft size={16} /> Back to students</button>
        <div className={styles.profileHero}><Avatar student={student} /><div><p className={styles.eyebrow}>{student.id}</p><h1>{student.name}</h1><p>{student.role}</p></div></div>
        <label className={styles.field}>Student<select aria-label="Student" value={studentId} onChange={(event) => setStudentId(event.target.value)}>{students.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
        <label className={styles.field + " " + styles.teachingContext}>Teaching context<select aria-label="Teaching context" value={termId} onChange={(event) => setTermId(event.target.value)}>{terms.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.status === "active" ? " · Active" : " · Read-only"}</option>)}</select></label>
        <div className={styles.profileGrid}>
        <section className={styles.profileSection}><div className={styles.sectionTitle}><h2>Module enrolments</h2><span>All terms</span></div>
          {enrolmentGroups}
          {!canWrite && <p className={styles.quiet}>No actively studied module in this term. Teaching records and plans are read-only.</p>}
        </section>
        <section className={styles.profileSection}><div className={styles.sectionTitle}><h2>Upcoming plans</h2><button className={styles.addButton} disabled={!canWrite} onClick={() => setDialog({ kind: "plan", type: "Presentation" })}><Plus size={16} /> Plan a date</button></div>
          <p className={styles.quiet}>{term.name} · Selected teaching context</p>
          {presentations.filter((entry) => entry.studentId === studentId && entry.termId === termId && !records.some((record) => record.presentationId === entry.id)).map((entry) => <div className={styles.planRow} key={entry.id}><span><strong>{entry.module} · {moduleName(entry.module)}</strong><small>{formatDate(entry.date)} · Presentation planned</small></span>{canRecordTeaching(studentId, entry.termId, entry.module) ? <><button className={styles.textButton} onClick={() => { setModule(entry.module); setDialog({ kind: "plan", type: "Presentation" }); }}>Change</button><button className={styles.textButton} onClick={() => cancelPresentation(entry)}>Cancel</button></> : <small>Read-only</small>}</div>)}
          {!presentations.some((entry) => entry.studentId === studentId && entry.termId === termId && !records.some((record) => record.presentationId === entry.id)) && <p className={styles.quiet}>No outstanding presentation plans.</p>}
        </section>
        <section className={styles.profileSection}><div className={styles.sectionTitle}><h2>Teaching records</h2><button className={styles.addButton} disabled={!canWrite} onClick={() => navigate("entry")}><Plus size={16} /> Add record</button></div>
          <p className={styles.quiet}>All terms · Module and assessor shown on every record</p>
          <TeachingTimeline records={studentRecords} staffId={staffId} edit={editScore} />
        </section>
        <section className={styles.profileSection}><div className={styles.sectionTitle}><h2>Attendance history</h2><span>{history.attended}/{history.required} required days</span></div>
          <label className={styles.field}>Show attendance for term<select aria-label="Show attendance for term" value={attendanceTermId} onChange={(event) => setAttendanceTermId(event.target.value)}>{terms.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
          <p className={styles.quiet}>{history.attended} attended · {history.planned} planned · target {history.required}</p>
          {[...history.sessions].sort((first, second) => first.date.localeCompare(second.date)).map((session) => <div key={session.date} className={styles.attendanceRow + (session.status === "Planned" ? " " + styles.plannedRow : "")}><span><strong>{formatDate(session.date)}</strong><small>{session.time}</small></span><span className={statusClass(session.status)}>{session.status === "Planned" ? "○ Planned" : session.status}</span>{session.status === "Planned" && !session.checkedInAt && session.date >= demoDate && canRecordTeaching(studentId, session.termId) && <><button className={styles.textButton} onClick={() => { setTermId(session.termId); setDialog({ kind: "plan", type: "Attendance", originalDate: session.date }); }}>Change</button><button className={styles.textButton} onClick={() => cancelAttendance(session)}>Cancel</button></>}</div>)}
          <button className={styles.textButton} disabled={!canRecordTeaching(studentId, attendanceTermId)} onClick={() => { setTermId(attendanceTermId); setDialog({ kind: "plan", type: "Attendance" }); }}><Plus size={16} /> Plan attendance</button>
        </section>
        </div>
      </section>}
      {view === "entry" && <section className={styles.entryWorkspace} aria-label="Teaching entry workspace">
        <button className={styles.back} onClick={() => navigate("profile")}><ArrowLeft size={16} /> Back to {student.name.split(" ")[0]}</button><h1>Add teaching record</h1><p className={styles.quiet}>{term.name} · Recording as {staffName(staffId)}</p>
        {canWrite ? <><div className={styles.entryContext}><label className={styles.field}>Student<select aria-label="Student" value={studentId} onChange={(event) => setStudentId(event.target.value)}>{students.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><label className={styles.field}>Module<select aria-label="Module" value={entryModule} onChange={(event) => setModule(event.target.value)}>{activeEnrolments.map((enrolment) => <option key={enrolment.module} value={enrolment.module}>{enrolment.module} · {moduleName(enrolment.module)}</option>)}</select></label></div>
        <div className={styles.entryTabs} aria-label="Record type">{(["Presentation", "Formative", "Encounter"] as const).map((candidate) => <button key={candidate} aria-pressed={kind === candidate} onClick={() => setKind(candidate)}>{candidate}</button>)}</div>
        {kind === "Presentation" && ownSubmission ? <div className={styles.duplicateNotice} role="status"><strong>You’ve already scored this presentation.</strong><p>{student.name} · {entryModule} · {term.name}</p><p>One submission per staff member for this module enrolment. Edit your existing score instead.</p><button className={styles.primary} onClick={() => editScore(ownSubmission)}>Edit my existing score</button></div> : <RecordForm key={studentId + entryModule + termId + kind + staffId} kind={kind} studentId={studentId} module={entryModule} termId={termId} staffId={staffId} presentation={kind === "Presentation" ? presentation : undefined} sharedPresentationLocked={kind === "Presentation" && presentationCompleted} onSave={saveRecord} />}</> : <p className={styles.quiet}>No active module enrolment in an active term. Teaching input is unavailable; existing records remain readable.</p>}
      </section>}
      <details className={styles.debug}><summary>Prototype assumptions & current state</summary>
        <label className={styles.field}>Preview staff account<select aria-label="Preview staff account" value={staffId} onChange={(event) => { setStaffId(event.target.value); setDialog(null); }}>{staff.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
        <p>Approved A. Fictional data, in-memory only. One presentation per module enrolment, multiple assessors. Edit controls simulate author-only permissions; production requires database enforcement. Module attendance is the term total. Demo requirements are 4 or 5 days; the real implementation will use the existing rule. Partial attendance counts as an attended day. Planned dates are separate. Attendance planning warnings are operational, not a new academic-risk evaluator. Drafts reset on navigation or selection changes.</p>
        <pre>{JSON.stringify({ tablet, variant, view, overview, termId, module, studentId, staffId, records, presentations, attendance }, null, 2)}</pre>
      </details>
    </main>
    <nav className={styles.bottomNav + " " + styles.approvedNav} aria-label="Teaching navigation"><button aria-current={view === "overview" ? "page" : undefined} onClick={() => navigate("overview")}><Users size={21} />Overview</button><button aria-current={view === "profile" ? "page" : undefined} onClick={() => navigate("profile")}><UserRound size={21} />Student</button><button disabled={!canWrite} aria-current={view === "entry" ? "page" : undefined} onClick={() => navigate("entry")}><ClipboardPen size={21} />Add record</button></nav>
    {tablet && <PrototypeSwitcher current={variant} variants={[{ key: "A", name: "Roomier register" }, { key: "B", name: "Split workspace" }, { key: "C", name: "Term board + drawer" }]} onChange={(next) => { setDialog(null); setView(next === "B" ? "profile" : "overview"); setOverview(next === "C" ? "term" : "module"); setMessage(""); }} />}
    {dialog?.kind === "student" && <Modal title={student.name} drawer close={() => setDialog(null)}>
      <p className={styles.quiet}>{student.id} · {term.name} · {hereToday(studentId, termId, attendance) ? "● Here today" : "Not checked in now"}</p>
      <div className={styles.drawerStats}><span><strong>{attendanceProgress(studentId, termId, attendance).attended}/{attendanceProgress(studentId, termId, attendance).required}</strong>Attendance</span><span><strong>{completedCount(studentId)}/{studentEnrolments.filter((enrolment) => enrolment.presentationRequired).length}</strong>Presentations</span></div>
      <section><h2>Module enrolments · All terms</h2>{enrolmentGroups}</section>
      <div className={styles.drawerActions}><button className={styles.primary} onClick={() => { setDialog(null); navigate("profile"); }}>Open full profile</button><button className={styles.addButton} disabled={!canWrite} onClick={() => setDialog({ kind: "plan", type: "Attendance" })}>Plan attendance</button></div>
      <section><h2>Teaching records</h2><TeachingTimeline records={studentRecords} staffId={staffId} edit={editScore} /></section>
    </Modal>}
    {dialog?.kind === "edit" && dialog.record.staffId === staffId && canRecordTeaching(dialog.record.studentId, dialog.record.termId, dialog.record.module) && <Modal title="Edit my presentation score" close={() => setDialog(null)}><p className={styles.quiet}>{students.find((candidate) => candidate.id === dialog.record.studentId)?.name} · {dialog.record.module} · {staffName(staffId)}</p><RecordForm key={dialog.record.id} kind="Presentation" studentId={dialog.record.studentId} module={dialog.record.module} termId={dialog.record.termId} staffId={staffId} initial={dialog.record} presentation={presentations.find((entry) => entry.id === dialog.record.presentationId)} sharedPresentationLocked onSave={saveRecord} /></Modal>}
    {dialog?.kind === "plan" && canWrite && <Modal title={"Plan a date · " + student.name} close={() => setDialog(null)}><PlanForm key={studentId + termId + entryModule + (dialog.originalDate ?? "")} originalDate={dialog.originalDate} type={dialog.type} termId={termId} studentId={studentId} module={entryModule} presentations={presentations} records={records} onSave={savePlan} /></Modal>}
    {dialog?.kind === "day" && <Modal title={dayStudent.name + " · " + formatDate(dialog.date)} close={() => setDialog(null)}>
      <p className={styles.quiet}>{attendance.find((entry) => entry.studentId === dayStudent.id && entry.termId === termId && entry.date === dialog.date)?.status ?? "No attendance planned or recorded"}</p>
      {presentations.filter((entry) => entry.studentId === dayStudent.id && entry.termId === termId && entry.date === dialog.date).map((entry) => <section key={entry.id}><h2>{entry.module} · {moduleName(entry.module)}</h2><p className={styles.quiet}>{records.some((record) => record.presentationId === entry.id) ? "Presented · " + records.filter((record) => record.presentationId === entry.id).length + " assessor submission(s)" : "Presentation planned"}</p></section>)}
      <button className={styles.primary} onClick={() => { setDialog(null); openStudent(dayStudent); }}>Open student profile</button>
    </Modal>}
  </div></div>;
}

function RecordForm({ kind, studentId, module, termId, staffId, onSave, initial, presentation, sharedPresentationLocked = false }: {
  kind: RecordKind; studentId: string; module: string; termId: string; staffId: string; onSave: (record: TeachingRecord) => void;
  initial?: TeachingRecord; presentation?: Presentation; sharedPresentationLocked?: boolean;
}) {
  const [scores, setScores] = useState<Record<string, number>>(initial?.scores ?? {});
  const [penaltyInput, setPenaltyInput] = useState(String(initial?.timePenalty ?? 0));
  const [formativeItems, setFormativeItems] = useState<string[]>([]);
  const criteria = presentationRubricGroups.flatMap((group) => group.criteria);
  const scored = Object.keys(scores).length;
  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  const timePenalty = Number(penaltyInput);
  const validPenalty = penaltyInput.trim() !== "" && Number.isInteger(timePenalty) && timePenalty >= 0 && timePenalty <= total;
  const finalScore = validPenalty ? total - timePenalty : undefined;
  const defaultDate = initial?.date ?? (presentation && presentation.date <= demoDate ? presentation.date : demoDate);
  const fieldPrefix = useId();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (kind === "Presentation" && (scored !== criteria.length || !validPenalty)) return;
    if (kind === "Formative" && !formativeItems.length) return;
    const form = new FormData(event.currentTarget);
    onSave({
      id: initial?.id ?? crypto.randomUUID(), studentId, module, termId, staffId, kind,
      date: sharedPresentationLocked ? presentation?.date ?? initial!.date : String(form.get("date")),
      summary: String(form.get("notes") ?? ""),
      ...(kind === "Presentation" ? {
        presentationId: initial?.presentationId ?? presentation?.id ?? crypto.randomUUID(),
        score: finalScore, maximum: 50, scores, timePenalty,
        duration: sharedPresentationLocked ? presentation?.duration ?? initial?.duration : Number(form.get("duration")),
        presentationType: sharedPresentationLocked ? presentation?.type ?? initial?.presentationType : String(form.get("presentationType"))
      } : {}),
      ...(kind === "Formative" ? { score: Number(form.get("score")), maximum: 5, items: formativeItems } : {}),
      ...(kind === "Encounter" ? { concern: String(form.get("concern")) } : {})
    });
  }
  return <form className={styles.recordForm} onSubmit={submit}>
    {sharedPresentationLocked && <p className={styles.quiet}>Scoring the existing {module} presentation. Its date, type and duration are shared; your rubric and feedback are your own.</p>}
    <div className={styles.formColumns}><label className={styles.field}>Date<input name="date" type="date" defaultValue={defaultDate} max={demoDate} readOnly={sharedPresentationLocked} required /></label>{kind === "Presentation" && <label className={styles.field}>Duration · minutes<input name="duration" type="number" min="1" max="180" defaultValue={initial?.duration ?? presentation?.duration} readOnly={sharedPresentationLocked} placeholder="e.g. 12" inputMode="numeric" required /></label>}</div>
    {kind === "Presentation" && <>
      <label className={styles.field}>Presentation type<select aria-label="Presentation type" name="presentationType" defaultValue={initial?.presentationType ?? presentation?.type} disabled={sharedPresentationLocked}><option>Case presentation</option><option>Journal club</option></select></label>
      <div className={styles.scoreSummary}><span><strong>Presentation rubric</strong><small>1 = needs improvement · 5 = excellent</small></span><b>{total}<small>/50</small></b></div>
      {presentationRubricGroups.map((group, groupIndex) => <fieldset className={styles.rubric} key={group.name}><legend><span>0{groupIndex + 1}</span>{group.name}</legend>{group.criteria.map((criterion) => <div className={styles.criterion} key={criterion.id}><p id={fieldPrefix + criterion.id}>{criterion.label}</p><div className={styles.scoreButtons} role="group" aria-labelledby={fieldPrefix + criterion.id}>{[1, 2, 3, 4, 5].map((score) => <button type="button" key={score} aria-pressed={scores[criterion.id] === score} aria-label={criterion.label + ": " + score + " out of 5"} onClick={() => setScores((previous) => ({ ...previous, [criterion.id]: score }))}>{score}</button>)}</div></div>)}</fieldset>)}
      <p className={styles.quiet} aria-live="polite">{scored} of {criteria.length} criteria scored</p>
      <section className={styles.penaltyPanel} aria-label="Presentation time penalty">
        <label className={styles.field} htmlFor={fieldPrefix + "penalty"}>Time penalty · points to deduct</label>
        <p className={styles.quiet} id={fieldPrefix + "penaltyHelp"}>Enter a manual deduction if the presentation exceeded its permitted time. Use 0 for no penalty; no automatic time limit is configured.</p>
        <div className={styles.penaltyStepper}>
          <button type="button" aria-label="Decrease time penalty" disabled={!validPenalty || timePenalty === 0} onClick={() => setPenaltyInput(String(timePenalty - 1))}>−</button>
          <input id={fieldPrefix + "penalty"} name="timePenalty" aria-describedby={fieldPrefix + "penaltyHelp"} aria-invalid={!validPenalty} type="number" min="0" max={total} step="1" inputMode="numeric" required value={penaltyInput} onChange={(event) => setPenaltyInput(event.target.value)} />
          <button type="button" aria-label="Increase time penalty" disabled={!validPenalty || timePenalty >= total} onClick={() => setPenaltyInput(String(timePenalty + 1))}>+</button>
        </div>
        {!validPenalty && <p className={styles.risk} role="alert">Enter a whole number from 0 to the rubric subtotal ({total}).</p>}
        <dl className={styles.scoreTotals} aria-live="polite"><dt>Rubric subtotal</dt><dd>{total}/50</dd><dt>Time penalty</dt><dd>{validPenalty ? "−" + timePenalty + " points" : "Check entry"}</dd><dt>Final score{scored !== criteria.length ? " · incomplete rubric" : ""}</dt><dd>{finalScore === undefined ? "—" : finalScore + "/50"}</dd></dl>
      </section>
    </>}
    {kind === "Formative" && <><fieldset className={styles.rubric}><legend>Skills assessed</legend>{["Patient preparation", "Image acquisition", "Interpretation", "Clinical integration"].map((item) => <label className={styles.checkbox} key={item}><input type="checkbox" checked={formativeItems.includes(item)} onChange={(event) => setFormativeItems((previous) => event.target.checked ? [...previous, item] : previous.filter((value) => value !== item))} />{item}</label>)}</fieldset><label className={styles.field}>Overall score · 1–5<input name="score" type="number" min="1" max="5" step="1" inputMode="numeric" placeholder="Enter score" required /></label><p className={styles.quiet}>Demo scale · select at least one skill.</p></>}
    {kind === "Encounter" && <label className={styles.field}>Concern level<select aria-label="Concern level" name="concern"><option>None</option><option>Watch</option><option>Support needed</option></select></label>}
    <label className={styles.field}>{kind === "Encounter" ? "Teaching note" : "Feedback · optional"}<textarea name="notes" rows={4} defaultValue={initial?.summary} placeholder={kind === "Encounter" ? "What did you cover? What should happen next?" : "What went well? What could improve?"} required={kind === "Encounter"} /></label>
    <button className={styles.primary} disabled={(kind === "Presentation" && (scored !== criteria.length || !validPenalty)) || (kind === "Formative" && !formativeItems.length)}><Check size={18} />{initial ? "Update my score" : "Save " + kind.toLowerCase()}</button><p className={styles.saveHint}>Saved in this preview only. Reload to reset.</p>
  </form>;
}

function PlanForm({ type: initialType, termId, studentId, module, presentations, records, onSave, originalDate }: {
  type: "Attendance" | "Presentation"; termId: string; studentId: string; module: string; presentations: Presentation[]; records: TeachingRecord[]; originalDate?: string;
  onSave: (type: "Attendance" | "Presentation", date: string, module: string, alsoAttendance: boolean) => void;
}) {
  const [type, setType] = useState(initialType);
  const eligible = enrolments.filter((enrolment) => enrolment.studentId === studentId && enrolment.termId === termId && enrolment.presentationRequired && canRecordTeaching(studentId, termId, enrolment.module) && !records.some((record) => record.kind === "Presentation" && record.studentId === studentId && record.module === enrolment.module && record.termId === termId));
  const [plannedModule, setPlannedModule] = useState(eligible.some((enrolment) => enrolment.module === module) ? module : eligible[0]?.module ?? "");
  const dates = terms.find((term) => term.id === termId)!.dates.filter((date) => date >= demoDate);
  const existing = presentations.find((entry) => entry.studentId === studentId && entry.termId === termId && entry.module === plannedModule);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRecordTeaching(studentId, termId, type === "Presentation" ? plannedModule : undefined) || (type === "Presentation" && !eligible.length)) return;
    const form = new FormData(event.currentTarget);
    onSave(type, String(form.get("date")), plannedModule, form.get("alsoAttendance") === "on");
  }
  return <form className={styles.recordForm} onSubmit={submit}>
    <label className={styles.field}>Plan type<select aria-label="Plan type" disabled={Boolean(originalDate)} value={type} onChange={(event) => setType(event.target.value as typeof type)}><option>Attendance</option><option>Presentation</option></select></label>
    {type === "Presentation" && !eligible.length && <div className={styles.duplicateNotice} role="status"><strong>No presentation is available to schedule.</strong><p>{enrolments.some((enrolment) => enrolment.studentId === studentId && enrolment.termId === termId && enrolment.presentationRequired && canRecordTeaching(studentId, termId, enrolment.module)) ? "All required presentations for your active modules are already complete." : "There are no active module enrolments requiring a presentation."}</p><p>A completed presentation can still receive another assessor’s score through Add record.</p><button className={styles.primary} type="button" onClick={() => setType("Attendance")}>Plan attendance instead</button></div>}
    {(type === "Attendance" || eligible.length > 0) && <>
    {type === "Attendance" && <p className={styles.quiet}>Attendance is term-wide; no module selection is needed.</p>}
    {type === "Presentation" && <label className={styles.field}>Module to present<select aria-label="Module to present" value={plannedModule} onChange={(event) => setPlannedModule(event.target.value)} required><option value="" disabled>Select module</option>{eligible.map((enrolment) => <option value={enrolment.module} key={enrolment.module}>{enrolment.module} · {moduleName(enrolment.module)}</option>)}</select></label>}
    {type === "Presentation" && existing && <p className={styles.quiet}>Currently planned: {formatDate(existing.date)}. Saving updates this plan.</p>}
    <label className={styles.field}>Teaching date<select aria-label="Teaching date" name="date" key={plannedModule} defaultValue={originalDate ?? (type === "Presentation" && dates.includes(existing?.date ?? "") ? existing?.date : dates[0])} required>{dates.map((date) => <option key={date} value={date}>{formatDate(date)} · 09:00–16:00</option>)}</select></label>
    {!dates.length && <p className={styles.quiet}>No upcoming teaching dates in this term. An admin must create a date.</p>}
    {type === "Presentation" && !eligible.length && <p className={styles.quiet}>All required module presentations are already complete.</p>}
    {type === "Presentation" && <label className={styles.checkbox}><input name="alsoAttendance" type="checkbox" defaultChecked />Also plan attendance on this date</label>}
    <button className={styles.primary} disabled={!dates.length || (type === "Presentation" && !plannedModule)}>Save plan</button></>}
    <p className={styles.quiet}>Plans are separate from attendance and completed presentations. Changing a presentation date does not remove other attendance plans.</p>
  </form>;
}
