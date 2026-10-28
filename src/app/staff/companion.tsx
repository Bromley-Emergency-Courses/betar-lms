import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, Users, UserRound, ClipboardPen } from "lucide-react";
import { indicatorLabel } from "@/lib/assessment/display";
import { attendanceLabel, companionPageSize, companionHref as href, companionScreen, recordedAttendanceDays, termAttendance, type CompanionData } from "@/lib/staff-companion";
import styles from "./companion.module.css";
import { PresentationEditButton } from "@/components/presentation-edit-button";
import { CompanionTeaching } from "./companion-teaching";
import { CompanionEntry } from "./companion-entry";

function dateLabel(date: string) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
const statusLabels: Record<string, string> = { attended: "✓ Attended", partial: "◐ Partial", missed: "× Missed", expected: "○ Planned", not_recorded: "Not recorded" };
function statusStyle(status: string) {
  return status === "expected" ? styles.planned : status === "missed" ? styles.risk : status === "partial" ? styles.partial : styles.quiet;
}

export function StaffCompanion({ data }: { data: CompanionData }) {
  const { query, terms, modules, students, profile } = data;
  const screen = companionScreen(query);
  const selectedTerm = terms.find(term => term.id === query.term);
  const pages = Math.max(1, Math.ceil(data.total / companionPageSize));
  return <div className={styles.app}>
    <header className={styles.header}><strong>{screen === "overview" ? "Overview" : screen === "entry" ? "Add record" : "Student"}</strong><Link href="/staff?view=legacy">Existing staff workflow</Link></header>
    <details className={styles.notice}><summary>{data.mode === "shadow" ? "Assessment preview" : "Connected LMS records"} · {data.teachingEnabled ? "Staff teaching" : "Read-only"}</summary><p>Academic results remain read-only. Teaching and planning depend on enrolment eligibility; only authors can edit their scores.{data.mode === "shadow" ? " Results match the new student workspace; legacy reports may differ." : ""}</p></details>
    {screen !== "overview" ? profile ? <>
      {screen === "student" ? <Link className={styles.back} href={href(query, { screen: "overview", studentId: undefined, attendanceTerm: undefined })}><ArrowLeft size={16} /> Back to students</Link> : null}
      <div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{profile.name.split(" ").map(part => part[0]).slice(0, 2).join("")}</span><div><p className={styles.eyebrow}>{profile.identifier}</p><h1>{profile.name}</h1><p className={styles.quiet}>Student status: {profile.status}</p></div></div>
      <div className={styles.contextActions}><Link href={href(query, { studentId: undefined, attendanceTerm: undefined, screen, page: 1 })}>Change student</Link>{screen === "student" ? <Link href={href(query, { screen: "entry" })}>Add record</Link> : <Link href={href(query, { screen: "student" })}>View student profile</Link>}</div>
      {screen === "entry" ? <><h2>Add teaching record</h2><CompanionEntry key={profile.id} profile={profile} enabled={data.teachingEnabled} /></> : <div className={styles.profileGrid}>
        <section aria-labelledby="enrolment-heading"><div className={styles.sectionHeading}><h2 id="enrolment-heading">Module enrolments</h2><span>All terms</span></div>
          {terms.filter(term => profile.modules.some(module => module.termId === term.id)).map(term => <section key={term.id} className={styles.termGroup} aria-label={`${term.name} enrolments`}>
            <div className={styles.termHeading}><h3>{term.name}</h3><span>{term.status === "active" ? "Active term" : term.status}</span></div>
            {profile.modules.filter(module => module.termId === term.id).map(module => <article className={styles.module} key={module.id} aria-label={`${module.code} · ${term.name}`}>
              <div className={styles.moduleTitle}><span className={styles.moduleCode}>{module.code}</span><h3>{module.title}</h3></div>
              <p className={styles.quiet}>{module.status} · Presentation {module.presentation === "N/A" ? "not required" : module.presentation.toLowerCase()}</p>
              {module.plannedPresentationDate ? <p className={styles.planned}>○ Presentation planned · {dateLabel(module.plannedPresentationDate)}</p> : null}
              <dl className={styles.results}><dt>Theory</dt><dd>{module.theory}</dd><dt>Practical</dt><dd>{module.practical}</dd></dl>
              {profile.teachingOfferingIds.includes(module.offeringId) || profile.presentationOfferingIds?.includes(module.offeringId) ? <CompanionTeaching studentId={profile.id} offeringId={module.offeringId} ordinary={profile.teachingOfferingIds.includes(module.offeringId)} presentation={profile.presentationOfferingIds?.includes(module.offeringId)} /> : <p className={styles.quiet}>{data.teachingEnabled || term.status !== "active" || ["Pass", "Abandoned", "Module deferred", "Assessment deferred"].includes(module.status) ? "Read-only · inactive or ineligible enrolment, student, module or term" : "Read-only · teaching input is not enabled in this release"}</p>}
            </article>)}
          </section>)}
          {!profile.modules.length && <p className={styles.empty}>No module enrolments available.</p>}
        </section>
        <section aria-labelledby="attendance-heading"><div className={styles.sectionHeading}><h2 id="attendance-heading">Attendance history</h2></div>
          <form action="/staff" className={styles.historyFilter}>
            {Object.entries(query).filter(([key, value]) => key !== "attendanceTerm" && value !== undefined).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
            <label>Show attendance for term<select aria-label="Show attendance for term" name="attendanceTerm" defaultValue={profile.attendanceTerm}>{terms.filter(term => profile.modules.some(module => module.termId === term.id)).map(term => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label><button>Show dates</button>
          </form>
          <p className={styles.quiet}>Attendance {(() => { const summary = termAttendance(profile.modules.filter(module => module.termId === profile.attendanceTerm)); return attendanceLabel(summary.attended, summary.required, recordedAttendanceDays(profile.attendance, data.today)); })()} · reviewed totals include applicable carryover; recorded totals show this term only, not requirement completion.</p>
          {!profile.attendance.length && <p className={styles.empty}>No attendance recorded or planned in this term.</p>}
          {profile.attendance.map(session => <div key={session.id} className={`${styles.attendanceRow} ${session.status === "expected" ? styles.plannedRow : ""}`}><span><strong>{dateLabel(session.date)}</strong><small>{session.startsAt.slice(0, 5)}–{session.endsAt.slice(0, 5)}</small></span><span className={statusStyle(session.status)}>{statusLabels[session.status] ?? session.status}</span></div>)}
          <p className={styles.quiet}>Planned dates are expectations, not completed attendance. Calendar changes remain with administrators.</p>
        </section>
        <section className={styles.teaching} aria-labelledby="teaching-heading"><div className={styles.sectionHeading}><h2 id="teaching-heading">Teaching records</h2><span>All terms · own-score edits where eligible</span></div>
          {!profile.teaching.length && <p className={styles.empty}>No teaching records recorded.</p>}
          {profile.teaching.map(record => <details className={styles.record} key={record.id}><summary><span><strong>{record.kind}</strong><small>{dateLabel(record.date)} · {record.module} · {record.term}</small><small>{record.author}{record.kind === "Encounter" ? ` · Concern: ${record.details[0]?.value ?? "Not recorded"}` : ""}</small></span><ChevronRight size={16} aria-hidden="true" /></summary><div className={styles.recordBody}><p>{record.comment || "No additional comment."}</p><dl>{record.details.map((detail, index) => <div key={`${detail.label}-${index}`}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>{record.editableOfferingId ? <PresentationEditButton studentId={profile.id} offeringId={record.editableOfferingId} /> : null}</div></details>)}
        </section>
      </div>}
    </> : query.studentId ? <p className={styles.empty}>Student unavailable. <Link href={href(query, { studentId: undefined, page: 1 })}>Choose another student</Link></p> : <>
      <div className={styles.heading}><h1>Choose a student</h1><p className={styles.quiet}>{screen === "entry" ? "Select a student to add teaching records or plan dates." : "Select a student to view their profile and academic record."}</p></div>
      <form action="/staff" className={styles.filters}>
        <input type="hidden" name="screen" value={screen} /><input type="hidden" name="mode" value="term" />
        <label>Teaching term<select aria-label="Teaching term" name="term" defaultValue={query.term}>{terms.map(term => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label>
        <label>Find a student<input name="q" maxLength={100} defaultValue={query.q} placeholder="Name or student ID" /></label><button>Find students</button>
      </form>
      <p className={styles.quiet}>{data.total} {data.total === 1 ? "student" : "students"} in this term. Change the term to find earlier enrolments.</p>
      <div className={styles.studentPicker}>{students.map(student => <Link key={student.id} href={href(query, { studentId: student.id, screen })}><span><strong>{student.name}</strong><small>{student.identifier}</small></span><ChevronRight size={18} aria-hidden="true" /></Link>)}</div>
      {!students.length ? <p className={styles.empty}>No matching students. Try another name or term.</p> : null}
      <nav className={styles.pagination} aria-label="Student pages">{query.page > 1 ? <Link href={href(query, { page: query.page - 1 })}>Previous</Link> : <span />}<span>Page {query.page} of {pages}</span>{query.page < pages ? <Link href={href(query, { page: query.page + 1 })}>Next</Link> : <span />}</nav>
    </> : <>
      <div className={styles.heading}><p className={styles.eyebrow}>{selectedTerm?.name ?? "No teaching terms"}</p><h1>{query.mode === "term" ? "Term overview" : "Module overview"}</h1></div>
      <nav className={styles.tabs} aria-label="Overview type"><Link aria-current={query.mode === "module" ? "page" : undefined} href={href(query, { mode: "module", page: 1 })}>By module</Link><Link aria-current={query.mode === "term" ? "page" : undefined} href={href(query, { mode: "term", page: 1 })}>All students · dates</Link></nav>
      <form action="/staff" className={styles.filters}><input type="hidden" name="mode" value={query.mode} /><input type="hidden" name="filter" value={query.filter} />
        <label>Teaching term<select aria-label="Teaching term" name="term" defaultValue={query.term}>{terms.map(term => <option value={term.id} key={term.id}>{term.name}</option>)}</select></label>
        <label>Find a student<input name="q" maxLength={100} defaultValue={query.q} placeholder="Name or student ID" /></label>
        {query.module && <input type="hidden" name="module" value={query.module} />}<button>Apply filters</button>
      </form>
      {query.mode === "module" && <nav className={styles.modules} aria-label="Module">{modules.map(module => <Link key={module.id} aria-current={query.module === module.id ? "page" : undefined} href={href(query, { module: module.id, page: 1 })}><strong>{module.code}</strong><small>{module.title}</small></Link>)}</nav>}
      <nav className={styles.quickFilters} aria-label="Student filters">{([['all', 'All'], ['here', 'Here today'], ['risk', 'At risk']] as const).map(([key, label]) => <Link key={key} aria-current={query.filter === key ? "page" : undefined} href={href(query, { filter: key, page: 1 })}>{label}</Link>)}</nav>
      <p className={styles.quiet}>{data.total} students · Green highlight = checked in now · {dateLabel(data.today)} (London). At risk reflects current academic outcomes, not an unfilled attendance plan.</p>
      {!students.length ? <p className={styles.empty}>No students match. Try another name, term, module or filter.</p> : query.mode === "module" ? <div className={styles.register}>
        <div className={styles.tableLabels}><span>Student</span><span>Term att.</span><span>Pres.</span><span>FA</span></div>
        {students.map(student => <Link key={student.id} className={`${styles.studentRow} ${student.here ? styles.here : ""}`} href={href(query, { studentId: student.id, screen: "student" })}>
          <span><strong>{student.name}</strong><small>{student.identifier}</small>{student.here && <small className={styles.present}>● Here today</small>}{student.risk.length > 0 && <small className={styles.risk}>{student.risk.map(indicatorLabel).join(" · ")}</small>}</span>
          <span>{attendanceLabel(student.attended, student.required, student.recordedAttendance)}</span><span aria-label={student.presentationUnknown ? student.presentationRecorded ? "Presentation recorded; completion not verified" : "Presentation not recorded; completion not verified" : !student.presentationRequired ? "Presentation not required" : student.presentationComplete ? "Presentation complete" : "Presentation incomplete"}>{student.presentationUnknown ? student.presentationRecorded ? "Recorded" : "Not recorded" : !student.presentationRequired ? "N/A" : student.presentationComplete ? <Check size={20} /> : "—"}</span><span>{student.formative}</span>
        </Link>)}
      </div> : <>
        <p className={styles.quiet}>Scroll dates horizontally. Attendance statuses are per session; presentation labels deduplicate assessors. Planned presentations are labelled separately by module.</p>
        <div className={styles.matrixScroll} role="region" aria-label="Term attendance and presentation register" tabIndex={0}><table className={styles.matrix}><thead><tr><th scope="col">Student</th>{data.dates.map(date => <th scope="col" key={date}>{dateLabel(date)}</th>)}</tr></thead><tbody>{students.map(student => <tr key={student.id} className={student.here ? styles.here : ""}><th scope="row"><Link href={href(query, { studentId: student.id, screen: "student" })}><strong>{student.name}</strong>{student.here && <small className={styles.present}>● Here today</small>}<small>Attendance {attendanceLabel(student.attended, student.required, student.recordedAttendance)}</small><small>Presentations {student.presentationUnknown ? `${student.presentationComplete + student.presentationRecorded}/${student.presentationRequired} evidenced` : `${student.presentationComplete}/${student.presentationRequired}`}</small></Link></th>{data.dates.map(date => {
          const day = student.days.find(candidate => candidate.date === date);
          return <td key={date}>{day?.statuses.length ? day.statuses.map(status => <span key={status} className={statusStyle(status)}>{statusLabels[status] ?? status}</span>) : day?.expected ? <span className={styles.planned}>○ Planned</span> : <span className={styles.quiet}>—</span>}{day?.presentations.map(code => <span className={styles.presentation} key={code}>{code} · Presented</span>)}{day?.plannedPresentations?.map(code => <span className={styles.planned} key={code}>{code} · Presentation planned</span>)}</td>;
        })}</tr>)}</tbody></table></div>
      </>}
      <nav className={styles.pagination} aria-label="Student pages">{query.page > 1 ? <Link href={href(query, { page: query.page - 1 })}>Previous</Link> : <span />}<span>Page {query.page} of {pages}</span>{query.page < pages ? <Link href={href(query, { page: query.page + 1 })}>Next</Link> : <span />}</nav>
      <p className={styles.quiet}>Attendance is shared across the term. Reviewed totals and completion ticks include applicable carryover. “Recorded” shows this term’s attended/part-attended dates or module presentation evidence—not verified completion. Missing records do not mean failure. Plans and extra assessor submissions do not count as completed teaching.</p>
    </>}
    <nav className={styles.teachingNav} aria-label="Teaching navigation">
      <Link aria-current={screen === "overview" ? "page" : undefined} href={href(query, { screen: "overview" })}><Users size={21} aria-hidden="true" />Overview</Link>
      <Link aria-current={screen === "student" ? "page" : undefined} href={href(query, { screen: "student" })}><UserRound size={21} aria-hidden="true" />Student</Link>
      <Link aria-current={screen === "entry" ? "page" : undefined} href={href(query, { screen: "entry" })}><ClipboardPen size={21} aria-hidden="true" />Add record</Link>
    </nav>
  </div>;
}
