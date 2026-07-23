import { describe, expect, it } from "vitest";
import {
  canAccessManagedDocument,
  requiresStaffDocumentAccessAudit,
  signedDocumentDownloadFilename,
  type DocumentAccessActor,
  type ManagedFileAccessRow
} from "@/lib/document-access";

const admin: DocumentAccessActor = { kind: "staff", userId: "admin-user", role: "admin" };
const teacher: DocumentAccessActor = { kind: "staff", userId: "teacher-user", role: "teacher" };
const reception: DocumentAccessActor = { kind: "staff", userId: "reception-user", role: "reception" };
const applicant: DocumentAccessActor = {
  kind: "portal",
  userId: "applicant-user",
  personId: "person-1",
  actorType: "applicant"
};
const student: DocumentAccessActor = {
  kind: "portal",
  userId: "student-user",
  personId: "person-1",
  actorType: "student"
};

function managedFile(overrides: Partial<ManagedFileAccessRow> = {}): ManagedFileAccessRow {
  return {
    id: "file-1",
    personId: "person-1",
    bucket: "application-docs",
    objectPath: "person-1/application.pdf",
    label: "Application document",
    retentionClass: "application_document",
    ...overrides
  };
}

describe("managed document access", () => {
  it("allows admins to sign managed admissions documents", () => {
    expect(canAccessManagedDocument(admin, managedFile({ bucket: "id-documents", retentionClass: "identity_document" }))).toEqual({
      allowed: true,
      reason: "allowed"
    });
    expect(
      canAccessManagedDocument(admin, managedFile({ bucket: "deferral-evidence", retentionClass: "deferral_evidence" }))
    ).toEqual({ allowed: true, reason: "allowed" });
  });

  it("keeps teachers away from admissions and sensitive document buckets", () => {
    expect(canAccessManagedDocument(teacher, managedFile())).toEqual({
      allowed: false,
      reason: "staff_role_not_allowed"
    });
    expect(canAccessManagedDocument(teacher, managedFile({ bucket: "id-documents", retentionClass: "identity_document" }))).toEqual({
      allowed: false,
      reason: "staff_role_not_allowed"
    });
    expect(canAccessManagedDocument(teacher, managedFile({ bucket: "student-photos", retentionClass: "student_photo" }))).toEqual({
      allowed: true,
      reason: "allowed"
    });
  });

  it("does not grant reception document access", () => {
    expect(canAccessManagedDocument(reception, managedFile({ bucket: "student-photos", retentionClass: "student_photo" }))).toEqual({
      allowed: false,
      reason: "staff_role_not_allowed"
    });
  });

  it("allows applicants and students to sign only their own portal-readable documents", () => {
    expect(canAccessManagedDocument(applicant, managedFile())).toEqual({ allowed: true, reason: "allowed" });
    expect(canAccessManagedDocument(student, managedFile({ bucket: "generated-letters", retentionClass: "generated_letter" }))).toEqual({
      allowed: true,
      reason: "allowed"
    });
  });

  it("blocks portal users from other people's documents and restricted document classes", () => {
    expect(canAccessManagedDocument(applicant, managedFile({ personId: "person-2" }))).toEqual({
      allowed: false,
      reason: "portal_person_mismatch"
    });
    expect(canAccessManagedDocument(applicant, managedFile({ bucket: "id-documents", retentionClass: "identity_document" }))).toEqual({
      allowed: false,
      reason: "portal_document_restricted"
    });
    expect(
      canAccessManagedDocument(applicant, managedFile({ bucket: "qualification-documents", retentionClass: "qualification_document" }))
    ).toEqual({ allowed: false, reason: "portal_document_restricted" });
    expect(
      canAccessManagedDocument(applicant, managedFile({ bucket: "deferral-evidence", retentionClass: "deferral_evidence" }))
    ).toEqual({ allowed: false, reason: "portal_document_restricted" });
  });

  it("does not sign unknown buckets even when a managed_files row exists", () => {
    expect(canAccessManagedDocument(admin, managedFile({ bucket: "imports" }))).toEqual({
      allowed: false,
      reason: "unknown_bucket"
    });
  });
});

describe("managed document access auditing", () => {
  it("requires staff audit coverage for identity and special-category evidence URLs", () => {
    expect(requiresStaffDocumentAccessAudit(admin, managedFile({ bucket: "id-documents", retentionClass: "identity_document" }))).toBe(
      true
    );
    expect(
      requiresStaffDocumentAccessAudit(admin, managedFile({ bucket: "deferral-evidence", retentionClass: "deferral_evidence" }))
    ).toBe(true);
  });

  it("does not require signed URL audit events for portal users or routine documents", () => {
    expect(requiresStaffDocumentAccessAudit(applicant, managedFile({ bucket: "id-documents", retentionClass: "identity_document" }))).toBe(
      false
    );
    expect(requiresStaffDocumentAccessAudit(admin, managedFile())).toBe(false);
  });

  it("uses sanitized filenames for signed URL downloads", () => {
    expect(signedDocumentDownloadFilename(managedFile({ originalFilename: "Passport Scan.pdf", sanitizedFilename: "passport-scan.pdf" }))).toBe(
      "passport-scan.pdf"
    );
    expect(signedDocumentDownloadFilename(managedFile({ originalFilename: "Statement.pdf" }))).toBe("Statement.pdf");
  });
});
