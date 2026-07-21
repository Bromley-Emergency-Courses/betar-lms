"use client";

import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { StatusPill } from "@/components/status-pill";
import { StudentLink } from "@/components/student-link";
import { externalStudentIdentifier, studentDisplayName } from "@/lib/rules";
import type { AppData, CourseModule, ExamComponentType, ExamResult, Student, Term } from "@/lib/types";

type SortKey = "student" | "term" | "module" | "component" | "score" | "outcome" | "source" | "taken";
type SortDirection = "asc" | "desc";
type OutcomeFilter = "all" | "passed" | "failed" | "resit";

interface ExamResultRow {
  result: ExamResult;
  student: Student;
  term: Term;
  module: CourseModule;
  priorResult?: ExamResult;
  studentSearch: string;
  outcome: "passed" | "failed";
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function SortButton({
  label,
  sortKey,
  activeSort,
  direction,
  onSort
}: {
  label: string;
  sortKey: SortKey;
  activeSort: SortKey;
  direction: SortDirection;
  onSort: (sortKey: SortKey) => void;
}) {
  const active = activeSort === sortKey;
  const Icon = direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <button className="table-sort-button" type="button" onClick={() => onSort(sortKey)}>
      {label}
      {active ? <Icon size={14} /> : null}
    </button>
  );
}

export function ExamResultsDirectoryTable({
  data,
  initialStudentId = "all"
}: {
  data: AppData;
  initialStudentId?: string;
}) {
  const [studentQuery, setStudentQuery] = useState("");
  const [studentFilter, setStudentFilter] = useState(initialStudentId);
  const [termFilter, setTermFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [componentFilter, setComponentFilter] = useState<"all" | ExamComponentType>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [takenFrom, setTakenFrom] = useState("");
  const [takenTo, setTakenTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("taken");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const rows = useMemo<ExamResultRow[]>(() => {
    return data.examResults.flatMap((result) => {
      const student = data.students.find((candidate) => candidate.id === result.studentId);
      const offering = data.offerings.find((candidate) => candidate.id === result.offeringId);
      const courseModule = offering ? data.modules.find((candidate) => candidate.id === offering.moduleId) : undefined;
      const term = offering ? data.terms.find((candidate) => candidate.id === offering.termId) : undefined;
      if (!student || !courseModule || !term) {
        return [];
      }

      return [
        {
          result,
          student,
          term,
          module: courseModule,
          priorResult: result.resitOfResultId ? data.examResults.find((candidate) => candidate.id === result.resitOfResultId) : undefined,
          studentSearch: `${studentDisplayName(student)} ${externalStudentIdentifier(student)} ${student.email}`.toLowerCase(),
          outcome: result.passed ? "passed" : "failed"
        }
      ];
    });
  }, [data.examResults, data.modules, data.offerings, data.students, data.terms]);

  const sortedStudents = useMemo(
    () => [...data.students].sort((a, b) => studentDisplayName(a).localeCompare(studentDisplayName(b))),
    [data.students]
  );

  const sortedModules = useMemo(
    () => [...data.modules].sort((a, b) => a.code.localeCompare(b.code) || a.title.localeCompare(b.title)),
    [data.modules]
  );

  const filteredRows = useMemo(() => {
    const normalizedStudentQuery = studentQuery.trim().toLowerCase();

    return rows
      .filter((row) => {
        if (normalizedStudentQuery && !row.studentSearch.includes(normalizedStudentQuery)) {
          return false;
        }
        if (studentFilter !== "all" && row.student.id !== studentFilter) {
          return false;
        }
        if (termFilter !== "all" && row.term.id !== termFilter) {
          return false;
        }
        if (moduleFilter !== "all" && row.module.id !== moduleFilter) {
          return false;
        }
        if (componentFilter !== "all" && row.result.componentType !== componentFilter) {
          return false;
        }
        if (outcomeFilter === "passed" && !row.result.passed) {
          return false;
        }
        if (outcomeFilter === "failed" && row.result.passed) {
          return false;
        }
        if (outcomeFilter === "resit" && !row.result.resitRequired && !row.result.isResit) {
          return false;
        }
        if (takenFrom && row.result.takenOn < takenFrom) {
          return false;
        }
        if (takenTo && row.result.takenOn > takenTo) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        let result = 0;
        if (sortKey === "student") {
          result = compareText(studentDisplayName(a.student), studentDisplayName(b.student));
        } else if (sortKey === "term") {
          result = compareText(a.term.name, b.term.name) || compareText(studentDisplayName(a.student), studentDisplayName(b.student));
        } else if (sortKey === "module") {
          result = compareText(a.module.code, b.module.code) || compareText(studentDisplayName(a.student), studentDisplayName(b.student));
        } else if (sortKey === "component") {
          result = compareText(a.result.componentType, b.result.componentType) || compareText(studentDisplayName(a.student), studentDisplayName(b.student));
        } else if (sortKey === "score") {
          result = a.result.score - b.result.score || compareText(studentDisplayName(a.student), studentDisplayName(b.student));
        } else if (sortKey === "outcome") {
          result = compareText(a.outcome, b.outcome) || Number(a.result.resitRequired) - Number(b.result.resitRequired);
        } else if (sortKey === "source") {
          result = compareText(a.result.sourceSystem, b.result.sourceSystem) || compareText(a.result.sourceAttemptId, b.result.sourceAttemptId);
        } else if (sortKey === "taken") {
          result = compareText(a.result.takenOn, b.result.takenOn) || compareText(studentDisplayName(a.student), studentDisplayName(b.student));
        }
        return sortDirection === "asc" ? result : -result;
      });
  }, [
    componentFilter,
    moduleFilter,
    outcomeFilter,
    rows,
    sortDirection,
    sortKey,
    studentFilter,
    studentQuery,
    takenFrom,
    takenTo,
    termFilter
  ]);

  function handleSort(nextSortKey: SortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "taken" || nextSortKey === "score" ? "desc" : "asc");
  }

  function clearFilters() {
    setStudentQuery("");
    setStudentFilter("all");
    setTermFilter("all");
    setModuleFilter("all");
    setComponentFilter("all");
    setOutcomeFilter("all");
    setTakenFrom("");
    setTakenTo("");
    setSortKey("taken");
    setSortDirection("desc");
  }

  return (
    <div className="exam-results-directory">
      <div className="exam-filter-panel">
        <div className="finance-filter-title">
          <Search size={18} />
          <strong>Filters</strong>
          <span className="muted small">
            Showing {filteredRows.length} of {rows.length}
          </span>
          <button className="button" type="button" onClick={clearFilters}>
            <X size={16} />
            Clear
          </button>
        </div>
        <div className="exam-filters">
          <label className="field">
            <span>Student</span>
            <input
              className="input"
              value={studentQuery}
              onChange={(event) => setStudentQuery(event.target.value)}
              placeholder="Name, ID, or email"
            />
          </label>
          <label className="field">
            <span>Student list</span>
            <select className="select" value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)}>
              <option value="all">All students</option>
              {sortedStudents.map((student) => (
                <option key={student.id} value={student.id}>
                  {studentDisplayName(student)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Term</span>
            <select className="select" value={termFilter} onChange={(event) => setTermFilter(event.target.value)}>
              <option value="all">All terms</option>
              {data.terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Module</span>
            <select className="select" value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}>
              <option value="all">All modules</option>
              {sortedModules.map((courseModule) => (
                <option key={courseModule.id} value={courseModule.id}>
                  {courseModule.code} - {courseModule.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Component</span>
            <select className="select" value={componentFilter} onChange={(event) => setComponentFilter(event.target.value as "all" | ExamComponentType)}>
              <option value="all">All components</option>
              <option value="theory">Theory</option>
              <option value="practical">Practical</option>
            </select>
          </label>
          <label className="field">
            <span>Outcome</span>
            <select className="select" value={outcomeFilter} onChange={(event) => setOutcomeFilter(event.target.value as OutcomeFilter)}>
              <option value="all">All outcomes</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="resit">Resit required/attempts</option>
            </select>
          </label>
          <div className="field">
            <span>Taken</span>
            <div className="split-filter">
              <input className="input" type="date" value={takenFrom} onChange={(event) => setTakenFrom(event.target.value)} />
              <input className="input" type="date" value={takenTo} onChange={(event) => setTakenTo(event.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState title="No matching exam results" detail="Adjust the filters or clear them to show more imported results." />
      ) : (
        <div className="table-wrap exam-results-table-wrap">
          <table className="exam-results-table">
            <thead>
              <tr>
                <th>
                  <SortButton label="Student" sortKey="student" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th>
                  <SortButton label="Term" sortKey="term" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th>
                  <SortButton label="Module" sortKey="module" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th>
                  <SortButton label="Component" sortKey="component" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th>
                  <SortButton label="Score" sortKey="score" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th>
                  <SortButton label="Outcome" sortKey="outcome" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th>Attempt</th>
                <th>
                  <SortButton label="Source" sortKey="source" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th>
                  <SortButton label="Taken" sortKey="taken" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.result.id}>
                  <td>
                    <StudentLink student={row.student} />
                  </td>
                  <td>{row.term.name}</td>
                  <td>
                    <strong>{row.module.code}</strong>
                    <br />
                    <span className="muted small">{row.module.title}</span>
                  </td>
                  <td>{row.result.componentType}</td>
                  <td>
                    {row.result.score}%<br />
                    <span className="muted small">Pass mark {row.result.passMark}%</span>
                  </td>
                  <td>
                    <StatusPill value={row.result.passed ? "passed" : "failed"} />
                    {row.result.resitRequired ? (
                      <>
                        <br />
                        <StatusPill value="watch" label="resit required" />
                      </>
                    ) : null}
                  </td>
                  <td>
                    <StatusPill value={row.result.isResit ? "resit" : "not_due"} label={`Attempt ${row.result.attemptNumber}`} />
                    {row.result.isResit ? (
                      <>
                        <br />
                        <StatusPill value="resit" label="resit" />
                      </>
                    ) : null}
                    {row.priorResult ? (
                      <>
                        <br />
                        <span className="muted small">Prior fail {row.priorResult.score}% on {row.priorResult.takenOn}</span>
                      </>
                    ) : null}
                    {row.result.priorAttemptMissing ? (
                      <>
                        <br />
                        <span className="muted small">Previous failed attempt missing</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {row.result.sourceSystem}
                    <br />
                    <span className="muted small">{row.result.sourceAttemptId}</span>
                  </td>
                  <td>{row.result.takenOn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
