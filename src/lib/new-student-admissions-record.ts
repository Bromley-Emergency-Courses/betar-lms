import "server-only";

import { getAdmissionsEmailConfig, isPilotRecipientAllowlisted } from "@/lib/admissions-email";
import {
  mapAdmissionsEmailPilotTestRecord,
  type AdmissionsEmailPilotTestRecord
} from "@/lib/admissions-email-pilot";
import {
  mapStaffNewStudentAdmissionsOperation,
  type StaffNewStudentAdmissionsOperation
} from "@/lib/admissions-workspace";
import type { ApplicationDocumentSlotKey, ApplicationDocumentVerificationStatus } from "@/lib/application-documents";
import type {
  AdmissionsRegistrationDocumentSlotKey,
  AdmissionsRegistrationDocumentVerificationRoute
} from "@/lib/admissions-registration";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

export interface NewStudentAdmissionLeadRecord {
  id: string;
  personId?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  programme: "pgcert" | "microcredential";
  source?: string;
  lastContactedOn?: string;
  nextActionOn?: string;
  applicationInvitedAt?: string;
  applicationInvitationExpiresAt?: string;
  notes?: string;
  archived: boolean;
  convertedStudentId?: string;
  moduleInterestIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NewStudentApplicationRecord {
  id: string;
  status: "draft" | "submitted";
  submittedAt?: string;
  declarationAcceptedAt?: string;
  intendedStartTermId?: string;
  intendedStartTermName?: string;
  fields: Record<string, string | number | boolean | undefined>;
  selectedOfferings: Array<{
    id: string;
    choiceOrder: number;
    moduleCode: string;
    moduleTitle: string;
    termName: string;
    credits: number;
    mode: string;
    capacity: number;
    pricePence: number;
  }>;
  supportNeedsDisclosed: boolean;
  documentSlots: NewStudentDocumentSlot[];
  review?: {
    readinessStatus: "not_ready" | "needs_information" | "ready_for_decision";
    reviewNotes?: string;
    decisionReasonNotes?: string;
    lastReviewedAt?: string;
  };
  correctionRequests: NewStudentCorrectionRequest[];
  evidenceOverrides: Array<{
    id: string;
    slotId: string;
    reason: string;
    recordedAt: string;
    revokedAt?: string;
  }>;
  decision?: {
    id: string;
    outcome: "offer" | "rejection";
    reason?: string;
    decidedAt?: string;
  };
  offer?: {
    id: string;
    reference: string;
    status: string;
    issuedAt?: string;
    deadlineAt?: string;
    acceptedAt?: string;
    declinedAt?: string;
    lapsedAt?: string;
    withdrawnAt?: string;
    withdrawalReason?: string;
    reminderCount: number;
    reissueCount: number;
    lastReissuedAt?: string;
    reissues: Array<{
      id: string;
      previousDeadlineAt: string;
      previousLapsedAt: string;
      newDeadlineAt: string;
      reason: string;
      reissuedAt: string;
    }>;
  };
  registration?: {
    id: string;
    status: string;
    deadlineAt?: string;
    savedAt?: string;
    submittedAt?: string;
    lapsedAt?: string;
    lapsedReason?: string;
    reopenedAt?: string;
    reopenedReason?: string;
    termsVersion?: string;
    termsAcceptedAt?: string;
    moduleConfirmationAccepted: boolean;
    requiredDocumentCount: number;
    uploadedRequiredDocumentCount: number;
    documentSlots: Array<{
      id: string;
      slotKey: AdmissionsRegistrationDocumentSlotKey;
      label: string;
      required: boolean;
      managedFileId?: string;
      filename?: string;
      sizeBytes?: number;
      uploadedAt?: string;
      verificationRoute: AdmissionsRegistrationDocumentVerificationRoute;
      verificationStatus: ApplicationDocumentVerificationStatus;
      verificationAt?: string;
      verificationNote?: string;
    }>;
    studentId?: string;
    convertedAt?: string;
  };
}

export interface NewStudentDocumentSlot {
  id: string;
  slotKey: ApplicationDocumentSlotKey;
  label: string;
  required: boolean;
  managedFileId?: string;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  uploadedAt?: string;
  verificationStatus: ApplicationDocumentVerificationStatus;
  verificationAt?: string;
  verificationNote?: string;
  previousVersionCount: number;
}

export interface NewStudentCorrectionRequest {
  id: string;
  versionNumber: number;
  revisionNumber: number;
  status: "open" | "resubmitted" | "resolved" | "cancelled";
  summary?: string;
  dueAt: string;
  requestedAt: string;
  lastResubmittedAt?: string;
  resolvedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  items: Array<{
    id: string;
    targetType: "application_field" | "document_slot";
    targetKey: string;
    instructions: string;
    status: "open" | "resubmitted" | "accepted";
    baselineValue?: unknown;
    proposedValue?: unknown;
    replacementManagedFileId?: string;
    replacementFilename?: string;
    replacementContentType?: string;
    replacementSizeBytes?: number;
    applicantResponseNote?: string;
    staffReviewNote?: string;
    submittedVersions: Array<{
      revisionNumber: number;
      staffOutcome?: "accepted" | "revise";
      staffReviewNote?: string;
      submittedAt: string;
      reviewedAt?: string;
    }>;
  }>;
}

export interface NewStudentAdmissionRecord {
  referenceTime: string;
  operation: StaffNewStudentAdmissionsOperation;
  lead: NewStudentAdmissionLeadRecord;
  application?: NewStudentApplicationRecord;
  abandonmentPeriods: Array<{
    id: string;
    previousLeadStage: string;
    reason: string;
    abandonedAt: string;
    reopenReason?: string;
    reopenedAt?: string;
  }>;
  history: Array<{ id: string; action: string; entityType: string; createdAt: string }>;
  correspondence: Array<{
    id: string;
    templateKey: string;
    recipientEmail: string;
    deliveryStatus: string;
    subject: string;
    sentAt?: string;
    createdAt: string;
  }>;
  pilotTestRecord?: AdmissionsEmailPilotTestRecord;
  email: {
    enabled: boolean;
    mode: string;
    missing: string[];
    recipientAllowlisted: boolean;
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function demoRecord(admissionId: string): NewStudentAdmissionRecord {
  const now = new Date().toISOString();
  const applicationId = "66666666-6666-4666-8666-666666666666";
  return {
    referenceTime: now,
    operation: {
      admissionLeadId: admissionId,
      personId: "22222222-2222-4222-8222-222222222222",
      firstName: "Amara",
      lastName: "Lewis",
      email: "amara.lewis@example.nhs.uk",
      phone: "07700 900200",
      programme: "pgcert",
      sourceLeadStage: "submitted",
      journeyStage: "review",
      applicationId,
      applicationStatus: "submitted",
      reviewReadinessStatus: "needs_information",
      hasDataInconsistency: false,
      attentionIndicators: ["needs_information"],
      primaryNextAction: "resolve_information_request",
      lastActivityAt: now,
      createdAt: now,
      applicantName: "Amara Lewis",
      hasOpenEmailDuplicate: false,
      applicationTargetTermId: "term-demo",
      applicationTargetTermName: "Autumn 2026",
      applicationDeadlineAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      applicationDeadlineState: "submitted",
      applicationReminderEligible: false,
      needsStaffAttention: true,
      isReadyToProgress: false,
      isAwaitingApplicant: false,
      leadingAttentionIndicator: "needs_information"
    },
    lead: {
      id: admissionId,
      personId: "22222222-2222-4222-8222-222222222222",
      firstName: "Amara",
      lastName: "Lewis",
      email: "amara.lewis@example.nhs.uk",
      phone: "07700 900200",
      programme: "pgcert",
      source: "Website enquiry",
      moduleInterestIds: [],
      archived: false,
      applicationInvitedAt: now,
      notes: "Demo admissions record for the feature-flagged workspace.",
      createdAt: now,
      updatedAt: now
    },
    application: {
      id: applicationId,
      status: "submitted",
      submittedAt: now,
      declarationAcceptedAt: now,
      intendedStartTermId: "term-demo",
      intendedStartTermName: "Autumn 2026",
      fields: {
        title: "Dr",
        first_name: "Amara",
        last_name: "Lewis",
        date_of_birth: "1990-04-12",
        email: "amara.lewis@example.nhs.uk",
        phone: "07700 900200",
        clinical_role: "Emergency medicine registrar",
        employer: "Example NHS Trust",
        professional_registration_body: "GMC",
        professional_registration_number: "7654321",
        highest_qualification: "MBBS",
        qualification_awarding_body: "Example University",
        qualification_year: 2015,
        funding_source: "employer_sponsor",
        pocus_motivation: "Structured training and supervised practice."
      },
      selectedOfferings: [{
        id: "55555555-5555-4555-8555-555555555555",
        choiceOrder: 1,
        moduleCode: "POCUS-01",
        moduleTitle: "Core Point-of-Care Ultrasound",
        termName: "Autumn 2026",
        credits: 20,
        mode: "blended",
        capacity: 24,
        pricePence: 125000
      }],
      supportNeedsDisclosed: true,
      documentSlots: [{
        id: "77777777-7777-4777-8777-777777777777",
        slotKey: "qualification_evidence",
        label: "Qualification certificate or transcript",
        required: true,
        managedFileId: "88888888-8888-4888-8888-888888888888",
        filename: "qualification-certificate.pdf",
        contentType: "application/pdf",
        sizeBytes: 512000,
        uploadedAt: now,
        verificationStatus: "unverified",
        previousVersionCount: 0
      }],
      review: { readinessStatus: "needs_information", lastReviewedAt: now },
      correctionRequests: [],
      evidenceOverrides: []
    },
    abandonmentPeriods: [],
    history: [{ id: "99999999-9999-4999-8999-999999999999", action: "application.submitted", entityType: "application", createdAt: now }],
    correspondence: [],
    email: { enabled: false, mode: "disabled", missing: [], recipientAllowlisted: false }
  };
}

const applicationFieldNames = [
  "title", "first_name", "middle_names", "last_name", "preferred_name", "previous_surname", "date_of_birth",
  "previous_study_detail", "partner_student_id", "email", "phone", "address_line_1", "address_line_2", "city",
  "postcode", "country", "clinical_role", "employer", "department_specialty", "professional_registration_body",
  "professional_registration_number", "highest_qualification", "qualification_awarding_body", "qualification_year",
  "qualification_result", "qualification_country", "work_experience", "nationality", "country_of_birth",
  "country_of_residence", "needs_visa_check", "visa_notes", "funding_source", "funding_organisation", "funding_contact",
  "pocus_previous_experience", "pocus_motivation", "pocus_case_improved_management", "pocus_limitations_case", "evidence_summary"
] as const;

export async function getNewStudentAdmissionRecord(admissionId: string): Promise<NewStudentAdmissionRecord | null> {
  if (!isSupabaseConfigured()) return demoRecord(admissionId);

  const supabase = await createSupabaseServerClient();
  const [operationResult, leadResult, abandonmentResult, pilotRecordResult] = await Promise.all([
    supabase.from("staff_new_student_admissions_operations").select("*").eq("admission_lead_id", admissionId).maybeSingle(),
    supabase.from("admission_leads").select("*").eq("id", admissionId).maybeSingle(),
    supabase.from("admission_abandonment_periods").select("id, previous_lead_stage, abandonment_reason, abandoned_at, reopen_reason, reopened_at").eq("admission_lead_id", admissionId).order("abandoned_at", { ascending: false }),
    supabase.from("admissions_email_test_records").select("id, record_type, label, reason, active, marked_at, unmarked_at, unmark_reason").eq("admission_lead_id", admissionId).maybeSingle()
  ]);
  if (operationResult.error) throw new Error(operationResult.error.message);
  if (leadResult.error) throw new Error(leadResult.error.message);
  if (abandonmentResult.error) throw new Error(abandonmentResult.error.message);
  if (pilotRecordResult.error) throw new Error(pilotRecordResult.error.message);
  if (!operationResult.data || !leadResult.data) return null;

  const operation = mapStaffNewStudentAdmissionsOperation(operationResult.data);
  const leadRow = asRecord(leadResult.data);
  const lead: NewStudentAdmissionLeadRecord = {
    id: String(leadRow.id),
    personId: optionalString(leadRow.person_id),
    firstName: String(leadRow.first_name),
    lastName: String(leadRow.last_name),
    email: String(leadRow.email),
    phone: optionalString(leadRow.phone),
    programme: leadRow.programme === "microcredential" ? "microcredential" : "pgcert",
    source: optionalString(leadRow.source),
    lastContactedOn: optionalString(leadRow.last_contacted_on),
    nextActionOn: optionalString(leadRow.next_action_on),
    applicationInvitedAt: optionalString(leadRow.application_invited_at),
    applicationInvitationExpiresAt: optionalString(leadRow.application_invitation_expires_at),
    notes: optionalString(leadRow.notes),
    archived: Boolean(leadRow.archived),
    convertedStudentId: optionalString(leadRow.converted_student_id),
    moduleInterestIds: Array.isArray(leadRow.module_interest_ids) ? leadRow.module_interest_ids.map(String) : [],
    createdAt: String(leadRow.created_at),
    updatedAt: String(leadRow.updated_at)
  };
  const abandonmentPeriods = (abandonmentResult.data ?? []).map((row) => ({
    id: String(row.id),
    previousLeadStage: String(row.previous_lead_stage),
    reason: String(row.abandonment_reason),
    abandonedAt: String(row.abandoned_at),
    reopenReason: optionalString(row.reopen_reason),
    reopenedAt: optionalString(row.reopened_at)
  }));

  let application: NewStudentApplicationRecord | undefined;
  const entityIds = new Set<string>([lead.id]);
  abandonmentPeriods.forEach((period) => entityIds.add(period.id));
  if (operation.applicationId) {
    const applicationResult = await supabase.from("applications").select("*").eq("id", operation.applicationId).eq("admission_lead_id", lead.id).maybeSingle();
    if (applicationResult.error) throw new Error(applicationResult.error.message);
    if (applicationResult.data) {
      const appRow = asRecord(applicationResult.data);
      entityIds.add(String(appRow.id));
      const [choiceResult, supportResult, slotResult, reviewResult, correctionResult, overrideResult, decisionResult, offerResult, registrationResult] = await Promise.all([
        supabase.from("application_module_offering_choices").select("application_id, offering_id, choice_order").eq("application_id", appRow.id).order("choice_order"),
        supabase.from("application_support_needs").select("disclosed").eq("application_id", appRow.id).maybeSingle(),
        supabase.from("application_document_slots").select("*").eq("application_id", appRow.id).order("required", { ascending: false }),
        supabase.from("application_reviews").select("*").eq("application_id", appRow.id).maybeSingle(),
        supabase.from("application_correction_requests").select("*").eq("application_id", appRow.id).order("version_number", { ascending: false }),
        supabase.from("application_evidence_overrides").select("id, slot_id, reason, recorded_at, revoked_at").eq("application_id", appRow.id).order("recorded_at", { ascending: false }),
        supabase.from("application_decisions").select("*").eq("application_id", appRow.id).order("decided_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("application_offers").select("*").eq("application_id", appRow.id).order("issued_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("admissions_registrations").select("*").eq("application_id", appRow.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
      ]);
      const results = [choiceResult, supportResult, slotResult, reviewResult, correctionResult, overrideResult, decisionResult, offerResult, registrationResult];
      const failed = results.find((result) => result.error);
      if (failed?.error) throw new Error(failed.error.message);

      const choiceRows = (choiceResult.data ?? []).map(asRecord);
      const offeringIds = choiceRows.map((row) => String(row.offering_id));
      const offeringResult = offeringIds.length > 0
        ? await supabase.from("module_offerings").select("id, module_id, term_id, price_pence, capacity").in("id", offeringIds)
        : { data: [], error: null };
      if (offeringResult.error) throw new Error(offeringResult.error.message);
      const offeringRows = (offeringResult.data ?? []).map(asRecord);
      const moduleIds = offeringRows.map((row) => String(row.module_id));
      const termIds = [...new Set([
        ...offeringRows.map((row) => String(row.term_id)),
        ...(optionalString(appRow.intended_start_term_id) ? [String(appRow.intended_start_term_id)] : [])
      ])];
      const [moduleResult, termResult] = await Promise.all([
        moduleIds.length > 0 ? supabase.from("course_modules").select("id, code, title, credits, mode").in("id", moduleIds) : Promise.resolve({ data: [], error: null }),
        termIds.length > 0 ? supabase.from("terms").select("id, name").in("id", termIds) : Promise.resolve({ data: [], error: null })
      ]);
      if (moduleResult.error) throw new Error(moduleResult.error.message);
      if (termResult.error) throw new Error(termResult.error.message);
      const moduleById = new Map((moduleResult.data ?? []).map((row) => [String(row.id), asRecord(row)]));
      const termById = new Map((termResult.data ?? []).map((row) => [String(row.id), asRecord(row)]));
      const offeringById = new Map(offeringRows.map((row) => [String(row.id), row]));

      const slotRows = (slotResult.data ?? []).map(asRecord);
      const slotIds = slotRows.map((row) => String(row.id));
      const slotVersionResult = slotIds.length > 0
        ? await supabase.from("application_document_slot_versions").select("slot_id").in("slot_id", slotIds)
        : { data: [], error: null };
      if (slotVersionResult.error) throw new Error(slotVersionResult.error.message);
      const versionCounts = new Map<string, number>();
      for (const row of slotVersionResult.data ?? []) {
        const slotId = String(row.slot_id);
        versionCounts.set(slotId, (versionCounts.get(slotId) ?? 0) + 1);
      }

      const correctionRows = (correctionResult.data ?? []).map(asRecord);
      const correctionIds = correctionRows.map((row) => String(row.id));
      correctionIds.forEach((id) => entityIds.add(id));
      const [itemResult, itemVersionResult] = correctionIds.length > 0
        ? await Promise.all([
            supabase.from("application_correction_items").select("*").in("request_id", correctionIds).order("created_at"),
            supabase.from("application_correction_item_versions").select("*").in("request_id", correctionIds).order("revision_number")
          ])
        : [{ data: [], error: null }, { data: [], error: null }];
      if (itemResult.error) throw new Error(itemResult.error.message);
      if (itemVersionResult.error) throw new Error(itemVersionResult.error.message);
      const itemRows = (itemResult.data ?? []).map(asRecord);
      const itemVersions = (itemVersionResult.data ?? []).map(asRecord);
      const replacementFileIds = itemRows
        .map((item) => optionalString(item.replacement_managed_file_id))
        .filter((id): id is string => Boolean(id));
      const replacementFileResult = replacementFileIds.length > 0
        ? await supabase
            .from("managed_files")
            .select("id, original_filename, sanitized_filename, content_type, size_bytes")
            .in("id", replacementFileIds)
        : { data: [], error: null };
      if (replacementFileResult.error) throw new Error(replacementFileResult.error.message);
      const replacementFileById = new Map(
        (replacementFileResult.data ?? []).map((file) => [String(file.id), asRecord(file)])
      );

      const decisionRow = decisionResult.data ? asRecord(decisionResult.data) : undefined;
      const offerRow = offerResult.data ? asRecord(offerResult.data) : undefined;
      const registrationRow = registrationResult.data ? asRecord(registrationResult.data) : undefined;
      if (decisionRow) entityIds.add(String(decisionRow.id));
      if (offerRow) entityIds.add(String(offerRow.id));
      if (registrationRow) entityIds.add(String(registrationRow.id));

      const [offerReissueResult, offerWithdrawalResult] = offerRow
        ? await Promise.all([
            supabase.from("application_offer_reissues").select("id, previous_deadline_at, previous_lapsed_at, new_deadline_at, reason, reissued_at").eq("offer_id", offerRow.id).order("reissued_at", { ascending: false }),
            supabase.from("application_offer_withdrawals").select("id").eq("offer_id", offerRow.id).maybeSingle()
          ])
        : [{ data: [], error: null }, { data: null, error: null }];
      if (offerReissueResult.error) throw new Error(offerReissueResult.error.message);
      if (offerWithdrawalResult.error) throw new Error(offerWithdrawalResult.error.message);
      const offerReissues = (offerReissueResult.data ?? []).map((row) => ({
        id: String(row.id),
        previousDeadlineAt: String(row.previous_deadline_at),
        previousLapsedAt: String(row.previous_lapsed_at),
        newDeadlineAt: String(row.new_deadline_at),
        reason: String(row.reason),
        reissuedAt: String(row.reissued_at)
      }));
      offerReissues.forEach((reissue) => entityIds.add(reissue.id));
      if (offerWithdrawalResult.data) entityIds.add(String(offerWithdrawalResult.data.id));

      let requiredDocumentCount = 0;
      let uploadedRequiredDocumentCount = 0;
      let registrationDocumentSlots: NonNullable<NewStudentApplicationRecord["registration"]>["documentSlots"] = [];
      if (registrationRow) {
        const registrationSlotResult = await supabase
          .from("admissions_registration_document_slots")
          .select("id, slot_key, label, required, managed_file_id, original_filename, sanitized_filename, size_bytes, uploaded_at, verification_route, verification_status, verification_at, verification_note")
          .eq("registration_id", registrationRow.id)
          .order("required", { ascending: false });
        if (registrationSlotResult.error) throw new Error(registrationSlotResult.error.message);
        const requiredSlots = (registrationSlotResult.data ?? []).filter((row) => row.required);
        requiredDocumentCount = requiredSlots.length;
        uploadedRequiredDocumentCount = requiredSlots.filter(
          (row) =>
            (row.managed_file_id && row.verification_status !== "rejected") ||
            row.verification_route === "in_person"
        ).length;
        registrationDocumentSlots = (registrationSlotResult.data ?? []).map((row) => ({
          id: String(row.id),
          slotKey: String(row.slot_key) as AdmissionsRegistrationDocumentSlotKey,
          label: String(row.label),
          required: Boolean(row.required),
          managedFileId: optionalString(row.managed_file_id),
          filename: optionalString(row.original_filename) ?? optionalString(row.sanitized_filename),
          sizeBytes: row.size_bytes == null ? undefined : numberValue(row.size_bytes),
          uploadedAt: optionalString(row.uploaded_at),
          verificationRoute: row.verification_route === "in_person" ? "in_person" : "upload",
          verificationStatus: String(row.verification_status) as ApplicationDocumentVerificationStatus,
          verificationAt: optionalString(row.verification_at),
          verificationNote: optionalString(row.verification_note)
        }));
        registrationDocumentSlots.forEach((slot) => entityIds.add(slot.id));
      }

      const fields = Object.fromEntries(applicationFieldNames.map((key) => [key, appRow[key] as string | number | boolean | undefined]));
      const intendedTerm = termById.get(String(appRow.intended_start_term_id));
      application = {
        id: String(appRow.id),
        status: appRow.status === "submitted" ? "submitted" : "draft",
        submittedAt: optionalString(appRow.submitted_at),
        declarationAcceptedAt: optionalString(appRow.declaration_accepted_at),
        intendedStartTermId: optionalString(appRow.intended_start_term_id),
        intendedStartTermName: intendedTerm ? String(intendedTerm.name) : undefined,
        fields,
        selectedOfferings: choiceRows.map((choice) => {
          const offering = offeringById.get(String(choice.offering_id)) ?? {};
          const courseModule = moduleById.get(String(offering.module_id)) ?? {};
          const term = termById.get(String(offering.term_id)) ?? {};
          return {
            id: String(choice.offering_id),
            choiceOrder: numberValue(choice.choice_order),
            moduleCode: String(courseModule.code ?? "Unknown"),
            moduleTitle: String(courseModule.title ?? "Unknown module"),
            termName: String(term.name ?? "Unknown term"),
            credits: numberValue(courseModule.credits),
            mode: String(courseModule.mode ?? "Not recorded"),
            capacity: numberValue(offering.capacity),
            pricePence: numberValue(offering.price_pence)
          };
        }),
        supportNeedsDisclosed: Boolean(supportResult.data?.disclosed),
        documentSlots: slotRows.map((slot) => ({
          id: String(slot.id),
          slotKey: String(slot.slot_key) as ApplicationDocumentSlotKey,
          label: String(slot.label),
          required: Boolean(slot.required),
          managedFileId: optionalString(slot.managed_file_id),
          filename: optionalString(slot.original_filename) ?? optionalString(slot.sanitized_filename),
          contentType: optionalString(slot.content_type),
          sizeBytes: slot.size_bytes == null ? undefined : numberValue(slot.size_bytes),
          uploadedAt: optionalString(slot.uploaded_at),
          verificationStatus: String(slot.verification_status) as ApplicationDocumentVerificationStatus,
          verificationAt: optionalString(slot.verification_at),
          verificationNote: optionalString(slot.verification_note),
          previousVersionCount: versionCounts.get(String(slot.id)) ?? 0
        })),
        review: reviewResult.data ? {
          readinessStatus: String(reviewResult.data.readiness_status) as "not_ready" | "needs_information" | "ready_for_decision",
          reviewNotes: optionalString(reviewResult.data.review_notes),
          decisionReasonNotes: optionalString(reviewResult.data.decision_reason_notes),
          lastReviewedAt: optionalString(reviewResult.data.last_reviewed_at)
        } : undefined,
        correctionRequests: correctionRows.map((request) => ({
          id: String(request.id),
          versionNumber: numberValue(request.version_number),
          revisionNumber: numberValue(request.revision_number),
          status: String(request.status) as NewStudentCorrectionRequest["status"],
          summary: optionalString(request.summary),
          dueAt: String(request.due_at),
          requestedAt: String(request.requested_at),
          lastResubmittedAt: optionalString(request.last_resubmitted_at),
          resolvedAt: optionalString(request.resolved_at),
          cancelledAt: optionalString(request.cancelled_at),
          cancellationReason: optionalString(request.cancellation_reason),
          items: itemRows.filter((item) => item.request_id === request.id).map((item) => {
            const replacementManagedFileId = optionalString(item.replacement_managed_file_id);
            const replacementFile = replacementManagedFileId ? replacementFileById.get(replacementManagedFileId) : undefined;
            return {
              id: String(item.id),
              targetType: String(item.target_type) as "application_field" | "document_slot",
              targetKey: String(item.target_key),
              instructions: String(item.instructions),
              status: String(item.status) as "open" | "resubmitted" | "accepted",
              baselineValue: item.baseline_value,
              proposedValue: item.proposed_value,
              replacementManagedFileId,
              replacementFilename: replacementFile
                ? optionalString(replacementFile.original_filename) ?? optionalString(replacementFile.sanitized_filename)
                : undefined,
              replacementContentType: replacementFile ? optionalString(replacementFile.content_type) : undefined,
              replacementSizeBytes: replacementFile?.size_bytes == null ? undefined : numberValue(replacementFile.size_bytes),
              applicantResponseNote: optionalString(item.applicant_response_note),
              staffReviewNote: optionalString(item.staff_review_note),
              submittedVersions: itemVersions.filter((version) => version.item_id === item.id).map((version) => ({
                revisionNumber: numberValue(version.revision_number),
                staffOutcome: optionalString(version.staff_outcome) as "accepted" | "revise" | undefined,
                staffReviewNote: optionalString(version.staff_review_note),
                submittedAt: String(version.submitted_at),
                reviewedAt: optionalString(version.reviewed_at)
              }))
            };
          })
        })),
        evidenceOverrides: (overrideResult.data ?? []).map((row) => ({
          id: String(row.id), slotId: String(row.slot_id), reason: String(row.reason), recordedAt: String(row.recorded_at), revokedAt: optionalString(row.revoked_at)
        })),
        decision: decisionRow ? {
          id: String(decisionRow.id), outcome: String(decisionRow.outcome) as "offer" | "rejection", reason: optionalString(decisionRow.decision_reason), decidedAt: optionalString(decisionRow.decided_at)
        } : undefined,
        offer: offerRow ? {
          id: String(offerRow.id), reference: String(offerRow.offer_reference), status: String(offerRow.status), issuedAt: optionalString(offerRow.issued_at), deadlineAt: optionalString(offerRow.deadline_at), acceptedAt: optionalString(offerRow.accepted_at), declinedAt: optionalString(offerRow.declined_at), lapsedAt: optionalString(offerRow.lapsed_at), withdrawnAt: optionalString(offerRow.withdrawn_at), withdrawalReason: optionalString(offerRow.withdrawal_reason), reminderCount: numberValue(offerRow.deadline_reminder_count), reissueCount: numberValue(offerRow.reissue_count), lastReissuedAt: optionalString(offerRow.last_reissued_at), reissues: offerReissues
        } : undefined,
        registration: registrationRow ? {
          id: String(registrationRow.id), status: String(registrationRow.status), deadlineAt: optionalString(registrationRow.registration_deadline_at), savedAt: optionalString(registrationRow.saved_at), submittedAt: optionalString(registrationRow.submitted_at), lapsedAt: optionalString(registrationRow.lapsed_at), lapsedReason: optionalString(registrationRow.lapsed_reason), reopenedAt: optionalString(registrationRow.reopened_at), reopenedReason: optionalString(registrationRow.reopened_reason), termsVersion: optionalString(registrationRow.terms_version), termsAcceptedAt: optionalString(registrationRow.terms_accepted_at), moduleConfirmationAccepted: Boolean(registrationRow.module_confirmation_accepted), requiredDocumentCount, uploadedRequiredDocumentCount, documentSlots: registrationDocumentSlots, studentId: optionalString(registrationRow.student_id), convertedAt: optionalString(registrationRow.converted_at)
        } : undefined
      };
    }
  }

  const ids = [...entityIds];
  const [historyResult, correspondenceResult] = await Promise.all([
    supabase.from("audit_events").select("id, action, entity_type, created_at").in("entity_id", ids).order("created_at", { ascending: false }).limit(60),
    lead.personId
      ? supabase.from("correspondence_logs").select("id, template_key, recipient_email, delivery_status, rendered_subject, sent_at, created_at").eq("person_id", lead.personId).in("related_entity_id", ids).order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (historyResult.error) throw new Error(historyResult.error.message);
  if (correspondenceResult.error) throw new Error(correspondenceResult.error.message);
  const email = getAdmissionsEmailConfig();

  return {
    referenceTime: new Date().toISOString(),
    operation,
    lead,
    application,
    abandonmentPeriods,
    pilotTestRecord: pilotRecordResult.data ? mapAdmissionsEmailPilotTestRecord(asRecord(pilotRecordResult.data)) : undefined,
    history: (historyResult.data ?? []).map((row) => ({ id: String(row.id), action: String(row.action), entityType: String(row.entity_type), createdAt: String(row.created_at) })),
    correspondence: (correspondenceResult.data ?? []).map((row) => ({ id: String(row.id), templateKey: String(row.template_key), recipientEmail: String(row.recipient_email), deliveryStatus: String(row.delivery_status), subject: String(row.rendered_subject), sentAt: optionalString(row.sent_at), createdAt: String(row.created_at) })),
    email: {
      enabled: email.enabled,
      mode: email.mode,
      missing: email.missing,
      recipientAllowlisted: isPilotRecipientAllowlisted(lead.email, email.pilotAllowlist)
    }
  };
}
