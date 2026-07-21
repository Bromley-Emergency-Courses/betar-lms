import { Download, PlugZap } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { ExamPortalMappingForm } from "@/components/exam-portal-mapping-form";
import { ExamResultsDirectoryTable } from "@/components/exam-results-directory-table";
import { Field, FormGrid } from "@/components/forms";
import { StatusPill } from "@/components/status-pill";
import {
  importExamResultsJson,
  importPracticalExamResultsCsv,
  resolveExamPortalSubmission,
  syncExamPortalMapping,
  updateExamPortalMapping
} from "@/lib/admin-actions";
import type { ExamPortalPickerExam } from "@/lib/exam-portal";
import type { AppData, ExamPortalSubmission, Student } from "@/lib/types";

function examplePayload(data: AppData): string {
  const student = data.students.find((candidate) => candidate.cccuStudentId || candidate.temporaryId);
  const offering = data.offerings[0];
  const courseModule = offering ? data.modules.find((candidate) => candidate.id === offering.moduleId) : undefined;
  const term = offering ? data.terms.find((candidate) => candidate.id === offering.termId) : undefined;
  return JSON.stringify(
    [
      {
        sourceSystem: "theory_portal",
        sourceAttemptId: "example-attempt-001",
        componentType: "theory",
        cccuStudentId: student?.cccuStudentId,
        temporaryId: student?.cccuStudentId ? undefined : student?.temporaryId,
        moduleCode: courseModule?.code ?? "POCUS-CORE",
        termName: term?.name ?? "April 2026",
        score: 72,
        passMark: 50,
        takenOn: new Date().toISOString().slice(0, 10),
        isResit: false,
        attemptNumber: 1
      }
    ],
    null,
    2
  );
}

function cccuFromSubmission(submission: ExamPortalSubmission): string | undefined {
  if (submission.cccuStudentId) {
    return submission.cccuStudentId;
  }
  return submission.studentName.match(/(?:^|\D)(\d{9})(?:\D|$)/)?.[1];
}

function nameTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/\d{7,}/g, " ")
      .split(/[^a-z]+/)
      .filter((token) => token.length > 1)
  );
}

function suggestedStudents(data: AppData, submission: ExamPortalSubmission): Student[] {
  const cccuId = cccuFromSubmission(submission);
  const exact = cccuId ? data.students.find((student) => student.cccuStudentId === cccuId) : undefined;
  const submissionTokens = nameTokens(submission.studentName);
  const scored = data.students
    .filter((student) => student.id !== exact?.id)
    .map((student) => {
      const studentTokens = nameTokens(`${student.firstName} ${student.lastName}`);
      const score = [...studentTokens].filter((token) => submissionTokens.has(token)).length;
      return { student, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.student.lastName.localeCompare(b.student.lastName))
    .slice(0, 4)
    .map((row) => row.student);

  return exact ? [exact, ...scored] : scored;
}

function sortedStudents(data: AppData): Student[] {
  return [...data.students].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
}

export function ExamTools({
  data,
  portalExams,
  portalSearch,
  practicalImportSummary
}: {
  data: AppData;
  portalExams: ExamPortalPickerExam[];
  portalSearch: string;
  practicalImportSummary?: {
    accepted: number;
    rejected: number;
  };
}) {
  return (
    <>
      <section className="grid grid-2">
        <ExamPortalMappingForm terms={data.terms} modules={data.modules} portalExams={portalExams} />

        <div className="panel grid">
          <div className="section-header">
            <div>
              <h2>Exam Portal Picker</h2>
              <p>Reviewed exams are fetched server-to-server from the production Exam Portal.</p>
            </div>
          </div>
          <form className="grid" action="/exams" method="get">
            <input type="hidden" name="mode" value="edit" />
            <Field label="Search Exam Portal" htmlFor="exam-search">
              <input id="exam-search" name="examSearch" className="input" defaultValue={portalSearch} placeholder="Search by exam title" />
            </Field>
            <button className="button">Find exams</button>
          </form>
          <p className="muted">
            The LMS stores the selected exam ID in the background. Sync imports results once Exam Portal marks the exam reviewed and available for LMS.
          </p>
        </div>
      </section>

      <section className="grid grid-2">
        <form className="panel grid" action={importPracticalExamResultsCsv}>
          <div className="section-header">
            <div>
              <h2>Practical Results CSV</h2>
              <p>Import desktop-app practical exports into the exam results register.</p>
            </div>
            {practicalImportSummary ? (
              <StatusPill
                value={practicalImportSummary.rejected > 0 ? "watch" : "paid"}
                label={`${practicalImportSummary.accepted} imported · ${practicalImportSummary.rejected} rejected`}
              />
            ) : null}
          </div>
          <FormGrid>
            <Field label="Exam sitting term" htmlFor="practical-term-id">
              <select id="practical-term-id" name="term_id" className="select" required>
                {data.terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Taken on" htmlFor="practical-taken-on">
              <input id="practical-taken-on" name="taken_on" className="input" type="date" required />
            </Field>
          </FormGrid>
          <Field label="Pass mark" htmlFor="practical-pass-mark">
            <input id="practical-pass-mark" name="pass_mark" className="input" type="number" min="0" max="100" step="0.01" defaultValue="50" required />
          </Field>
          <Field label="Module code mappings" htmlFor="practical-module-code-map">
            <textarea
              id="practical-module-code-map"
              name="module_code_map"
              className="textarea code-textarea"
              placeholder={"IN=POCUS-CORE\nVA=POCUS-VASC\nLU=POCUS-LUNG\nEC=POCUS-CARD"}
            />
          </Field>
          <Field label="CSV file" htmlFor="practical-csv-file">
            <input id="practical-csv-file" name="csv_file" className="input" type="file" accept=".csv,text/csv" required />
          </Field>
          <button className="button primary">Import practical results</button>
        </form>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2>Exam Portal Mappings</h2>
            <p>Sync reviewed results from mapped production Exam Portal exams. The mapping term is the exam sitting term.</p>
          </div>
        </div>
        {data.examPortalMappings.length === 0 ? (
          <EmptyState title="No Exam Portal mappings" detail="Add a production exam ID above before syncing." />
        ) : (
          <div className="record-grid">
            {data.examPortalMappings.map((mapping) => {
              const term = data.terms.find((candidate) => candidate.id === mapping.termId);
              const courseModule = mapping.moduleId ? data.modules.find((candidate) => candidate.id === mapping.moduleId) : undefined;
              return (
                <div className="panel grid" key={mapping.id}>
                  <form className="grid" action={updateExamPortalMapping}>
                    <input type="hidden" name="mapping_id" value={mapping.id} />
                    <div className="section-header">
                      <div>
                        <h2>{mapping.examTitle ?? mapping.portalExamId}</h2>
                        <p>
                          Sitting {term?.name ?? "term"} · {mapping.portalExamKind === "physics_equipment" ? "Physics/equipment" : courseModule?.code}
                        </p>
                      </div>
                      <StatusPill value={mapping.lastSyncStatus === "imported" ? "paid" : "watch"} label={mapping.lastSyncStatus ?? "not synced"} />
                    </div>
                    <Field label="Exam Portal exam ID" htmlFor={`portal-exam-id-${mapping.id}`}>
                      <input id={`portal-exam-id-${mapping.id}`} name="portal_exam_id" className="input" defaultValue={mapping.portalExamId} required />
                    </Field>
                    <Field label="Exam title optional" htmlFor={`portal-exam-title-${mapping.id}`}>
                      <input id={`portal-exam-title-${mapping.id}`} name="exam_title" className="input" defaultValue={mapping.examTitle ?? ""} />
                    </Field>
                    <FormGrid>
                      <Field label="Exam sitting term" htmlFor={`portal-term-${mapping.id}`}>
                        <select id={`portal-term-${mapping.id}`} name="term_id" className="select" defaultValue={mapping.termId} required>
                          {data.terms.map((termOption) => (
                            <option key={termOption.id} value={termOption.id}>
                              {termOption.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Exam kind" htmlFor={`portal-exam-kind-${mapping.id}`}>
                        <select id={`portal-exam-kind-${mapping.id}`} name="portal_exam_kind" className="select" defaultValue={mapping.portalExamKind}>
                          <option value="module_theory">Module theory</option>
                          <option value="physics_equipment">Physics/equipment</option>
                        </select>
                      </Field>
                    </FormGrid>
                    <Field label="Module for module theory" htmlFor={`portal-module-${mapping.id}`}>
                      <select id={`portal-module-${mapping.id}`} name="module_id" className="select" defaultValue={mapping.moduleId ?? ""}>
                        <option value="">None for physics/equipment</option>
                        {data.modules.map((moduleOption) => (
                          <option key={moduleOption.id} value={moduleOption.id}>
                            {moduleOption.code} · {moduleOption.title}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <label className="toolbar small">
                      <input name="physics_required" type="checkbox" defaultChecked={mapping.physicsRequired} /> Physics/equipment contributes 50%
                    </label>
                    <label className="toolbar small">
                      <input name="active" type="checkbox" defaultChecked={mapping.active} /> Active
                    </label>
                    {mapping.lastSyncedAt ? <p className="muted small">Last synced {mapping.lastSyncedAt}</p> : null}
                    {mapping.lastSyncMessage ? <p className="muted small">{mapping.lastSyncMessage}</p> : null}
                    <button className="button primary">Save mapping</button>
                  </form>
                  <form action={syncExamPortalMapping}>
                    <input type="hidden" name="mapping_id" value={mapping.id} />
                    <button className="button">Sync from Exam Portal</button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2>Exam Exceptions</h2>
            <p>Assign unmatched Exam Portal submissions to LMS student records</p>
          </div>
        </div>
        {data.examPortalSubmissions.filter((submission) => !submission.studentId).length === 0 ? (
          <EmptyState title="No unmatched exam submissions" detail="Unmatched rows from Exam Portal sync will appear here for manual resolution." />
        ) : (
          <div className="term-groups">
            {data.examPortalMappings.map((mapping) => {
              const unmatched = data.examPortalSubmissions.filter((submission) => submission.mappingId === mapping.id && !submission.studentId);
              if (unmatched.length === 0) {
                return null;
              }
              const term = data.terms.find((candidate) => candidate.id === mapping.termId);
              const courseModule = mapping.moduleId ? data.modules.find((candidate) => candidate.id === mapping.moduleId) : undefined;
              const students = sortedStudents(data);
              return (
                <details className="panel" key={mapping.id} open>
                  <summary className="term-summary">
                    <span>
                      <strong>{mapping.examTitle ?? mapping.portalExamId}</strong>
                      <span className="muted small">
                        Sitting {term?.name ?? "term"} · {mapping.portalExamKind === "physics_equipment" ? "Physics/equipment" : courseModule?.code ?? "Module"} · {unmatched.length} unmatched
                      </span>
                    </span>
                  </summary>
                  <div className="table-wrap compact-table exception-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Portal student</th>
                          <th>Score</th>
                          <th>Completed</th>
                          <th>Assign LMS student</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unmatched.map((submission) => {
                          const suggestions = suggestedStudents(data, submission);
                          const suggestedIds = new Set(suggestions.map((student) => student.id));
                          return (
                            <tr key={submission.id}>
                              <td>
                                <strong>{submission.studentName}</strong>
                                <br />
                                <span className="muted small">CCCU {cccuFromSubmission(submission) ?? "not found"}</span>
                              </td>
                              <td>
                                {submission.score}/{submission.total}
                                <br />
                                <span className="muted small">{submission.percentage}%</span>
                              </td>
                              <td>{submission.completedAt?.slice(0, 10) ?? "Not set"}</td>
                              <td>
                                <form className="exception-resolve-form" action={resolveExamPortalSubmission}>
                                  <input type="hidden" name="submission_id" value={submission.id} />
                                  <select name="student_id" className="select" required defaultValue="">
                                    <option value="">Select student</option>
                                    {suggestions.length > 0 ? (
                                      <optgroup label="Suggested">
                                        {suggestions.map((student) => (
                                          <option key={student.id} value={student.id}>
                                            {student.lastName}, {student.firstName} · {student.cccuStudentId ?? student.temporaryId}
                                          </option>
                                        ))}
                                      </optgroup>
                                    ) : null}
                                    <optgroup label="All students">
                                      {students.filter((student) => !suggestedIds.has(student.id)).map((student) => (
                                        <option key={student.id} value={student.id}>
                                          {student.lastName}, {student.firstName} · {student.cccuStudentId ?? student.temporaryId}
                                        </option>
                                      ))}
                                    </optgroup>
                                  </select>
                                  <button className="button">Assign</button>
                                </form>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <details className="panel">
        <summary className="term-summary">
          <span>
            <strong>Manual JSON Import</strong>
            <span className="muted small">Legacy adapter contract testing</span>
          </span>
          <Link className="button" href="/api/exam-adapters/contract">
            <PlugZap size={16} />
            Contract
          </Link>
        </summary>
        <form className="grid session-form" action={importExamResultsJson}>
          <Field label="Adapter JSON payload" htmlFor="exam-results-json">
            <textarea id="exam-results-json" name="exam_results_json" className="textarea code-textarea" defaultValue={examplePayload(data)} required />
          </Field>
          <button className="button primary">Import exam results</button>
        </form>
      </details>
    </>
  );
}

export function ExamSummary({ data, studentId }: { data: AppData; studentId?: string }) {
  const results = studentId ? data.examResults.filter((result) => result.studentId === studentId) : data.examResults;
  const passed = results.filter((result) => result.passed).length;
  const failed = results.filter((result) => !result.passed).length;
  const resits = results.filter((result) => result.resitRequired).length;
  return (
    <section className="grid grid-4">
      <div className="card metric">
        <div>
          <span>Total results</span>
          <strong>{results.length}</strong>
        </div>
      </div>
      <div className="card metric">
        <div>
          <span>Passed</span>
          <strong>{passed}</strong>
        </div>
      </div>
      <div className="card metric">
        <div>
          <span>Failed</span>
          <strong>{failed}</strong>
        </div>
      </div>
      <div className="card metric">
        <div>
          <span>Resits required</span>
          <strong>{resits}</strong>
        </div>
      </div>
    </section>
  );
}

export function ExamResultsTable({ data, studentId }: { data: AppData; studentId?: string }) {
  const results = studentId ? data.examResults.filter((result) => result.studentId === studentId) : data.examResults;

  if (results.length === 0) {
    return <EmptyState title="No exam results yet" detail="Theory and practical results will appear here once exam adapters or imports send data." />;
  }

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>Imported Results</h2>
          <p>Search, filter, and sort imported exam results</p>
        </div>
        <Link className="button" href="/api/exports/cccu-exam-results">
          <Download size={16} />
          CCCU CSV
        </Link>
      </div>
      <ExamResultsDirectoryTable key={studentId ?? "all"} data={data} initialStudentId={studentId} />
    </section>
  );
}
