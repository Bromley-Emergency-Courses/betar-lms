import type {
  AppData,
  AttendanceRecord,
  CourseModule,
  DashboardMetrics,
  Enrolment,
  EnrolmentStatus,
  ExamResult,
  FinanceRecord,
  ModuleOffering,
  Student
} from "@/lib/types";

const PASS_MARK = 50;
const STANDARD_REQUIREMENT_ENROLMENT_STATUSES: EnrolmentStatus[] = ["planned", "in_progress", "completed"];
const REQUIREMENT_RELEVANT_ENROLMENT_STATUSES: EnrolmentStatus[] = [
  "planned",
  "in_progress",
  "completed",
  "resit"
];
const PRIOR_PRACTICAL_ENROLMENT_STATUSES: EnrolmentStatus[] = [
  "planned",
  "in_progress",
  "completed",
  "resit"
];
const PRIOR_EVIDENCE_CARRYOVER_ENROLMENT_STATUSES: EnrolmentStatus[] = [
  "deferred",
  "did_not_complete",
  "failed"
];
const AUTO_STATUS_ENROLMENT_STATUSES: EnrolmentStatus[] = ["planned", "in_progress", "resit"];

export function formatCurrency(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(pence / 100);
}

export function studentDisplayName(student: Pick<Student, "firstName" | "lastName">): string {
  return `${student.firstName} ${student.lastName}`;
}

export function externalStudentIdentifier(student: Student): string {
  return student.cccuStudentId ?? student.temporaryId;
}

export function creditsAwardedForStudent(studentId: string, enrolments: Enrolment[]): number {
  return enrolments
    .filter((enrolment) => enrolment.studentId === studentId)
    .reduce((total, enrolment) => total + enrolment.creditsAwarded, 0);
}

export function hasCompletedMandatoryModule(
  studentId: string,
  enrolments: Enrolment[],
  offerings: ModuleOffering[],
  modules: CourseModule[]
): boolean {
  const mandatoryModuleIds = new Set(modules.filter((module) => module.mandatory).map((module) => module.id));
  return enrolments.some((enrolment) => {
    if (enrolment.studentId !== studentId || enrolment.status !== "completed") {
      return false;
    }
    const offering = offerings.find((candidate) => candidate.id === enrolment.offeringId);
    return offering ? mandatoryModuleIds.has(offering.moduleId) : false;
  });
}

export function enrolmentsInTerm(studentId: string, termId: string, data: AppData): Enrolment[] {
  const offeringIds = new Set(
    data.offerings.filter((offering) => offering.termId === termId).map((offering) => offering.id)
  );
  return data.enrolments.filter(
    (enrolment) => enrolment.studentId === studentId && offeringIds.has(enrolment.offeringId)
  );
}

export function canAddEnrolmentForTerm(studentId: string, termId: string, data: AppData): boolean {
  return enrolmentsInTerm(studentId, termId, data).length < 2;
}

function moduleForOffering(offering: ModuleOffering, data: AppData): CourseModule | undefined {
  return data.modules.find((candidate) => candidate.id === offering.moduleId);
}

function isPracticalOffering(offering: ModuleOffering, data: AppData): boolean {
  return moduleForOffering(offering, data)?.mode === "practical";
}

function enrolmentForOffering(studentId: string, offeringId: string, data: AppData): Enrolment | undefined {
  return data.enrolments.find(
    (candidate) => candidate.studentId === studentId && candidate.offeringId === offeringId
  );
}

function usesStandardAttendanceRequirement(enrolment: Enrolment): boolean {
  return STANDARD_REQUIREMENT_ENROLMENT_STATUSES.includes(enrolment.status);
}

function attendanceRequirementOverride(enrolment: Enrolment): number {
  if (typeof enrolment.attendanceDaysRequiredOverride === "number") {
    return enrolment.attendanceDaysRequiredOverride;
  }

  return enrolment.status === "resit" ? 0 : 0;
}

export function isEnrolmentComplianceRelevant(enrolment: Enrolment): boolean {
  return REQUIREMENT_RELEVANT_ENROLMENT_STATUSES.includes(enrolment.status);
}

export function isStudentComplianceRelevant(student?: Pick<Student, "status">): boolean {
  return Boolean(student && student.status !== "withdrawn");
}

function practicalEnrolmentsInTerm(studentId: string, termId: string, data: AppData): Enrolment[] {
  if (!isStudentComplianceRelevant(data.students.find((student) => student.id === studentId))) {
    return [];
  }

  return data.enrolments.filter((enrolment) => {
    if (enrolment.studentId !== studentId || !isEnrolmentComplianceRelevant(enrolment)) {
      return false;
    }

    const offering = data.offerings.find((candidate) => candidate.id === enrolment.offeringId);
    return Boolean(offering && offering.termId === termId && isPracticalOffering(offering, data));
  });
}

function hasPriorPracticalEnrolment(studentId: string, termId: string, data: AppData): boolean {
  if (!isStudentComplianceRelevant(data.students.find((student) => student.id === studentId))) {
    return false;
  }

  const currentTerm = data.terms.find((candidate) => candidate.id === termId);
  return data.enrolments.some((enrolment) => {
    if (
      enrolment.studentId !== studentId ||
      !PRIOR_PRACTICAL_ENROLMENT_STATUSES.includes(enrolment.status)
    ) {
      return false;
    }

    const offering = data.offerings.find((candidate) => candidate.id === enrolment.offeringId);
    const term = offering ? data.terms.find((candidate) => candidate.id === offering.termId) : undefined;
    if (!offering || !term || offering.termId === termId || !isPracticalOffering(offering, data)) {
      return false;
    }

    return currentTerm ? term.startsOn < currentTerm.startsOn : true;
  });
}

function attendedDatesForOffering(studentId: string, offering: ModuleOffering, data: AppData): Set<string> {
  const attendedDates = new Set<string>();
  for (const record of data.attendance) {
    if (record.studentId !== studentId || !["attended", "partial"].includes(record.status)) {
      continue;
    }

    const session = data.sessions.find((candidate) => candidate.id === record.sessionId);
    if (session?.termId === offering.termId && (!session.offeringId || session.offeringId === offering.id)) {
      attendedDates.add(session.sessionDate);
    }
  }

  return attendedDates;
}

function priorEvidenceCarryoverEnrolmentsForModule(
  enrolment: Enrolment,
  offering: ModuleOffering,
  data: AppData
): Enrolment[] {
  if (!isStudentComplianceRelevant(data.students.find((student) => student.id === enrolment.studentId))) {
    return [];
  }

  const currentTerm = data.terms.find((candidate) => candidate.id === offering.termId);
  if (!currentTerm) {
    return [];
  }

  return data.enrolments.filter((candidate) => {
    if (
      candidate.id === enrolment.id ||
      candidate.studentId !== enrolment.studentId ||
      !PRIOR_EVIDENCE_CARRYOVER_ENROLMENT_STATUSES.includes(candidate.status)
    ) {
      return false;
    }

    const candidateOffering = data.offerings.find((item) => item.id === candidate.offeringId);
    const candidateTerm = candidateOffering
      ? data.terms.find((term) => term.id === candidateOffering.termId)
      : undefined;

    return Boolean(
      candidateOffering &&
        candidateTerm &&
        candidateOffering.moduleId === offering.moduleId &&
        candidateTerm.startsOn < currentTerm.startsOn
    );
  });
}

function carriedAttendanceDaysForEnrolment(enrolment: Enrolment, offering: ModuleOffering, data: AppData): number {
  return priorEvidenceCarryoverEnrolmentsForModule(enrolment, offering, data).reduce((total, priorEnrolment) => {
    const priorOffering = data.offerings.find((candidate) => candidate.id === priorEnrolment.offeringId);
    return priorOffering ? total + attendedDatesForOffering(enrolment.studentId, priorOffering, data).size : total;
  }, 0);
}

function carriedAttendanceDaysForTerm(studentId: string, termId: string, data: AppData): number {
  return practicalEnrolmentsInTerm(studentId, termId, data).reduce((total, enrolment) => {
    const offering = data.offerings.find((candidate) => candidate.id === enrolment.offeringId);
    return offering ? total + carriedAttendanceDaysForEnrolment(enrolment, offering, data) : total;
  }, 0);
}

export function requiredAttendanceDaysForTerm(studentId: string, termId: string, data: AppData): number {
  const practicalEnrolments = practicalEnrolmentsInTerm(studentId, termId, data);
  if (practicalEnrolments.length === 0) {
    return 0;
  }

  const overrideRequirementTotal = practicalEnrolments
    .filter((enrolment) => !usesStandardAttendanceRequirement(enrolment))
    .reduce((total, enrolment) => total + attendanceRequirementOverride(enrolment), 0);
  const practicalOfferings = practicalEnrolments
    .filter(usesStandardAttendanceRequirement)
    .map((enrolment) => data.offerings.find((candidate) => candidate.id === enrolment.offeringId))
    .filter((offering): offering is ModuleOffering => Boolean(offering));
  if (practicalOfferings.length === 0) {
    return overrideRequirementTotal;
  }

  const subsequentRequirementTotal = practicalOfferings.reduce(
    (total, offering) => total + offering.attendanceDaysRequiredSubsequentPractical,
    0
  );

  if (hasPriorPracticalEnrolment(studentId, termId, data)) {
    return overrideRequirementTotal + subsequentRequirementTotal;
  }

  const firstPracticalPremium = Math.max(
    0,
    ...practicalOfferings.map(
      (offering) =>
        offering.attendanceDaysRequiredFirstPractical - offering.attendanceDaysRequiredSubsequentPractical
    )
  );

  return overrideRequirementTotal + subsequentRequirementTotal + firstPracticalPremium;
}

export function requiredAttendanceDays(studentId: string, offering: ModuleOffering, data: AppData): number {
  if (!isStudentComplianceRelevant(data.students.find((student) => student.id === studentId))) {
    return 0;
  }

  const courseModule = data.modules.find((candidate) => candidate.id === offering.moduleId);
  if (!courseModule || courseModule.mode === "online") {
    return 0;
  }

  const enrolment = enrolmentForOffering(studentId, offering.id, data);
  if (enrolment && !isEnrolmentComplianceRelevant(enrolment)) {
    return 0;
  }
  if (enrolment && !usesStandardAttendanceRequirement(enrolment)) {
    return attendanceRequirementOverride(enrolment);
  }

  return requiredAttendanceDaysForTerm(studentId, offering.termId, data);
}

export function attendedDaysInTerm(studentId: string, termId: string, data: AppData): number {
  if (!isStudentComplianceRelevant(data.students.find((student) => student.id === studentId))) {
    return 0;
  }

  const attendedDates = new Set<string>();
  for (const record of data.attendance) {
    if (record.studentId !== studentId || !["attended", "partial"].includes(record.status)) {
      continue;
    }

    const session = data.sessions.find((candidate) => candidate.id === record.sessionId);
    if (session?.termId === termId) {
      attendedDates.add(session.sessionDate);
    }
  }

  return attendedDates.size + carriedAttendanceDaysForTerm(studentId, termId, data);
}

export function attendedDays(studentId: string, offeringId: string, data: AppData): number {
  const offering = data.offerings.find((candidate) => candidate.id === offeringId);
  if (!offering || !isPracticalOffering(offering, data)) {
    return 0;
  }

  return attendedDaysInTerm(studentId, offering.termId, data);
}

export function hasTermAttendanceGap(studentId: string, termId: string, data: AppData): boolean {
  if (!isStudentComplianceRelevant(data.students.find((student) => student.id === studentId))) {
    return false;
  }

  return attendedDaysInTerm(studentId, termId, data) < requiredAttendanceDaysForTerm(studentId, termId, data);
}

export function hasAttendanceGap(studentId: string, offering: ModuleOffering, data: AppData): boolean {
  if (!isPracticalOffering(offering, data)) {
    return false;
  }

  const enrolment = enrolmentForOffering(studentId, offering.id, data);
  if (enrolment && !isEnrolmentComplianceRelevant(enrolment)) {
    return false;
  }

  return hasTermAttendanceGap(studentId, offering.termId, data);
}

function hasPriorDeferredPresentation(enrolment: Enrolment, offering: ModuleOffering, data: AppData): boolean {
  return priorEvidenceCarryoverEnrolmentsForModule(enrolment, offering, data).some((priorEnrolment) =>
    data.presentationScores.some(
      (score) => score.studentId === enrolment.studentId && score.offeringId === priorEnrolment.offeringId
    )
  );
}

export function isPresentationRequiredForEnrolment(
  enrolment: Enrolment,
  offering: ModuleOffering,
  data: AppData
): boolean {
  if (
    !isEnrolmentComplianceRelevant(enrolment) ||
    !isStudentComplianceRelevant(data.students.find((student) => student.id === enrolment.studentId))
  ) {
    return false;
  }

  if (typeof enrolment.presentationRequiredOverride === "boolean") {
    return enrolment.presentationRequiredOverride;
  }

  if (enrolment.status === "resit") {
    return false;
  }

  if (hasPriorDeferredPresentation(enrolment, offering, data)) {
    return false;
  }

  return offering.presentationRequired;
}

function latestExamResultForComponent(results: ExamResult[]): ExamResult | undefined {
  return [...results].sort((a, b) => {
    return (
      (b.attemptNumber ?? 1) - (a.attemptNumber ?? 1) ||
      b.takenOn.localeCompare(a.takenOn) ||
      b.importedAt.localeCompare(a.importedAt)
    );
  })[0];
}

export function latestExamResultsByComponent(enrolment: Enrolment, data: AppData): Map<ExamResult["componentType"], ExamResult> {
  const resultsByComponent = new Map<ExamResult["componentType"], ExamResult[]>();
  data.examResults
    .filter((result) => result.studentId === enrolment.studentId && result.offeringId === enrolment.offeringId)
    .forEach((result) => {
      resultsByComponent.set(result.componentType, [...(resultsByComponent.get(result.componentType) ?? []), result]);
    });

  const latest = new Map<ExamResult["componentType"], ExamResult>();
  resultsByComponent.forEach((results, componentType) => {
    const result = latestExamResultForComponent(results);
    if (result) {
      latest.set(componentType, result);
    }
  });
  return latest;
}

function requiredExamComponents(courseModule: CourseModule): ExamResult["componentType"][] {
  return courseModule.mode === "practical" ? ["theory", "practical"] : ["theory"];
}

function examComponentLabel(componentType: ExamResult["componentType"]): string {
  return componentType === "theory" ? "Theory" : "Practical";
}

function nonExamCompletionBlockers(enrolment: Enrolment, offering: ModuleOffering, courseModule: CourseModule, data: AppData): string[] {
  const blockers: string[] = [];
  const presentation = data.presentationScores.find(
    (score) => score.studentId === enrolment.studentId && score.offeringId === offering.id
  );

  if (courseModule.mode === "practical" && hasAttendanceGap(enrolment.studentId, offering, data)) {
    blockers.push("Attendance");
  }
  if (isPresentationRequiredForEnrolment(enrolment, offering, data) && !presentation) {
    blockers.push("Presentation");
  }

  return blockers;
}

export function completionBlockersForEnrolment(enrolment: Enrolment, data: AppData): string[] {
  if (
    !isEnrolmentComplianceRelevant(enrolment) ||
    !isStudentComplianceRelevant(data.students.find((student) => student.id === enrolment.studentId))
  ) {
    return [];
  }

  const offering = data.offerings.find((candidate) => candidate.id === enrolment.offeringId);
  const courseModule = offering ? data.modules.find((candidate) => candidate.id === offering.moduleId) : undefined;
  if (!offering || !courseModule) {
    return ["Missing offering"];
  }

  const blockers = nonExamCompletionBlockers(enrolment, offering, courseModule, data);
  const latestResults = latestExamResultsByComponent(enrolment, data);

  requiredExamComponents(courseModule).forEach((componentType) => {
    const result = latestResults.get(componentType);
    if (!result) {
      blockers.push(`${examComponentLabel(componentType)} result`);
      return;
    }
    if (!result.passed) {
      blockers.push(`${examComponentLabel(componentType)} failed`);
    }
  });

  return blockers;
}

export function recommendedOngoingEnrolmentStatus(enrolment: Enrolment, data: AppData): EnrolmentStatus | undefined {
  if (!AUTO_STATUS_ENROLMENT_STATUSES.includes(enrolment.status)) {
    return undefined;
  }
  if (!isStudentComplianceRelevant(data.students.find((student) => student.id === enrolment.studentId))) {
    return undefined;
  }

  const offering = data.offerings.find((candidate) => candidate.id === enrolment.offeringId);
  const courseModule = offering ? data.modules.find((candidate) => candidate.id === offering.moduleId) : undefined;
  if (!offering || !courseModule) {
    return undefined;
  }

  const latestResults = latestExamResultsByComponent(enrolment, data);
  const latestRecordedResults = [...latestResults.values()];
  if (latestRecordedResults.some((result) => !result.passed)) {
    return "failed";
  }

  const requiredComponents = requiredExamComponents(courseModule);
  const hasAllRequiredPasses = requiredComponents.every((componentType) => latestResults.get(componentType)?.passed === true);
  if (hasAllRequiredPasses && nonExamCompletionBlockers(enrolment, offering, courseModule, data).length === 0) {
    return "completed";
  }

  return undefined;
}

export function creditsForEnrolmentStatus(status: EnrolmentStatus, offering: ModuleOffering, data: AppData): number {
  if (status !== "completed") {
    return 0;
  }
  return data.modules.find((candidate) => candidate.id === offering.moduleId)?.credits ?? 10;
}

export function financeDiscrepancy(record: FinanceRecord): number {
  const paid = record.paidAmountPence ?? 0;
  return record.expectedAmountPence - paid;
}

export function normalizeExamResultScore(score: number, passMark = PASS_MARK): Pick<ExamResult, "passed" | "resitRequired"> {
  const passed = score >= passMark;
  return { passed, resitRequired: !passed };
}

export function studentAcademicRisk(studentId: string, data: AppData): "none" | "watch" | "support_needed" {
  const hasSupportConcern = data.encounters.some(
    (encounter) => encounter.studentId === studentId && encounter.concernLevel === "support_needed"
  );
  if (hasSupportConcern) {
    return "support_needed";
  }

  const hasFailedExam = data.examResults.some((result) => result.studentId === studentId && result.resitRequired);
  const hasWatchConcern = data.encounters.some(
    (encounter) => encounter.studentId === studentId && encounter.concernLevel === "watch"
  );
  return hasFailedExam || hasWatchConcern ? "watch" : "none";
}

export function dashboardMetrics(data: AppData): DashboardMetrics {
  const activeStudents = data.students.filter((student) => student.status === "active").length;
  const admissionsBlocked = data.admissionLeads.filter(
    (lead) => !lead.archived && ["accepted", "offered", "submitted"].includes(lead.stage)
  ).length;
  const financeDiscrepancies = data.financeRecords.filter((record) => financeDiscrepancy(record) !== 0).length;
  const studentsAtAcademicRisk = data.students.filter(
    (student) => studentAcademicRisk(student.id, data) !== "none"
  ).length;
  const attendanceGaps = data.enrolments.filter((enrolment) => {
    const student = data.students.find((candidate) => candidate.id === enrolment.studentId);
    const offering = data.offerings.find((candidate) => candidate.id === enrolment.offeringId);
    return isStudentComplianceRelevant(student) && isEnrolmentComplianceRelevant(enrolment) && offering
      ? hasAttendanceGap(enrolment.studentId, offering, data)
      : false;
  }).length;
  const creditsAwarded = data.enrolments.reduce((total, enrolment) => total + enrolment.creditsAwarded, 0);

  return {
    activeStudents,
    admissionsBlocked,
    financeDiscrepancies,
    studentsAtAcademicRisk,
    attendanceGaps,
    creditsAwarded
  };
}

export function attendanceStatusForRecord(record?: AttendanceRecord): string {
  if (!record) {
    return "Expected";
  }
  if (record.checkedInAt && !record.checkedOutAt) {
    return "Checked in";
  }
  if (record.checkedInAt && record.checkedOutAt) {
    return "Complete";
  }
  return record.status;
}
