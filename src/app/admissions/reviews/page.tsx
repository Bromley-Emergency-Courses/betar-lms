import { ClipboardCheck, FileCheck2, LockKeyhole, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { recordStaffApplicationReview, verifyApplicationDocument } from "@/app/admissions/reviews/actions";
import { DocumentOpenButton } from "@/app/admissions/reviews/document-open-button";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { Field, FormGrid } from "@/components/forms";
import { StatusPill } from "@/components/status-pill";
import {
  applicationSupportNeedsViewedAction,
  buildApplicationSupportNeedsViewedAuditMetadata,
  applicationReviewReadinessStatuses,
  type ApplicationReviewReadinessStatus
} from "@/lib/application-review";
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

function leadIsReviewable(lead: LeadJoin | undefined): boolean {
  return Boolean(
    lead &&
      !lead.archived &&
      !lead.converted_student_id &&
      typeof lead.stage === "string" &&
      ["submitted", "reviewed"].includes(lead.stage)
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

function mapApplication(row: ApplicationRow, data: AppData, choices: ChoiceRow[], support?: SupportNeedsRow, slots: DocumentSlotRow[] = [], review?: ReviewRow): StaffReviewApplication {
  const lead = joinedObject(row.admission_leads);
  return {
    id: row.id,
    admissionLeadId: row.admission_lead_id,
    personId: row.person_id,
    status: "submitted",
    leadStage: String(lead?.stage ?? "submitted"),
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
      : undefined
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
      leadStage: "submitted",
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
        readinessStatus: "not_ready"
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
    return leadIsReviewable(lead);
  });
  const applicationIds = applicationRows.map((row) => row.id);

  if (applicationIds.length === 0) {
    return [];
  }

  const [choiceResult, supportNeedsResult, documentSlotResult, reviewResult] = await Promise.all([
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
      .in("application_id", applicationIds)
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

  const choices = (choiceResult.data ?? []) as ChoiceRow[];
  const supportNeedsRows = (supportNeedsResult.data ?? []) as SupportNeedsRow[];
  await auditSupportNeedsViews(supabase, staffUserId, applicationRows, supportNeedsRows);
  const supportByApplicationId = new Map(supportNeedsRows.map((row) => [row.application_id, row]));
  const slots = (documentSlotResult.data ?? []) as DocumentSlotRow[];
  const reviewByApplicationId = new Map(((reviewResult.data ?? []) as ReviewRow[]).map((row) => [row.application_id, row]));

  return applicationRows.map((row) =>
    mapApplication(row, data, choices, supportByApplicationId.get(row.id), slots, reviewByApplicationId.get(row.id))
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
        </div>
      </div>

      <div className="review-data-grid">
        <DataItem label="Email" value={application.email} />
        <DataItem label="Phone" value={application.phone} />
        <DataItem label="Date of birth" value={formatDate(application.dateOfBirth)} />
        <DataItem label="Programme" value={application.programme === "pgcert" ? "PGCert" : "Microcredential"} />
        <DataItem label="Intended start term" value={startTerm} />
        <DataItem label="Selected offerings" value={application.selectedOfferings.length} />
      </div>
    </div>
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
      </div>
    </details>
  );
}

export default async function AdmissionsReviewsPage({
  searchParams
}: {
  searchParams: Promise<{ application?: string; document_verified?: string; review_saved?: string; document_demo?: string; review_demo?: string }>;
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
      {params.document_verified || params.review_saved || params.document_demo || params.review_demo ? (
        <div className="apply-success" role="status">
          <ShieldAlert size={18} />
          <div>
            <h2>{params.review_saved || params.review_demo ? "Review saved" : "Document verification saved"}</h2>
            <p>{params.document_demo || params.review_demo ? "Demo mode simulated the action." : "Audit events were recorded for the staff action."}</p>
          </div>
        </div>
      ) : null}

      {applications.length === 0 ? (
        <EmptyState title="No submitted applications" detail="Submitted applicant records will appear here before offer or rejection work begins." />
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
