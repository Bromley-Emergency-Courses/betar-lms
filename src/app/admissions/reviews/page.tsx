import { BadgeCheck, ClipboardCheck, Clock, FileCheck2, GraduationCap, LockKeyhole, MailWarning, ShieldAlert, XCircle } from "lucide-react";
import Link from "next/link";
import {
  convertSubmittedAdmissionsRegistration,
  processAdmissionsRegistrationDeadlineWorkflow,
  processApplicationOfferDeadlineWorkflow,
  recordApplicationDecision,
  recordStaffApplicationReview,
  reopenLapsedAdmissionsRegistration,
  verifyApplicationDocument
} from "@/app/admissions/reviews/actions";
import { DocumentOpenButton } from "@/app/admissions/reviews/document-open-button";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { Field, FormGrid } from "@/components/forms";
import { StatusPill } from "@/components/status-pill";
import {
  canRecordApplicationDecision,
  type ApplicationDecisionOutcome
} from "@/lib/application-decisions";
import type { ApplicationOfferStatus } from "@/lib/application-offers";
import {
  applicationSupportNeedsViewedAction,
  buildApplicationSupportNeedsViewedAuditMetadata,
  applicationReviewReadinessStatuses,
  type ApplicationReviewReadinessStatus
} from "@/lib/application-review";
import { canConvertSubmittedRegistration } from "@/lib/admissions-conversion";
import { canReopenLapsedRegistration } from "@/lib/admissions-registration";
import type {
  ApplicationDocumentSlotKey,
  ApplicationDocumentVerificationStatus
} from "@/lib/application-documents";
import { requirePermission } from "@/lib/auth";
import { getLmsData } from "@/lib/lms-data";
import { getAppData } from "@/lib/seed";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";
import type { AppData } from "@/lib/types";

export const dynamic = "force-dynamic";

type FundingSource = "self_funded" | "employer_sponsor" | "nhs_trust" | "other" | "unknown";

interface StaffReviewApplication {
  id: string;
  admissionLeadId: string;
  personId: string;
  status: "submitted";
  leadStage: string;
  leadConvertedStudentId?: string;
  programme: "pgcert" | "microcredential";
  submittedAt?: string;
  declarationAcceptedAt?: string;
  title?: string;
  firstName?: string;
  middleNames?: string;
  lastName?: string;
  preferredName?: string;
  previousSurname?: string;
  dateOfBirth?: string;
  previousStudyDetail?: string;
  partnerStudentId?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postcode?: string;
  country?: string;
  clinicalRole?: string;
  employer?: string;
  departmentSpecialty?: string;
  professionalRegistrationBody?: string;
  professionalRegistrationNumber?: string;
  highestQualification?: string;
  qualificationAwardingBody?: string;
  qualificationYear?: number;
  qualificationResult?: string;
  qualificationCountry?: string;
  workExperience?: string;
  nationality?: string;
  countryOfBirth?: string;
  countryOfResidence?: string;
  needsVisaCheck: boolean;
  visaNotes?: string;
  fundingSource: FundingSource;
  fundingOrganisation?: string;
  fundingContact?: string;
  intendedStartTermId?: string;
  pocusPreviousExperience?: string;
  pocusMotivation?: string;
  pocusCaseImprovedManagement?: string;
  pocusLimitationsCase?: string;
  evidenceSummary?: string;
  supportNeeds?: ApplicationSupportNeedsSummary;
  selectedOfferings: SelectedOfferingSummary[];
  documentSlots: ApplicationDocumentSlotSummary[];
  review?: ApplicationReviewSummary;
  decision?: ApplicationDecisionSummary;
  offer?: ApplicationOfferSummary;
  registration?: RegistrationStatusSummary;
}

interface SelectedOfferingSummary {
  offeringId: string;
  choiceOrder: number;
  moduleCode: string;
  moduleTitle: string;
  termName: string;
  mode: string;
  capacity: number;
}

interface ApplicationSupportNeedsSummary {
  disclosed: boolean;
  supportDetail?: string;
  requestedAdjustments?: string;
}

interface ApplicationDocumentSlotSummary {
  id: string;
  slotKey: ApplicationDocumentSlotKey;
  label: string;
  required: boolean;
  managedFileId?: string;
  originalFilename?: string;
  sanitizedFilename?: string;
  contentType?: string;
  sizeBytes?: number;
  uploadedAt?: string;
  verificationStatus: ApplicationDocumentVerificationStatus;
  verificationAt?: string;
  verificationNote?: string;
}

interface ApplicationReviewSummary {
  readinessStatus: ApplicationReviewReadinessStatus;
  reviewNotes?: string;
  decisionReasonNotes?: string;
  lastReviewedAt?: string;
}

interface ApplicationDecisionSummary {
  outcome: ApplicationDecisionOutcome;
  decidedAt?: string;
  decisionReason?: string;
  correspondenceLogId?: string;
}

interface ApplicationOfferSummary {
  id: string;
  offerReference: string;
  status: ApplicationOfferStatus;
  issuedAt?: string;
  deadlineAt?: string;
  acceptedAt?: string;
  declinedAt?: string;
  lapsedAt?: string;
  deadlinePassed: boolean;
  reminderCount: number;
  lastDeadlineReminderAt?: string;
  lastDeadlineReminderCorrespondenceLogId?: string;
  correspondenceLogId?: string;
  convertedStudentId?: string;
  convertedAt?: string;
}

interface RegistrationStatusSummary {
  id: string;
  status: "not_started" | "in_progress" | "submitted" | "complete" | "lapsed";
  registrationDeadlineAt?: string;
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
  conversionRequestId?: string;
  studentId?: string;
  convertedAt?: string;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type ApplicationRow = {
  id: string;
  admission_lead_id: string;
  person_id: string;
  status: "submitted";
  programme: "pgcert" | "microcredential";
  submitted_at: string | null;
  declaration_accepted_at: string | null;
  title: string | null;
  first_name: string | null;
  middle_names: string | null;
  last_name: string | null;
  preferred_name: string | null;
  previous_surname: string | null;
  date_of_birth: string | null;
  previous_study_detail: string | null;
  partner_student_id: string | null;
  email: string | null;
  phone: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  clinical_role: string | null;
  employer: string | null;
  department_specialty: string | null;
  professional_registration_body: string | null;
  professional_registration_number: string | null;
  highest_qualification: string | null;
  qualification_awarding_body: string | null;
  qualification_year: number | null;
  qualification_result: string | null;
  qualification_country: string | null;
  work_experience: string | null;
  nationality: string | null;
  country_of_birth: string | null;
  country_of_residence: string | null;
  needs_visa_check: boolean | null;
  visa_notes: string | null;
  funding_source: FundingSource | null;
  funding_organisation: string | null;
  funding_contact: string | null;
  intended_start_term_id: string | null;
  pocus_previous_experience: string | null;
  pocus_motivation: string | null;
  pocus_case_improved_management: string | null;
  pocus_limitations_case: string | null;
  evidence_summary: string | null;
  admission_leads?: unknown;
};

type ChoiceRow = {
  application_id: string;
  offering_id: string;
  choice_order: number;
};

type SupportNeedsRow = {
  application_id: string;
  disclosed: boolean;
  support_detail: string | null;
  requested_adjustments: string | null;
};

type DocumentSlotRow = {
  id: string;
  application_id: string;
  slot_key: ApplicationDocumentSlotKey;
  label: string;
  required: boolean;
  managed_file_id: string | null;
  original_filename: string | null;
  sanitized_filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_at: string | null;
  verification_status: ApplicationDocumentVerificationStatus;
  verification_at: string | null;
  verification_note: string | null;
};

type ReviewRow = {
  application_id: string;
  readiness_status: ApplicationReviewReadinessStatus;
  review_notes: string | null;
  decision_reason_notes: string | null;
  last_reviewed_at: string | null;
};

type DecisionRow = {
  application_id: string;
  outcome: ApplicationDecisionOutcome;
  decision_reason: string | null;
  decided_at: string | null;
  correspondence_log_id: string | null;
};

type OfferRow = {
  application_id: string;
  id: string;
  offer_reference: string;
  status: ApplicationOfferStatus;
  issued_at: string | null;
  deadline_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  lapsed_at: string | null;
  deadline_reminder_count: number | null;
  last_deadline_reminder_at: string | null;
  last_deadline_reminder_correspondence_log_id: string | null;
  correspondence_log_id: string | null;
  converted_student_id: string | null;
  converted_at: string | null;
};

type RegistrationRow = {
  application_id: string;
  id: string;
  status: "not_started" | "in_progress" | "submitted" | "complete" | "lapsed";
  registration_deadline_at: string | null;
  saved_at: string | null;
  submitted_at: string | null;
  lapsed_at: string | null;
  lapsed_reason: string | null;
  reopened_at: string | null;
  reopened_reason: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
  module_confirmation_accepted: boolean | null;
  conversion_request_id: string | null;
  student_id: string | null;
  converted_at: string | null;
};

type RegistrationDocumentSlotRow = {
  registration_id: string;
  required: boolean;
  managed_file_id: string | null;
  verification_status: ApplicationDocumentVerificationStatus;
};

type LeadJoin = {
  stage?: string;
  archived?: boolean;
  converted_student_id?: string | null;
};

function optionalString(value: string | null | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function joinedObject(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    return value[0] && typeof value[0] === "object" ? (value[0] as Record<string, unknown>) : undefined;
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function formatDateTime(value?: string): string {
  return value ? new Date(value).toLocaleString("en-GB") : "Not recorded";
}

function formatDate(value?: string): string {
  return value ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB") : "Not recorded";
}

function formatFileSize(sizeBytes?: number): string {
  if (!sizeBytes || sizeBytes <= 0) {
    return "Unknown size";
  }

  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${Math.ceil(sizeBytes / 1024)} KB`;
}

function labelForReadiness(status: ApplicationReviewReadinessStatus): string {
  return status.replaceAll("_", " ");
}

function labelForFunding(status: FundingSource): string {
  return status.replaceAll("_", " ");
}

function leadIsVisibleInReviewAdmin(lead: LeadJoin | undefined): boolean {
  return Boolean(
    lead &&
      !lead.archived &&
      typeof lead.stage === "string" &&
      [
        "submitted",
        "reviewed",
        "offered",
        "accepted",
        "registration_in_progress",
        "registration_lapsed",
        "registered",
        "offer_declined",
        "offer_lapsed"
      ].includes(lead.stage)
  );
}

function selectedOfferingsForApplication(data: AppData, choices: ChoiceRow[], applicationId: string): SelectedOfferingSummary[] {
  return choices
    .filter((choice) => choice.application_id === applicationId)
    .sort((a, b) => a.choice_order - b.choice_order)
    .map((choice) => {
      const offering = data.offerings.find((candidate) => candidate.id === choice.offering_id);
      const courseModule = offering ? data.modules.find((candidate) => candidate.id === offering.moduleId) : undefined;
      const term = offering ? data.terms.find((candidate) => candidate.id === offering.termId) : undefined;
      return {
        offeringId: choice.offering_id,
        choiceOrder: choice.choice_order,
        moduleCode: courseModule?.code ?? "Unknown module",
        moduleTitle: courseModule?.title ?? "Module offering not found",
        termName: term?.name ?? "Unknown term",
        mode: courseModule?.mode ?? "unknown",
        capacity: offering?.capacity ?? 0
      };
    });
}

function mapApplication(
  row: ApplicationRow,
  data: AppData,
  choices: ChoiceRow[],
  support?: SupportNeedsRow,
  slots: DocumentSlotRow[] = [],
  review?: ReviewRow,
  decision?: DecisionRow,
  offer?: OfferRow,
  registration?: RegistrationStatusSummary
): StaffReviewApplication {
  const lead = joinedObject(row.admission_leads);
  return {
    id: row.id,
    admissionLeadId: row.admission_lead_id,
    personId: row.person_id,
    status: "submitted",
    leadStage: String(lead?.stage ?? "submitted"),
    leadConvertedStudentId: optionalString(String(lead?.converted_student_id ?? "")),
    programme: row.programme,
    submittedAt: optionalString(row.submitted_at),
    declarationAcceptedAt: optionalString(row.declaration_accepted_at),
    title: optionalString(row.title),
    firstName: optionalString(row.first_name),
    middleNames: optionalString(row.middle_names),
    lastName: optionalString(row.last_name),
    preferredName: optionalString(row.preferred_name),
    previousSurname: optionalString(row.previous_surname),
    dateOfBirth: optionalString(row.date_of_birth),
    previousStudyDetail: optionalString(row.previous_study_detail),
    partnerStudentId: optionalString(row.partner_student_id),
    email: optionalString(row.email),
    phone: optionalString(row.phone),
    addressLine1: optionalString(row.address_line_1),
    addressLine2: optionalString(row.address_line_2),
    city: optionalString(row.city),
    postcode: optionalString(row.postcode),
    country: optionalString(row.country),
    clinicalRole: optionalString(row.clinical_role),
    employer: optionalString(row.employer),
    departmentSpecialty: optionalString(row.department_specialty),
    professionalRegistrationBody: optionalString(row.professional_registration_body),
    professionalRegistrationNumber: optionalString(row.professional_registration_number),
    highestQualification: optionalString(row.highest_qualification),
    qualificationAwardingBody: optionalString(row.qualification_awarding_body),
    qualificationYear: row.qualification_year ?? undefined,
    qualificationResult: optionalString(row.qualification_result),
    qualificationCountry: optionalString(row.qualification_country),
    workExperience: optionalString(row.work_experience),
    nationality: optionalString(row.nationality),
    countryOfBirth: optionalString(row.country_of_birth),
    countryOfResidence: optionalString(row.country_of_residence),
    needsVisaCheck: Boolean(row.needs_visa_check),
    visaNotes: optionalString(row.visa_notes),
    fundingSource: row.funding_source ?? "unknown",
    fundingOrganisation: optionalString(row.funding_organisation),
    fundingContact: optionalString(row.funding_contact),
    intendedStartTermId: optionalString(row.intended_start_term_id),
    pocusPreviousExperience: optionalString(row.pocus_previous_experience),
    pocusMotivation: optionalString(row.pocus_motivation),
    pocusCaseImprovedManagement: optionalString(row.pocus_case_improved_management),
    pocusLimitationsCase: optionalString(row.pocus_limitations_case),
    evidenceSummary: optionalString(row.evidence_summary),
    supportNeeds: support
      ? {
          disclosed: support.disclosed,
          supportDetail: optionalString(support.support_detail),
          requestedAdjustments: optionalString(support.requested_adjustments)
        }
      : undefined,
    selectedOfferings: selectedOfferingsForApplication(data, choices, row.id),
    documentSlots: slots
      .filter((slot) => slot.application_id === row.id)
      .sort((a, b) => Number(b.required) - Number(a.required) || a.label.localeCompare(b.label))
      .map((slot) => ({
        id: slot.id,
        slotKey: slot.slot_key,
        label: slot.label,
        required: slot.required,
        managedFileId: optionalString(slot.managed_file_id),
        originalFilename: optionalString(slot.original_filename),
        sanitizedFilename: optionalString(slot.sanitized_filename),
        contentType: optionalString(slot.content_type),
        sizeBytes: slot.size_bytes ?? undefined,
        uploadedAt: optionalString(slot.uploaded_at),
        verificationStatus: slot.verification_status,
        verificationAt: optionalString(slot.verification_at),
        verificationNote: optionalString(slot.verification_note)
      })),
    review: review
      ? {
          readinessStatus: review.readiness_status,
          reviewNotes: optionalString(review.review_notes),
          decisionReasonNotes: optionalString(review.decision_reason_notes),
          lastReviewedAt: optionalString(review.last_reviewed_at)
        }
      : undefined,
    decision: decision
      ? {
          outcome: decision.outcome,
          decisionReason: optionalString(decision.decision_reason),
          decidedAt: optionalString(decision.decided_at),
          correspondenceLogId: optionalString(decision.correspondence_log_id)
        }
      : undefined,
    offer: offer
      ? {
          id: offer.id,
          offerReference: offer.offer_reference,
          status: offer.status,
          issuedAt: optionalString(offer.issued_at),
          deadlineAt: optionalString(offer.deadline_at),
          acceptedAt: optionalString(offer.accepted_at),
          declinedAt: optionalString(offer.declined_at),
          lapsedAt: optionalString(offer.lapsed_at),
          deadlinePassed: offer.status === "issued" && offer.deadline_at ? new Date(offer.deadline_at).getTime() <= Date.now() : false,
          reminderCount: offer.deadline_reminder_count ?? 0,
          lastDeadlineReminderAt: optionalString(offer.last_deadline_reminder_at),
          lastDeadlineReminderCorrespondenceLogId: optionalString(offer.last_deadline_reminder_correspondence_log_id),
          correspondenceLogId: optionalString(offer.correspondence_log_id),
          convertedStudentId: optionalString(offer.converted_student_id),
          convertedAt: optionalString(offer.converted_at)
        }
      : undefined,
    registration
  };
}

async function auditSupportNeedsViews(
  supabase: SupabaseServerClient,
  staffUserId: string,
  applicationRows: ApplicationRow[],
  supportNeedsRows: SupportNeedsRow[]
) {
  const applicationById = new Map(applicationRows.map((row) => [row.id, row]));
  const viewedRows = supportNeedsRows.filter(
    (row) => row.disclosed || Boolean(row.support_detail) || Boolean(row.requested_adjustments)
  );

  if (viewedRows.length === 0) {
    return;
  }

  const { error } = await supabase.from("audit_events").insert(
    viewedRows.map((row) => {
      const application = applicationById.get(row.application_id);
      if (!application) {
        throw new Error("Support-needs audit could not resolve the related application.");
      }

      return {
        actor_type: "staff",
        actor_user_id: staffUserId,
        actor_person_id: null,
        action: applicationSupportNeedsViewedAction,
        entity_type: "application_support_needs",
        entity_id: row.application_id,
        reason: null,
        metadata: buildApplicationSupportNeedsViewedAuditMetadata({
          applicationId: row.application_id,
          admissionLeadId: application.admission_lead_id,
          personId: application.person_id,
          disclosed: row.disclosed,
          supportDetail: row.support_detail,
          requestedAdjustments: row.requested_adjustments
        })
      };
    })
  );

  if (error) {
    throw new Error(`Failed to audit support-needs view: ${error.message}`);
  }
}

function demoApplications(): StaffReviewApplication[] {
  const data = getAppData();
  return [
    {
      id: "66666666-6666-4666-8666-666666666666",
      admissionLeadId: "11111111-1111-4111-8111-111111111111",
      personId: "22222222-2222-4222-8222-222222222222",
      status: "submitted",
      leadStage: "registration_in_progress",
      leadConvertedStudentId: undefined,
      programme: "pgcert",
      submittedAt: new Date().toISOString(),
      declarationAcceptedAt: new Date().toISOString(),
      firstName: "Amara",
      lastName: "Lewis",
      preferredName: "Amara",
      dateOfBirth: "1990-04-12",
      email: "amara.lewis@example.nhs.uk",
      phone: "07700 900200",
      addressLine1: "12 Example Street",
      city: "London",
      postcode: "E1 1AA",
      country: "United Kingdom",
      clinicalRole: "Emergency medicine registrar",
      employer: "Example NHS Trust",
      departmentSpecialty: "Emergency Department",
      professionalRegistrationBody: "GMC",
      professionalRegistrationNumber: "7654321",
      highestQualification: "MBBS",
      qualificationAwardingBody: "Example University",
      qualificationYear: 2015,
      qualificationResult: "Pass",
      workExperience: "Nine years of acute clinical practice with regular ultrasound exposure in supervised sessions.",
      nationality: "British",
      countryOfResidence: "United Kingdom",
      needsVisaCheck: false,
      fundingSource: "employer_sponsor",
      fundingOrganisation: "Example NHS Trust",
      pocusPreviousExperience: "Observed FAST, lung, vascular access, and focused cardiac ultrasound in acute assessment areas.",
      pocusMotivation: "Wants structured training and supervised practice to make bedside imaging safer and more consistent.",
      pocusCaseImprovedManagement: "A shocked patient with suspected sepsis where bedside cardiac and lung views could have accelerated treatment decisions.",
      pocusLimitationsCase: "Would seek senior imaging support for unclear windows, conflicting clinical findings, or decisions outside scope.",
      evidenceSummary: "Qualification certificate and GMC registration uploaded.",
      supportNeeds: {
        disclosed: true,
        supportDetail: "Applicant disclosed a disability-related support need.",
        requestedAdjustments: "May need scheduling notice for practical sessions."
      },
      selectedOfferings: selectedOfferingsForApplication(data, [
        { application_id: "66666666-6666-4666-8666-666666666666", offering_id: "offering-vascular-sep", choice_order: 1 }
      ], "66666666-6666-4666-8666-666666666666"),
      documentSlots: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          slotKey: "qualification_evidence",
          label: "Qualification certificate or transcript",
          required: true,
          managedFileId: "88888888-8888-4888-8888-888888888888",
          sanitizedFilename: "qualification-certificate.pdf",
          contentType: "application/pdf",
          sizeBytes: 512000,
          uploadedAt: new Date().toISOString(),
          verificationStatus: "unverified"
        },
        {
          id: "99999999-9999-4999-8999-999999999999",
          slotKey: "professional_registration_evidence",
          label: "Professional registration evidence",
          required: true,
          managedFileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          sanitizedFilename: "gmc-registration.pdf",
          contentType: "application/pdf",
          sizeBytes: 220000,
          uploadedAt: new Date().toISOString(),
          verificationStatus: "verified",
          verificationAt: new Date().toISOString()
        }
      ],
      review: {
        readinessStatus: "ready_for_decision",
        decisionReasonNotes: "Meets entry criteria once both required documents are verified.",
        lastReviewedAt: new Date().toISOString()
      },
      decision: {
        outcome: "offer",
        decidedAt: new Date().toISOString(),
        correspondenceLogId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      },
      offer: {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        offerReference: "BETAR-DEMO-OFFER",
        status: "issued",
        issuedAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        deadlinePassed: false,
        reminderCount: 0,
        correspondenceLogId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      },
      registration: {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        status: "submitted",
        registrationDeadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        submittedAt: new Date().toISOString(),
        termsVersion: "registration-terms-2026-07-28-v1",
        termsAcceptedAt: new Date().toISOString(),
        moduleConfirmationAccepted: true,
        requiredDocumentCount: 2,
        uploadedRequiredDocumentCount: 2
      }
    }
  ];
}

async function getStaffReviewApplications(staffUserId: string): Promise<StaffReviewApplication[]> {
  if (!isSupabaseConfigured()) {
    return demoApplications();
  }

  const [data, supabase] = await Promise.all([getLmsData(), createSupabaseServerClient()]);
  const applicationResult = await supabase
    .from("applications")
    .select(
      `
        id,
        admission_lead_id,
        person_id,
        status,
        programme,
        submitted_at,
        declaration_accepted_at,
        title,
        first_name,
        middle_names,
        last_name,
        preferred_name,
        previous_surname,
        date_of_birth,
        previous_study_detail,
        partner_student_id,
        email,
        phone,
        address_line_1,
        address_line_2,
        city,
        postcode,
        country,
        clinical_role,
        employer,
        department_specialty,
        professional_registration_body,
        professional_registration_number,
        highest_qualification,
        qualification_awarding_body,
        qualification_year,
        qualification_result,
        qualification_country,
        work_experience,
        nationality,
        country_of_birth,
        country_of_residence,
        needs_visa_check,
        visa_notes,
        funding_source,
        funding_organisation,
        funding_contact,
        intended_start_term_id,
        pocus_previous_experience,
        pocus_motivation,
        pocus_case_improved_management,
        pocus_limitations_case,
        evidence_summary,
        admission_leads!inner (
          stage,
          archived,
          converted_student_id
        )
      `
    )
    .eq("status", "submitted")
    .order("submitted_at", { ascending: false });

  if (applicationResult.error) {
    throw new Error(applicationResult.error.message);
  }

  const applicationRows = ((applicationResult.data ?? []) as ApplicationRow[]).filter((row) => {
    const lead = joinedObject(row.admission_leads);
    return leadIsVisibleInReviewAdmin(lead);
  });
  const applicationIds = applicationRows.map((row) => row.id);

  if (applicationIds.length === 0) {
    return [];
  }

  const [choiceResult, supportNeedsResult, documentSlotResult, reviewResult, decisionResult, offerResult, registrationResult] = await Promise.all([
    supabase
      .from("application_module_offering_choices")
      .select("application_id, offering_id, choice_order")
      .in("application_id", applicationIds)
      .order("choice_order"),
    supabase
      .from("application_support_needs")
      .select("application_id, disclosed, support_detail, requested_adjustments")
      .in("application_id", applicationIds),
    supabase
      .from("application_document_slots")
      .select(
        "id, application_id, slot_key, label, required, managed_file_id, original_filename, sanitized_filename, content_type, size_bytes, uploaded_at, verification_status, verification_at, verification_note"
      )
      .in("application_id", applicationIds)
      .order("required", { ascending: false }),
    supabase
      .from("application_reviews")
      .select("application_id, readiness_status, review_notes, decision_reason_notes, last_reviewed_at")
      .in("application_id", applicationIds),
    supabase
      .from("application_decisions")
      .select("application_id, outcome, decision_reason, decided_at, correspondence_log_id")
      .in("application_id", applicationIds),
    supabase
      .from("application_offers")
      .select(
        "application_id, id, offer_reference, status, issued_at, deadline_at, accepted_at, declined_at, lapsed_at, deadline_reminder_count, last_deadline_reminder_at, last_deadline_reminder_correspondence_log_id, correspondence_log_id, converted_student_id, converted_at"
      )
      .in("application_id", applicationIds)
      .order("issued_at", { ascending: false }),
    supabase
      .from("admissions_registrations")
      .select(
        "application_id, id, status, registration_deadline_at, saved_at, submitted_at, lapsed_at, lapsed_reason, reopened_at, reopened_reason, terms_version, terms_accepted_at, module_confirmation_accepted, conversion_request_id, student_id, converted_at"
      )
      .in("application_id", applicationIds)
      .order("updated_at", { ascending: false })
  ]);

  if (choiceResult.error) {
    throw new Error(choiceResult.error.message);
  }
  if (supportNeedsResult.error) {
    throw new Error(supportNeedsResult.error.message);
  }
  if (documentSlotResult.error) {
    throw new Error(documentSlotResult.error.message);
  }
  if (reviewResult.error) {
    throw new Error(reviewResult.error.message);
  }
  if (decisionResult.error) {
    throw new Error(decisionResult.error.message);
  }
  if (offerResult.error) {
    throw new Error(offerResult.error.message);
  }
  if (registrationResult.error) {
    throw new Error(registrationResult.error.message);
  }

  const choices = (choiceResult.data ?? []) as ChoiceRow[];
  const supportNeedsRows = (supportNeedsResult.data ?? []) as SupportNeedsRow[];
  await auditSupportNeedsViews(supabase, staffUserId, applicationRows, supportNeedsRows);
  const supportByApplicationId = new Map(supportNeedsRows.map((row) => [row.application_id, row]));
  const slots = (documentSlotResult.data ?? []) as DocumentSlotRow[];
  const reviewByApplicationId = new Map(((reviewResult.data ?? []) as ReviewRow[]).map((row) => [row.application_id, row]));
  const decisionByApplicationId = new Map(((decisionResult.data ?? []) as DecisionRow[]).map((row) => [row.application_id, row]));
  const offerByApplicationId = new Map<string, OfferRow>();
  for (const offer of (offerResult.data ?? []) as OfferRow[]) {
    if (!offerByApplicationId.has(offer.application_id)) {
      offerByApplicationId.set(offer.application_id, offer);
    }
  }
  const registrationRows = (registrationResult.data ?? []) as RegistrationRow[];
  const registrationIds = registrationRows.map((row) => row.id);
  const registrationSlotResult =
    registrationIds.length > 0
      ? await supabase
          .from("admissions_registration_document_slots")
          .select("registration_id, required, managed_file_id, verification_status")
          .in("registration_id", registrationIds)
      : { data: [], error: null };

  if (registrationSlotResult.error) {
    throw new Error(registrationSlotResult.error.message);
  }

  const registrationSlots = (registrationSlotResult.data ?? []) as RegistrationDocumentSlotRow[];
  const registrationByApplicationId = new Map<string, RegistrationStatusSummary>();
  for (const registration of registrationRows) {
    if (registrationByApplicationId.has(registration.application_id)) {
      continue;
    }
    const registrationRequiredSlots = registrationSlots.filter((slot) => slot.registration_id === registration.id && slot.required);
    registrationByApplicationId.set(registration.application_id, {
      id: registration.id,
      status: registration.status,
      registrationDeadlineAt: optionalString(registration.registration_deadline_at),
      savedAt: optionalString(registration.saved_at),
      submittedAt: optionalString(registration.submitted_at),
      lapsedAt: optionalString(registration.lapsed_at),
      lapsedReason: optionalString(registration.lapsed_reason),
      reopenedAt: optionalString(registration.reopened_at),
      reopenedReason: optionalString(registration.reopened_reason),
      termsVersion: optionalString(registration.terms_version),
      termsAcceptedAt: optionalString(registration.terms_accepted_at),
      moduleConfirmationAccepted: Boolean(registration.module_confirmation_accepted),
      requiredDocumentCount: registrationRequiredSlots.length,
      uploadedRequiredDocumentCount: registrationRequiredSlots.filter(
        (slot) => slot.managed_file_id && slot.verification_status !== "rejected"
      ).length,
      conversionRequestId: optionalString(registration.conversion_request_id),
      studentId: optionalString(registration.student_id),
      convertedAt: optionalString(registration.converted_at)
    });
  }

  return applicationRows.map((row) =>
    mapApplication(
      row,
      data,
      choices,
      supportByApplicationId.get(row.id),
      slots,
      reviewByApplicationId.get(row.id),
      decisionByApplicationId.get(row.id),
      offerByApplicationId.get(row.id),
      registrationByApplicationId.get(row.id)
    )
  );
}

function DataItem({ label, value }: { label: string; value?: string | number | boolean }) {
  const displayValue = typeof value === "boolean" ? (value ? "Yes" : "No") : value;
  return (
    <div className="review-data-item">
      <span>{label}</span>
      <strong>{displayValue ?? "Not provided"}</strong>
    </div>
  );
}

function TextAnswer({ label, value }: { label: string; value?: string }) {
  return (
    <div className="review-text-answer">
      <span>{label}</span>
      <p>{value ?? "Not provided"}</p>
    </div>
  );
}

function ApplicationSummaryPanel({ application }: { application: StaffReviewApplication }) {
  const startTerm = application.intendedStartTermId
    ? application.selectedOfferings[0]?.termName ?? application.intendedStartTermId
    : "Not provided";

  return (
    <div className="panel review-application-summary">
      <div className="section-header">
        <div>
          <h2>
            {[application.title, application.firstName, application.middleNames, application.lastName].filter(Boolean).join(" ") ||
              "Unnamed applicant"}
          </h2>
          <p>
            Submitted {formatDateTime(application.submittedAt)} · Declaration {formatDateTime(application.declarationAcceptedAt)}
          </p>
        </div>
        <div className="toolbar">
          <StatusPill value={application.leadStage} />
          <StatusPill value={application.review?.readinessStatus ?? "not_ready"} />
          <StatusPill value={application.registration?.status ?? "not_started"} label={`registration ${application.registration?.status?.replaceAll("_", " ") ?? "not started"}`} />
        </div>
      </div>

      <div className="review-data-grid">
        <DataItem label="Email" value={application.email} />
        <DataItem label="Phone" value={application.phone} />
        <DataItem label="Date of birth" value={formatDate(application.dateOfBirth)} />
        <DataItem label="Programme" value={application.programme === "pgcert" ? "PGCert" : "Microcredential"} />
        <DataItem label="Intended start term" value={startTerm} />
        <DataItem label="Selected offerings" value={application.selectedOfferings.length} />
        <DataItem label="Offer deadline" value={application.offer?.deadlineAt ? formatDateTime(application.offer.deadlineAt) : "No offer issued"} />
        <DataItem label="Registration" value={application.registration?.status.replaceAll("_", " ") ?? "Not started"} />
      </div>
    </div>
  );
}

function OfferDeadlineWorkflowPanel() {
  return (
    <section className="panel grid">
      <div className="section-header">
        <div>
          <h2>Offer Deadline Workflow</h2>
          <p>Manual processor for suppressed deadline reminders and lapsed offers. No applicant emails are sent.</p>
        </div>
        <div className="icon-box">
          <MailWarning size={18} />
        </div>
      </div>
      <form className="toolbar" action={processApplicationOfferDeadlineWorkflow}>
        <Field label="Reminder window" htmlFor="offer-reminder-window-days">
          <input
            id="offer-reminder-window-days"
            name="reminder_window_days"
            className="input"
            type="number"
            min={0}
            max={30}
            defaultValue={3}
          />
        </Field>
        <button className="button primary">
          <Clock size={16} />
          Process offer deadlines
        </button>
      </form>
    </section>
  );
}

function RegistrationDeadlineWorkflowPanel() {
  return (
    <section className="panel grid">
      <div className="section-header">
        <div>
          <h2>Registration Deadline Workflow</h2>
          <p>Marks overdue in-progress or submitted registrations as lapsed and logs suppressed applicant notices.</p>
        </div>
        <div className="icon-box">
          <MailWarning size={18} />
        </div>
      </div>
      <form className="grid" action={processAdmissionsRegistrationDeadlineWorkflow}>
        <Field label="Lapse reason" htmlFor="registration-lapse-reason">
          <input
            id="registration-lapse-reason"
            name="lapse_reason"
            className="input"
            maxLength={4000}
            defaultValue="Registration deadline passed before submission or conversion."
          />
        </Field>
        <button className="button primary">
          <Clock size={16} />
          Process registration deadlines
        </button>
      </form>
    </section>
  );
}

function ApplicantDetailsPanel({ application }: { application: StaffReviewApplication }) {
  return (
    <section className="panel grid">
      <div className="section-header">
        <div>
          <h2>Applicant Details</h2>
          <p>Personal, contact, professional, qualification, visa, and funding information</p>
        </div>
      </div>
      <div className="review-data-grid">
        <DataItem label="Preferred name" value={application.preferredName} />
        <DataItem label="Previous surname" value={application.previousSurname} />
        <DataItem label="Address line 1" value={application.addressLine1} />
        <DataItem label="Address line 2" value={application.addressLine2} />
        <DataItem label="City" value={application.city} />
        <DataItem label="Postcode" value={application.postcode} />
        <DataItem label="Country" value={application.country} />
        <DataItem label="Clinical role" value={application.clinicalRole} />
        <DataItem label="Employer" value={application.employer} />
        <DataItem label="Department or specialty" value={application.departmentSpecialty} />
        <DataItem label="Registration body" value={application.professionalRegistrationBody} />
        <DataItem label="Registration number" value={application.professionalRegistrationNumber} />
        <DataItem label="Highest qualification" value={application.highestQualification} />
        <DataItem label="Awarding body" value={application.qualificationAwardingBody} />
        <DataItem label="Qualification year" value={application.qualificationYear} />
        <DataItem label="Qualification result" value={application.qualificationResult} />
        <DataItem label="Qualification country" value={application.qualificationCountry} />
        <DataItem label="Nationality" value={application.nationality} />
        <DataItem label="Country of birth" value={application.countryOfBirth} />
        <DataItem label="Country of residence" value={application.countryOfResidence} />
        <DataItem label="Needs visa check" value={application.needsVisaCheck} />
        <DataItem label="Visa notes" value={application.visaNotes} />
        <DataItem label="Funding source" value={labelForFunding(application.fundingSource)} />
        <DataItem label="Funding organisation" value={application.fundingOrganisation} />
        <DataItem label="Funding contact" value={application.fundingContact} />
        <DataItem label="Partner student ID" value={application.partnerStudentId} />
        <DataItem label="Previous study" value={application.previousStudyDetail} />
      </div>
      <TextAnswer label="Work experience" value={application.workExperience} />
      <TextAnswer label="Evidence summary" value={application.evidenceSummary} />
    </section>
  );
}

function StudyPlanPanel({ application }: { application: StaffReviewApplication }) {
  return (
    <section className="panel grid">
      <div className="section-header">
        <div>
          <h2>Intended Study Plan</h2>
          <p>Application choices only; no places, enrolments, or finance rows are created here</p>
        </div>
      </div>
      {application.selectedOfferings.length === 0 ? (
        <p className="muted small">No module offerings selected.</p>
      ) : (
        <div className="review-offering-list">
          {application.selectedOfferings.map((offering) => (
            <div className="review-offering-row" key={offering.offeringId}>
              <div>
                <strong>
                  Choice {offering.choiceOrder}: {offering.moduleCode}
                </strong>
                <p className="muted small">
                  {offering.moduleTitle} · {offering.termName} · {offering.mode} · capacity {offering.capacity}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PocusPanel({ application }: { application: StaffReviewApplication }) {
  return (
    <section className="panel grid">
      <div className="section-header">
        <div>
          <h2>POCUS Answers</h2>
          <p>Applicant free-text answers from the submitted application</p>
        </div>
      </div>
      <TextAnswer label="Previous POCUS experience" value={application.pocusPreviousExperience} />
      <TextAnswer label="Motivation for this course" value={application.pocusMotivation} />
      <TextAnswer label="Clinical case where POCUS could improve management" value={application.pocusCaseImprovedManagement} />
      <TextAnswer label="Clinical case showing limits or escalation" value={application.pocusLimitationsCase} />
    </section>
  );
}

function SupportNeedsPanel({ application }: { application: StaffReviewApplication }) {
  const supportNeeds = application.supportNeeds;
  return (
    <section className="panel grid restricted-panel">
      <div className="section-header">
        <div>
          <h2>Restricted Support Needs</h2>
          <p>Separated from the general application record and restricted to admissions admins</p>
        </div>
        <div className="icon-box">
          <LockKeyhole size={18} />
        </div>
      </div>
      {!supportNeeds || !supportNeeds.disclosed ? (
        <p className="muted small">No support needs disclosed.</p>
      ) : (
        <>
          <TextAnswer label="Disclosure detail" value={supportNeeds.supportDetail} />
          <TextAnswer label="Requested adjustments" value={supportNeeds.requestedAdjustments} />
        </>
      )}
    </section>
  );
}

function EvidencePanel({ application }: { application: StaffReviewApplication }) {
  return (
    <section className="panel grid">
      <div className="section-header">
        <div>
          <h2>Uploaded Evidence</h2>
          <p>Verify, reject, or reset uploaded application evidence before decision readiness</p>
        </div>
        <div className="icon-box">
          <FileCheck2 size={18} />
        </div>
      </div>
      {application.documentSlots.length === 0 ? (
        <p className="muted small">No uploaded evidence slots found.</p>
      ) : (
        <div className="application-document-list">
          {application.documentSlots.map((slot) => (
            <div className="application-document-slot review-document-slot" key={slot.id}>
              <div className="review-document-main">
                <div>
                  <div className="application-document-slot-heading">
                    <strong>{slot.label}</strong>
                    <span>{slot.required ? "Required" : "Optional"}</span>
                  </div>
                  {slot.managedFileId ? (
                    <p className="muted small">
                      {slot.sanitizedFilename ?? slot.originalFilename ?? "Uploaded file"} · {formatFileSize(slot.sizeBytes)}
                      {slot.uploadedAt ? ` · Uploaded ${formatDateTime(slot.uploadedAt)}` : ""}
                      {slot.verificationAt ? ` · Checked ${formatDateTime(slot.verificationAt)}` : ""}
                    </p>
                  ) : (
                    <p className="muted small">No file uploaded.</p>
                  )}
                  {slot.verificationNote ? <p className="muted small">Verification note: {slot.verificationNote}</p> : null}
                </div>
                <div className="review-document-status">
                  <StatusPill value={slot.verificationStatus} />
                  <DocumentOpenButton fileId={slot.managedFileId} />
                </div>
              </div>
              <form className="review-document-form" action={verifyApplicationDocument}>
                <input type="hidden" name="application_id" value={application.id} />
                <input type="hidden" name="slot_id" value={slot.id} />
                <Field label="Verification state" htmlFor={`verification-status-${slot.id}`}>
                  <select
                    id={`verification-status-${slot.id}`}
                    name="verification_status"
                    className="select"
                    defaultValue={slot.verificationStatus}
                    disabled={!slot.managedFileId}
                  >
                    <option value="unverified">Unverified</option>
                    <option value="verified">Verified</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </Field>
                <Field label="Verification note" htmlFor={`verification-note-${slot.id}`}>
                  <input
                    id={`verification-note-${slot.id}`}
                    name="verification_note"
                    className="input"
                    defaultValue={slot.verificationNote ?? ""}
                    placeholder="Optional note"
                    disabled={!slot.managedFileId}
                  />
                </Field>
                <button className="button primary" disabled={!slot.managedFileId}>
                  Save verification
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewDecisionPanel({ application }: { application: StaffReviewApplication }) {
  const readiness = application.review?.readinessStatus ?? "not_ready";
  return (
    <section className="panel grid">
      <div className="section-header">
        <div>
          <h2>Review Notes</h2>
          <p>Record decision readiness without issuing offers, rejections, emails, enrolments, or registration</p>
        </div>
        <div className="icon-box">
          <ClipboardCheck size={18} />
        </div>
      </div>
      {application.review?.lastReviewedAt ? (
        <p className="muted small">Last reviewed {formatDateTime(application.review.lastReviewedAt)}</p>
      ) : null}
      <form className="grid" action={recordStaffApplicationReview}>
        <input type="hidden" name="application_id" value={application.id} />
        <FormGrid>
          <Field label="Decision readiness" htmlFor={`readiness-${application.id}`}>
            <select id={`readiness-${application.id}`} name="readiness_status" className="select" defaultValue={readiness}>
              {applicationReviewReadinessStatuses.map((status) => (
                <option key={status} value={status}>
                  {labelForReadiness(status)}
                </option>
              ))}
            </select>
          </Field>
          <DataItem label="Current readiness" value={labelForReadiness(readiness)} />
        </FormGrid>
        <Field label="Review notes" htmlFor={`review-notes-${application.id}`}>
          <textarea
            id={`review-notes-${application.id}`}
            name="review_notes"
            className="textarea"
            defaultValue={application.review?.reviewNotes ?? ""}
          />
        </Field>
        <Field label="Decision reason notes" htmlFor={`decision-reasons-${application.id}`}>
          <textarea
            id={`decision-reasons-${application.id}`}
            name="decision_reason_notes"
            className="textarea"
            defaultValue={application.review?.decisionReasonNotes ?? ""}
          />
        </Field>
        <button className="button primary">Save review</button>
      </form>
    </section>
  );
}

function RecordDecisionPanel({ application }: { application: StaffReviewApplication }) {
  const readiness = application.review?.readinessStatus ?? "not_ready";
  const decisionAccess = canRecordApplicationDecision({
    applicationStatus: application.status,
    leadStage: application.leadStage,
    archived: false,
    convertedStudentId: application.leadConvertedStudentId ?? application.registration?.studentId ?? application.offer?.convertedStudentId ?? null,
    readinessStatus: readiness,
    existingDecisionOutcome: application.decision?.outcome
  });
  const disabled = !decisionAccess.allowed;
  const disabledReason =
    decisionAccess.reason === "review_not_ready"
      ? "Review must be ready for decision first."
      : decisionAccess.reason === "decision_already_recorded"
        ? "A decision has already been recorded."
        : decisionAccess.reason === "lead_not_decisionable"
          ? "This admissions stage is not open for a new decision."
          : "Decision recording is unavailable for this application.";

  return (
    <section className="panel grid">
      <div className="section-header">
        <div>
          <h2>Offer Or Rejection</h2>
          <p>Record the staff decision and log placeholder correspondence. Applicant email sending remains suppressed.</p>
        </div>
        <div className="toolbar">
          <div className="icon-box">
            <BadgeCheck size={18} />
          </div>
          <div className="icon-box">
            <XCircle size={18} />
          </div>
        </div>
      </div>

      {application.decision ? (
        <div className="apply-success" role="status">
          <ShieldAlert size={18} />
          <div>
            <h2>{application.decision.outcome === "offer" ? "Offer recorded" : "Rejection recorded"}</h2>
            <p>
              Decided {formatDateTime(application.decision.decidedAt)}. Correspondence log{" "}
              {application.decision.correspondenceLogId ? "created" : "not recorded"}.
            </p>
          </div>
        </div>
      ) : null}

      {!decisionAccess.allowed ? <p className="muted small">{disabledReason}</p> : null}

      <div className="grid grid-2">
        <form className="grid" action={recordApplicationDecision}>
          <input type="hidden" name="application_id" value={application.id} />
          <input type="hidden" name="decision_outcome" value="offer" />
          <Field label="Offer deadline" htmlFor={`offer-deadline-${application.id}`}>
            <input
              id={`offer-deadline-${application.id}`}
              name="offer_deadline_at"
              className="input"
              type="date"
              disabled={disabled}
            />
          </Field>
          <Field label="Offer decision reason" htmlFor={`offer-reason-${application.id}`}>
            <textarea
              id={`offer-reason-${application.id}`}
              name="decision_reason"
              className="textarea"
              defaultValue={application.review?.decisionReasonNotes ?? ""}
              maxLength={4000}
              required
              disabled={disabled}
            />
          </Field>
          <button className="button primary" disabled={disabled}>
            Record offer
          </button>
        </form>

        <form className="grid" action={recordApplicationDecision}>
          <input type="hidden" name="application_id" value={application.id} />
          <input type="hidden" name="decision_outcome" value="rejection" />
          <input type="hidden" name="offer_deadline_at" value="" />
          <Field label="Rejection decision reason" htmlFor={`rejection-reason-${application.id}`}>
            <textarea
              id={`rejection-reason-${application.id}`}
              name="decision_reason"
              className="textarea"
              defaultValue={application.review?.decisionReasonNotes ?? ""}
              maxLength={4000}
              required
              disabled={disabled}
            />
          </Field>
          <button className="button danger" disabled={disabled}>
            Record rejection
          </button>
        </form>
      </div>
    </section>
  );
}

function OfferStatusPanel({ application }: { application: StaffReviewApplication }) {
  const offer = application.offer;

  if (!offer) {
    return null;
  }

  return (
    <section className="panel grid">
      <div className="section-header">
        <div>
          <h2>Offer State</h2>
          <p>Portal/database offer state, deadline tracking, and suppressed reminder/lapse logging</p>
        </div>
        <div className="toolbar">
          <StatusPill value={offer.status} />
          {offer.deadlinePassed ? <StatusPill value="watch" label="deadline passed" /> : null}
        </div>
      </div>

      <div className="review-data-grid">
        <DataItem label="Offer reference" value={offer.offerReference} />
        <DataItem label="Issued" value={formatDateTime(offer.issuedAt)} />
        <DataItem label="Response deadline" value={formatDateTime(offer.deadlineAt)} />
        <DataItem label="Reminder logs" value={offer.reminderCount} />
        <DataItem label="Last reminder eligibility" value={formatDateTime(offer.lastDeadlineReminderAt)} />
        <DataItem label="Offer correspondence log" value={offer.correspondenceLogId ? "Created" : "Not recorded"} />
      </div>

      {offer.status === "lapsed" ? (
        <div className="apply-error" role="status">
          <Clock size={18} />
          <div>
            <h2>Offer lapsed</h2>
            <p>This offer lapsed {formatDateTime(offer.lapsedAt)}. Applicants cannot accept or decline lapsed offers.</p>
          </div>
        </div>
      ) : null}

      {offer.deadlinePassed && offer.status === "issued" ? (
        <div className="apply-error" role="status">
          <Clock size={18} />
          <div>
            <h2>Deadline passed</h2>
            <p>Run the offer deadline workflow to mark the overdue issued offer as lapsed and create suppressed lapse correspondence.</p>
          </div>
        </div>
      ) : null}

      {offer.lastDeadlineReminderCorrespondenceLogId ? (
        <p className="muted small">Latest reminder correspondence log was created with delivery suppressed.</p>
      ) : (
        <p className="muted small">No reminder eligibility log has been recorded for this offer yet.</p>
      )}
    </section>
  );
}

function RegistrationStatusPanel({ application }: { application: StaffReviewApplication }) {
  const registration = application.registration;

  if (!registration) {
    return (
      <section className="panel grid">
        <div className="section-header">
          <div>
            <h2>Registration State</h2>
            <p>No registration has been started for this accepted offer yet.</p>
          </div>
          <StatusPill value="not_started" />
        </div>
      </section>
    );
  }

  return (
    <section className="panel grid">
      <div className="section-header">
        <div>
          <h2>Registration State</h2>
          <p>Submitted registrations can be converted to student records with planned initial enrolments. Finance remains disabled.</p>
        </div>
        <StatusPill value={registration.status} />
      </div>

      <div className="review-data-grid">
        <DataItem label="Status" value={registration.status.replaceAll("_", " ")} />
        <DataItem label="Registration deadline" value={formatDateTime(registration.registrationDeadlineAt)} />
        <DataItem label="Last saved" value={formatDateTime(registration.savedAt)} />
        <DataItem label="Submitted" value={formatDateTime(registration.submittedAt)} />
        <DataItem label="Lapsed" value={formatDateTime(registration.lapsedAt)} />
        <DataItem label="Reopened" value={formatDateTime(registration.reopenedAt)} />
        <DataItem label="Course/modules confirmed" value={registration.moduleConfirmationAccepted} />
        <DataItem label="Required docs uploaded" value={`${registration.uploadedRequiredDocumentCount}/${registration.requiredDocumentCount}`} />
        <DataItem label="T&C version" value={registration.termsVersion} />
        <DataItem label="T&C accepted" value={formatDateTime(registration.termsAcceptedAt)} />
        <DataItem label="Converted" value={formatDateTime(registration.convertedAt)} />
        <DataItem label="Student record" value={registration.studentId ? "Linked" : "Not created"} />
      </div>

      {registration.status === "lapsed" ? (
        <div className="apply-error" role="status">
          <Clock size={18} />
          <div>
            <h2>Registration lapsed</h2>
            <p>
              This registration lapsed {formatDateTime(registration.lapsedAt)}. Applicants cannot submit it and staff cannot convert it
              unless it is reopened.
            </p>
          </div>
        </div>
      ) : null}

      {registration.reopenedAt ? (
        <div className="apply-success" role="status">
          <ShieldAlert size={18} />
          <div>
            <h2>Registration reopened</h2>
            <p>
              Reopened {formatDateTime(registration.reopenedAt)}. Current deadline:{" "}
              {formatDateTime(registration.registrationDeadlineAt)}.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RegistrationReopenPanel({ application }: { application: StaffReviewApplication }) {
  const registration = application.registration;
  const access = canReopenLapsedRegistration(
    registration
      ? {
          registrationStatus: registration.status,
          convertedStudentId: registration.studentId ?? application.leadConvertedStudentId ?? application.offer?.convertedStudentId,
          leadStage: application.leadStage
        }
      : undefined
  );

  const reasonByKey: Record<typeof access.reason, string> = {
    allowed: "This lapsed registration can be reopened for applicant editing and resubmission.",
    missing_registration: "No registration exists to reopen.",
    not_lapsed: "Only lapsed registrations can be reopened.",
    already_converted: "Converted registrations cannot be reopened.",
    lead_not_reopenable: "The admissions lead is not in the lapsed-registration stage."
  };

  if (!registration) {
    return null;
  }

  return (
    <section className="panel grid">
      <div className="section-header">
        <div>
          <h2>Registration Reopen</h2>
          <p>Reopening requires a staff reason and creates a suppressed applicant notice. No email is sent.</p>
        </div>
        <StatusPill value={access.allowed ? "ready_for_decision" : "not_ready"} label={access.allowed ? "available" : "blocked"} />
      </div>

      <p className="muted small">{reasonByKey[access.reason]}</p>

      <form className="grid" action={reopenLapsedAdmissionsRegistration}>
        <input type="hidden" name="application_id" value={application.id} />
        <input type="hidden" name="registration_id" value={registration.id} />
        <FormGrid>
          <Field label="New deadline" htmlFor={`registration-reopen-deadline-${registration.id}`}>
            <input
              id={`registration-reopen-deadline-${registration.id}`}
              name="new_deadline_at"
              className="input"
              type="date"
              disabled={!access.allowed}
            />
          </Field>
          <DataItem label="Previous deadline" value={formatDateTime(registration.registrationDeadlineAt)} />
        </FormGrid>
        <Field label="Reopen reason" htmlFor={`registration-reopen-reason-${registration.id}`}>
          <textarea
            id={`registration-reopen-reason-${registration.id}`}
            name="reopen_reason"
            className="textarea"
            maxLength={4000}
            required
            disabled={!access.allowed}
          />
        </Field>
        <button className="button primary" disabled={!access.allowed}>
          <ShieldAlert size={16} />
          Reopen registration
        </button>
      </form>
    </section>
  );
}

function RegistrationConversionPanel({ application }: { application: StaffReviewApplication }) {
  const registration = application.registration;
  const access = canConvertSubmittedRegistration({
    registrationStatus: registration?.status ?? "not_started",
    registrationDeadlineAt: registration?.registrationDeadlineAt,
    requiredDocumentCount: registration?.requiredDocumentCount ?? 0,
    uploadedRequiredDocumentCount: registration?.uploadedRequiredDocumentCount ?? 0,
    moduleConfirmationAccepted: Boolean(registration?.moduleConfirmationAccepted),
    termsAcceptedAt: registration?.termsAcceptedAt,
    convertedStudentId: registration?.studentId ?? application.leadConvertedStudentId ?? application.offer?.convertedStudentId,
    leadStage: application.leadStage
  });

  const reasonByKey: Record<typeof access.reason, string> = {
    allowed: "Ready to convert.",
    already_converted: "This registration has already been converted to a student record.",
    registration_deadline_passed: "The registration deadline has passed. Reopen the registration before conversion.",
    registration_not_submitted: "The applicant must submit registration before conversion.",
    required_documents_missing: "Required registration documents must be uploaded and not rejected.",
    modules_not_confirmed: "The applicant must confirm the accepted modules.",
    terms_not_accepted: "Registration terms must be accepted.",
    lead_not_convertible: "This admissions stage cannot be converted."
  };

  if (!registration) {
    return null;
  }

  return (
    <section className="panel grid">
      <div className="section-header">
        <div>
          <h2>Student Conversion</h2>
          <p>Create or activate the linked student record and planned initial enrolments. Finance rows are not created here.</p>
        </div>
        <div className="toolbar">
          <GraduationCap size={18} />
          <StatusPill
            value={registration.status === "complete" || registration.studentId ? "completed" : access.allowed ? "ready_for_decision" : "not_ready"}
            label={registration.status === "complete" || registration.studentId ? "converted" : access.allowed ? "ready" : "blocked"}
          />
        </div>
      </div>

      <div className="review-data-grid">
        <DataItem label="Conversion request" value={registration.conversionRequestId ? "Linked" : "Not staged"} />
        <DataItem label="Student record" value={registration.studentId ?? application.leadConvertedStudentId ?? application.offer?.convertedStudentId ?? "Not linked"} />
        <DataItem label="Converted at" value={formatDateTime(registration.convertedAt ?? application.offer?.convertedAt)} />
      </div>

      <p className="muted small">{reasonByKey[access.reason]}</p>

      <form action={convertSubmittedAdmissionsRegistration}>
        <input type="hidden" name="application_id" value={application.id} />
        <input type="hidden" name="registration_id" value={registration.id} />
        <button className="button primary" disabled={!access.allowed}>
          <GraduationCap size={16} />
          Convert to student
        </button>
      </form>
    </section>
  );
}

function ReviewApplicationRecord({ application, open }: { application: StaffReviewApplication; open: boolean }) {
  return (
    <details className="review-application-record" id={`application-${application.id}`} open={open}>
      <summary>
        <span>
          <strong>
            {application.firstName} {application.lastName}
          </strong>
          <small>
            {application.email ?? "No email"} · submitted {formatDateTime(application.submittedAt)}
          </small>
        </span>
        <span className="toolbar">
          <StatusPill value={application.leadStage} />
          <StatusPill value={application.review?.readinessStatus ?? "not_ready"} />
          <StatusPill value={application.registration?.status ?? "not_started"} label={`registration ${application.registration?.status?.replaceAll("_", " ") ?? "not started"}`} />
        </span>
      </summary>
      <div className="review-application-body">
        <ApplicationSummaryPanel application={application} />
        <div className="grid grid-2">
          <ApplicantDetailsPanel application={application} />
          <div className="grid">
            <StudyPlanPanel application={application} />
            <PocusPanel application={application} />
            <SupportNeedsPanel application={application} />
          </div>
        </div>
        <EvidencePanel application={application} />
        <ReviewDecisionPanel application={application} />
        <RecordDecisionPanel application={application} />
        <OfferStatusPanel application={application} />
        <RegistrationStatusPanel application={application} />
        <RegistrationReopenPanel application={application} />
        <RegistrationConversionPanel application={application} />
      </div>
    </details>
  );
}

export default async function AdmissionsReviewsPage({
  searchParams
}: {
  searchParams: Promise<{
    application?: string;
    document_verified?: string;
    review_saved?: string;
    decision_recorded?: string;
    offer_deadlines_processed?: string;
    registration_converted?: string;
    registration_reopened?: string;
    registration_deadlines_processed?: string;
    offer_deadlines_demo?: string;
    conversion_demo?: string;
    registration_reopened_demo?: string;
    registration_deadlines_demo?: string;
    document_demo?: string;
    review_demo?: string;
    decision_demo?: string;
  }>;
}) {
  const staffProfile = await requirePermission("manage_admissions");
  const params = await searchParams;
  const applications = await getStaffReviewApplications(staffProfile.id);

  return (
    <AppShell
      title="Application Review"
      subtitle="Submitted applications, evidence checks, support needs, and decision readiness"
      actions={
        <Link className="button" href="/admissions">
          Back to admissions
        </Link>
      }
    >
      {params.document_verified ||
      params.review_saved ||
      params.decision_recorded ||
      params.registration_converted ||
      params.registration_reopened ||
      params.registration_deadlines_processed ||
      params.offer_deadlines_processed ||
      params.document_demo ||
      params.review_demo ||
      params.decision_demo ||
      params.conversion_demo ||
      params.registration_reopened_demo ||
      params.registration_deadlines_demo ||
      params.offer_deadlines_demo ? (
        <div className="apply-success" role="status">
          <ShieldAlert size={18} />
          <div>
            <h2>
              {params.offer_deadlines_processed || params.offer_deadlines_demo
                ? "Offer deadlines processed"
                : params.registration_deadlines_processed || params.registration_deadlines_demo
                ? "Registration deadlines processed"
                : params.registration_reopened || params.registration_reopened_demo
                ? "Registration reopened"
                : params.registration_converted || params.conversion_demo
                  ? "Registration converted"
                : params.decision_recorded || params.decision_demo
                ? "Decision recorded"
                : params.review_saved || params.review_demo
                  ? "Review saved"
                  : "Document verification saved"}
            </h2>
            <p>
              {params.document_demo ||
              params.review_demo ||
              params.decision_demo ||
              params.offer_deadlines_demo ||
              params.registration_deadlines_demo ||
              params.registration_reopened_demo ||
              params.conversion_demo
                ? "Demo mode simulated the action."
                : params.offer_deadlines_processed
                  ? "Eligible reminders and lapsed offers were logged with suppressed correspondence. No applicant email was sent."
                : params.registration_deadlines_processed
                  ? "Eligible overdue registrations were marked lapsed with suppressed correspondence. No applicant email was sent."
                : params.registration_reopened
                  ? "The lapsed registration was reopened, audited, and logged with suppressed correspondence. No applicant email was sent."
                : params.registration_converted
                  ? "The linked student record and planned initial enrolments were created or activated. No finance rows were created."
                : params.decision_recorded
                  ? "The lead moved to offered or rejected, a suppressed correspondence log was recorded, and no applicant email was sent."
                  : "Audit events were recorded for the staff action."}
            </p>
          </div>
        </div>
      ) : null}

      <OfferDeadlineWorkflowPanel />
      <RegistrationDeadlineWorkflowPanel />

      {applications.length === 0 ? (
        <EmptyState
          title="No submitted applications"
          detail="Submitted, offered, accepted, declined, and lapsed applicant records appear here for admissions review and offer operations."
        />
      ) : (
        <section className="section">
          <div className="section-header">
            <div>
              <h2>Submitted Applications</h2>
              <p>{applications.length} application{applications.length === 1 ? "" : "s"} awaiting review or decision readiness</p>
            </div>
          </div>
          <div className="review-application-list">
            {applications.map((application, index) => (
              <ReviewApplicationRecord
                key={application.id}
                application={application}
                open={params.application ? params.application === application.id : index === 0}
              />
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
