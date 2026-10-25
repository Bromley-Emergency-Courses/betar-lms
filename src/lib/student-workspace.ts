import type { AppData, AttendanceStatus, FinanceRecord } from "./types";
import { presentationRubricCriteria } from "./presentation-rubric";

export interface WorkspaceAttendance {
  id: string;
  revision?: number;
  sessionRevision?: number;
  canEdit?: boolean;
  expected?: boolean;
  hasRecord?: boolean;
  termId: string;
  term: string;
  date: string;
  startsAt: string;
  endsAt: string;
  location: string;
  status: AttendanceStatus | "not_recorded";
  note?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
}

export interface WorkspaceTeachingRecord {
  id: string;
  date: string;
  author: string;
  module: string;
  type: "Observation" | "Formative assessment" | "Presentation";
  text: string;
  concern?: string;
  details: Array<{ label: string; value: string }>;
}

export interface StudentWorkspaceData {
  attendance: WorkspaceAttendance[];
  teaching: WorkspaceTeachingRecord[];
  finance: Array<FinanceRecord & { term: string }>;
  terms: Array<{ id: string; name: string }>;
}

export function buildStudentWorkspaceData(data: AppData, studentId: string, includeFinance: boolean): StudentWorkspaceData {
  const enrolments = data.enrolments.filter(enrolment => enrolment.studentId === studentId);
  const termIds = new Set(enrolments.map(enrolment => data.offerings.find(offering => offering.id === enrolment.offeringId)?.termId));
  const records = data.attendance.filter(record => record.studentId === studentId);
  const termName = (termId: string) => data.terms.find(term => term.id === termId)?.name ?? "Term unavailable";
  const moduleName = (offeringId: string) => {
    const offering = data.offerings.find(candidate => candidate.id === offeringId);
    const courseModule = data.modules.find(candidate => candidate.id === offering?.moduleId);
    return `${courseModule?.title ?? "Module unavailable"} · ${offering ? termName(offering.termId) : "Term unavailable"}`;
  };
  const authorName = (staffId: string) => data.staffUsers.find(staff => staff.id === staffId)?.name ?? "Teaching staff";
  const attendance = data.sessions.filter(session => termIds.has(session.termId) || session.expectedStudentIds.includes(studentId) || records.some(record => record.sessionId === session.id)).map(session => {
    const record = records.find(candidate => candidate.sessionId === session.id);
    return {
      id: session.id, termId: session.termId, term: termName(session.termId), date: session.sessionDate,
      startsAt: session.startsAt, endsAt: session.endsAt, location: session.location,
      status: record?.status ?? (session.expectedStudentIds.includes(studentId) ? "expected" : "not_recorded") as WorkspaceAttendance["status"],
      note: record?.adminNote, checkedInAt: record?.checkedInAt, checkedOutAt: record?.checkedOutAt
    };
  }).sort((first, second) => second.date.localeCompare(first.date) || first.startsAt.localeCompare(second.startsAt));
  const teaching: WorkspaceTeachingRecord[] = [
    ...data.encounters.filter(record => record.studentId === studentId).map(record => ({
      id: record.id, date: record.occurredOn, author: authorName(record.staffUserId), module: moduleName(record.offeringId),
      type: "Observation" as const, text: record.summary, concern: record.concernLevel, details: []
    })),
    ...data.assessmentAttempts.filter(record => record.studentId === studentId).map(record => {
      const definition = data.assessmentDefinitions.find(candidate => candidate.id === record.definitionId);
      return {
        id: record.id, date: record.occurredOn, author: authorName(record.staffUserId), module: moduleName(record.offeringId),
        type: "Formative assessment" as const, text: record.comments ?? "", details: [
          { label: "Assessment", value: definition?.name ?? "Assessment definition unavailable" },
          ...(record.overallScore === undefined ? [] : [{ label: "Overall score", value: String(record.overallScore) }]),
          ...record.assessedItemIds.map(itemId => ({ label: "Assessed item", value: definition?.domains.find(domain => domain.id === itemId)?.label ?? "Earlier assessment item" })),
          ...Object.entries(record.scores).map(([key, value]) => ({ label: definition?.domains.find(domain => domain.id === key)?.label ?? key.replaceAll("_", " "), value: String(value) }))
        ]
      };
    }),
    ...data.presentationScores.filter(record => record.studentId === studentId).map(record => ({
      id: record.id, date: record.occurredOn, author: authorName(record.staffUserId), module: moduleName(record.offeringId),
      type: "Presentation" as const, text: record.comments ?? "", details: [
        { label: "Type", value: record.presentationType?.replaceAll("_", " ") ?? "Not recorded" },
        { label: "Duration", value: record.durationMinutes === undefined ? "Not recorded" : `${record.durationMinutes} minutes` },
        { label: "Total score", value: String(record.totalScore) },
        ...Object.entries(record.scores).map(([key, value]) => ({ label: presentationRubricCriteria.find(criterion => criterion.id === key)?.label ?? key.replaceAll("_", " "), value: String(value) }))
      ]
    }))
  ];
  teaching.sort((first, second) => second.date.localeCompare(first.date));
  return {
    attendance, teaching,
    finance: includeFinance ? data.financeRecords.filter(record => record.studentId === studentId).map(record => ({ ...record, term: termName(record.termId) })) : [],
    terms: data.terms.filter(term => termIds.has(term.id) || attendance.some(record => record.termId === term.id)).map(term => ({ id: term.id, name: term.name }))
  };
}
