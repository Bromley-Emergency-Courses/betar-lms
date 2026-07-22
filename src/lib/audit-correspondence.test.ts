import { describe, expect, it } from "vitest";
import {
  buildAuditEventInsert,
  buildCorrespondenceLogInsert,
  isSensitiveAuditMetadataKey,
  redactAuditMetadata
} from "@/lib/audit-correspondence";

describe("audit metadata redaction", () => {
  it("detects common sensitive metadata keys", () => {
    expect(isSensitiveAuditMetadataKey("passport_number")).toBe(true);
    expect(isSensitiveAuditMetadataKey("dateOfBirth")).toBe(true);
    expect(isSensitiveAuditMetadataKey("uploadedDocumentId")).toBe(false);
  });

  it("redacts sensitive nested values while preserving structural metadata", () => {
    expect(
      redactAuditMetadata({
        previous_stage: "submitted",
        next_stage: "offer_issued",
        applicant: {
          passportNumber: "123456789",
          qualification_document_id: "file-123"
        },
        documents: [{ id: "file-1", medical_note: "details" }]
      })
    ).toEqual({
      previous_stage: "submitted",
      next_stage: "offer_issued",
      applicant: {
        passportNumber: "[redacted]",
        qualification_document_id: "file-123"
      },
      documents: [{ id: "file-1", medical_note: "[redacted]" }]
    });
  });

  it("builds audit insert payloads with redacted metadata defaults", () => {
    expect(
      buildAuditEventInsert({
        actor_type: "applicant",
        actor_user_id: "auth-user-1",
        actor_person_id: "person-1",
        action: "application.submitted",
        entity_type: "application",
        entity_id: "application-1",
        metadata: {
          module_count: 2,
          session_token: "token"
        }
      })
    ).toEqual({
      actor_type: "applicant",
      actor_user_id: "auth-user-1",
      actor_person_id: "person-1",
      action: "application.submitted",
      entity_type: "application",
      entity_id: "application-1",
      reason: null,
      metadata: {
        module_count: 2,
        session_token: "[redacted]"
      }
    });
  });
});

describe("correspondence log inserts", () => {
  it("defaults delivery and bounce state before provider callbacks arrive", () => {
    expect(
      buildCorrespondenceLogInsert({
        person_id: "person-1",
        template_key: "offer_issued",
        template_version: 1,
        channel: "email",
        rendered_subject: "Your BETAR offer"
      })
    ).toEqual({
      person_id: "person-1",
      related_entity_type: null,
      related_entity_id: null,
      template_id: null,
      template_key: "offer_issued",
      template_version: 1,
      channel: "email",
      rendered_subject: "Your BETAR offer",
      provider_message_id: null,
      delivery_status: "queued",
      bounce_status: "none",
      sent_at: null,
      generated_file_id: null,
      metadata: {},
      created_by_user_id: null
    });
  });
});
