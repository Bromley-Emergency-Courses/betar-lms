import type { AuditActorType, ManagedFileRetentionClass, UserRole } from "@/lib/types";

export type SignedDocumentAccessBoundary = "staff" | "portal";

export type ManagedDocumentBucket =
  | "student-documents"
  | "application-docs"
  | "id-documents"
  | "qualification-documents"
  | "student-photos"
  | "generated-letters"
  | "deferral-evidence";

export interface ManagedFileAccessRow {
  id: string;
  studentId?: string;
  personId?: string;
  bucket: string;
  objectPath: string;
  label: string;
  originalFilename?: string;
  sanitizedFilename?: string;
  contentType?: string;
  sizeBytes?: number;
  retentionClass: ManagedFileRetentionClass;
}

export type DocumentAccessActor =
  | {
      kind: "staff";
      userId: string;
      role: UserRole;
    }
  | {
      kind: "portal";
      userId: string;
      personId: string;
      actorType: Extract<AuditActorType, "applicant" | "student">;
    };

export interface DocumentAccessDecision {
  allowed: boolean;
  reason:
    | "allowed"
    | "unknown_bucket"
    | "staff_role_not_allowed"
    | "portal_person_mismatch"
    | "portal_document_restricted";
}

const managedDocumentBuckets = new Set<string>([
  "student-documents",
  "application-docs",
  "id-documents",
  "qualification-documents",
  "student-photos",
  "generated-letters",
  "deferral-evidence"
]);

const portalReadableDocuments = new Set<string>([
  "application-docs:application_document",
  "student-photos:student_photo",
  "generated-letters:generated_letter"
]);

const auditedStaffDocumentAccess = new Set<ManagedFileRetentionClass>(["identity_document", "deferral_evidence"]);

export function isManagedDocumentBucket(bucket: string): bucket is ManagedDocumentBucket {
  return managedDocumentBuckets.has(bucket);
}

export function canAccessManagedDocument(
  actor: DocumentAccessActor,
  file: ManagedFileAccessRow
): DocumentAccessDecision {
  if (!isManagedDocumentBucket(file.bucket)) {
    return { allowed: false, reason: "unknown_bucket" };
  }

  if (actor.kind === "staff") {
    if (actor.role === "admin") {
      return { allowed: true, reason: "allowed" };
    }

    if (actor.role === "teacher" && file.bucket === "student-photos" && file.retentionClass === "student_photo") {
      return { allowed: true, reason: "allowed" };
    }

    return { allowed: false, reason: "staff_role_not_allowed" };
  }

  if (file.personId !== actor.personId) {
    return { allowed: false, reason: "portal_person_mismatch" };
  }

  if (portalReadableDocuments.has(`${file.bucket}:${file.retentionClass}`)) {
    return { allowed: true, reason: "allowed" };
  }

  return { allowed: false, reason: "portal_document_restricted" };
}

export function requiresStaffDocumentAccessAudit(actor: DocumentAccessActor, file: ManagedFileAccessRow): boolean {
  return actor.kind === "staff" && auditedStaffDocumentAccess.has(file.retentionClass);
}

export function signedDocumentDownloadFilename(file: ManagedFileAccessRow): string {
  return file.sanitizedFilename ?? file.originalFilename ?? `${file.label || "document"}`;
}
