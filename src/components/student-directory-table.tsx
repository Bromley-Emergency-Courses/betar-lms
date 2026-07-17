"use client";

import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { StatusPill } from "@/components/status-pill";
import { StudentLink } from "@/components/student-link";
import {
  creditsAwardedForStudent,
  externalStudentIdentifier,
  studentAcademicRisk,
  studentDisplayName
} from "@/lib/rules";
import type { AdmissionStage, AppData, Student, StudentStatus } from "@/lib/types";

type SortKey = "student" | "programme" | "status" | "admission" | "credits" | "risk";
type SortDirection = "asc" | "desc";
type CreditFilter = "all" | "none" | "partial" | "complete";
type RiskFilter = "all" | "none" | "watch" | "support_needed";

interface StudentRow {
  student: Student;
  name: string;
  identifier: string;
  credits: number;
  risk: ReturnType<typeof studentAcademicRisk>;
}

const programmeOptions = [
  { value: "all", label: "All programmes" },
  { value: "pgcert", label: "PGCert" },
  { value: "microcredential", label: "Microcredential" }
] as const;

const statusOptions: Array<{ value: "all" | StudentStatus; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "deferred", label: "Deferred" },
  { value: "interrupted", label: "Interrupted" }
];

const admissionOptions: Array<{ value: "all" | AdmissionStage; label: string }> = [
  { value: "all", label: "All admissions" },
  { value: "interest", label: "Interest" },
  { value: "application_invited", label: "Application invited" },
  { value: "submitted", label: "Submitted" },
  { value: "reviewed", label: "Reviewed" },
  { value: "offered", label: "Offered" },
  { value: "rejected", label: "Rejected" },
  { value: "accepted", label: "Accepted" },
  { value: "cccu_registration_pending", label: "CCCU registration pending" },
  { value: "cccu_registration_complete", label: "CCCU registration complete" }
];

const creditOptions: Array<{ value: CreditFilter; label: string }> = [
  { value: "all", label: "All credits" },
  { value: "none", label: "0 credits" },
  { value: "partial", label: "1-59 credits" },
  { value: "complete", label: "60 credits" }
];

const riskOptions: Array<{ value: RiskFilter; label: string }> = [
  { value: "all", label: "All risks" },
  { value: "none", label: "None" },
  { value: "watch", label: "Watch" },
  { value: "support_needed", label: "Support needed" }
];

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

export function StudentDirectoryTable({ data, initialSearch = "" }: { data: AppData; initialSearch?: string }) {
  const [query, setQuery] = useState(initialSearch);
  const [programmeFilter, setProgrammeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | StudentStatus>("all");
  const [admissionFilter, setAdmissionFilter] = useState<"all" | AdmissionStage>("all");
  const [creditFilter, setCreditFilter] = useState<CreditFilter>("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("student");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const rows = useMemo<StudentRow[]>(
    () =>
      data.students.map((student) => ({
        student,
        name: studentDisplayName(student),
        identifier: externalStudentIdentifier(student),
        credits: creditsAwardedForStudent(student.id, data.enrolments),
        risk: studentAcademicRisk(student.id, data)
      })),
    [data]
  );

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        const { student } = row;
        if (
          normalizedQuery &&
          !`${row.name} ${row.identifier} ${student.email} ${student.phone ?? ""}`.toLowerCase().includes(normalizedQuery)
        ) {
          return false;
        }
        if (programmeFilter !== "all" && student.programme !== programmeFilter) {
          return false;
        }
        if (statusFilter !== "all" && student.status !== statusFilter) {
          return false;
        }
        if (admissionFilter !== "all" && student.admissionStage !== admissionFilter) {
          return false;
        }
        if (creditFilter === "none" && row.credits !== 0) {
          return false;
        }
        if (creditFilter === "partial" && (row.credits <= 0 || row.credits >= 60)) {
          return false;
        }
        if (creditFilter === "complete" && row.credits < 60) {
          return false;
        }
        if (riskFilter !== "all" && row.risk !== riskFilter) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        let result = 0;
        if (sortKey === "student") {
          result = compareText(a.name, b.name);
        } else if (sortKey === "programme") {
          result = compareText(a.student.programme, b.student.programme) || compareText(a.name, b.name);
        } else if (sortKey === "status") {
          result = compareText(a.student.status, b.student.status) || compareText(a.name, b.name);
        } else if (sortKey === "admission") {
          result = compareText(a.student.admissionStage, b.student.admissionStage) || compareText(a.name, b.name);
        } else if (sortKey === "credits") {
          result = a.credits - b.credits || compareText(a.name, b.name);
        } else if (sortKey === "risk") {
          result = compareText(a.risk, b.risk) || compareText(a.name, b.name);
        }
        return sortDirection === "asc" ? result : -result;
      });
  }, [admissionFilter, creditFilter, programmeFilter, query, riskFilter, rows, sortDirection, sortKey, statusFilter]);

  function handleSort(nextSortKey: SortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection("asc");
  }

  function clearFilters() {
    setQuery("");
    setProgrammeFilter("all");
    setStatusFilter("all");
    setAdmissionFilter("all");
    setCreditFilter("all");
    setRiskFilter("all");
    setSortKey("student");
    setSortDirection("asc");
  }

  return (
    <section className="section">
      <div className="student-filter-panel">
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
        <div className="student-filters">
          <label className="field">
            <span>Student</span>
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, ID, email, or phone"
            />
          </label>
          <label className="field">
            <span>Programme</span>
            <select className="select" value={programmeFilter} onChange={(event) => setProgrammeFilter(event.target.value)}>
              {programmeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | StudentStatus)}>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Admission</span>
            <select
              className="select"
              value={admissionFilter}
              onChange={(event) => setAdmissionFilter(event.target.value as "all" | AdmissionStage)}
            >
              {admissionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Credits</span>
            <select className="select" value={creditFilter} onChange={(event) => setCreditFilter(event.target.value as CreditFilter)}>
              {creditOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Risk</span>
            <select className="select" value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as RiskFilter)}>
              {riskOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState title="No matching students" detail="Adjust the column filters or clear filters to show more student records." />
      ) : (
        <div className="table-wrap student-table-wrap">
          <table className="student-directory-table">
            <thead>
              <tr>
                <th>
                  <SortButton label="Student" sortKey="student" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th>
                  <SortButton label="Programme" sortKey="programme" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th>
                  <SortButton label="Status" sortKey="status" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th>
                  <SortButton label="Admission" sortKey="admission" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th>
                  <SortButton label="Credits" sortKey="credits" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th>
                  <SortButton label="Risk" sortKey="risk" activeSort={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.student.id}>
                  <td>
                    <StudentLink student={row.student} />
                  </td>
                  <td>{row.student.programme}</td>
                  <td>
                    <StatusPill value={row.student.status} />
                  </td>
                  <td>
                    <StatusPill value={row.student.admissionStage} />
                  </td>
                  <td>{row.credits} / 60</td>
                  <td>
                    <StatusPill value={row.risk} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
