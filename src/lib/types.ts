export type UserRole = "admin" | "teacher" | "reception";

export type StudentStatus =
  | "prospect"
  | "active"
  | "completed"
  | "withdrawn"
  | "deferred"
  | "interrupted";

export type AdmissionStage =
  | "interest"
  | "application_invited"
  | "submitted"
  | "reviewed"
  | "offered"
  | "rejected"
  | "accepted"
  | "cccu_registration_pending"
  | "cccu_registration_complete";

export type ModuleMode = "practical" | "online";
export type EnrolmentStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "failed"
  | "deferred"
  | "resit"
  | "did_not_complete";
export type InvoiceStatus = "not_requested" | "requested" | "sent" | "corrected";
export type PaymentStatus = "not_due" | "outstanding" | "paid" | "disputed";
export type AttendanceStatus = "expected" | "attended" | "partial" | "missed";
export type ExamComponentType = "theory" | "practical";
export type ExamPortalExamKind = "module_theory" | "physics_equipment";
export type PresentationType = "case_presentation" | "journal_club";
export type AdmissionLeadStage =
  | "interest"
  | "application_invited"
  | "submitted"
  | "reviewed"
  | "offered"
  | "rejected"
  | "accepted"
  | "archived";

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
}

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  dateOfBirth?: string;
  email: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postcode?: string;
  country?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Student {
  id: string;
  personId?: string;
  cccuStudentId?: string;
  temporaryId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  status: StudentStatus;
  admissionStage: AdmissionStage;
  programme: "pgcert" | "microcredential";
  startTermId?: string;
  photoUrl?: string;
  notes?: string;
}

export interface AdmissionLead {
  id: string;
  personId?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  stage: AdmissionLeadStage;
  programme: "pgcert" | "microcredential";
  moduleInterestIds: string[];
  source?: string;
  lastContactedOn?: string;
  nextActionOn?: string;
  applicationInvitedAt?: string;
  applicationInvitationExpiresAt?: string;
  notes?: string;
  convertedStudentId?: string;
  archived: boolean;
}

export interface Term {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  examWindowStartsOn?: string;
  examWindowEndsOn?: string;
  status: "draft" | "published" | "active" | "closed";
}

export interface CourseModule {
  id: string;
  code: string;
  title: string;
  credits: number;
  mode: ModuleMode;
  mandatory: boolean;
  active: boolean;
}

export interface ModuleOffering {
  id: string;
  moduleId: string;
  termId: string;
  pricePence: number;
  capacity: number;
  attendanceDaysRequiredFirstPractical: number;
  attendanceDaysRequiredSubsequentPractical: number;
  presentationRequired: boolean;
}

export interface Enrolment {
  id: string;
  studentId: string;
  offeringId: string;
  status: EnrolmentStatus;
  grade?: string;
  finalMark?: number;
  creditsAwarded: number;
  attendanceDaysRequiredOverride?: number;
  presentationRequiredOverride?: boolean;
}

export interface AttendanceSession {
  id: string;
  termId: string;
  offeringId?: string;
  sessionDate: string;
  startsAt: string;
  endsAt: string;
  location: string;
  expectedStudentIds: string[];
}

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  checkedInAt?: string;
  checkedOutAt?: string;
  recordedByUserId?: string;
  adminNote?: string;
}

export interface AssessmentDefinition {
  id: string;
  moduleId: string;
  name: string;
  domains: AssessmentDomain[];
  scoreMin: number;
  scoreMax: number;
  active: boolean;
}

export interface AssessmentDomain {
  id: string;
  label: string;
  maxScore?: number;
  required?: boolean;
}

export interface EncounterLog {
  id: string;
  studentId: string;
  offeringId: string;
  staffUserId: string;
  occurredOn: string;
  summary: string;
  concernLevel: "none" | "watch" | "support_needed";
}

export interface AssessmentAttempt {
  id: string;
  studentId: string;
  offeringId: string;
  definitionId: string;
  staffUserId: string;
  occurredOn: string;
  assessedItemIds: string[];
  overallScore?: number;
  scores: Record<string, number>;
  comments?: string;
}

export interface PresentationScore {
  id: string;
  studentId: string;
  offeringId: string;
  staffUserId: string;
  occurredOn: string;
  presentationType?: PresentationType;
  durationMinutes?: number;
  scores: Record<string, number>;
  totalScore: number;
  comments?: string;
}

export interface FinanceRecord {
  id: string;
  studentId: string;
  termId: string;
  expectedAmountPence: number;
  invoiceStatus: InvoiceStatus;
  invoiceAmountPence?: number;
  paymentStatus: PaymentStatus;
  paidAmountPence?: number;
  notes?: string;
}

export interface ExamResult {
  id: string;
  studentId: string;
  offeringId: string;
  componentType: ExamComponentType;
  sourceSystem: "theory_portal" | "practical_osce" | "manual";
  sourceAttemptId: string;
  score: number;
  passMark: number;
  passed: boolean;
  resitRequired: boolean;
  isResit: boolean;
  attemptNumber: number;
  resitOfResultId?: string;
  priorAttemptMissing: boolean;
  takenOn: string;
  importedAt: string;
}

export interface ExamPortalMapping {
  id: string;
  portalExamId: string;
  examTitle?: string;
  termId: string;
  moduleId?: string;
  componentType: ExamComponentType;
  portalExamKind: ExamPortalExamKind;
  physicsRequired: boolean;
  active: boolean;
  lastSyncedAt?: string;
  lastSyncStatus?: string;
  lastSyncMessage?: string;
}

export interface ExamPortalSubmission {
  id: string;
  mappingId: string;
  portalExamId: string;
  tokenId: string;
  token?: string;
  cccuStudentId?: string;
  studentId?: string;
  studentName: string;
  sourceSessionId?: string;
  startedAt?: string;
  completedAt?: string;
  answered?: number;
  score: number;
  total: number;
  percentage: number;
  integrityEventCount: number;
  importedAt: string;
}

export type ManagedFileCategory = "cv" | "identity" | "certificate" | "correspondence" | "other";
export type ManagedFileRetentionClass =
  | "application_document"
  | "identity_document"
  | "qualification_document"
  | "student_photo"
  | "generated_letter"
  | "deferral_evidence"
  | "student_academic_record"
  | "other";

export interface ManagedFile {
  id: string;
  studentId?: string;
  personId?: string;
  bucket: string;
  objectPath: string;
  label: string;
  fileCategory: ManagedFileCategory;
  originalFilename?: string;
  sanitizedFilename?: string;
  contentType?: string;
  sizeBytes?: number;
  retentionClass: ManagedFileRetentionClass;
  uploadedByUserId?: string;
  uploadedByPersonId?: string;
  createdAt: string;
}

export type AuditActorType = "staff" | "applicant" | "student" | "service";

export interface AuditEvent {
  id: string;
  actorType: AuditActorType;
  actorUserId?: string;
  actorPersonId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type CorrespondenceChannel = "email" | "letter";
export type CorrespondenceDeliveryStatus = "queued" | "sent" | "delivered" | "failed" | "bounced" | "suppressed";
export type CorrespondenceBounceStatus = "none" | "soft_bounce" | "hard_bounce" | "complaint" | "blocked" | "unknown";

export interface CorrespondenceTemplate {
  id: string;
  templateKey: string;
  version: number;
  channel: CorrespondenceChannel;
  description?: string;
  subjectTemplate: string;
  bodyTemplate?: string;
  createdByUserId?: string;
  createdAt: string;
}

export interface CorrespondenceLog {
  id: string;
  personId: string;
  recipientEmail: string;
  recipientName?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  templateId?: string;
  templateKey: string;
  templateVersion: number;
  channel: CorrespondenceChannel;
  renderedSubject: string;
  providerMessageId?: string;
  deliveryStatus: CorrespondenceDeliveryStatus;
  bounceStatus: CorrespondenceBounceStatus;
  sentAt?: string;
  statusUpdatedAt: string;
  generatedFileId?: string;
  metadata: Record<string, unknown>;
  createdByUserId?: string;
  createdAt: string;
}

export interface AppData {
  admissionLeads: AdmissionLead[];
  staffUsers: StaffUser[];
  students: Student[];
  terms: Term[];
  modules: CourseModule[];
  offerings: ModuleOffering[];
  enrolments: Enrolment[];
  sessions: AttendanceSession[];
  attendance: AttendanceRecord[];
  assessmentDefinitions: AssessmentDefinition[];
  encounters: EncounterLog[];
  assessmentAttempts: AssessmentAttempt[];
  presentationScores: PresentationScore[];
  financeRecords: FinanceRecord[];
  examResults: ExamResult[];
  examPortalMappings: ExamPortalMapping[];
  examPortalSubmissions: ExamPortalSubmission[];
  managedFiles: ManagedFile[];
}

export interface DashboardMetrics {
  activeStudents: number;
  admissionsBlocked: number;
  financeDiscrepancies: number;
  studentsAtAcademicRisk: number;
  attendanceGaps: number;
  creditsAwarded: number;
}
