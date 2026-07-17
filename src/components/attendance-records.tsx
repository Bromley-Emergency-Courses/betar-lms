import Link from "next/link";
import { ChevronDown, Plus, Save, Search, Trash2 } from "lucide-react";
import { AttendanceDirtyForm, AttendanceDirtySubmitButton } from "@/components/attendance-unsaved-changes";
import { DeleteWarning } from "@/components/course-records";
import { Field } from "@/components/forms";
import { StatusPill } from "@/components/status-pill";
import {
  createAttendanceSession,
  deleteAdminAttendanceRecord,
  deleteAttendanceSession,
  saveAdminAttendanceRecord,
  updateAttendanceSession
} from "@/lib/admin-actions";
import { studentDisplayName } from "@/lib/rules";
import type { AppData, AttendanceRecord, AttendanceStatus, Student, Term } from "@/lib/types";

function termLabel(term?: Term): string {
  return term?.name ?? "Term";
}

function practicalOfferingsForTerm(data: AppData, termId: string) {
  return data.offerings.filter((offering) => {
    if (offering.termId !== termId) {
      return false;
    }
    const courseModule = data.modules.find((candidate) => candidate.id === offering.moduleId);
    return courseModule?.mode === "practical";
  });
}

function practicalOfferingCodesForTerm(data: AppData, termId: string): string {
  return practicalOfferingsForTerm(data, termId)
    .map((offering) => data.modules.find((candidate) => candidate.id === offering.moduleId)?.code)
    .filter(Boolean)
    .join(", ");
}

function enrolledActiveStudentsForTerm(data: AppData, termId: string): Student[] {
  const practicalOfferingIds = new Set(practicalOfferingsForTerm(data, termId).map((offering) => offering.id));
  const enrolledStudentIds = new Set(
    data.enrolments
      .filter((enrolment) => practicalOfferingIds.has(enrolment.offeringId))
      .map((enrolment) => enrolment.studentId)
  );
  return data.students.filter((student) => student.status === "active" && enrolledStudentIds.has(student.id));
}

function studentIdentifier(student: Student): string {
  return student.cccuStudentId ?? student.temporaryId;
}

function studentSearchLabel(student: Student): string {
  return `${studentDisplayName(student)} (${studentIdentifier(student)})`;
}

function recordStatus(record?: AttendanceRecord): AttendanceStatus | "" {
  if (!record || record.status === "expected") {
    return "";
  }
  return record.status;
}

function attendanceStudentsForSession(data: AppData, sessionId: string, termId: string): Student[] {
  const defaultStudents = enrolledActiveStudentsForTerm(data, termId);
  const session = data.sessions.find((candidate) => candidate.id === sessionId);
  const studentIds = new Set([
    ...defaultStudents.map((student) => student.id),
    ...(session?.expectedStudentIds ?? []),
    ...data.attendance.filter((record) => record.sessionId === sessionId).map((record) => record.studentId)
  ]);

  return [...studentIds]
    .map((studentId) => data.students.find((student) => student.id === studentId))
    .filter((student): student is Student => Boolean(student))
    .sort((a, b) => studentDisplayName(a).localeCompare(studentDisplayName(b)));
}

function attendanceStudentsForOverview(data: AppData, sessionId: string): Student[] {
  const session = data.sessions.find((candidate) => candidate.id === sessionId);
  const studentIds = new Set([
    ...(session?.expectedStudentIds ?? []),
    ...data.attendance.filter((record) => record.sessionId === sessionId).map((record) => record.studentId)
  ]);

  return [...studentIds]
    .map((studentId) => data.students.find((student) => student.id === studentId))
    .filter((student): student is Student => Boolean(student))
    .sort((a, b) => studentDisplayName(a).localeCompare(studentDisplayName(b)));
}

export function AttendanceTermTabs({
  terms,
  selectedTermId,
  editMode
}: {
  terms: Term[];
  selectedTermId?: string;
  editMode: boolean;
}) {
  if (terms.length === 0) {
    return null;
  }

  return (
    <nav className="term-tabs" aria-label="Attendance terms">
      {terms.map((term) => {
        const href = editMode ? `/attendance?mode=edit&term=${term.id}` : `/attendance?term=${term.id}`;
        return (
          <Link className={term.id === selectedTermId ? "button is-active" : "button"} href={href} key={term.id}>
            {term.name}
          </Link>
        );
      })}
    </nav>
  );
}

export function AttendanceSessionCreator({ data, selectedTermId }: { data: AppData; selectedTermId?: string }) {
  const term = data.terms.find((candidate) => candidate.id === selectedTermId);
  if (!term) {
    return <p className="muted">Create a term before adding attendance sessions.</p>;
  }

  const practicalOfferings = practicalOfferingsForTerm(data, term.id);

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>Add Teaching Session</h2>
          <p>
            {term.name} · {practicalOfferings.length} practical offerings · no students expected by default
          </p>
        </div>
      </div>
      <form className="attendance-session-row attendance-session-row-new" action={createAttendanceSession}>
        <input type="hidden" name="term_id" value={term.id} />
        <Field label="Date" htmlFor={`attendance-date-${term.id}`}>
          <input id={`attendance-date-${term.id}`} name="session_date" className="input" type="date" required />
        </Field>
        <Field label="Starts" htmlFor={`attendance-starts-${term.id}`}>
          <input id={`attendance-starts-${term.id}`} name="starts_at" className="input" type="time" defaultValue="09:00" required />
        </Field>
        <Field label="Ends" htmlFor={`attendance-ends-${term.id}`}>
          <input id={`attendance-ends-${term.id}`} name="ends_at" className="input" type="time" defaultValue="17:00" required />
        </Field>
        <Field label="Location" htmlFor={`attendance-location-${term.id}`}>
          <input id={`attendance-location-${term.id}`} name="location" className="input" placeholder="BETAR Skills Lab 1" required />
        </Field>
        <button className="button primary">
          <Plus size={16} />
          Add session
        </button>
      </form>
    </section>
  );
}

function AttendanceRecordEditor({
  sessionId,
  student,
  record,
  expected
}: {
  sessionId: string;
  student: Student;
  record?: AttendanceRecord;
  expected: boolean;
}) {
  const status = recordStatus(record);
  return (
    <div className="attendance-record-row">
      <AttendanceDirtyForm className="attendance-record-form" action={saveAdminAttendanceRecord}>
        <input type="hidden" name="session_id" value={sessionId} />
        <input type="hidden" name="student_id" value={student.id} />
        <div>
          <strong>{studentDisplayName(student)}</strong>
          <p className="muted small">{studentIdentifier(student)}</p>
        </div>
        <label className="attendance-expected-check">
          <input name="expected" type="checkbox" defaultChecked={expected || status === "missed"} />
          Expected
        </label>
        <select className="select" name="status" defaultValue={status}>
          <option value="">No record</option>
          <option value="attended">Attended</option>
          <option value="partial">Partial</option>
          <option value="missed">Missed</option>
        </select>
        <div className="muted small">
          <span>{record?.checkedInAt ? `In ${new Date(record.checkedInAt).toLocaleString()}` : "No check-in"}</span>
          <br />
          <span>{record?.checkedOutAt ? `Out ${new Date(record.checkedOutAt).toLocaleString()}` : "No check-out"}</span>
        </div>
        <input
          className="input"
          name="admin_note"
          placeholder="Optional note"
          defaultValue={record?.adminNote ?? ""}
          maxLength={500}
        />
        <AttendanceDirtySubmitButton>
          <Save size={16} />
          Save
        </AttendanceDirtySubmitButton>
      </AttendanceDirtyForm>
      <form className="attendance-delete-form" action={deleteAdminAttendanceRecord}>
        <input type="hidden" name="session_id" value={sessionId} />
        <input type="hidden" name="student_id" value={student.id} />
        <label className="muted small">
          <input name="confirm_delete" type="checkbox" /> Confirm
        </label>
        <button className="button danger">
          <Trash2 size={16} />
          Delete attendance
        </button>
      </form>
    </div>
  );
}

function AttendanceRecordManager({ data, sessionId, termId }: { data: AppData; sessionId: string; termId: string }) {
  const session = data.sessions.find((candidate) => candidate.id === sessionId);
  const expectedStudentIds = new Set(session?.expectedStudentIds ?? []);
  const records = data.attendance.filter((record) => record.sessionId === sessionId);
  const students = attendanceStudentsForSession(data, sessionId, termId);
  const addDatalistId = `attendance-add-student-${sessionId}`;

  return (
    <details className="attendance-record-manager">
      <summary>
        <span>
          <ChevronDown size={16} />
          Manage attendance records
        </span>
        <span className="muted small">
          {expectedStudentIds.size} expected · {records.length} recorded
        </span>
      </summary>
      <div className="attendance-record-tools">
        <form className="attendance-add-student-form" action={saveAdminAttendanceRecord}>
          <input type="hidden" name="session_id" value={sessionId} />
          <Field label="Add student" htmlFor={`attendance-student-lookup-${sessionId}`}>
            <div className="search-input-wrap">
              <Search size={16} />
              <input
                id={`attendance-student-lookup-${sessionId}`}
                name="student_lookup"
                className="input"
                list={addDatalistId}
                placeholder="Search by name, CCCU ID, or temporary ID"
                required
              />
            </div>
          </Field>
          <datalist id={addDatalistId}>
            {data.students.map((student) => (
              <option key={student.id} value={studentIdentifier(student)}>
                {studentSearchLabel(student)}
              </option>
            ))}
          </datalist>
          <label className="attendance-expected-check">
            <input name="expected" type="checkbox" />
            Expected
          </label>
          <select className="select" name="status" defaultValue="">
            <option value="">No record</option>
            <option value="attended">Attended</option>
            <option value="partial">Partial</option>
            <option value="missed">Missed</option>
          </select>
          <input className="input" name="admin_note" placeholder="Optional note" maxLength={500} />
          <button className="button primary">
            <Plus size={16} />
            Add / save
          </button>
        </form>
      </div>
      <div className="attendance-record-list">
        <div className="attendance-record-heading">
          <span>Student</span>
          <span>Expected</span>
          <span>Status</span>
          <span>Check-in/out</span>
          <span>Note</span>
          <span>Save</span>
        </div>
        {students.map((student) => (
          <AttendanceRecordEditor
            expected={expectedStudentIds.has(student.id)}
            key={student.id}
            record={records.find((record) => record.studentId === student.id)}
            sessionId={sessionId}
            student={student}
          />
        ))}
      </div>
    </details>
  );
}

export function AttendanceSessionRecords({ data, selectedTermId }: { data: AppData; selectedTermId?: string }) {
  const sessions = data.sessions.filter((session) => session.termId === selectedTermId);
  const term = data.terms.find((candidate) => candidate.id === selectedTermId);

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>Teaching Sessions</h2>
          <p>Inline session editing and admin-only retrospective attendance amendments</p>
        </div>
      </div>
      {!term ? (
        <p className="muted">Select a term to edit teaching sessions.</p>
      ) : sessions.length === 0 ? (
        <p className="muted">No teaching sessions have been created for {term.name}.</p>
      ) : (
        <div className="attendance-session-list">
          <div className="attendance-session-heading">
            <span>Date</span>
            <span>Starts</span>
            <span>Ends</span>
            <span>Location</span>
            <span>Expected</span>
            <span>Recorded</span>
            <span>Actions</span>
          </div>
          {sessions.map((session) => {
            const recorded = data.attendance.filter((record) => record.sessionId === session.id);
            return (
              <div className="attendance-session-item" key={session.id}>
                <AttendanceDirtyForm className="attendance-session-row" action={updateAttendanceSession}>
                  <input type="hidden" name="session_id" value={session.id} />
                  <input type="hidden" name="term_id" value={session.termId} />
                  <input name="session_date" className="input" type="date" defaultValue={session.sessionDate} required />
                  <input name="starts_at" className="input" type="time" defaultValue={session.startsAt} required />
                  <input name="ends_at" className="input" type="time" defaultValue={session.endsAt} required />
                  <input name="location" className="input" defaultValue={session.location} required />
                  <span>{session.expectedStudentIds.length}</span>
                  <span>{recorded.length}</span>
                  <AttendanceDirtySubmitButton>
                    <Save size={16} />
                    Save
                  </AttendanceDirtySubmitButton>
                </AttendanceDirtyForm>
                <AttendanceRecordManager data={data} sessionId={session.id} termId={session.termId} />
                <form className="attendance-session-delete" action={deleteAttendanceSession}>
                  <DeleteWarning name={`${session.sessionDate} ${termLabel(term)}`} idName="session_id" idValue={session.id} />
                  <button className="button danger">
                    <Trash2 size={16} />
                    Delete session
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function AttendanceOverview({ data, selectedTermId }: { data: AppData; selectedTermId?: string }) {
  const sessions = data.sessions
    .filter((session) => !selectedTermId || session.termId === selectedTermId)
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || b.startsAt.localeCompare(a.startsAt));

  return (
    <div className="attendance-overview-list">
      {sessions.map((session) => {
        const term = data.terms.find((candidate) => candidate.id === session.termId);
        const expectedStudentIds = new Set(session.expectedStudentIds);
        const recorded = data.attendance.filter((record) => record.sessionId === session.id);
        const attendedCount = recorded.filter((record) => record.status === "attended" || record.status === "partial").length;
        const missedCount = attendanceStudentsForOverview(data, session.id).filter((student) => {
          const record = recorded.find((candidate) => candidate.studentId === student.id);
          return record?.status === "missed" || (!record && expectedStudentIds.has(student.id));
        }).length;
        const students = attendanceStudentsForOverview(data, session.id);

        return (
          <details className="attendance-overview-item" key={session.id}>
            <summary className="attendance-overview-summary">
              <span>
                <strong>{session.sessionDate}</strong>
                <span className="muted small">
                  {session.startsAt}-{session.endsAt} · {termLabel(term)}
                </span>
              </span>
              <span className="attendance-overview-stat">
                <strong>{session.expectedStudentIds.length}</strong>
                <span>expected</span>
              </span>
              <span className="attendance-overview-stat">
                <strong>{attendedCount}</strong>
                <span>attended</span>
              </span>
              <span className="attendance-overview-stat">
                <strong>{missedCount}</strong>
                <span>missed</span>
              </span>
              <span className="attendance-overview-location">{session.location}</span>
            </summary>
            <div className="attendance-overview-detail">
              <div className="attendance-overview-meta">
                <span>Practical modules: {practicalOfferingCodesForTerm(data, session.termId) || "None configured"}</span>
                <span>{recorded.length} attendance record{recorded.length === 1 ? "" : "s"} saved</span>
              </div>
              {students.length === 0 ? (
                <p className="muted small">No students expected or recorded for this session.</p>
              ) : (
                <div className="attendance-overview-students">
                  {students.map((student) => {
                    const record = recorded.find((candidate) => candidate.studentId === student.id);
                    const status = record?.status ?? (expectedStudentIds.has(student.id) ? "missed" : "expected");
                    const note = [
                      expectedStudentIds.has(student.id) ? "Expected" : "Not expected",
                      record?.checkedInAt ? `In ${new Date(record.checkedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "",
                      record?.checkedOutAt ? `Out ${new Date(record.checkedOutAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "",
                      record?.adminNote ?? ""
                    ].filter(Boolean).join(" · ");

                    return (
                      <div className="attendance-overview-student" key={student.id}>
                        <div>
                          <strong>{studentDisplayName(student)}</strong>
                          <p className="muted small">{studentIdentifier(student)}</p>
                        </div>
                        <StatusPill value={status} />
                        <span className="muted small">{note}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
