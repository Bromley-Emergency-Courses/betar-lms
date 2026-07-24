import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applicationDocumentSlotDefinitions,
  buildApplicationDocumentObjectPath,
  parseApplicationDocumentUploadForm,
  sanitizeApplicationDocumentFilename,
  validateApplicationDocumentUpload
} from "@/lib/application-documents";

function uploadFile(overrides: Partial<Pick<File, "name" | "size" | "type">> = {}): Pick<File, "name" | "size" | "type"> {
  return {
    name: "Certificate Scan.pdf",
    size: 512_000,
    type: "application/pdf",
    ...overrides
  };
}

describe("application document uploads", () => {
  it("defines required and optional applicant-owned slots", () => {
    expect(applicationDocumentSlotDefinitions.map((slot) => [slot.key, slot.required])).toEqual([
      ["qualification_evidence", true],
      ["professional_registration_evidence", true],
      ["cv_or_supporting_evidence", false],
      ["funding_evidence", false]
    ]);
  });

  it("parses upload form identifiers", () => {
    const formData = new FormData();
    formData.set("application_id", "66666666-6666-4666-8666-666666666666");
    formData.set("slot_key", "qualification_evidence");

    expect(parseApplicationDocumentUploadForm(formData)).toEqual({
      application_id: "66666666-6666-4666-8666-666666666666",
      slot_key: "qualification_evidence"
    });

    formData.set("slot_key", "unknown");
    expect(() => parseApplicationDocumentUploadForm(formData)).toThrow();
  });

  it("sanitizes filenames and validates MIME type, extension, and size", () => {
    expect(sanitizeApplicationDocumentFilename("../My Certificate 2026!.PDF")).toBe("my-certificate-2026.pdf");

    expect(validateApplicationDocumentUpload({ file: uploadFile(), slotKey: "qualification_evidence" })).toMatchObject({
      valid: true,
      sanitizedFilename: "certificate-scan.pdf",
      contentType: "application/pdf",
      extension: ".pdf"
    });

    expect(
      validateApplicationDocumentUpload({
        file: uploadFile({ name: "script.pdf", type: "application/x-msdownload" }),
        slotKey: "qualification_evidence"
      }).errors
    ).toContain("File type is not accepted for this slot.");

    expect(
      validateApplicationDocumentUpload({
        file: uploadFile({ name: "certificate.exe" }),
        slotKey: "qualification_evidence"
      }).errors
    ).toContain("File extension is not accepted for this slot.");

    expect(
      validateApplicationDocumentUpload({
        file: uploadFile({ size: 26 * 1024 * 1024 }),
        slotKey: "qualification_evidence"
      }).errors
    ).toContain("File must be 25 MB or smaller.");
  });

  it("builds object paths scoped to person, application, and slot", () => {
    expect(
      buildApplicationDocumentObjectPath(
        "person-1",
        "application-1",
        "qualification_evidence",
        "certificate.pdf",
        "token-1"
      )
    ).toBe("person-1/application-1/qualification_evidence/token-1-certificate.pdf");
  });

  it("adds application document slot schema, RPC, audit, and submit blocking without review or offer side effects", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/0024_application_document_upload_slots.sql"),
      "utf8"
    );

    expect(migration).toContain("create table public.application_document_slots");
    expect(migration).toContain("managed_file_id uuid references public.managed_files");
    expect(migration).toContain("create or replace function public.record_application_document_upload");
    expect(migration).toContain("'document.uploaded'");
    expect(migration).toContain("'application_document'");
    expect(migration).toContain("v_lead.stage <> 'application_invited'");
    expect(migration).toContain("v_application.status <> 'draft'");
    expect(migration).toContain("v_allowed_extensions text[]");
    expect(migration).toContain("Document extension is not accepted for this upload slot");
    expect(migration).toContain("from storage.objects storage_object");
    expect(migration).toContain("storage_object.bucket_id = v_bucket");
    expect(migration).toContain("storage_object.name = p_object_path");
    expect(migration).toContain("storage_object.metadata->>'mimetype'");
    expect(migration).toContain("Uploaded document object was not found in private storage");
    expect(migration).toContain("'document:' || required_slot.slot_key::text");
    expect(migration).toContain("'qualification_evidence'::public.application_document_slot_key");
    expect(migration).toContain("'professional_registration_evidence'::public.application_document_slot_key");
    expect(migration).toContain("required_document_slot_count");
    expect(migration).toContain("join storage.objects storage_object");
    expect(migration).toContain("managed_file.id = document_slot.managed_file_id");
    expect(migration).not.toContain("create table public.application_reviews");
    expect(migration).not.toContain("create table public.offers");
    expect(migration).not.toContain("insert into public.enrolments");
    expect(migration).not.toContain("insert into public.finance_records");
  });
});
