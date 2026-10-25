"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, BookOpen, CalendarCheck, CreditCard, LayoutDashboard, MessageSquare, Pencil } from "lucide-react";
import type { Student } from "@/lib/types";
import type { StudentWorkspaceData } from "@/lib/student-workspace";
import type { AssessmentAttempt, AssessmentOutcome, AssessmentRevision } from "@/lib/assessment/types";
import { AssessmentRegister, OutcomeBadge } from "./assessment-register";
import { StudentProfilePhoto } from "./student-profile-photo";
import { StudentProfileDialog } from "./student-profile-dialog";
import { StudentAttendanceSection } from "./student-attendance";
import { StudentEnrolmentActions } from "./student-enrolments";
import { StudentTeachingSection } from "./student-teaching";
import { StudentFinanceSection } from "./student-finance";
import { StudentPhotoDialog } from "./student-photo-dialog";
import { loadWorkspacePhoto } from "@/app/students/photo-actions";
import type { PhotoSnapshot } from "@/lib/student-photo";
import type { AssessmentDecision, AssessmentSourceEvidence } from "@/lib/assessment/types";
import styles from "./student-workspace.module.css";

const sections = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "modules", label: "Modules & results", icon: BookOpen },
  { id: "attendance", label: "Attendance", icon: CalendarCheck },
  { id: "teaching", label: "Teaching records", icon: MessageSquare },
  { id: "finance", label: "Finance", icon: CreditCard }
];
const money = (amount: number | undefined) => amount === undefined ? "Not recorded" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amount / 100);
const dateLabel = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function WorkspaceRefresh() {
  const router = useRouter();
  useEffect(() => {
    function refresh() {
      if (document.visibilityState === "visible" && !document.querySelector("dialog[open], [data-unsaved=true]")) router.refresh();
    }
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [router]);
  return null;
}

export function StudentWorkspace({ student, data, outcomes, attempts, revisions, sourceEvidence, terms, decisions, canEdit, canFinance, canTeach, returnTo }: {
  student: Student; data: StudentWorkspaceData; outcomes: AssessmentOutcome[]; attempts: AssessmentAttempt[]; revisions: AssessmentRevision[];
  canEdit: boolean; canFinance: boolean; returnTo?: string; terms: Array<{ id: string; name: string }>; decisions: AssessmentDecision[];
  sourceEvidence: AssessmentSourceEvidence[]; canTeach: boolean;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const originalIdentity = useRef<HTMLHeadingElement>(null);
  const originalPhoto = useRef<HTMLSpanElement>(null);
  const compactIdentity = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const [compactHeight, setCompactHeight] = useState(0);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [photoTask, setPhotoTask] = useState<PhotoSnapshot | null>(null);
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const availableSections = sections.filter(section => section.id !== "finance" || canFinance);
  const requestedTab = searchParams.get("tab") === "notes" ? "teaching" : searchParams.get("tab");
  const tab = availableSections.find(section => section.id === requestedTab)?.id ?? "overview";
  const name = `${student.firstName} ${student.lastName}`;
  const identifier = student.cccuStudentId || student.temporaryId;
  const initials = `${student.firstName[0] ?? ""}${student.lastName[0] ?? ""}`;
  const passed = outcomes.filter(outcome => outcome.assessment.effective_status === "Pass").length;
  const credits = outcomes.reduce((sum, outcome) => sum + (outcome.assessment.awarded_credits ?? 0), 0);
  const recordedPaid = data.finance.reduce((sum, record) => sum + (record.paidAmountPence ?? 0), 0);
  const expectedFees = data.finance.reduce((sum, record) => sum + record.expectedAmountPence, 0);
  const paymentIncomplete = data.finance.some(record => record.paidAmountPence === undefined);
  const directoryHref = returnTo?.startsWith("/students?") && returnTo.length < 4000 ? returnTo : "/students";

  async function editPhoto() {
    setLoadingPhoto(true); setProfileMessage("");
    try {
      const result = await loadWorkspacePhoto(student.id);
      if (result.ok) setPhotoTask(result.snapshot); else setProfileMessage(result.error);
    } catch { setProfileMessage("Photo details could not be loaded. Please try again."); }
    finally { setLoadingPhoto(false); }
  }

  function navigate(section: string, termId?: string) {
    const query = new URLSearchParams(window.location.search);
    query.set("tab", section);
    if (termId) query.set("term", termId);
    window.history.pushState(null, "", `${pathname}?${query}`);
    requestAnimationFrame(() => { panel.current?.focus({ preventScroll: true }); panel.current?.scrollIntoView({ block: "start" }); });
  }

  useEffect(() => {
    const original = originalIdentity.current;
    const compact = compactIdentity.current;
    if (!original || !compact) return;
    function update() {
      const appHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--workspace-app-height")) || 0;
      const focused = compact?.contains(document.activeElement);
      const identityBottom = Math.max(original?.getBoundingClientRect().bottom ?? Infinity, originalPhoto.current?.getBoundingClientRect().bottom ?? Infinity);
      setPinned(Boolean(focused) || identityBottom <= appHeight);
    }
    const observer = new IntersectionObserver(update, { threshold: [0, 1] });
    const resize = new ResizeObserver(() => { setCompactHeight(compact.getBoundingClientRect().height); update(); });
    observer.observe(original);
    if (originalPhoto.current) observer.observe(originalPhoto.current);
    resize.observe(compact);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const afterFocus = () => requestAnimationFrame(update);
    compact.addEventListener("focusout", afterFocus);
    update();
    return () => { observer.disconnect(); resize.disconnect(); window.removeEventListener("scroll", update); window.removeEventListener("resize", update); compact.removeEventListener("focusout", afterFocus); };
  }, []);

  const avatar = (compact = false) => <span ref={compact ? undefined : originalPhoto} className={compact ? styles.smallAvatar : styles.avatar}><StudentProfilePhoto studentId={student.id} studentName={name} initials={initials} hasPhoto={Boolean(student.photoUrl)} version={student.profileRevision} /></span>;
  const sectionSelector = <label className={styles.sectionSelector}>Student section<select value={tab} onChange={event => navigate(event.target.value)}>{availableSections.map(section => <option key={section.id} value={section.id}>{section.label}</option>)}</select></label>;
  const heading = (title: string, detail: string) => <div className={styles.sectionHeading}><div><h2>{title}</h2><p className={styles.muted}>{detail}</p></div></div>;

  return <div className={styles.workspace} style={{ "--identity-height": `${compactHeight}px`, "--active-identity-height": pinned ? `${compactHeight}px` : "0px" } as CSSProperties}>
    <WorkspaceRefresh />
    <div ref={compactIdentity} className={`${styles.compactIdentity} ${pinned ? styles.isPinned : ""}`} inert={!pinned} aria-hidden={!pinned}>
      <div className={styles.compactPerson}>{avatar(true)}<div><strong>{name}</strong><span>{identifier}</span></div><span className={`${styles.badge} ${styles.neutral} ${styles.compactStatus}`}>{student.status.replaceAll("_", " ")}</span></div>
      {canEdit ? <button className={`${styles.button} ${styles.compactEdit}`} onClick={() => setEditingProfile(true)}><Pencil size={15} />Edit student details</button> : null}
      {canEdit ? <details className={styles.compactActions}><summary>Student actions</summary><button onClick={() => setEditingProfile(true)}>Edit student details</button><button disabled={loadingPhoto} onClick={editPhoto}>Manage photo</button><Link href={`${pathname}?view=legacy&mode=edit`}>Other student tools</Link></details> : null}
      {sectionSelector}
    </div>
    <div className={styles.breadcrumb}><Link href={directoryHref}><ArrowLeft size={15} />Students directory</Link><span>/</span><span>{name}</span><Link className={styles.globalLink} href="/assessments">All-student assessments <ArrowUpRight size={15} /></Link></div>
    <div className={styles.reviewNotice}>Development review · Student details, photos, enrolments, attendance, teaching, finance and assessment tasks save here.</div>
    {profileMessage ? <p role="status" className={styles.notice}>{profileMessage}</p> : null}
    <div className={styles.layout}>
      <aside className={styles.rail}>
        <div className={styles.identity}>{avatar()}{canEdit ? <button className={styles.textButton} disabled={loadingPhoto} onClick={editPhoto}>{loadingPhoto ? "Loading photo…" : "Manage photo"}</button> : null}<h1 ref={originalIdentity}>{name}</h1><span className={`${styles.badge} ${styles.neutral}`}>{student.status.replaceAll("_", " ")}</span><p>{identifier} · {student.programme === "pgcert" ? "PGCert POCUS" : "Microcredential"}</p><a href={`mailto:${student.email}`}>{student.email}</a>{student.phone ? <a href={`tel:${student.phone}`}>{student.phone}</a> : null}{canEdit ? <><button className={styles.button} onClick={() => setEditingProfile(true)}><Pencil size={15} />Edit student details</button><Link className={styles.textButton} href={`${pathname}?view=legacy&mode=edit`}>Other student tools</Link></> : null}</div>
        <nav className={styles.sectionNav} aria-label="Student sections">{availableSections.map(section => { const Icon = section.icon; return <button key={section.id} aria-current={tab === section.id ? "page" : undefined} onClick={() => navigate(section.id)}><Icon size={18} />{section.label}</button>; })}</nav>
        <div className={styles.mobileSelector}>{sectionSelector}</div>
      </aside>
      <div ref={panel} tabIndex={-1} className={styles.workingSection}>
        {tab === "overview" ? <div className={styles.stack}>
          <div className={styles.metrics}><button onClick={() => navigate("modules")}><span>Module progress</span><strong>{passed}<small> / {outcomes.length} passed</small></strong><span>{credits} credits awarded</span></button><button onClick={() => navigate("attendance")}><span>Attendance records</span><strong>{data.attendance.filter(record => record.status === "attended").length}<small> attended</small></strong><span>{data.attendance.filter(record => record.status === "missed").length} missed sessions</span></button>{canFinance ? <button onClick={() => navigate("finance")}><span>Recorded balance</span><strong>{!data.finance.length ? "Not recorded" : paymentIncomplete ? "Incomplete" : money(expectedFees - recordedPaid)}</strong><span>{paymentIncomplete ? "Some payment amounts are not recorded" : "Expected fees less recorded payments"}</span></button> : <button onClick={() => navigate("teaching")}><span>Teaching records</span><strong>{data.teaching.length}</strong><span>Observations, assessments & presentations</span></button>}</div>
          <section className={styles.panel}>{heading("Modules at a glance", "Each module has its own outcome.")}<div className={styles.moduleList}>{outcomes.map(outcome => <button key={outcome.enrolment_id} onClick={() => navigate("modules")}><span><strong>{outcome.module_title}</strong><small>{outcome.module_code} · {outcome.original_cohort}</small></span><OutcomeBadge assessment={outcome.assessment} /></button>)}{!outcomes.length ? <p className={styles.empty}>No module enrolments yet.</p> : null}</div></section>
          <section className={styles.panel}>{heading("Student details", "Contact, programme and student lifecycle.")}<dl className={styles.facts}><div><dt>Programme</dt><dd>{student.programme === "pgcert" ? "PGCert POCUS" : "Microcredential"}</dd></div><div><dt>Admission stage</dt><dd>{student.admissionStage.replaceAll("_", " ")}</dd></div><div><dt>Temporary ID</dt><dd>{student.temporaryId}</dd></div><div><dt>CCCU student ID</dt><dd>{student.cccuStudentId ?? "Not recorded"}</dd></div></dl>{student.notes ? <p>{student.notes}</p> : null}</section>
          <section className={styles.panel}>{heading("Latest teaching records", "Observations, formative assessments and presentations.")}{data.teaching.slice(0, 2).map(record => <article className={styles.teachingRecord} key={record.id}><strong>{record.type} · {record.module}</strong><p>{record.text || "Structured score recorded"}</p><small>{record.author} · {dateLabel(record.date)}</small></article>)}{!data.teaching.length ? <p className={styles.empty}>No teaching records yet.</p> : null}<button className={styles.textButton} onClick={() => navigate("teaching")}>View all teaching records <ArrowUpRight size={15} /></button></section>
        </div> : null}
        {tab === "modules" ? <section className={styles.panel}>{canEdit ? <StudentEnrolmentActions studentId={student.id} studentName={`${student.firstName} ${student.lastName}`} /> : null}<AssessmentRegister outcomes={outcomes} attempts={attempts} revisions={revisions} sourceEvidence={sourceEvidence} terms={terms} decisions={decisions} canEdit={canEdit} studentScoped onAttendance={termId => navigate("attendance", termId)} /></section> : null}
        {tab === "attendance" ? <StudentAttendanceSection studentId={student.id} studentName={name} records={data.attendance} terms={data.terms} sessionTerms={data.terms.filter(candidate => outcomes.some(outcome => outcome.assessment.original_term_id === candidate.id && !["Abandoned", "Module deferred"].includes(outcome.assessment.disposition ?? "")))} canEdit={canEdit} /> : null}
        {tab === "teaching" ? <StudentTeachingSection studentId={student.id} records={data.teaching} canTeach={canTeach} /> : null}
        {tab === "finance" && canFinance ? <StudentFinanceSection studentId={student.id} records={data.finance} /> : null}
      </div>
    </div>
    {editingProfile && canEdit ? <StudentProfileDialog student={student} terms={terms} close={() => setEditingProfile(false)} saved={message => { setEditingProfile(false); setProfileMessage(message); }} /> : null}
    {photoTask && canEdit ? <StudentPhotoDialog studentId={student.id} studentName={name} snapshot={photoTask} close={() => setPhotoTask(null)} saved={message => { setPhotoTask(null); setProfileMessage(message); }} /> : null}
  </div>;
}
