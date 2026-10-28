import { presentationRubricCriteria } from "@/lib/presentation-rubric";

export const demoDate = "2026-10-23";
export const currentTermId = "autumn-2026";
export const terms = [
  { id: currentTermId, name: "Autumn 2026", status: "active", dates: ["2026-09-10", "2026-09-24", "2026-10-08", "2026-10-22", demoDate, "2026-11-05", "2026-11-19"] },
  { id: "spring-2026", name: "Spring 2026", status: "closed", dates: ["2026-04-09", "2026-04-16", "2026-04-23", "2026-04-30"] }
];
export const staff = [
  { id: "alan", name: "Alan Mathew", initials: "AM" },
  { id: "nina", name: "Nina Patel", initials: "NP" }
];
export const modules = [
  { code: "VA", name: "Vascular access", active: true },
  { code: "EC", name: "Echocardiography", active: true },
  { code: "LU", name: "Lung ultrasound", active: true }
];
export const students = [
  { id: "BT02601", name: "Amara Okafor", initials: "AO", role: "Emergency medicine" },
  { id: "BT02602", name: "James Wilson", initials: "JW", role: "Acute medicine" },
  { id: "BT02603", name: "Priya Shah", initials: "PS", role: "Anaesthetics" },
  { id: "BT02604", name: "Daniel Chen", initials: "DC", role: "Intensive care" },
  { id: "BT02605", name: "Sofia Ahmed", initials: "SA", role: "Emergency medicine" },
  { id: "BT02606", name: "Oliver Hughes", initials: "OH", role: "Acute medicine" },
  { id: "BT02607", name: "Mei Tan", initials: "MT", role: "Intensive care" },
  { id: "BT02608", name: "Grace Mensah", initials: "GM", role: "Anaesthetics" }
];
export const enrolments = students.flatMap((student, studentIndex) => [
  ...[["VA", "EC"], ["EC", "LU"], ["VA", "LU"]][studentIndex % 3].map((module) => ({
    studentId: student.id, module, termId: currentTermId, presentationRequired: true,
    status: studentIndex === 6 || (studentIndex === 3 && module === "EC") ? "completed" : studentIndex === 7 ? "deferred" : "in_progress"
  })),
  { studentId: student.id, module: studentIndex === 5 ? "VA" : ["LU", "VA", "EC"][studentIndex % 3], termId: "spring-2026", presentationRequired: true, status: "completed" }
]);
export function canRecordTeaching(studentId: string, termId: string, module?: string) {
  return terms.some((term) => term.id === termId && term.status === "active") && enrolments.some((enrolment) =>
    enrolment.studentId === studentId && enrolment.termId === termId && enrolment.status === "in_progress"
    && (module === undefined || enrolment.module === module) && modules.some((candidate) => candidate.code === enrolment.module && candidate.active)
  );
}
export function hereToday(studentId: string, termId: string, attendance: Attendance[]) {
  return attendance.some((session) => session.studentId === studentId && session.termId === termId && session.date === demoDate && session.checkedInAt && !session.checkedOutAt);
}
export type DemoStudent = typeof students[number];
export type RecordKind = "Presentation" | "Formative" | "Encounter";
export type TeachingRecord = {
  id: string; studentId: string; module: string; termId: string; staffId: string; kind: RecordKind; date: string;
  summary: string; score?: number; maximum?: number; concern?: string; presentationId?: string;
  duration?: number; presentationType?: string; scores?: Record<string, number>; items?: string[]; timePenalty?: number;
};
export type Attendance = {
  studentId: string; termId: string; date: string; status: "Attended" | "Partial" | "Missed" | "Planned"; time: string;
  checkedInAt?: string; checkedOutAt?: string;
};
export type Presentation = {
  id: string; studentId: string; termId: string; module: string; date: string;
  type: string; duration?: number;
};
export function requiredAttendance(studentId: string, termId: string) {
  if (termId !== currentTermId) return 3;
  return students.findIndex((student) => student.id === studentId) % 2 === 0 ? 5 : 4;
}
export function seedAttendance(): Attendance[] {
  return students.flatMap((student, studentIndex) => terms.flatMap((term) => term.dates.map((date, dateIndex) => ({
    studentId: student.id, termId: term.id, date,
    status: date === demoDate ? (studentIndex % 3 === 2 ? "Planned" as const : "Attended" as const) : date > demoDate ? "Planned" as const : (studentIndex + dateIndex) % 5 === 1 ? "Missed" as const : (studentIndex + dateIndex) % 4 === 3 ? "Partial" as const : "Attended" as const,
    time: date === demoDate ? (studentIndex % 3 === 2 ? "Expected · not checked in" : studentIndex % 3 === 0 ? "Checked in 09:00 · here now" : "09:00–12:00 · checked out") : date > demoDate ? "09:00–16:00 · planned" : (studentIndex + dateIndex) % 5 === 1 ? "No attendance recorded" : (studentIndex + dateIndex) % 4 === 3 ? "09:00–12:00" : "09:00–16:00",
    checkedInAt: date === demoDate && studentIndex % 3 !== 2 ? demoDate + "T09:00:00" : undefined,
    checkedOutAt: date === demoDate && studentIndex % 3 === 1 ? demoDate + "T12:00:00" : undefined
  }))));
}
export function seedPresentations(): Presentation[] {
  return enrolments.map((enrolment, enrolmentIndex) => ({
    ...enrolment, id: `presentation-${enrolment.studentId}-${enrolment.termId}-${enrolment.module}`,
    date: enrolment.termId !== currentTermId ? "2026-04-23" : enrolment.status === "completed" || enrolment.studentId === students[0].id || enrolmentIndex % 3 === 0 ? "2026-10-08" : "2026-11-05",
    type: enrolmentIndex % 2 ? "Journal club" : "Case presentation", duration: 12
  }));
}
export function seedRecords(): TeachingRecord[] {
  return seedPresentations().flatMap((presentation, presentationIndex) => {
    const records: TeachingRecord[] = [{
      id: `enc-${presentation.id}`, studentId: presentation.studentId, module: presentation.module,
      termId: presentation.termId, staffId: "nina", kind: "Encounter",
      date: presentation.termId === currentTermId ? "2026-10-08" : "2026-04-23",
      concern: presentationIndex % 3 === 1 ? "Watch" : "None",
      summary: "Good progress with image acquisition. Practise probe positioning before the next supervised session."
    }];
    if (presentation.date <= demoDate) {
      const authors = presentation.studentId === students[0].id && presentation.module === "VA" && presentation.termId === currentTermId ? staff : [staff[presentationIndex % 2]];
      for (const author of authors) {
        const scores = Object.fromEntries(presentationRubricCriteria.map((criterion, criterionIndex) => [criterion.id, 3 + (criterionIndex + presentationIndex + (author.id === "nina" ? 1 : 0)) % 3]));
        records.push({
          id: `score-${presentation.id}-${author.id}`, presentationId: presentation.id,
          studentId: presentation.studentId, module: presentation.module, termId: presentation.termId,
          staffId: author.id, kind: "Presentation", date: presentation.date, scores,
          score: Object.values(scores).reduce((sum, score) => sum + score, 0), maximum: 50,
          presentationType: presentation.type, duration: presentation.duration,
          summary: "Clear clinical reasoning and a well-structured discussion."
        });
      }
    }
    for (let attempt = 0; attempt < presentationIndex % 4; attempt++) records.push({
      id: `fa-${presentation.id}-${attempt}`, studentId: presentation.studentId, module: presentation.module,
      termId: presentation.termId, staffId: "alan", kind: "Formative",
      date: presentation.termId === currentTermId ? "2026-10-08" : "2026-04-23",
      score: 3 + attempt % 2, maximum: 5, items: ["Image acquisition", "Interpretation"],
      summary: "Developing a systematic approach. Review probe positioning."
    });
    return records;
  });
}
export function attendanceProgress(studentId: string, termId: string, attendance: Attendance[]) {
  const sessions = attendance.filter((session) => session.studentId === studentId && session.termId === termId);
  const attended = new Set(sessions.filter((session) => ["Attended", "Partial"].includes(session.status) && session.date <= demoDate).map((session) => session.date)).size;
  const planned = new Set(sessions.filter((session) => session.status === "Planned" && session.date >= demoDate).map((session) => session.date)).size;
  return { sessions, attended, planned, required: requiredAttendance(studentId, termId) };
}
export function progress(studentId: string, module: string, records: TeachingRecord[], attendance: Attendance[], termId = currentTermId) {
  const termAttendance = attendanceProgress(studentId, termId, attendance);
  const related = records.filter((record) => record.studentId === studentId && record.module === module && record.termId === termId);
  const presentations = related.some((record) => record.kind === "Presentation") ? 1 : 0;
  const formative = related.filter((record) => record.kind === "Formative").length;
  const reasons = [
    ...(termAttendance.attended + termAttendance.planned < termAttendance.required ? ["More attendance dates needed"] : []),
    ...(studentId === "BT02606" && module === "LU" ? ["Resit required"] : [])
  ];
  return { ...termAttendance, presentations, formative, reasons };
}
