import { z } from "zod";
import type { AssessmentSummary } from "./assessment";
import { componentScoreText } from "./assessment/display";
import type { AssessmentEvaluation } from "./assessment/types";

export const companionPageSize = 20;
export const companionQuerySchema = z.object({
  screen: z.enum(["overview", "student", "entry"]).optional().catch(undefined),
  term: z.uuid().optional(), module: z.uuid().optional(), studentId: z.uuid().optional(), attendanceTerm: z.uuid().optional(),
  mode: z.enum(["module", "term"]).catch("module"), filter: z.enum(["all", "here", "risk"]).catch("all"),
  q: z.string().trim().max(100).catch(""), page: z.coerce.number().int().min(1).max(100000).catch(1)
});
export type CompanionQuery = z.infer<typeof companionQuerySchema>;
export function companionScreen(query: CompanionQuery) {
  return query.screen ?? (query.studentId ? "student" : "overview");
}
export function companionHref(query: CompanionQuery, change: Partial<Record<keyof CompanionQuery, string | number | undefined>> = {}) {
  const parameters = new URLSearchParams();
  Object.entries({ ...query, ...change }).forEach(([key, value]) => { if (value !== undefined && value !== "") parameters.set(key, String(value)); });
  return `/staff?${parameters}`;
}
export interface CompanionTerm { id: string; name: string; status: string; starts_on: string }
export interface CompanionOffering { id: string; term_id: string; module_id: string; presentation_required: boolean }
export interface CompanionEnrolment { id: string; student_id: string; offering_id: string; presentation_required_override: boolean | null }
export interface CompanionModule { id: string; code: string; title: string }
export interface CompanionSession { id: string; term_id: string; session_date: string; starts_at: string; ends_at: string }
export interface CompanionAttendance { student_id: string; session_id: string; status: string; checked_in_at: string | null; checked_out_at: string | null }
export interface CompanionExpectation { student_id: string; session_id: string }
export interface CompanionPresentation { student_id: string; offering_id: string; occurred_on: string }
export interface CompanionModuleResult {
  id: string; offeringId: string; moduleId: string; code: string; title: string; termId: string; term: string;
  status: string; theory: string; practical: string; presentation: "Complete" | "Incomplete" | "N/A" | "Unavailable" | "Recorded" | "Not recorded";
  attended: number | null; required: number | null; practicalModule: boolean | null; risk: string[];
  plannedPresentationDate?: string;
}
export interface CompanionDay { date: string; statuses: string[]; expected: boolean; presentations: string[]; plannedPresentations?: string[] }
export interface CompanionStudent {
  id: string; name: string; identifier: string; here: boolean; risk: string[];
  attended: number | null; required: number | null; presentationComplete: number; presentationRequired: number; presentationUnknown: boolean;
  recordedAttendance: number; presentationRecorded: number;
  formative: number; days: CompanionDay[];
}
export interface CompanionTeaching {
  editableOfferingId?: string;
  id: string; date: string; kind: string; author: string; module: string; term: string; comment: string;
  details: Array<{ label: string; value: string }>;
}
export interface CompanionProfile {
  teachingOfferingIds: string[];
  presentationOfferingIds?: string[];
  id: string; name: string; identifier: string; status: string; modules: CompanionModuleResult[];
  attendanceTerm: string; attendance: Array<{ id: string; date: string; startsAt: string; endsAt: string; status: string; expected: boolean }>;
  teaching: CompanionTeaching[];
}
export interface CompanionData {
  teachingEnabled: boolean;
  query: CompanionQuery; terms: CompanionTerm[]; modules: CompanionModule[]; today: string; mode: "shadow" | "live";
  students: CompanionStudent[]; dates: string[]; total: number; profile: CompanionProfile | null;
}

export function teachingDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function companionExamScore(assessment: AssessmentEvaluation | undefined, component: "theory" | "practical", reviewed: boolean): string {
  const result = assessment?.components?.[component];
  const notRequired = component === "practical" && reviewed && assessment?.plan.mode === "online";
  if (assessment?.historical && result?.origin === "Historical record") {
    if (result.score !== null && result.score !== undefined) return `${result.score}% (recorded)`;
    if (result.attempt_count > 0) return "Review result history";
    return notRequired ? "N/A" : "Not recorded";
  }
  if (reviewed) return componentScoreText(result, notRequired);
  return assessment?.historical && !result ? "Not recorded" : "Unavailable";
}

export function moduleResult(enrolment: CompanionEnrolment, offering: CompanionOffering, courseModule: CompanionModule, term: CompanionTerm, outcome?: AssessmentSummary): CompanionModuleResult {
  const assessment = outcome?.assessment;
  const reviewed = Boolean(assessment && !assessment.needs_plan && assessment.plan);
  const outcomeAvailable = reviewed || Boolean(assessment?.historical);
  const presentationRequired = enrolment.presentation_required_override ?? offering.presentation_required;
  const held = ["Abandoned", "Module deferred", "Assessment deferred"].includes(assessment?.effective_status ?? "");
  return {
    id: enrolment.id, offeringId: offering.id, moduleId: courseModule.id, code: courseModule.code, title: courseModule.title, termId: term.id, term: term.name,
    status: assessment?.historical ? assessment.effective_status : assessment?.needs_plan ? "Plan review required" : assessment?.effective_status ?? "Unavailable",
    theory: companionExamScore(assessment, "theory", reviewed),
    practical: companionExamScore(assessment, "practical", reviewed),
    presentation: !presentationRequired ? "N/A" : !reviewed || typeof assessment?.presentation_pending !== "boolean" ? "Unavailable" : assessment.presentation_pending ? "Incomplete" : "Complete",
    attended: reviewed ? assessment?.attendance_actual ?? null : null, required: reviewed ? assessment?.attendance_required ?? null : null,
    practicalModule: reviewed ? assessment?.plan.mode === "practical" : null,
    risk: !outcomeAvailable || held ? [] : [...new Set([...(assessment?.effective_status === "Fail" ? ["Module failed"] : []), ...(assessment?.effective_indicators ?? [])])]
  };
}

export function termAttendance(results: CompanionModuleResult[]) {
  if (!results.length || results.some(result => result.practicalModule === null)) return { attended: null, required: null };
  const practical = results.filter(result => result.practicalModule);
  if (practical.some(result => result.attended === null || result.required === null)) return { attended: null, required: null };
  return { attended: Math.max(0, ...practical.map(result => result.attended!)), required: Math.max(0, ...practical.map(result => result.required!)) };
}

export function recordedAttendanceDays(records: Array<{ date: string; status: string }>, today: string): number {
  return new Set(records.filter(record => record.date <= today && ["attended", "partial"].includes(record.status)).map(record => record.date)).size;
}

export function attendanceLabel(attended: number | null, required: number | null, recorded?: number): string {
  if (attended !== null && required !== null) return `${attended}/${required}`;
  return recorded === undefined ? "Unavailable" : `${recorded} recorded`;
}

export function attachRecordedPresentations(modules: CompanionModuleResult[], studentId: string, presentations: CompanionPresentation[], today: string) {
  for (const courseModule of modules) {
    if (courseModule.presentation !== "Unavailable") continue;
    courseModule.presentation = presentations.some(event => event.student_id === studentId && event.offering_id === courseModule.offeringId && event.occurred_on <= today) ? "Recorded" : "Not recorded";
  }
}

export function isHereToday(studentId: string, today: string, sessions: CompanionSession[], attendance: CompanionAttendance[]): boolean {
  const todaySessions = new Set(sessions.filter(session => session.session_date === today).map(session => session.id));
  return attendance.some(record => record.student_id === studentId && todaySessions.has(record.session_id) && Boolean(record.checked_in_at) && !record.checked_out_at);
}

export function studentDays(studentId: string, sessions: CompanionSession[], attendance: CompanionAttendance[], expectations: CompanionExpectation[], presentations: CompanionPresentation[], modules: CompanionModuleResult[]): CompanionDay[] {
  const dates = [...new Set([...sessions.map(session => session.session_date), ...presentations.filter(event => event.student_id === studentId).map(event => event.occurred_on)])].sort();
  return dates.map(date => {
    const sessionIds = new Set(sessions.filter(session => session.session_date === date).map(session => session.id));
    return {
      date,
      statuses: [...new Set(attendance.filter(record => record.student_id === studentId && sessionIds.has(record.session_id)).map(record => record.status))],
      expected: expectations.some(record => record.student_id === studentId && sessionIds.has(record.session_id)),
      presentations: [...new Set(presentations.filter(event => event.student_id === studentId && event.occurred_on === date).map(event => modules.find(module => module.offeringId === event.offering_id)?.code).filter((code): code is string => Boolean(code)))]
    };
  });
}
