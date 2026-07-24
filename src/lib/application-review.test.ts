import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applicationDocumentRejectedAction,
  applicationDocumentVerificationResetAction,
  applicationDocumentVerifiedAction,
  applicationReviewEntityType,
  applicationReviewRecordedAction,
  applicationSupportNeedsViewedAction,
  buildApplicationDocumentVerificationAuditMetadata,
  buildApplicationSupportNeedsViewedAuditMetadata,
  buildStaffApplicationReviewAuditMetadata,
  canReviewSubmittedApplication,
  parseRecordStaffApplicationReviewForm,
  parseVerifyApplicationDocumentForm
} from "@/lib/application-review";

describe("staff application review", () => {
  it("parses document verification form input", () => {
    const formData = new FormData();
    formData.set("slot_id", "77777777-7777-4777-8777-777777777777");
    formData.set("application_id", "66666666-6666-4666-8666-666666666666");
    formData.set("verification_status", "verified");
    formData.set("verification_note", "Checked certificate against applicant details.");

    expect(parseVerifyApplicationDocumentForm(formData)).toEqual({
      slot_id: "77777777-7777-4777-8777-777777777777",
      application_id: "66666666-6666-4666-8666-666666666666",
      verification_status: "verified",
      verification_note: "Checked certificate against applicant details."
    });

    formData.set("verification_status", "accepted");
    expect(() => parseVerifyApplicationDocumentForm(formData)).toThrow();
  });

  it("parses review readiness notes without creating an offer decision", () => {
    const formData = new FormData();
    formData.set("application_id", "66666666-6666-4666-8666-666666666666");
    formData.set("readiness_status", "ready_for_decision");
    formData.set("review_notes", "Academic review complete.");
    formData.set("decision_reason_notes", "Meets entry criteria.");

    expect(parseRecordStaffApplicationReviewForm(formData)).toEqual({
      application_id: "66666666-6666-4666-8666-666666666666",
      readiness_status: "ready_for_decision",
      review_notes: "Academic review complete.",
      decision_reason_notes: "Meets entry criteria."
    });
  });

  it("keeps application review admin-only and limited to submitted reviewable leads", () => {
    expect(
      canReviewSubmittedApplication(
        { role: "admin" },
        {
          applicationStatus: "submitted",
          leadStage: "submitted",
          archived: false,
          convertedStudentId: null
        }
      )
    ).toEqual({ allowed: true, reason: "allowed" });

    expect(
      canReviewSubmittedApplication(
        { role: "teacher" },
        {
          applicationStatus: "submitted",
          leadStage: "submitted",
          archived: false
        }
      ).reason
    ).toBe("staff_role_not_allowed");

    expect(
      canReviewSubmittedApplication(
        { role: "admin" },
        {
          applicationStatus: "draft",
          leadStage: "application_invited",
          archived: false
        }
      ).reason
    ).toBe("application_not_submitted");
  });

  it("builds redacted review and verification audit metadata", () => {
    expect(
      buildStaffApplicationReviewAuditMetadata({
        applicationId: "application-1",
        admissionLeadId: "lead-1",
        personId: "person-1",
        previousReadinessStatus: "not_ready",
        readinessStatus: "ready_for_decision",
        reviewNotes: "Detailed private review note",
        decisionReasonNotes: "Detailed private decision reason",
        requiredDocumentCount: 2,
        verifiedRequiredDocumentCount: 2
      })
    ).toEqual({
      admission_lead_id: "lead-1",
      person_id: "person-1",
      previous_readiness_status: "not_ready",
      readiness_status: "ready_for_decision",
      has_review_notes: true,
      has_decision_reason_notes: true,
      required_document_count: 2,
      verified_required_document_count: 2
    });

    expect(
      buildApplicationDocumentVerificationAuditMetadata({
        slotId: "slot-1",
        applicationId: "application-1",
        admissionLeadId: "lead-1",
        personId: "person-1",
        slotKey: "qualification_evidence",
        required: true,
        previousStatus: "unverified",
        verificationStatus: "rejected",
        managedFileId: "file-1",
        verificationNote: "Wrong document"
      })
    ).toMatchObject({
      slot_key: "qualification_evidence",
      required: true,
      previous_status: "unverified",
      verification_status: "rejected",
      managed_file_id: "file-1",
      has_note: true
    });

    expect(
      buildApplicationSupportNeedsViewedAuditMetadata({
        applicationId: "application-1",
        admissionLeadId: "lead-1",
        personId: "person-1",
        disclosed: true,
        supportDetail: "Restricted support detail",
        requestedAdjustments: null
      })
    ).toEqual({
      application_id: "application-1",
      admission_lead_id: "lead-1",
      person_id: "person-1",
      disclosed: true,
      has_support_detail: true,
      has_requested_adjustments: false
    });
  });

  it("adds review schema, verification/review RPCs, and audit events without offer or registration side effects", () => {
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/0025_staff_application_review.sql"), "utf8");

    expect(migration).toContain("create table public.application_reviews");
    expect(migration).toContain("application_review_readiness_status");
    expect(migration).toContain("create or replace function public.verify_application_document_slot");
    expect(migration).toContain("create or replace function public.record_staff_application_review");
    expect(migration).toContain("'document.verified'");
    expect(migration).toContain("'document.rejected'");
    expect(migration).toContain("'document.verification_reset'");
    expect(migration).toContain("'application.review_recorded'");
    expect(migration).toContain("v_staff.role <> 'admin'");
    expect(migration).toContain("v_application.status <> 'submitted'");
    expect(migration).toContain("v_lead.stage not in ('submitted', 'reviewed')");
    expect(migration).toContain("p_readiness_status = 'ready_for_decision'");
    expect(migration).not.toContain("create table public.offers");
    expect(migration).not.toContain("correspondence_templates");
    expect(migration).not.toContain("insert into public.enrolments");
    expect(migration).not.toContain("insert into public.finance_records");
    expect(migration).not.toContain("convert_admissions_registration");
    expect(applicationReviewRecordedAction).toBe("application.review_recorded");
    expect(applicationReviewEntityType).toBe("application");
    expect(applicationDocumentVerifiedAction).toBe("document.verified");
    expect(applicationDocumentRejectedAction).toBe("document.rejected");
    expect(applicationDocumentVerificationResetAction).toBe("document.verification_reset");
    expect(applicationSupportNeedsViewedAction).toBe("application_support_needs.viewed");
  });

  it("audits restricted support-needs views in the staff review page", () => {
    const page = readFileSync(join(process.cwd(), "src/app/admissions/reviews/page.tsx"), "utf8");

    expect(page).toContain("auditSupportNeedsViews");
    expect(page).toContain("applicationSupportNeedsViewedAction");
    expect(page).toContain("buildApplicationSupportNeedsViewedAuditMetadata");
    expect(page).toContain("await auditSupportNeedsViews(supabase, staffUserId, applicationRows, supportNeedsRows)");
    expect(page).toContain('throw new Error(`Failed to audit support-needs view: ${error.message}`)');
  });
});
