import "server-only";

import { cache } from "react";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";
import { getAppData } from "@/lib/seed";
import type {
  AppData,
  AdmissionLead,
  AssessmentAttempt,
  AttendanceRecord,
  AttendanceSession,
  CourseModule,
  EncounterLog,
  Enrolment,
  ExamResult,
  ExamPortalMapping,
  ExamPortalSubmission,
  FinanceRecord,
  ManagedFile,
  ModuleOffering,
  PresentationScore,
  StaffUser,
  Student,
  Term
} from "@/lib/types";

type DbRow = Record<string, unknown>;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function mapStudent(row: DbRow): Student {
  return {
    id: String(row.id),
    personId: optionalString(row.person_id),
    cccuStudentId: optionalString(row.cccu_student_id),
    temporaryId: String(row.temporary_id),
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    email: String(row.email),
    phone: optionalString(row.phone),
    status: row.status as Student["status"],
    admissionStage: row.admission_stage as Student["admissionStage"],
    programme: row.programme as Student["programme"],
    startTermId: optionalString(row.start_term_id),
    photoUrl: optionalString(row.photo_path),
    notes: optionalString(row.notes)
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function mapAdmissionLead(row: DbRow): AdmissionLead {
  return {
    id: String(row.id),
    personId: optionalString(row.person_id),
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    email: String(row.email),
    phone: optionalString(row.phone),
    stage: row.stage as AdmissionLead["stage"],
    programme: row.programme as AdmissionLead["programme"],
    moduleInterestIds: stringArray(row.module_interest_ids),
    source: optionalString(row.source),
    lastContactedOn: optionalString(row.last_contacted_on),
    nextActionOn: optionalString(row.next_action_on),
    applicationInvitedAt: optionalString(row.application_invited_at),
    applicationInvitationExpiresAt: optionalString(row.application_invitation_expires_at),
    notes: optionalString(row.notes),
    convertedStudentId: optionalString(row.converted_student_id),
    archived: Boolean(row.archived)
  };
}

function mapTerm(row: DbRow): Term {
  return {
    id: String(row.id),
    name: String(row.name),
    startsOn: String(row.starts_on),
    endsOn: String(row.ends_on),
    examWindowStartsOn: optionalString(row.exam_window_starts_on),
    examWindowEndsOn: optionalString(row.exam_window_ends_on),
    status: row.status as Term["status"]
  };
}

function mapCourseModule(row: DbRow): CourseModule {
  return {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    credits: Number(row.credits),
    mode: row.mode as CourseModule["mode"],
    mandatory: Boolean(row.mandatory),
    active: Boolean(row.active)
  };
}

function mapOffering(row: DbRow): ModuleOffering {
  return {
    id: String(row.id),
    moduleId: String(row.module_id),
    termId: String(row.term_id),
    pricePence: Number(row.price_pence),
    capacity: Number(row.capacity),
    attendanceDaysRequiredFirstPractical: Number(row.attendance_days_required_first_practical),
    attendanceDaysRequiredSubsequentPractical: Number(row.attendance_days_required_subsequent_practical),
    presentationRequired: Boolean(row.presentation_required)
  };
}

function mapEnrolment(row: DbRow): Enrolment {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    offeringId: String(row.offering_id),
    status: row.status as Enrolment["status"],
    grade: optionalString(row.grade),
    finalMark: numberValue(row.final_mark),
    creditsAwarded: Number(row.credits_awarded),
    attendanceDaysRequiredOverride: numberValue(row.attendance_days_required_override),
    presentationRequiredOverride: booleanValue(row.presentation_required_override)
  };
}

function mapAttendanceSession(row: DbRow, expectedStudentIds: string[]): AttendanceSession {
  return {
    id: String(row.id),
    termId: String(row.term_id),
    offeringId: optionalString(row.offering_id),
    sessionDate: String(row.session_date),
    startsAt: String(row.starts_at),
    endsAt: String(row.ends_at),
    location: String(row.location),
    expectedStudentIds
  };
}

function mapAttendanceRecord(row: DbRow): AttendanceRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    studentId: String(row.student_id),
    status: row.status as AttendanceRecord["status"],
    checkedInAt: optionalString(row.checked_in_at),
    checkedOutAt: optionalString(row.checked_out_at),
    recordedByUserId: optionalString(row.recorded_by_user_id),
    adminNote: optionalString(row.admin_note)
  };
}

function mapEncounter(row: DbRow): EncounterLog {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    offeringId: String(row.offering_id),
    staffUserId: String(row.staff_user_id),
    occurredOn: String(row.occurred_on),
    summary: String(row.summary),
    concernLevel: row.concern_level as EncounterLog["concernLevel"]
  };
}

function mapAssessmentAttempt(row: DbRow): AssessmentAttempt {
  const assessedItemIds = Array.isArray(row.assessed_item_ids) ? row.assessed_item_ids.map(String) : [];
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    offeringId: String(row.offering_id),
    definitionId: String(row.definition_id),
    staffUserId: String(row.staff_user_id),
    occurredOn: String(row.occurred_on),
    assessedItemIds,
    overallScore: numberValue(row.overall_score),
    scores: (row.scores ?? {}) as Record<string, number>,
    comments: optionalString(row.comments)
  };
}

function mapPresentation(row: DbRow): PresentationScore {
  const presentationType =
    row.presentation_type === "case_presentation" || row.presentation_type === "journal_club"
      ? row.presentation_type
      : undefined;

  return {
    id: String(row.id),
    studentId: String(row.student_id),
    offeringId: String(row.offering_id),
    staffUserId: String(row.staff_user_id),
    occurredOn: String(row.occurred_on),
    presentationType,
    durationMinutes: numberValue(row.duration_minutes),
    scores: (row.scores ?? {}) as Record<string, number>,
    totalScore: Number(row.total_score),
    comments: optionalString(row.comments)
  };
}

function mapFinance(row: DbRow): FinanceRecord {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    termId: String(row.term_id),
    expectedAmountPence: Number(row.expected_amount_pence),
    invoiceStatus: row.invoice_status as FinanceRecord["invoiceStatus"],
    invoiceAmountPence: numberValue(row.invoice_amount_pence),
    paymentStatus: row.payment_status as FinanceRecord["paymentStatus"],
    paidAmountPence: numberValue(row.paid_amount_pence),
    notes: optionalString(row.notes)
  };
}

function mapExamResult(row: DbRow): ExamResult {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    offeringId: String(row.offering_id),
    componentType: row.component_type as ExamResult["componentType"],
    sourceSystem: row.source_system as ExamResult["sourceSystem"],
    sourceAttemptId: String(row.source_attempt_id),
    score: Number(row.score),
    passMark: Number(row.pass_mark),
    passed: Boolean(row.passed),
    resitRequired: Boolean(row.resit_required),
    isResit: Boolean(row.is_resit),
    attemptNumber: Number(row.attempt_number ?? 1),
    resitOfResultId: optionalString(row.resit_of_result_id),
    priorAttemptMissing: Boolean(row.prior_attempt_missing),
    takenOn: String(row.taken_on),
    importedAt: String(row.imported_at)
  };
}

function mapExamPortalMapping(row: DbRow): ExamPortalMapping {
  return {
    id: String(row.id),
    portalExamId: String(row.portal_exam_id),
    examTitle: optionalString(row.exam_title),
    termId: String(row.term_id),
    moduleId: optionalString(row.module_id),
    componentType: row.component_type as ExamPortalMapping["componentType"],
    portalExamKind: row.portal_exam_kind as ExamPortalMapping["portalExamKind"],
    physicsRequired: Boolean(row.physics_required ?? true),
    active: Boolean(row.active),
    lastSyncedAt: optionalString(row.last_synced_at),
    lastSyncStatus: optionalString(row.last_sync_status),
    lastSyncMessage: optionalString(row.last_sync_message)
  };
}

function mapExamPortalSubmission(row: DbRow): ExamPortalSubmission {
  return {
    id: String(row.id),
    mappingId: String(row.mapping_id),
    portalExamId: String(row.portal_exam_id),
    tokenId: String(row.token_id),
    token: optionalString(row.token),
    cccuStudentId: optionalString(row.cccu_student_id),
    studentId: optionalString(row.student_id),
    studentName: String(row.student_name),
    sourceSessionId: optionalString(row.source_session_id),
    startedAt: optionalString(row.started_at),
    completedAt: optionalString(row.completed_at),
    answered: numberValue(row.answered),
    score: Number(row.score),
    total: Number(row.total),
    percentage: Number(row.percentage),
    integrityEventCount: Number(row.integrity_event_count),
    importedAt: String(row.imported_at)
  };
}

function mapManagedFile(row: DbRow): ManagedFile {
  return {
    id: String(row.id),
    studentId: optionalString(row.student_id),
    personId: optionalString(row.person_id),
    bucket: String(row.bucket),
    objectPath: String(row.object_path),
    label: String(row.label),
    fileCategory: (row.file_category ?? "other") as ManagedFile["fileCategory"],
    originalFilename: optionalString(row.original_filename),
    sanitizedFilename: optionalString(row.sanitized_filename),
    contentType: optionalString(row.content_type),
    sizeBytes: numberValue(row.size_bytes),
    retentionClass: (row.retention_class ?? "student_academic_record") as ManagedFile["retentionClass"],
    uploadedByUserId: optionalString(row.uploaded_by_user_id),
    uploadedByPersonId: optionalString(row.uploaded_by_person_id),
    createdAt: String(row.created_at)
  };
}

function mapStaff(row: DbRow): StaffUser {
  return {
    id: String(row.id),
    name: String(row.full_name),
    email: "",
    role: row.role as StaffUser["role"],
    active: Boolean(row.active)
  };
}

async function selectRows(table: string, columns = "*", order?: { column: string; ascending?: boolean }): Promise<DbRow[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from(table).select(columns);
  if (order) {
    query = query.order(order.column, { ascending: order.ascending ?? true });
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load ${table}: ${error.message}`);
  }
  return (data ?? []) as unknown as DbRow[];
}

export const getLmsData = cache(async (): Promise<AppData> => {
  if (!isSupabaseConfigured()) {
    return getAppData();
  }

  const [
    admissionLeadRows,
    staffRows,
    studentRows,
    termRows,
    moduleRows,
    offeringRows,
    enrolmentRows,
    sessionRows,
    expectedAttendanceRows,
    attendanceRows,
    assessmentDefinitionRows,
    encounterRows,
    assessmentAttemptRows,
    presentationRows,
    financeRows,
    examRows,
    examPortalMappingRows,
    examPortalSubmissionRows,
    managedFileRows
  ] = await Promise.all([
    selectRows("admission_leads", "*", { column: "created_at", ascending: false }),
    selectRows("staff_profiles", "*", { column: "full_name" }),
    selectRows("students", "*", { column: "last_name" }),
    selectRows("terms", "*", { column: "starts_on", ascending: false }),
    selectRows("course_modules", "*", { column: "code" }),
    selectRows("module_offerings"),
    selectRows("enrolments"),
    selectRows("attendance_sessions", "*", { column: "session_date", ascending: false }),
    selectRows("expected_attendance"),
    selectRows("attendance_records"),
    selectRows("assessment_definitions"),
    selectRows("encounter_logs", "*", { column: "occurred_on", ascending: false }),
    selectRows("assessment_attempts", "*", { column: "occurred_on", ascending: false }),
    selectRows("presentation_scores", "*", { column: "occurred_on", ascending: false }),
    selectRows("finance_records"),
    selectRows("exam_results", "*", { column: "taken_on", ascending: false }),
    selectRows("exam_portal_mappings", "*", { column: "created_at", ascending: false }),
    selectRows("exam_portal_submissions", "*", { column: "completed_at", ascending: false }),
    selectRows("managed_files", "*", { column: "created_at", ascending: false })
  ]);

  const expectedBySession = new Map<string, string[]>();
  expectedAttendanceRows.forEach((row) => {
    const sessionId = String(row.session_id);
    expectedBySession.set(sessionId, [...(expectedBySession.get(sessionId) ?? []), String(row.student_id)]);
  });

  return {
    admissionLeads: admissionLeadRows.map(mapAdmissionLead),
    staffUsers: staffRows.map(mapStaff),
    students: studentRows.map(mapStudent),
    terms: termRows.map(mapTerm),
    modules: moduleRows.map(mapCourseModule),
    offerings: offeringRows.map(mapOffering),
    enrolments: enrolmentRows.map(mapEnrolment),
    sessions: sessionRows.map((row) => mapAttendanceSession(row, expectedBySession.get(String(row.id)) ?? [])),
    attendance: attendanceRows.map(mapAttendanceRecord),
    assessmentDefinitions: assessmentDefinitionRows.map((row) => ({
      id: String(row.id),
      moduleId: String(row.module_id),
      name: String(row.name),
      domains: (row.domains ?? []) as AppData["assessmentDefinitions"][number]["domains"],
      scoreMin: Number(row.score_min ?? 0),
      scoreMax: Number(row.score_max ?? 10),
      active: Boolean(row.active)
    })),
    encounters: encounterRows.map(mapEncounter),
    assessmentAttempts: assessmentAttemptRows.map(mapAssessmentAttempt),
    presentationScores: presentationRows.map(mapPresentation),
    financeRecords: financeRows.map(mapFinance),
    examResults: examRows.map(mapExamResult),
    examPortalMappings: examPortalMappingRows.map(mapExamPortalMapping),
    examPortalSubmissions: examPortalSubmissionRows.map(mapExamPortalSubmission),
    managedFiles: managedFileRows.map(mapManagedFile)
  };
});

export async function getStudentProfileData(studentId: string): Promise<{ data: AppData; student: Student | undefined }> {
  const data = await getLmsData();
  return {
    data,
    student: data.students.find((student) => student.id === studentId)
  };
}
