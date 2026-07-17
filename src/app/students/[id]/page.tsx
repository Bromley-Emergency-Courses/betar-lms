import { notFound } from "next/navigation";
import { Eye, Pencil, Save, Upload } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { DeleteWarning } from "@/components/course-records";
import { EmptyState } from "@/components/empty-state";
import { Field, FormGrid } from "@/components/forms";
import { StatusPill } from "@/components/status-pill";
import { StudentProfilePhoto } from "@/components/student-profile-photo";
import { requirePermission } from "@/lib/auth";
import {
  createEnrolment,
  deleteEnrolment,
  deleteStudent,
  deleteStudentPhoto,
  saveStudentProfileAttendance,
  saveStudentProfileFinance,
  updateEnrolment,
  updateStudentDetails,
  updateStudentLifecycle,
  uploadStudentPhoto
} from "@/lib/admin-actions";
import { getStudentProfileData } from "@/lib/lms-data";
import {
  attendanceStatusForRecord,
  attendedDays,
  creditsAwardedForStudent,
  externalStudentIdentifier,
  financeDiscrepancy,
  formatCurrency,
  requiredAttendanceDays,
  studentAcademicRisk,
  studentDisplayName
} from "@/lib/rules";
import type { AppData, PresentationScore } from "@/lib/types";

function formativeAttemptSummary(data: AppData, definitionId: string, itemIds: string[]): string {
  const definition = data.assessmentDefinitions.find((candidate) => candidate.id === definitionId);
  if (!definition || itemIds.length === 0) {
    return "";
  }
  const labels = itemIds
    .map((itemId) => definition.domains.find((domain) => domain.id === itemId)?.label)
    .filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : "";
}

function moduleLabelForOffering(data: AppData, offeringId: string): string | undefined {
  const offering = data.offerings.find((candidate) => candidate.id === offeringId);
  const courseModule = offering ? data.modules.find((candidate) => candidate.id === offering.moduleId) : undefined;
  return offering && courseModule ? `${courseModule.code} · ${courseModule.title}` : undefined;
}

function presentationTypeLabel(type: PresentationScore["presentationType"]): string | undefined {
  if (type === "case_presentation") {
    return "Case presentation";
  }
  if (type === "journal_club") {
    return "Journal club";
  }
  return undefined;
}

function presentationMetadata(data: AppData, presentation: PresentationScore): string {
  return [
    moduleLabelForOffering(data, presentation.offeringId),
    presentationTypeLabel(presentation.presentationType),
    typeof presentation.durationMinutes === "number" ? `${presentation.durationMinutes} mins` : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}

function termSortValue(term?: { startsOn: string }) {
  return term ? new Date(term.startsOn).getTime() : 0;
}

function pounds(pence?: number): string {
  return typeof pence === "number" ? String(pence / 100) : "";
}

export default async function StudentProfilePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const profile = await requirePermission("view_students");
  const { id } = await params;
  const { mode } = await searchParams;
  const editMode = profile.role === "admin" && mode === "edit";
  const { data, student } = await getStudentProfileData(id);
  if (!student) {
    notFound();
  }

  const enrolments = data.enrolments.filter((enrolment) => enrolment.studentId === student.id);
  const financeRecords = data.financeRecords.filter((record) => record.studentId === student.id);
  const encounters = data.encounters.filter((encounter) => encounter.studentId === student.id);
  const attempts = data.assessmentAttempts.filter((attempt) => attempt.studentId === student.id);
  const presentations = data.presentationScores.filter((score) => score.studentId === student.id);
  const examResults = data.examResults.filter((result) => result.studentId === student.id);
  const enrolledTermIds = new Set<string>();
  const expectedFinanceByTerm = new Map<string, number>();
  enrolments.forEach((enrolment) => {
    const offering = data.offerings.find((candidate) => candidate.id === enrolment.offeringId);
    if (offering) {
      enrolledTermIds.add(offering.termId);
      if (enrolment.status !== "deferred") {
        expectedFinanceByTerm.set(offering.termId, (expectedFinanceByTerm.get(offering.termId) ?? 0) + offering.pricePence);
      }
    }
  });
  const attendanceRows = data.attendance
    .filter((record) => record.studentId === student.id && ["attended", "partial"].includes(record.status))
    .map((record) => ({
      record,
      session: data.sessions.find((session) => session.id === record.sessionId)
    }))
    .filter((row): row is { record: typeof row.record; session: NonNullable<typeof row.session> } => Boolean(row.session))
    .sort((a, b) => a.session.sessionDate.localeCompare(b.session.sessionDate));
  const activeTermIds = new Set(enrolledTermIds);
  attendanceRows.forEach(({ session }) => activeTermIds.add(session.termId));
  if (student.startTermId && activeTermIds.size === 0) {
    activeTermIds.add(student.startTermId);
  }
  const attendanceHistoryByTerm = data.terms
    .filter((term) => activeTermIds.has(term.id))
    .sort((a, b) => termSortValue(a) - termSortValue(b))
    .map((term) => ({
      term,
      rows: attendanceRows.filter(({ session }) => session.termId === term.id)
    }));
  const attendanceEditorByTerm = data.terms
    .filter((term) => enrolledTermIds.has(term.id))
    .sort((a, b) => termSortValue(a) - termSortValue(b))
    .map((term) => ({
      term,
      sessions: data.sessions
        .filter((session) => session.termId === term.id)
        .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate) || a.startsAt.localeCompare(b.startsAt))
    }))
    .filter(({ sessions }) => sessions.length > 0);
  const financeRecordsByTerm = new Map(financeRecords.map((record) => [record.termId, record]));
  const financeEditorRows = data.terms
    .filter((term) => enrolledTermIds.has(term.id) || financeRecordsByTerm.has(term.id))
    .sort((a, b) => termSortValue(a) - termSortValue(b))
    .map((term) => ({
      term,
      record: financeRecordsByTerm.get(term.id),
      expectedAmountPence: financeRecordsByTerm.get(term.id)?.expectedAmountPence ?? expectedFinanceByTerm.get(term.id) ?? 0
    }));
  const availableOfferings = data.offerings.filter(
    (offering) => !enrolments.some((enrolment) => enrolment.offeringId === offering.id)
  );

  return (
    <AppShell
      title={studentDisplayName(student)}
      subtitle={`${externalStudentIdentifier(student)} · ${student.email}`}
      titleMedia={
        <StudentProfilePhoto
          studentId={student.id}
          studentName={studentDisplayName(student)}
          initials={`${student.firstName.slice(0, 1)}${student.lastName.slice(0, 1)}`}
          hasPhoto={Boolean(student.photoUrl)}
        />
      }
      actions={
        profile.role === "admin" ? (
          editMode ? (
            <Link className="button" href={`/students/${student.id}`}>
              <Eye size={16} />
              View mode
            </Link>
          ) : (
            <Link className="button primary" href={`/students/${student.id}?mode=edit`}>
              <Pencil size={16} />
              Edit mode
            </Link>
          )
        ) : null
      }
    >
      <section className="grid grid-4">
        <div className="card">
          <span className="muted small">Student status</span>
          <p>
            <StatusPill value={student.status} />
          </p>
        </div>
        <div className="card">
          <span className="muted small">Admission stage</span>
          <p>
            <StatusPill value={student.admissionStage} />
          </p>
        </div>
        <div className="card">
          <span className="muted small">Credits</span>
          <p>
            <strong>{creditsAwardedForStudent(student.id, data.enrolments)} / 60</strong>
          </p>
        </div>
        <div className="card">
          <span className="muted small">Academic risk</span>
          <p>
            <StatusPill value={studentAcademicRisk(student.id, data)} />
          </p>
        </div>
      </section>

      {editMode ? (
      <section className="grid grid-2">
        <form className="panel grid" action={updateStudentDetails}>
          <input type="hidden" name="student_id" value={student.id} />
          <div className="section-header">
            <div>
              <h2>Edit Student Details</h2>
              <p>Identity, contact details, programme, and notes</p>
            </div>
          </div>
          <FormGrid>
            <Field label="First name" htmlFor="profile-first-name">
              <input id="profile-first-name" name="first_name" className="input" defaultValue={student.firstName} required />
            </Field>
            <Field label="Last name" htmlFor="profile-last-name">
              <input id="profile-last-name" name="last_name" className="input" defaultValue={student.lastName} required />
            </Field>
            <Field label="Email" htmlFor="profile-email">
              <input id="profile-email" name="email" className="input" type="email" defaultValue={student.email} required />
            </Field>
            <Field label="Phone" htmlFor="profile-phone">
              <input id="profile-phone" name="phone" className="input" defaultValue={student.phone ?? ""} />
            </Field>
            <Field label="Temporary ID" htmlFor="profile-temporary-id">
              <input id="profile-temporary-id" name="temporary_id" className="input" defaultValue={student.temporaryId} required />
            </Field>
            <Field label="CCCU student ID" htmlFor="profile-cccu-id">
              <input id="profile-cccu-id" name="cccu_student_id" className="input" defaultValue={student.cccuStudentId ?? ""} />
            </Field>
            <Field label="Programme" htmlFor="profile-programme">
              <select id="profile-programme" name="programme" className="select" defaultValue={student.programme}>
                <option value="pgcert">PGCert</option>
                <option value="microcredential">Microcredential</option>
              </select>
            </Field>
            <Field label="Start term" htmlFor="profile-start-term">
              <select id="profile-start-term" name="start_term_id" className="select" defaultValue={student.startTermId ?? ""}>
                <option value="">Not set</option>
                {data.terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Student status" htmlFor="profile-details-status">
              <select id="profile-details-status" name="status" className="select" defaultValue={student.status}>
                <option value="prospect">Prospect</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="deferred">Deferred</option>
                <option value="interrupted">Interrupted</option>
              </select>
            </Field>
            <Field label="Admission stage" htmlFor="profile-details-admission">
              <select id="profile-details-admission" name="admission_stage" className="select" defaultValue={student.admissionStage}>
                <option value="interest">Interest</option>
                <option value="application_invited">Application invited</option>
                <option value="submitted">Submitted</option>
                <option value="reviewed">Reviewed</option>
                <option value="offered">Offered</option>
                <option value="rejected">Rejected</option>
                <option value="accepted">Accepted</option>
                <option value="cccu_registration_pending">CCCU registration pending</option>
                <option value="cccu_registration_complete">CCCU registration complete</option>
              </select>
            </Field>
          </FormGrid>
          <Field label="Notes" htmlFor="profile-notes">
            <textarea id="profile-notes" name="notes" className="textarea" defaultValue={student.notes ?? ""} />
          </Field>
          <button className="button primary">Save student details</button>
        </form>

        <form className="panel grid" action={updateStudentLifecycle}>
          <input type="hidden" name="student_id" value={student.id} />
          <div className="section-header">
            <div>
              <h2>Update Lifecycle</h2>
              <p>Status and admissions pipeline stage</p>
            </div>
          </div>
          <FormGrid>
            <Field label="Student status" htmlFor="profile-status">
              <select id="profile-status" name="status" className="select" defaultValue={student.status}>
                <option value="prospect">Prospect</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="deferred">Deferred</option>
                <option value="interrupted">Interrupted</option>
              </select>
            </Field>
            <Field label="Admission stage" htmlFor="profile-admission">
              <select id="profile-admission" name="admission_stage" className="select" defaultValue={student.admissionStage}>
                <option value="interest">Interest</option>
                <option value="application_invited">Application invited</option>
                <option value="submitted">Submitted</option>
                <option value="reviewed">Reviewed</option>
                <option value="offered">Offered</option>
                <option value="rejected">Rejected</option>
                <option value="accepted">Accepted</option>
                <option value="cccu_registration_pending">CCCU registration pending</option>
                <option value="cccu_registration_complete">CCCU registration complete</option>
              </select>
            </Field>
          </FormGrid>
          <button className="button primary">Update lifecycle</button>
        </form>

        <form className="panel grid" action={createEnrolment}>
          <input type="hidden" name="student_id" value={student.id} />
          <div className="section-header">
            <div>
              <h2>Add Enrolment</h2>
              <p>Attach this student to a term offering</p>
            </div>
          </div>
          <Field label="Offering" htmlFor="enrolment-offering">
            <select id="enrolment-offering" name="offering_id" className="select" disabled={availableOfferings.length === 0} required>
              <option value="">Select offering</option>
              {availableOfferings.map((offering) => {
                const courseModule = data.modules.find((candidate) => candidate.id === offering.moduleId);
                const term = data.terms.find((candidate) => candidate.id === offering.termId);
                return courseModule && term ? (
                  <option key={offering.id} value={offering.id}>
                    {term.name} · {courseModule.code}
                  </option>
                ) : null;
              })}
            </select>
          </Field>
          <FormGrid>
            <Field label="Status" htmlFor="enrolment-status">
                              <select id="enrolment-status" name="status" className="select" defaultValue="planned">
                                <option value="planned">Planned</option>
                                <option value="in_progress">In progress</option>
                                <option value="completed">Completed</option>
                                <option value="failed">Failed</option>
                                <option value="deferred">Deferred</option>
                                <option value="resit">Resit</option>
                                <option value="did_not_complete">Did not complete</option>
                              </select>
                            </Field>
                            <Field label="Credits awarded" htmlFor="credits-awarded">
                              <input id="credits-awarded" name="credits_awarded" className="input" type="number" min="0" defaultValue="0" />
                            </Field>
                            <Field label="Attendance override" htmlFor="attendance-days-required-override">
                              <input
                                id="attendance-days-required-override"
                                name="attendance_days_required_override"
                                className="input"
                                type="number"
                                min="0"
                                step="1"
                                placeholder="Default"
                              />
                            </Field>
                            <Field label="Presentation override" htmlFor="presentation-required-override">
                              <select id="presentation-required-override" name="presentation_required_override" className="select" defaultValue="">
                                <option value="">Default</option>
                                <option value="true">Required</option>
                                <option value="false">Not required</option>
                              </select>
                            </Field>
                          </FormGrid>
                          <button className="button primary" disabled={availableOfferings.length === 0}>
                            Add enrolment
          </button>
        </form>

        <form className="panel" action={deleteStudent}>
          <div className="section-header">
            <div>
              <h2>Delete Student</h2>
              <p>Removes this student and dependent student records</p>
            </div>
          </div>
          <DeleteWarning name={studentDisplayName(student)} idName="student_id" idValue={student.id} />
          <button className="button danger">Delete student</button>
        </form>

        <div className="panel grid">
          <div className="section-header">
            <div>
              <h2>Profile Photo</h2>
              <p>{student.photoUrl ? "Replace or remove the current student photo" : "Upload a private student photo"}</p>
            </div>
          </div>
          <form className="grid" action={uploadStudentPhoto}>
            <input type="hidden" name="student_id" value={student.id} />
            <Field label="Photo" htmlFor="student-photo">
              <input id="student-photo" name="photo" className="input" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" required />
            </Field>
            <button className="button primary">
              <Upload size={16} />
              {student.photoUrl ? "Replace photo" : "Upload photo"}
            </button>
          </form>
          {student.photoUrl ? (
            <form action={deleteStudentPhoto}>
              <DeleteWarning name="student profile photo" idName="student_id" idValue={student.id} />
              <button className="button danger">Remove photo</button>
            </form>
          ) : null}
        </div>
      </section>
      ) : null}

      <section className="section">
        <div className="section-header">
          <div>
            <h2>Enrolments</h2>
            <p>Term module offering and enrolment status</p>
          </div>
        </div>
          {enrolments.length === 0 ? (
            <EmptyState title="No enrolments recorded" detail="This student does not yet have module enrolments in Supabase." />
          ) : !editMode ? (
          <div className="panel profile-enrolment-list">
              {enrolments.map((enrolment) => {
                const offering = data.offerings.find((candidate) => candidate.id === enrolment.offeringId);
                const courseModule = offering ? data.modules.find((candidate) => candidate.id === offering.moduleId) : undefined;
                const term = offering ? data.terms.find((candidate) => candidate.id === offering.termId) : undefined;
                return offering && courseModule && term ? (
                  <div className="profile-enrolment-row" key={enrolment.id}>
                    <div>
                      <strong>{term.name} · {courseModule.code}</strong>
                      <span className="muted small">{courseModule.title}</span>
                    </div>
                    <StatusPill value={enrolment.status} />
                  </div>
                ) : null;
              })}
          </div>
          ) : (
          <div className="record-grid">
              {enrolments.map((enrolment) => {
                const offering = data.offerings.find((candidate) => candidate.id === enrolment.offeringId);
                const courseModule = offering ? data.modules.find((candidate) => candidate.id === offering.moduleId) : undefined;
                const term = offering ? data.terms.find((candidate) => candidate.id === offering.termId) : undefined;
                return offering && courseModule && term ? (
	                  <div className="panel grid" key={enrolment.id}>
	                    <div>
	                      <strong>{term.name} · {courseModule.code}</strong>
	                      <p className="muted small">
                        {courseModule.title}
                        {courseModule.mode === "practical"
                          ? ` · Practical attendance ${attendedDays(student.id, offering.id, data)} / ${requiredAttendanceDays(student.id, offering, data)}`
                          : " · Online module"}
                      </p>
	                    </div>
                    {editMode ? (
                      <>
                        <form className="grid" action={updateEnrolment}>
                          <input type="hidden" name="enrolment_id" value={enrolment.id} />
                          <input type="hidden" name="student_id" value={student.id} />
                          <FormGrid>
                            <Field label="Status" htmlFor={`enrolment-status-${enrolment.id}`}>
                              <select id={`enrolment-status-${enrolment.id}`} name="status" className="select" defaultValue={enrolment.status}>
                                <option value="planned">Planned</option>
                                <option value="in_progress">In progress</option>
                                <option value="completed">Completed</option>
                                <option value="failed">Failed</option>
                                <option value="deferred">Deferred</option>
                                <option value="resit">Resit</option>
                                <option value="did_not_complete">Did not complete</option>
                              </select>
                            </Field>
                            <Field label="Credits" htmlFor={`enrolment-credits-${enrolment.id}`}>
                              <input id={`enrolment-credits-${enrolment.id}`} name="credits_awarded" className="input" type="number" min="0" defaultValue={enrolment.creditsAwarded} />
                            </Field>
                            <Field label="Final mark" htmlFor={`enrolment-mark-${enrolment.id}`}>
                              <input id={`enrolment-mark-${enrolment.id}`} name="final_mark" className="input" type="number" min="0" max="100" step="0.01" defaultValue={enrolment.finalMark ?? ""} />
                            </Field>
                            <Field label="Grade" htmlFor={`enrolment-grade-${enrolment.id}`}>
                              <input id={`enrolment-grade-${enrolment.id}`} name="grade" className="input" defaultValue={enrolment.grade ?? ""} />
                            </Field>
                            <Field label="Attendance override" htmlFor={`enrolment-attendance-override-${enrolment.id}`}>
                              <input
                                id={`enrolment-attendance-override-${enrolment.id}`}
                                name="attendance_days_required_override"
                                className="input"
                                type="number"
                                min="0"
                                step="1"
                                placeholder="Default"
                                defaultValue={enrolment.attendanceDaysRequiredOverride ?? ""}
                              />
                            </Field>
                            <Field label="Presentation override" htmlFor={`enrolment-presentation-override-${enrolment.id}`}>
                              <select
                                id={`enrolment-presentation-override-${enrolment.id}`}
                                name="presentation_required_override"
                                className="select"
                                defaultValue={
                                  typeof enrolment.presentationRequiredOverride === "boolean"
                                    ? String(enrolment.presentationRequiredOverride)
                                    : ""
                                }
                              >
                                <option value="">Default</option>
                                <option value="true">Required</option>
                                <option value="false">Not required</option>
                              </select>
                            </Field>
                          </FormGrid>
                          <button className="button primary">Save enrolment</button>
                        </form>
                        <form action={deleteEnrolment}>
                          <DeleteWarning name={`${term.name} ${courseModule.code}`} idName="enrolment_id" idValue={enrolment.id} />
                          <input type="hidden" name="student_id" value={student.id} />
                          <button className="button danger">Delete enrolment</button>
                        </form>
                      </>
                    ) : (
                      <div className="toolbar">
                        <StatusPill value={enrolment.status} />
                        <span className="muted small">Mark {enrolment.finalMark ?? "Pending"} · Credits {enrolment.creditsAwarded}</span>
                      </div>
                    )}
                  </div>
                ) : null;
              })}
          </div>
          )}
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2>Attendance History</h2>
            <p>Recorded attended dates by active term</p>
          </div>
        </div>
        {editMode ? (
          attendanceEditorByTerm.length === 0 ? (
            <EmptyState title="No teaching sessions available" detail="Create teaching sessions for this student's enrolled terms before editing attendance here." />
          ) : (
            <form className="panel profile-attendance-editor" action={saveStudentProfileAttendance}>
              <input type="hidden" name="student_id" value={student.id} />
              {attendanceEditorByTerm.map(({ term, sessions }) => (
                <details className="profile-term-toggle" key={term.id} open>
                  <summary>
                    <span>
                      <strong>{term.name}</strong>
                      <span className="muted small">
                        {sessions.length} teaching {sessions.length === 1 ? "date" : "dates"}
                      </span>
                    </span>
                  </summary>
                  <div className="profile-edit-list">
                    {sessions.map((session) => {
                      const record = data.attendance.find((candidate) => candidate.sessionId === session.id && candidate.studentId === student.id);
                      const expected = session.expectedStudentIds.includes(student.id);
                      const status = record?.status ?? (expected ? "expected" : "");

                      return (
                        <div
                          className={
                            status === "attended"
                              ? "profile-attendance-edit-row is-attended"
                              : "profile-attendance-edit-row"
                          }
                          key={session.id}
                        >
                          <input type="hidden" name="attendance_session_id" value={session.id} />
                          <div>
                            <strong>{session.sessionDate}</strong>
                            <span className="muted small">
                              {session.startsAt}-{session.endsAt} · {session.location}
                            </span>
                          </div>
                          <select className="select" name="attendance_status" defaultValue={status}>
                            <option value="">No record</option>
                            <option value="expected">Expected</option>
                            <option value="attended">Attended</option>
                            <option value="partial">Partial</option>
                            <option value="missed">Missed</option>
                          </select>
                          <label className="profile-delete-check muted small">
                            <input name="attendance_delete_session_id" type="checkbox" value={session.id} />
                            Remove
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ))}
              <button className="button primary">
                <Save size={16} />
                Save attendance
              </button>
            </form>
          )
        ) : attendanceHistoryByTerm.length === 0 ? (
          <EmptyState title="No attended dates yet" detail="Recorded attendance dates will appear here once this student has an attendance record." />
        ) : (
          <div className="panel profile-toggle-list">
            {attendanceHistoryByTerm.map(({ term, rows }) => {
              return (
                <details className="profile-term-toggle" key={term.id}>
                  <summary>
                    <span>
                      <strong>{term.name}</strong>
                      <span className="muted small">
                        {rows.length} attended {rows.length === 1 ? "date" : "dates"}
                      </span>
                    </span>
                  </summary>
                  {rows.length === 0 ? (
                    <p className="muted small">No attended dates recorded for this term.</p>
                  ) : (
                    <div className="profile-attendance-dates">
                      {rows.map(({ record, session }) => (
                        <div className="profile-attendance-date" key={session.id}>
                          <span>{session.sessionDate}</span>
                          <span className="muted small">
                            {session.startsAt}-{session.endsAt} · {session.location}
                          </span>
                          <StatusPill value={record.status} label={attendanceStatusForRecord(record)} />
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid grid-2 profile-card-grid">
        <div className="section profile-fixed-card">
          <div className="section-header">
            <div>
              <h2>Teaching Notes</h2>
              <p>Encounter logs and assessment comments</p>
            </div>
          </div>
          {encounters.length === 0 && attempts.length === 0 && presentations.length === 0 ? (
            <EmptyState title="No teaching notes yet" detail="Encounter logs, formative assessments, and presentation scores will appear here." />
          ) : (
            <div className="panel timeline profile-scroll-panel profile-compact-timeline">
              {encounters.map((encounter) => (
              <div className="timeline-item" key={encounter.id}>
                <span className="muted small">{encounter.occurredOn}</span>
                <div>
                  <StatusPill value={encounter.concernLevel} />
                  <p>{encounter.summary}</p>
                </div>
              </div>
              ))}
              {attempts.map((attempt) => (
              <div className="timeline-item" key={attempt.id}>
                <span className="muted small">{attempt.occurredOn}</span>
                <div>
                  <strong>
                    Formative assessment
                    {typeof attempt.overallScore === "number" ? `: ${attempt.overallScore}` : ""}
                  </strong>
                  {formativeAttemptSummary(data, attempt.definitionId, attempt.assessedItemIds) ? (
                    <p className="muted small">{formativeAttemptSummary(data, attempt.definitionId, attempt.assessedItemIds)}</p>
                  ) : null}
                  <p>{attempt.comments ?? "No comments recorded"}</p>
                </div>
              </div>
              ))}
              {presentations.map((presentation) => {
                const metadata = presentationMetadata(data, presentation);
                return (
              <div className="timeline-item" key={presentation.id}>
                <span className="muted small">{presentation.occurredOn}</span>
                <div>
                  <strong>Presentation score: {presentation.totalScore}</strong>
                  {metadata ? <p className="muted small">{metadata}</p> : null}
                  <p>{presentation.comments ?? "No comments recorded"}</p>
                </div>
              </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="section profile-fixed-card">
          <div className="section-header">
            <div>
              <h2>{editMode ? "Finance" : "Finance And Exams"}</h2>
              <p>{editMode ? "CCCU invoice and payment reconciliation" : "CCCU reconciliation and imported result components"}</p>
            </div>
          </div>
          {editMode ? (
            financeEditorRows.length === 0 ? (
              <EmptyState title="No finance terms available" detail="Add an enrolment before creating finance records for this student." />
            ) : (
              <form className="panel profile-scroll-panel profile-finance-editor" action={saveStudentProfileFinance}>
                <input type="hidden" name="student_id" value={student.id} />
                {financeEditorRows.map(({ term, record, expectedAmountPence }) => {
                  const rowKey = record?.id ?? `new-${term.id}`;

                  return (
                    <details className="profile-finance-edit-row" key={rowKey} open={Boolean(record)}>
                      <summary>
                        <span>
                          <strong>{term.name}</strong>
                          <span className="muted small">
                            {record ? `${record.paymentStatus.replaceAll("_", " ")} · ${formatCurrency(financeDiscrepancy(record))} balance` : "No finance record"}
                          </span>
                        </span>
                      </summary>
                      <input type="hidden" name="finance_row_key" value={rowKey} />
                      <input type="hidden" name={`finance_record_id_${rowKey}`} value={record?.id ?? ""} />
                      <input type="hidden" name={`finance_term_id_${rowKey}`} value={term.id} />
                      <div className="profile-finance-fields">
                        {!record ? (
                          <label className="profile-create-check muted small">
                            <input name="finance_create_key" type="checkbox" value={rowKey} />
                            Create
                          </label>
                        ) : null}
                        <label className="field">
                          <span>Expected GBP</span>
                          <input
                            className="input"
                            name={`finance_expected_amount_${rowKey}`}
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={pounds(expectedAmountPence)}
                            required={Boolean(record)}
                          />
                        </label>
                        <label className="field">
                          <span>Invoice status</span>
                          <select
                            className="select"
                            name={`finance_invoice_status_${rowKey}`}
                            defaultValue={record?.invoiceStatus ?? "not_requested"}
                          >
                            <option value="not_requested">Not requested</option>
                            <option value="requested">Requested</option>
                            <option value="sent">Sent</option>
                            <option value="corrected">Corrected</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Invoice GBP</span>
                          <input
                            className="input"
                            name={`finance_invoice_amount_${rowKey}`}
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={pounds(record?.invoiceAmountPence)}
                          />
                        </label>
                        <label className="field">
                          <span>Payment status</span>
                          <select className="select" name={`finance_payment_status_${rowKey}`} defaultValue={record?.paymentStatus ?? "not_due"}>
                            <option value="not_due">Not due</option>
                            <option value="outstanding">Outstanding</option>
                            <option value="paid">Paid</option>
                            <option value="disputed">Disputed</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Paid GBP</span>
                          <input
                            className="input"
                            name={`finance_paid_amount_${rowKey}`}
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={pounds(record?.paidAmountPence)}
                          />
                        </label>
                        <label className="field profile-finance-notes">
                          <span>Notes</span>
                          <textarea className="textarea" name={`finance_notes_${rowKey}`} defaultValue={record?.notes ?? ""} rows={2} />
                        </label>
                      </div>
                    </details>
                  );
                })}
                <button className="button primary">
                  <Save size={16} />
                  Save finance
                </button>
              </form>
            )
          ) : financeRecords.length === 0 && examResults.length === 0 ? (
            <EmptyState title="No finance or exam records yet" detail="CCCU finance reconciliation and imported exam results will appear here." />
          ) : (
            <div className="panel timeline profile-scroll-panel profile-compact-timeline">
              {financeRecords.map((record) => {
                const term = data.terms.find((candidate) => candidate.id === record.termId);
                return (
                  <Link className="timeline-item linked-row" href={`/finance?mode=edit&student=${student.id}`} key={record.id}>
                    <span className="muted small">Finance</span>
                    <div>
                      <StatusPill value={record.paymentStatus} />
                      <p>
                        {term?.name ?? "Term"} · Expected {formatCurrency(record.expectedAmountPence)} · Balance due{" "}
                        {formatCurrency(financeDiscrepancy(record))}
                      </p>
                      <span className="muted small">Open finance reconciliation</span>
                    </div>
                  </Link>
                );
              })}
              {examResults.map((result) => {
                const offering = data.offerings.find((candidate) => candidate.id === result.offeringId);
                const courseModule = offering ? data.modules.find((candidate) => candidate.id === offering.moduleId) : undefined;
                return (
                  <Link className="timeline-item linked-row" href={`/exams?student=${student.id}`} key={result.id}>
                    <span className="muted small">{result.takenOn}</span>
                    <div>
                      <StatusPill value={result.passed ? "passed" : "failed"} />
                      <p>
                        {courseModule?.code ? `${courseModule.code} · ` : ""}
                        {result.componentType} score {result.score}% from {result.sourceSystem}
                      </p>
                      <span className="muted small">Open exam results</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
