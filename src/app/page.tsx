import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  CalendarX,
  ClipboardList,
  GraduationCap,
  UserCheck
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import { StatusPill } from "@/components/status-pill";
import { StudentLink } from "@/components/student-link";
import { requirePermission } from "@/lib/auth";
import { getLmsData } from "@/lib/lms-data";
import {
  attendedDaysInTerm,
  completionBlockersForEnrolment,
  financeDiscrepancy,
  formatCurrency,
  hasTermAttendanceGap,
  isEnrolmentComplianceRelevant,
  isStudentComplianceRelevant,
  requiredAttendanceDaysForTerm,
  studentAcademicRisk
} from "@/lib/rules";
import type { AppData, Enrolment, ModuleOffering, Student } from "@/lib/types";

function termName(data: AppData, termId: string) {
  return data.terms.find((term) => term.id === termId)?.name ?? "All terms";
}

function selectedTermId(data: AppData, requested?: string) {
  if (requested === "all") {
    return "all";
  }
  if (requested && data.terms.some((term) => term.id === requested)) {
    return requested;
  }
  return data.terms.find((term) => term.status === "active")?.id ?? data.terms[0]?.id ?? "all";
}

function offeringForEnrolment(data: AppData, enrolment: Enrolment) {
  return data.offerings.find((offering) => offering.id === enrolment.offeringId);
}

function moduleForOffering(data: AppData, offering?: ModuleOffering) {
  return offering ? data.modules.find((module) => module.id === offering.moduleId) : undefined;
}

function enrolmentsForScope(data: AppData, termId: string) {
  return data.enrolments.filter((enrolment) => {
    if (termId === "all") {
      return true;
    }
    return offeringForEnrolment(data, enrolment)?.termId === termId;
  });
}

function studentsForScope(data: AppData, termId: string) {
  if (termId === "all") {
    return data.students;
  }

  const enrolledStudentIds = new Set(enrolmentsForScope(data, termId).map((enrolment) => enrolment.studentId));
  return data.students.filter((student) => student.startTermId === termId || enrolledStudentIds.has(student.id));
}

function studentHasTermEnrolment(data: AppData, studentId: string, termId: string) {
  return enrolmentsForScope(data, termId).some((enrolment) => enrolment.studentId === studentId);
}

function financeRowsForScope(data: AppData, termId: string) {
  return data.financeRecords.filter((record) => termId === "all" || record.termId === termId);
}

function examMappingsForScope(data: AppData, termId: string) {
  return data.examPortalMappings.filter((mapping) => termId === "all" || mapping.termId === termId);
}

function attendanceRowsForScope(data: AppData, enrolments: Enrolment[]) {
  const rows = new Map<
    string,
    {
      student: Student;
      termId: string;
      moduleCodes: string[];
      attended: number;
      required: number;
    }
  >();

  for (const enrolment of enrolments) {
    const student = linkedStudent(data, enrolment.studentId);
    const offering = offeringForEnrolment(data, enrolment);
    const courseModule = moduleForOffering(data, offering);
    if (
      !student ||
      !isStudentComplianceRelevant(student) ||
      !isEnrolmentComplianceRelevant(enrolment) ||
      !offering ||
      courseModule?.mode !== "practical"
    ) {
      continue;
    }

    const key = `${student.id}:${offering.termId}`;
    const existing = rows.get(key);
    if (existing) {
      existing.moduleCodes.push(courseModule.code);
      continue;
    }

    rows.set(key, {
      student,
      termId: offering.termId,
      moduleCodes: [courseModule.code],
      attended: attendedDaysInTerm(student.id, offering.termId, data),
      required: requiredAttendanceDaysForTerm(student.id, offering.termId, data)
    });
  }

  return [...rows.values()]
    .filter((row) => row.required > 0 && hasTermAttendanceGap(row.student.id, row.termId, data))
    .sort((first, second) => {
      const nameComparison = `${first.student.lastName} ${first.student.firstName}`.localeCompare(
        `${second.student.lastName} ${second.student.firstName}`
      );
      return nameComparison || first.termId.localeCompare(second.termId);
    });
}

function linkedStudent(data: AppData, studentId?: string) {
  return studentId ? data.students.find((student) => student.id === studentId) : undefined;
}

function metricTone(count: number) {
  return count > 0 ? "#b45309" : "#178f5b";
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<{ termId?: string }>;
}) {
  await requirePermission("view_students");
  const data = await getLmsData();
  const { termId: requestedTermId } = await searchParams;
  const termId = selectedTermId(data, requestedTermId);
  const scopedStudents = studentsForScope(data, termId);
  const scopedEnrolments = enrolmentsForScope(data, termId);
  const scopedFinanceRows = financeRowsForScope(data, termId);
  const scopedMappings = examMappingsForScope(data, termId);
  const mappingIds = new Set(scopedMappings.map((mapping) => mapping.id));
  const scopedExamSubmissions = data.examPortalSubmissions.filter((submission) => mappingIds.has(submission.mappingId));

  const studentsMissingCccu = scopedStudents.filter(
    (student) => student.status === "active" && !student.cccuStudentId
  );
  const registrationPending = scopedStudents.filter((student) =>
    ["accepted", "cccu_registration_pending"].includes(student.admissionStage)
  );
  const studentsMissingEnrolment = scopedStudents.filter(
    (student) => student.status === "active" && termId !== "all" && !studentHasTermEnrolment(data, student.id, termId)
  );
  const attendanceGaps = attendanceRowsForScope(data, scopedEnrolments);
  const financeIssues = scopedFinanceRows
    .map((record) => ({ record, student: linkedStudent(data, record.studentId), balance: financeDiscrepancy(record) }))
    .filter((row) => row.student && (row.balance !== 0 || row.record.paymentStatus === "disputed"));
  const studentsWithFinanceRecords = new Set(scopedFinanceRows.map((record) => record.studentId));
  const missingFinance = scopedStudents.filter(
    (student) => student.status === "active" && !studentsWithFinanceRecords.has(student.id)
  );
  const academicRisk = scopedStudents
    .map((student) => ({ student, risk: studentAcademicRisk(student.id, data) }))
    .filter((row) => row.risk !== "none");
  const unmatchedExamSubmissions = scopedExamSubmissions.filter((submission) => !submission.studentId);
  const staleLeads = data.admissionLeads.filter(
    (lead) => !lead.archived && (lead.nextActionOn ? lead.nextActionOn < new Date().toISOString().slice(0, 10) : ["interest", "submitted", "offered"].includes(lead.stage))
  );
  const registrationRows = [
    ...studentsMissingCccu.map((student) => ({ student, issue: "Missing CCCU ID" })),
    ...studentsMissingEnrolment.map((student) => ({ student, issue: "No term enrolment" }))
  ];
  const completionRows = scopedEnrolments
    .map((enrolment) => {
      const offering = offeringForEnrolment(data, enrolment);
      return {
        enrolment,
        student: linkedStudent(data, enrolment.studentId),
        offering,
        module: moduleForOffering(data, offering),
        blockers: completionBlockersForEnrolment(enrolment, data)
      };
    })
    .filter((row) => row.student && row.offering && row.module);
  const blockedCompletionRows = completionRows.filter((row) => row.blockers.length > 0);

  const attentionItems = [
    { label: "Unmatched exam submissions", count: unmatchedExamSubmissions.length, href: "/exams?mode=edit" },
    { label: "Missing CCCU IDs", count: studentsMissingCccu.length, href: "/students" },
    { label: "Registration pending", count: registrationPending.length, href: "/students" },
    { label: "Attendance gaps", count: attendanceGaps.length, href: "/attendance" },
    { label: "Finance exceptions", count: financeIssues.length + missingFinance.length, href: "/finance" },
    { label: "Academic risk flags", count: academicRisk.length, href: "/staff" },
    { label: "Leads needing follow-up", count: staleLeads.length, href: "/admissions" },
    { label: "Completion blockers", count: blockedCompletionRows.length, href: "/course" }
  ].filter((item) => item.count > 0);

  return (
    <AppShell
      title="Operational Dashboard"
      subtitle={termId === "all" ? "All terms" : `${termName(data, termId)} operational status`}
      actions={
        <Link className="button" href="/exports">
          Exports
        </Link>
      }
    >
      <section className="panel dashboard-filters">
        <div>
          <h2>Term</h2>
          <p className="muted small">Dashboard counts and exception lists are scoped by term.</p>
        </div>
        <div className="filter-strip">
          <Link className={termId === "all" ? "button is-active" : "button"} href="/?termId=all">
            All terms
          </Link>
          {data.terms.map((term) => (
            <Link key={term.id} className={termId === term.id ? "button is-active" : "button"} href={`/?termId=${term.id}`}>
              {term.name}
            </Link>
          ))}
        </div>
      </section>

      <section className="grid grid-4">
        <Link className="metric-link" href="/students">
          <MetricCard label="Students in scope" value={scopedStudents.length} icon={<UserCheck size={20} />} />
        </Link>
        <Link className="metric-link" href="/exams?mode=edit">
          <MetricCard label="Unmatched exams" value={unmatchedExamSubmissions.length} icon={<ClipboardList size={20} />} tone={metricTone(unmatchedExamSubmissions.length)} />
        </Link>
        <Link className="metric-link" href="#attendance-compliance">
          <MetricCard label="Attendance gaps" value={attendanceGaps.length} icon={<CalendarX size={20} />} tone={metricTone(attendanceGaps.length)} />
        </Link>
        <Link className="metric-link" href="#finance-reconciliation">
          <MetricCard label="Finance exceptions" value={financeIssues.length + missingFinance.length} icon={<Banknote size={20} />} tone={metricTone(financeIssues.length + missingFinance.length)} />
        </Link>
        <details className="metric-popover-wrap">
          <summary aria-label="View academic risk students">
            <MetricCard label="Academic risk" value={academicRisk.length} icon={<AlertTriangle size={20} />} tone={metricTone(academicRisk.length)} />
          </summary>
          <div className="academic-risk-popover">
            <div className="academic-risk-popover-header">
              <strong>Academic risk</strong>
              <span className="muted small">Students flagged in this scope</span>
            </div>
            {academicRisk.length === 0 ? (
              <span className="muted small">No students currently flagged.</span>
            ) : (
              <div className="academic-risk-list">
                {academicRisk.map(({ student, risk }) => (
                  <div key={student.id} className="academic-risk-row">
                    <StudentLink student={student} />
                    <StatusPill value={risk} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
        <Link className="metric-link" href="#module-completion">
          <MetricCard label="Completion blockers" value={blockedCompletionRows.length} icon={<GraduationCap size={20} />} tone={metricTone(blockedCompletionRows.length)} />
        </Link>
      </section>

      <section className="grid grid-2 dashboard-card-grid">
        <div className="section dashboard-card">
          <div className="section-header">
            <div>
              <h2>Needs Attention</h2>
              <p>Current operational exceptions</p>
            </div>
          </div>
          {attentionItems.length === 0 ? (
            <EmptyState title="No current exceptions" detail="Operational alerts will appear here as records are created or synced." />
          ) : (
            <div className="table-wrap compact-table dashboard-table-card">
              <table>
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Count</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {attentionItems.map((item) => (
                    <tr key={item.label}>
                      <td>{item.label}</td>
                      <td>
                        <strong>{item.count}</strong>
                      </td>
                      <td>
                        <Link className="button" href={item.href}>
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="section dashboard-card">
          <div className="section-header">
            <div>
              <h2>Exam Sync</h2>
              <p>Mapped Exam Portal imports and matching status</p>
            </div>
            <Link className="button" href="/exams?mode=edit">
              Manage exams
            </Link>
          </div>
          {scopedMappings.length === 0 ? (
            <EmptyState title="No exam mappings" detail="Reviewed Exam Portal exams will appear here after they are mapped." />
          ) : (
            <div className="table-wrap compact-table dashboard-table-card">
              <table>
                <thead>
                  <tr>
                    <th>Exam</th>
                    <th>Status</th>
                    <th>Matched</th>
                    <th>Unmatched</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedMappings.map((mapping) => {
                    const submissions = scopedExamSubmissions.filter((submission) => submission.mappingId === mapping.id);
                    const unmatched = submissions.filter((submission) => !submission.studentId).length;
                    return (
                      <tr key={mapping.id}>
                        <td>
                          <strong>{mapping.examTitle ?? mapping.portalExamId}</strong>
                          <br />
                          <span className="muted small">{mapping.portalExamKind.replaceAll("_", " ")}</span>
                        </td>
                        <td>
                          <StatusPill value={unmatched > 0 ? "watch" : mapping.lastSyncStatus === "imported" ? "passed" : "not_due"} label={mapping.lastSyncStatus ?? "not synced"} />
                        </td>
                        <td>{submissions.length - unmatched}</td>
                        <td>{unmatched}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-2 dashboard-card-grid">
        <div id="attendance-compliance" className="section dashboard-card dashboard-anchor">
          <div className="section-header">
            <div>
              <h2>Attendance Compliance</h2>
              <p>Students below configured attendance requirement</p>
            </div>
            <Link className="button" href="/attendance">
              Attendance
            </Link>
          </div>
          {attendanceGaps.length === 0 ? (
            <EmptyState title="No attendance gaps" detail="Attendance exceptions will appear after sessions and enrolments are recorded." />
          ) : (
            <div className="table-wrap compact-table dashboard-table-card">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Module</th>
                    <th>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceGaps.map(({ student, termId: rowTermId, moduleCodes, attended, required }) => {
                    const term = data.terms.find((candidate) => candidate.id === rowTermId);
                    return (
                      <tr key={`${student.id}-${rowTermId}`}>
                        <td>
                          <StudentLink student={student} />
                        </td>
                        <td>
                          {moduleCodes.join(", ")}
                          {termId === "all" && term ? (
                            <>
                              <br />
                              <span className="muted small">{term.name}</span>
                            </>
                          ) : null}
                        </td>
                        <td>
                          {attended} / {required}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div id="finance-reconciliation" className="section dashboard-card dashboard-anchor">
          <div className="section-header">
            <div>
              <h2>Finance Reconciliation</h2>
              <p>Outstanding, disputed, and missing finance records</p>
            </div>
            <Link className="button" href="/finance">
              Finance
            </Link>
          </div>
          {financeIssues.length === 0 && missingFinance.length === 0 ? (
            <EmptyState title="No finance exceptions" detail="Outstanding balances and missing finance records will appear here." />
          ) : (
            <div className="table-wrap compact-table dashboard-table-card">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Status</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {financeIssues.map(({ record, student, balance }) =>
                    student ? (
                      <tr key={record.id}>
                        <td>
                          <StudentLink student={student} />
                        </td>
                        <td>
                          <StatusPill value={record.paymentStatus} />
                        </td>
                        <td>{formatCurrency(balance)}</td>
                      </tr>
                    ) : null
                  )}
                  {missingFinance.map((student) => (
                    <tr key={`missing-${student.id}`}>
                      <td>
                        <StudentLink student={student} />
                      </td>
                      <td>
                        <StatusPill value="watch" label="missing record" />
                      </td>
                      <td>Not set</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-2 dashboard-card-grid">
        <div className="section dashboard-card">
          <div className="section-header">
            <div>
              <h2>Registration Readiness</h2>
              <p>CCCU and enrolment blockers</p>
            </div>
            <Link className="button" href="/students">
              Students
            </Link>
          </div>
          {studentsMissingCccu.length === 0 && registrationPending.length === 0 && studentsMissingEnrolment.length === 0 ? (
            <EmptyState title="No registration blockers" detail="Missing CCCU IDs and enrolment gaps will appear here." />
          ) : (
            <div className="table-wrap compact-table dashboard-table-card">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Issue</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {registrationRows.map(({ student, issue }) => (
                    <tr key={`${student.id}-${issue}`}>
                      <td>
                        <StudentLink student={student} />
                      </td>
                      <td>{issue}</td>
                      <td>
                        <StatusPill value={student.admissionStage} />
                      </td>
                    </tr>
                  ))}
                  {registrationPending.map((student) => (
                    <tr key={`pending-${student.id}`}>
                      <td>
                        <StudentLink student={student} />
                      </td>
                      <td>Registration pending</td>
                      <td>
                        <StatusPill value={student.admissionStage} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div id="module-completion" className="section dashboard-card dashboard-anchor">
          <div className="section-header">
            <div>
              <h2>Module Completion</h2>
              <p>Items blocking module completion</p>
            </div>
            <Link className="button" href="/course">
              Course
            </Link>
          </div>
          {blockedCompletionRows.length === 0 ? (
            <EmptyState title="No completion blockers" detail="Missing results, attendance, and presentation blockers will appear here." />
          ) : (
            <div className="table-wrap compact-table dashboard-table-card">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Module</th>
                    <th>Blocked by</th>
                  </tr>
                </thead>
                <tbody>
                  {blockedCompletionRows.map((row) =>
                    row.student && row.module ? (
                      <tr key={row.enrolment.id}>
                        <td>
                          <StudentLink student={row.student as Student} />
                        </td>
                        <td>{row.module.code}</td>
                        <td>{row.blockers.join(", ")}</td>
                      </tr>
                    ) : null
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
