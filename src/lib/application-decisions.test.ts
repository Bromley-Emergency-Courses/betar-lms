import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applicationDecisionEntityType,
  applicationDecisionOfferIssuedAction,
  applicationDecisionRejectionRecordedAction,
  applicationOfferTemplateKey,
  applicationRejectionTemplateKey,
  buildApplicationDecisionAuditMetadata,
  canRecordApplicationDecision,
  parseRecordApplicationDecisionForm
} from "@/lib/application-decisions";

describe("application decisions", () => {
  it("parses staff offer and rejection decision forms", () => {
    const offerForm = new FormData();
    offerForm.set("application_id", "66666666-6666-4666-8666-666666666666");
    offerForm.set("decision_outcome", "offer");
    offerForm.set("decision_reason", "Meets entry criteria and documents are verified.");
    offerForm.set("offer_deadline_at", "2026-08-07");

    expect(parseRecordApplicationDecisionForm(offerForm)).toEqual({
      application_id: "66666666-6666-4666-8666-666666666666",
      decision_outcome: "offer",
      decision_reason: "Meets entry criteria and documents are verified.",
      offer_deadline_at: "2026-08-07T23:59:59+00:00"
    });

    const rejectionForm = new FormData();
    rejectionForm.set("application_id", "66666666-6666-4666-8666-666666666666");
    rejectionForm.set("decision_outcome", "rejection");
    rejectionForm.set("decision_reason", "Does not meet entry criteria for this intake.");

    expect(parseRecordApplicationDecisionForm(rejectionForm)).toMatchObject({
      decision_outcome: "rejection",
      offer_deadline_at: null
    });
    expect(() => {
      rejectionForm.set("decision_reason", "");
      parseRecordApplicationDecisionForm(rejectionForm);
    }).toThrow();
  });

  it("allows decisions only after review readiness and before a terminal lead stage", () => {
    expect(
      canRecordApplicationDecision({
        applicationStatus: "submitted",
        leadStage: "reviewed",
        archived: false,
        convertedStudentId: null,
        readinessStatus: "ready_for_decision"
      })
    ).toEqual({ allowed: true, reason: "allowed" });

    expect(
      canRecordApplicationDecision({
        applicationStatus: "submitted",
        leadStage: "submitted",
        archived: false,
        readinessStatus: "needs_information"
      }).reason
    ).toBe("review_not_ready");

    expect(
      canRecordApplicationDecision({
        applicationStatus: "submitted",
        leadStage: "offered",
        archived: false,
        readinessStatus: "ready_for_decision"
      }).reason
    ).toBe("lead_not_decisionable");

    expect(
      canRecordApplicationDecision({
        applicationStatus: "submitted",
        leadStage: "reviewed",
        archived: false,
        readinessStatus: "ready_for_decision",
        existingDecisionOutcome: "offer"
      }).reason
    ).toBe("decision_already_recorded");
  });

  it("builds redacted decision audit metadata without leaking reason text", () => {
    expect(
      buildApplicationDecisionAuditMetadata({
        decisionId: "decision-1",
        applicationId: "application-1",
        admissionLeadId: "lead-1",
        personId: "person-1",
        outcome: "offer",
        decisionReason: "Detailed private decision reason",
        offerId: "offer-1",
        correspondenceLogId: "log-1",
        deadlineAt: "2026-08-07T23:59:59+00:00",
        offeredModuleOfferingCount: 2
      })
    ).toEqual({
      application_id: "application-1",
      admission_lead_id: "lead-1",
      person_id: "person-1",
      outcome: "offer",
      has_decision_reason: true,
      offer_id: "offer-1",
      rejection_id: null,
      correspondence_log_id: "log-1",
      deadline_at: "2026-08-07T23:59:59+00:00",
      offered_module_offering_count: 2,
      production_email_send_enabled: false
    });
  });

  it("adds offer/rejection records, suppressed correspondence placeholders, and guarded staff RPC", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/0026_offer_rejection_decision_foundation.sql"),
      "utf8"
    );

    expect(migration).toContain("create table public.application_decisions");
    expect(migration).toContain("create table public.application_offers");
    expect(migration).toContain("create table public.application_rejections");
    expect(migration).toContain("create table public.application_offer_module_offerings");
    expect(migration).toContain("create or replace function public.record_application_decision");
    expect(migration).toContain("v_review.readiness_status <> 'ready_for_decision'");
    expect(migration).toContain("v_lead.stage not in ('submitted', 'reviewed')");
    expect(migration).toContain("Offer decisions require one or two module offering snapshots");
    expect(migration).toContain("'delivery_status',\n        'suppressed'");
    expect(migration).toContain("'production_email_send_enabled',\n        false");
    expect(migration).toContain(`'${applicationOfferTemplateKey}'`);
    expect(migration).toContain(`'${applicationRejectionTemplateKey}'`);
    expect(migration).toContain(`'${applicationDecisionOfferIssuedAction}'`);
    expect(migration).toContain(`'${applicationDecisionRejectionRecordedAction}'`);
    expect(migration).toContain("update public.admission_leads");
    expect(migration).not.toContain("portal users read own application decisions");
    expect(migration).not.toContain("portal users read own application rejections");
    expect(migration).not.toContain("last_contacted_on = current_date");
    expect(migration).not.toContain("insert into public.enrolments");
    expect(migration).not.toContain("insert into public.finance_records");
    expect(migration).not.toContain("convert_admissions_registration");
    expect(applicationDecisionEntityType).toBe("application_decision");
  });
});
