import type { AppData, Student } from "@/lib/types";
import type { AssessmentOutcome } from "@/lib/assessment/types";

export type WorkspaceData = Pick<AppData, "terms" | "offerings" | "modules" | "enrolments" | "sessions" | "attendance" | "encounters" | "assessmentAttempts" | "presentationScores" | "staffUsers" | "financeRecords">;
export type AttendancePreview = { id: string; term: string; date: string; time: string; location: string; status: string; note: string };
export type FinancePreview = { id: string; term: string; expected: number; invoiced: number; paid: number; invoiceStatus: string; paymentStatus: string; note: string };
export type NotePreview = { id: string; date: string; author: string; category: string; module: string; text: string; concern: string };

export function previewAttendance(data: WorkspaceData, student: Student, examples: boolean): AttendancePreview[] {
  if (examples) return [
    { id: "session-1", term: "Autumn 2026", date: "2026-10-05", time: "09:00–17:00", location: "Skills centre", status: "attended", note: "" },
    { id: "session-2", term: "Autumn 2026", date: "2026-10-12", time: "09:00–17:00", location: "Skills centre", status: "missed", note: "Awaiting confirmation from the tutor" },
    { id: "session-3", term: "Autumn 2026", date: "2026-10-19", time: "09:00–17:00", location: "Skills centre", status: "missed", note: "Medical leave" }
  ];
  const termIds = new Set(data.enrolments.filter(row => row.studentId === student.id).map(row => data.offerings.find(offering => offering.id === row.offeringId)?.termId));
  return data.sessions.filter(session => termIds.has(session.termId)).map(session => {
    const record = data.attendance.find(row => row.studentId === student.id && row.sessionId === session.id);
    return { id: session.id, term: data.terms.find(term => term.id === session.termId)?.name ?? "Term not recorded", date: session.sessionDate, time: `${session.startsAt}–${session.endsAt}`, location: session.location, status: record?.status ?? "expected", note: record?.adminNote ?? "" };
  });
}

export function previewFinance(data: WorkspaceData, student: Student, examples: boolean): FinancePreview[] {
  if (examples) return [
    { id: "finance-1", term: "Autumn 2026", expected: 180000, invoiced: 180000, paid: 120000, invoiceStatus: "sent", paymentStatus: "outstanding", note: "Final instalment due 30 November" },
    { id: "finance-2", term: "Summer 2026", expected: 120000, invoiced: 120000, paid: 120000, invoiceStatus: "sent", paymentStatus: "paid", note: "Reconciled" }
  ];
  return data.financeRecords.filter(row => row.studentId === student.id).map(row => ({ id: row.id, term: data.terms.find(term => term.id === row.termId)?.name ?? "Term not recorded", expected: row.expectedAmountPence, invoiced: row.invoiceAmountPence ?? 0, paid: row.paidAmountPence ?? 0, invoiceStatus: row.invoiceStatus, paymentStatus: row.paymentStatus, note: row.notes ?? "" }));
}

export function previewNotes(data: WorkspaceData, student: Student, examples: boolean): NotePreview[] {
  if (examples) return [
    { id: "note-1", date: "2026-10-19", author: "Dr Sam Patel", category: "Teaching observation", module: "Abdominal ultrasound", text: "Good probe handling and clear explanations to the patient. Continue practising image optimisation before the next session.", concern: "none" },
    { id: "note-2", date: "2026-10-12", author: "Dr Alex Green", category: "Support follow-up", module: "Abdominal ultrasound", text: "Missed the practical session. Contact the student to agree a catch-up plan before the next assessment.", concern: "watch" }
  ];
  const moduleTitle = (offeringId: string) => data.modules.find(module => module.id === data.offerings.find(offering => offering.id === offeringId)?.moduleId)?.title ?? "Teaching record";
  const author = (staffId: string) => data.staffUsers.find(staff => staff.id === staffId)?.name ?? "Teaching staff";
  return [
    ...data.encounters.filter(row => row.studentId === student.id).map(row => ({ id: row.id, date: row.occurredOn, author: author(row.staffUserId), category: "Teaching observation", module: moduleTitle(row.offeringId), text: row.summary, concern: row.concernLevel })),
    ...data.assessmentAttempts.filter(row => row.studentId === student.id).map(row => ({ id: row.id, date: row.occurredOn, author: author(row.staffUserId), category: "Formative assessment", module: moduleTitle(row.offeringId), text: row.comments ?? "No comments recorded", concern: "none" })),
    ...data.presentationScores.filter(row => row.studentId === student.id).map(row => ({ id: row.id, date: row.occurredOn, author: author(row.staffUserId), category: "Presentation", module: moduleTitle(row.offeringId), text: row.comments ?? "No comments recorded", concern: "none" }))
  ].sort((first, second) => second.date.localeCompare(first.date));
}

export function previewOutcomes(outcomes: AssessmentOutcome[], examples: boolean): AssessmentOutcome[] {
  if (!examples || !outcomes.length) return outcomes;
  const template = outcomes.find(row => row.assessment.plan);
  if (!template) return outcomes;
  return [
    { code: "POCUS-01", title: "Ultrasound foundations", status: "Pass", theory: 84, practical: 72 },
    { code: "POCUS-02", title: "Abdominal ultrasound", status: "Fail", theory: 80, practical: 70 },
    { code: "POCUS-03", title: "Cardiac ultrasound", status: "Fail", theory: 42, practical: 76 },
    { code: "POCUS-04", title: "Vascular ultrasound", status: "Module deferred", theory: null, practical: null }
  ].map((example, index) => {
    const row = structuredClone(template);
    row.enrolment_id = `preview-module-${index}`;
    row.student_name = "Amelia Taylor"; row.module_code = example.code; row.module_title = example.title; row.original_cohort = "Autumn 2026";
    row.assessment.enrolment_id = row.enrolment_id;
    row.assessment.plan = { ...row.assessment.plan, mode: "practical", theory_scheme: "mcq", physics_weighting: false, requires_coursework: false, requires_viva: false };
    row.assessment.effective_status = example.status as AssessmentOutcome["assessment"]["effective_status"];
    row.assessment.calculated_status = row.assessment.effective_status;
    row.assessment.awarded_credits = example.status === "Pass" ? 10 : 0;
    row.assessment.overrides = []; row.assessment.disposition = example.status === "Module deferred" ? "Module deferred" : null;
    row.assessment.attendance_actual = index === 1 ? 1 : 3; row.assessment.attendance_required = 3;
    row.assessment.calculated_indicators = index === 1 ? ["Attendance non-compliance"] : index === 2 ? ["theory:Resit scheduled"] : [];
    row.assessment.effective_indicators = row.assessment.calculated_indicators;
    for (const component of ["theory", "practical"] as const) {
      const score = example[component];
      row.assessment.components[component] = { component, id: null, sequence: score === null ? null : 1, score, pass_mark: 50, passed: score === null ? null : score >= 50, origin: "Manual", revision: 1, attempt_count: score === null ? 0 : 1, arrangement_kind: index === 2 && component === "theory" ? "resit_schedule" : null, arrangement_state: index === 2 && component === "theory" ? "active" : null, note: index === 2 ? "12 November · 10:00, skills centre" : null };
    }
    return row;
  });
}
