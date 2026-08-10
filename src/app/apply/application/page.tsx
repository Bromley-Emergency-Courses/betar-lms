import { CheckCircle2, FileText, LockKeyhole, ShieldCheck, Upload } from "lucide-react";
import { Field, FormGrid } from "@/components/forms";
import {
  resubmitApplicationCorrections,
  saveApplicationDraft,
  uploadApplicationCorrectionDocument,
  uploadApplicationDocument
} from "@/app/apply/application/actions";
import { ApplicationCorrectionFieldResponse } from "@/app/apply/application/application-correction-field-response";
import { ApplicationSubmitControls } from "@/app/apply/application/application-submit-controls";
import {
  StudyPlanFields,
  type ApplicationOfferingOption,
  type ApplicationTermOption
} from "@/app/apply/application/study-plan-fields";
import {
  applicationDocumentSlotDefinitions,
  type ApplicationDocumentSlotKey,
  type ApplicationDocumentVerificationStatus
} from "@/lib/application-documents";
import {
  applicationCorrectionFieldKeys,
  applicationCorrectionFieldLabel,
  type ApplicationCorrectionFieldKey
} from "@/lib/application-corrections";
import { applicationDeclarationText } from "@/lib/application-submit";
import { requireApplicantProfile, type PortalProfile } from "@/lib/portal-auth";
import { getAppData } from "@/lib/seed";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface ApplicantInvitationSummary {
  id: string;
  admissionLeadId: string;
  email: string;
  status: string;
  invitedAt: string;
  expiresAt: string;
}

interface ApplicationDraftSummary {
  id: string;
  admissionLeadId: string;
  status: "draft" | "submitted";
  programme: "pgcert" | "microcredential";
  intendedStartTermId: string | null;
  selectedOfferingIds: string[];
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
  fundingSource: "self_funded" | "employer_sponsor" | "nhs_trust" | "other" | "unknown";
  fundingOrganisation?: string;
  fundingContact?: string;
  supportNeedsDisclosed: boolean;
  supportNeedsDetail?: string;
  supportNeedsAdjustments?: string;
  pocusPreviousExperience?: string;
  pocusMotivation?: string;
  pocusCaseImprovedManagement?: string;
  pocusLimitationsCase?: string;
  evidenceSummary?: string;
  submittedAt?: string;
  declarationAcceptedAt?: string;
  lastSavedAt: string;
}

interface ApplicationDocumentSlotSummary {
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
}

interface ApplicantCorrectionItemSummary {
  id: string;
  targetType: "application_field" | "document_slot";
  targetKey: string;
  instructions: string;
  status: "open" | "resubmitted" | "accepted";
  baselineValue: string | number | boolean | null;
  proposedValue: string | number | boolean | null;
  replacementManagedFileId?: string;
  responseNote?: string;
  savedAt?: string;
}

interface ApplicantCorrectionRequestSummary {
  id: string;
  applicationId: string;
  status: "open" | "resubmitted";
  summary?: string;
  dueAt: string;
  requestedAt: string;
  revisionNumber: number;
  items: ApplicantCorrectionItemSummary[];
}

type ApplicationDraftRow = {
  id: string;
  admission_lead_id: string;
  status: "draft" | "submitted";
  programme: "pgcert" | "microcredential";
  intended_start_term_id: string | null;
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
  funding_source: ApplicationDraftSummary["fundingSource"] | null;
  funding_organisation: string | null;
  funding_contact: string | null;
  pocus_previous_experience: string | null;
  pocus_motivation: string | null;
  pocus_case_improved_management: string | null;
  pocus_limitations_case: string | null;
  evidence_summary: string | null;
  submitted_at: string | null;
  declaration_accepted_at: string | null;
  last_saved_at: string;
};

type SupportNeedsRow = {
  disclosed: boolean | null;
  support_detail: string | null;
  requested_adjustments: string | null;
};

type ApplicationDocumentSlotRow = {
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
};

type ApplicantCorrectionRequestRow = {
  id: string;
  application_id: string;
  status: "open" | "resubmitted";
  summary: string | null;
  due_at: string;
  requested_at: string;
  revision_number: number;
};

type ApplicantCorrectionItemRow = {
  id: string;
  target_type: "application_field" | "document_slot";
  target_key: string;
  instructions: string;
  status: "open" | "resubmitted" | "accepted";
  baseline_value: string | number | boolean | null;
  proposed_value: string | number | boolean | null;
  replacement_managed_file_id: string | null;
  applicant_response_note: string | null;
  applicant_saved_at: string | null;
};

function optionalString(value: string | null | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function relatedObject(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    return value[0] && typeof value[0] === "object" ? (value[0] as Record<string, unknown>) : undefined;
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function mapApplicationDraft(
  row: ApplicationDraftRow,
  selectedOfferingIds: string[],
  supportNeeds?: SupportNeedsRow
): ApplicationDraftSummary {
  return {
    id: row.id,
    admissionLeadId: row.admission_lead_id,
    status: row.status,
    programme: row.programme,
    intendedStartTermId: row.intended_start_term_id,
    selectedOfferingIds,
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
    supportNeedsDisclosed: Boolean(supportNeeds?.disclosed),
    supportNeedsDetail: optionalString(supportNeeds?.support_detail),
    supportNeedsAdjustments: optionalString(supportNeeds?.requested_adjustments),
    pocusPreviousExperience: optionalString(row.pocus_previous_experience),
    pocusMotivation: optionalString(row.pocus_motivation),
    pocusCaseImprovedManagement: optionalString(row.pocus_case_improved_management),
    pocusLimitationsCase: optionalString(row.pocus_limitations_case),
    evidenceSummary: optionalString(row.evidence_summary),
    submittedAt: optionalString(row.submitted_at),
    declarationAcceptedAt: optionalString(row.declaration_accepted_at),
    lastSavedAt: row.last_saved_at
  };
}

async function getApplicantApplicationContext(personId: string): Promise<{
  invitations: ApplicantInvitationSummary[];
  draft?: ApplicationDraftSummary;
  documentSlots: ApplicationDocumentSlotSummary[];
  correctionRequest?: ApplicantCorrectionRequestSummary;
  terms: ApplicationTermOption[];
  offerings: ApplicationOfferingOption[];
}> {
  const today = new Date().toISOString().slice(0, 10);

  if (!isSupabaseConfigured()) {
    const data = getAppData();
    const terms = data.terms
      .filter((term) => ["published", "active"].includes(term.status) && term.startsOn >= today)
      .map((term) => ({ id: term.id, name: term.name, startsOn: term.startsOn }));
    const termIds = new Set(terms.map((term) => term.id));
    const activeModulesById = new Map(data.modules.filter((courseModule) => courseModule.active).map((courseModule) => [courseModule.id, courseModule]));

    return {
      invitations: [
        {
          id: "demo-invitation",
          admissionLeadId: "11111111-1111-4111-8111-111111111111",
          email: "applicant@example.com",
          status: "claimed",
          invitedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        }
      ],
      draft: undefined,
      documentSlots: [],
      correctionRequest: undefined,
      terms,
      offerings: data.offerings
        .map((offering) => ({ offering, courseModule: activeModulesById.get(offering.moduleId) }))
        .filter(({ offering, courseModule }) => courseModule && termIds.has(offering.termId))
        .map(({ offering, courseModule }) => ({
          id: offering.id,
          termId: offering.termId,
          moduleCode: courseModule?.code ?? "",
          moduleTitle: courseModule?.title ?? "",
          credits: courseModule?.credits ?? 0,
          mode: courseModule?.mode ?? "online",
          capacity: offering.capacity
        }))
    };
  }

  const supabase = await createSupabaseServerClient();

  const [invitationResult, draftResult, termResult, offeringResult] = await Promise.all([
    supabase
      .from("application_invitations")
      .select("id, admission_lead_id, email, status, invited_at, expires_at")
      .eq("person_id", personId)
      .order("invited_at", { ascending: false }),
    supabase
      .from("applications")
      .select(
        `
          id,
          admission_lead_id,
          status,
          programme,
          intended_start_term_id,
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
          pocus_previous_experience,
          pocus_motivation,
          pocus_case_improved_management,
          pocus_limitations_case,
          evidence_summary,
          submitted_at,
          declaration_accepted_at,
          last_saved_at
        `
      )
      .eq("person_id", personId)
      .order("last_saved_at", { ascending: false }),
    supabase
      .from("terms")
      .select("id, name, starts_on")
      .in("status", ["published", "active"])
      .gte("starts_on", today)
      .order("starts_on"),
    supabase
      .from("module_offerings")
      .select(
        `
          id,
          term_id,
          capacity,
          course_modules!inner (
            code,
            title,
            credits,
            mode
          )
        `
      )
      .order("term_id")
  ]);

  if (invitationResult.error) {
    throw new Error(invitationResult.error.message);
  }
  if (draftResult.error) {
    throw new Error(draftResult.error.message);
  }
  if (termResult.error) {
    throw new Error(termResult.error.message);
  }
  if (offeringResult.error) {
    throw new Error(offeringResult.error.message);
  }

  const invitations = (invitationResult.data ?? []).map((row) => ({
    id: String(row.id),
    admissionLeadId: String(row.admission_lead_id),
    email: String(row.email),
    status: String(row.status),
    invitedAt: String(row.invited_at),
    expiresAt: String(row.expires_at)
  }));
  const claimedLeadIds = new Set(
    invitations.filter((invitation) => invitation.status === "claimed").map((invitation) => invitation.admissionLeadId)
  );
  const draftRows = ((draftResult.data ?? []) as ApplicationDraftRow[]).filter((row) => claimedLeadIds.has(row.admission_lead_id));
  const selectedDraftRow = draftRows[0];

  let draft: ApplicationDraftSummary | undefined;
  let documentSlots: ApplicationDocumentSlotSummary[] = [];
  let correctionRequest: ApplicantCorrectionRequestSummary | undefined;
  if (selectedDraftRow) {
    const [choiceResult, supportNeedsResult, documentSlotResult, correctionRequestResult] = await Promise.all([
      supabase
        .from("application_module_offering_choices")
        .select("offering_id")
        .eq("application_id", selectedDraftRow.id)
        .order("choice_order"),
      supabase
        .from("application_support_needs")
        .select("disclosed, support_detail, requested_adjustments")
        .eq("application_id", selectedDraftRow.id)
        .maybeSingle<SupportNeedsRow>(),
      supabase
        .from("application_document_slots")
        .select(
          "slot_key, label, required, managed_file_id, original_filename, sanitized_filename, content_type, size_bytes, uploaded_at, verification_status"
        )
        .eq("application_id", selectedDraftRow.id)
        .order("required", { ascending: false }),
      supabase
        .from("application_correction_requests")
        .select("id, application_id, status, summary, due_at, requested_at, revision_number")
        .eq("application_id", selectedDraftRow.id)
        .in("status", ["open", "resubmitted"])
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle<ApplicantCorrectionRequestRow>()
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
    if (correctionRequestResult.error) {
      throw new Error(correctionRequestResult.error.message);
    }

    draft = mapApplicationDraft(
      selectedDraftRow,
      (choiceResult.data ?? []).map((row) => String(row.offering_id)),
      supportNeedsResult.data ?? undefined
    );
    documentSlots = ((documentSlotResult.data ?? []) as ApplicationDocumentSlotRow[]).map((row) => ({
      slotKey: row.slot_key,
      label: row.label,
      required: row.required,
      managedFileId: optionalString(row.managed_file_id),
      originalFilename: optionalString(row.original_filename),
      sanitizedFilename: optionalString(row.sanitized_filename),
      contentType: optionalString(row.content_type),
      sizeBytes: row.size_bytes ?? undefined,
      uploadedAt: optionalString(row.uploaded_at),
      verificationStatus: row.verification_status
    }));

    if (correctionRequestResult.data) {
      const requestRow = correctionRequestResult.data;
      const correctionItemResult = await supabase
        .from("application_correction_items")
        .select("id, target_type, target_key, instructions, status, baseline_value, proposed_value, replacement_managed_file_id, applicant_response_note, applicant_saved_at")
        .eq("request_id", requestRow.id)
        .order("created_at");
      if (correctionItemResult.error) {
        throw new Error(correctionItemResult.error.message);
      }

      correctionRequest = {
        id: requestRow.id,
        applicationId: requestRow.application_id,
        status: requestRow.status,
        summary: optionalString(requestRow.summary),
        dueAt: requestRow.due_at,
        requestedAt: requestRow.requested_at,
        revisionNumber: requestRow.revision_number,
        items: ((correctionItemResult.data ?? []) as ApplicantCorrectionItemRow[]).map((row) => ({
          id: row.id,
          targetType: row.target_type,
          targetKey: row.target_key,
          instructions: row.instructions,
          status: row.status,
          baselineValue: row.baseline_value,
          proposedValue: row.proposed_value,
          replacementManagedFileId: optionalString(row.replacement_managed_file_id),
          responseNote: optionalString(row.applicant_response_note),
          savedAt: optionalString(row.applicant_saved_at)
        }))
      };
    }
  }

  return {
    invitations,
    draft,
    documentSlots,
    correctionRequest,
    terms: (termResult.data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      startsOn: String(row.starts_on)
    })),
    offerings: (offeringResult.data ?? []).map((row) => {
      const courseModule = relatedObject(row.course_modules);
      return {
        id: String(row.id),
        termId: String(row.term_id),
        moduleCode: String(courseModule?.code ?? ""),
        moduleTitle: String(courseModule?.title ?? ""),
        credits: Number(courseModule?.credits ?? 0),
        mode: courseModule?.mode === "practical" ? "practical" : "online",
        capacity: Number(row.capacity ?? 0)
      };
    })
  };
}

function ApplicationSection({
  title,
  status = "Draft",
  children
}: {
  title: string;
  status?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="application-section">
      <div className="application-section-heading">
        <h3>{title}</h3>
        <span>{status}</span>
      </div>
      {children}
    </div>
  );
}

function ApplicationSubmittedPanel({
  draft,
  hasActiveCorrections
}: {
  draft: ApplicationDraftSummary;
  hasActiveCorrections: boolean;
}) {
  return (
    <div className="apply-form-panel application-draft-form">
      <div className="section-header">
        <div>
          <h2>Application submitted</h2>
          <p>
            Submitted {draft.submittedAt ? new Date(draft.submittedAt).toLocaleString("en-GB") : "for admissions review"}.
          </p>
        </div>
        <div className="icon-box">
          <ShieldCheck size={18} />
        </div>
      </div>
      <div className="application-preview-box">
        <strong>{hasActiveCorrections ? "Original submission preserved" : "Locked for admissions review"}</strong>
        <p className="muted small">
          {hasActiveCorrections
            ? "Only the specific corrections requested by admissions can be changed below."
            : `Programme: ${draft.programme === "pgcert" ? "PGCert" : "Microcredential"} · selected first-term offerings: ${draft.selectedOfferingIds.length}`}
        </p>
      </div>
    </div>
  );
}

function isApplicationCorrectionFieldKey(value: string): value is ApplicationCorrectionFieldKey {
  return applicationCorrectionFieldKeys.some((key) => key === value);
}

function displayCorrectionValue(value: string | number | boolean | null): string {
  if (value === null || value === "") return "Not previously provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).replaceAll("_", " ");
}

function ApplicationCorrectionPanel({
  request
}: {
  request: ApplicantCorrectionRequestSummary;
}) {
  const editable = request.status === "open";
  const unresolvedItems = request.items.filter((item) => item.status !== "accepted");
  const addressedItems = unresolvedItems.filter((item) =>
    item.targetType === "document_slot" ? Boolean(item.replacementManagedFileId) : Boolean(item.savedAt)
  );
  const allAddressed = unresolvedItems.length > 0 && addressedItems.length === unresolvedItems.length;

  return (
    <div className="apply-form-panel application-draft-form application-correction-panel">
      <div className="section-header">
        <div>
          <h2>{editable ? "Admissions needs more information" : "Corrections sent to admissions"}</h2>
          <p>
            {editable
              ? `Address each requested item and resubmit by ${new Date(request.dueAt).toLocaleDateString("en-GB")}.`
              : "Your responses are locked while admissions reviews them. If another change is needed, this section will reopen."}
          </p>
        </div>
        <div className="icon-box">
          {editable ? <FileText size={18} /> : <ShieldCheck size={18} />}
        </div>
      </div>

      {request.summary ? <div className="application-preview-box"><strong>Admissions summary</strong><p className="muted small">{request.summary}</p></div> : null}

      <div className="application-document-list">
        {request.items.map((item, index) => {
          const fieldKey = item.targetType === "application_field" && isApplicationCorrectionFieldKey(item.targetKey)
            ? item.targetKey
            : null;
          const documentDefinition = item.targetType === "document_slot"
            ? applicationDocumentSlotDefinitions.find((definition) => definition.key === item.targetKey)
            : undefined;
          const itemEditable = editable && item.status !== "accepted";
          const itemAddressed = item.status === "accepted"
            || (item.targetType === "document_slot" ? Boolean(item.replacementManagedFileId) : Boolean(item.savedAt));

          return (
            <article className="application-document-slot" key={item.id}>
              <div>
                <div className="application-document-slot-heading">
                  <strong>
                    {index + 1}. {fieldKey
                      ? applicationCorrectionFieldLabel(fieldKey)
                      : documentDefinition?.label ?? item.targetKey.replaceAll("_", " ")}
                  </strong>
                  <span>{item.status === "accepted" ? "Accepted" : itemAddressed ? "Response saved" : "Action required"}</span>
                </div>
                <p>{item.instructions}</p>
                {fieldKey ? <p className="muted small">Previously submitted: {displayCorrectionValue(item.baselineValue)}</p> : null}
                {item.savedAt ? <p className="muted small">Last saved {new Date(item.savedAt).toLocaleString("en-GB")}</p> : null}
              </div>

              {itemEditable && fieldKey ? (
                <ApplicationCorrectionFieldResponse
                  itemId={item.id}
                  fieldKey={fieldKey}
                  initialValue={item.savedAt ? item.proposedValue : item.baselineValue}
                  initialCleared={Boolean(item.savedAt) && item.proposedValue === null}
                  responseNote={item.responseNote}
                />
              ) : null}

              {itemEditable && documentDefinition ? (
                <form className="application-correction-response-form" action={uploadApplicationCorrectionDocument}>
                  <input type="hidden" name="application_id" value={request.applicationId} />
                  <input type="hidden" name="item_id" value={item.id} />
                  <input type="hidden" name="slot_key" value={documentDefinition.key} />
                  <label>
                    <span>{item.replacementManagedFileId ? "Replace the saved file" : "Replacement document"}</span>
                    <input
                      className="input"
                      name="document"
                      type="file"
                      accept={documentDefinition.acceptedExtensions.join(",")}
                      required
                    />
                  </label>
                  <p className="muted small">
                    PDF is recommended. Maximum {Math.floor(documentDefinition.maxBytes / 1024 / 1024)} MB for this document.
                  </p>
                  <label>
                    <span>Note to admissions (optional)</span>
                    <textarea className="textarea" name="response_note" rows={2} maxLength={2000} defaultValue={item.responseNote} />
                  </label>
                  <button className="button secondary" type="submit">
                    <Upload size={16} /> {item.replacementManagedFileId ? "Upload another replacement" : "Upload replacement"}
                  </button>
                </form>
              ) : null}
            </article>
          );
        })}
      </div>

      {editable ? (
        <div className="application-actions">
          <div className="application-preview-box">
            <strong>{allAddressed ? "Ready to resubmit" : `${addressedItems.length} of ${unresolvedItems.length} requested items addressed`}</strong>
            <p className="muted small">Save or upload a response for every requested item before sending the corrections back to admissions.</p>
          </div>
          <form action={resubmitApplicationCorrections}>
            <input type="hidden" name="request_id" value={request.id} />
            <button className="button primary apply-submit" type="submit" disabled={!allAddressed}>
              <ShieldCheck size={16} /> Resubmit corrections
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
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

function ApplicationDocumentSlotsPanel({
  applicationId,
  documentSlots,
  editable
}: {
  applicationId: string;
  documentSlots: ApplicationDocumentSlotSummary[];
  editable: boolean;
}) {
  const slotByKey = new Map(documentSlots.map((slot) => [slot.slotKey, slot]));

  return (
    <div className="apply-form-panel application-draft-form">
      <div className="section-header">
        <div>
          <h2>Application evidence</h2>
          <p>Upload the required evidence before final submission. Optional evidence can be added where it supports the application.</p>
        </div>
        <div className="icon-box">
          <Upload size={18} />
        </div>
      </div>

      <div className="application-document-list">
        {applicationDocumentSlotDefinitions.map((definition) => {
          const uploadedSlot = slotByKey.get(definition.key);
          const uploadedAt = uploadedSlot?.uploadedAt ? new Date(uploadedSlot.uploadedAt).toLocaleString("en-GB") : null;

          return (
            <div className="application-document-slot" key={definition.key}>
              <div>
                <div className="application-document-slot-heading">
                  <strong>{uploadedSlot?.label ?? definition.label}</strong>
                  <span>{definition.required ? "Required" : "Optional"}</span>
                </div>
                {uploadedSlot?.managedFileId ? (
                  <p className="muted small">
                    {uploadedSlot.sanitizedFilename ?? uploadedSlot.originalFilename ?? "Uploaded file"} · {formatFileSize(uploadedSlot.sizeBytes)}
                    {uploadedAt ? ` · Uploaded ${uploadedAt}` : ""} · {uploadedSlot.verificationStatus.replaceAll("_", " ")}
                  </p>
                ) : (
                  <p className="muted small">No file uploaded.</p>
                )}
              </div>

              {editable ? (
                <form className="application-document-upload-form" action={uploadApplicationDocument}>
                  <input type="hidden" name="application_id" value={applicationId} />
                  <input type="hidden" name="slot_key" value={definition.key} />
                  <input
                    className="input"
                    name="document"
                    type="file"
                    accept={definition.acceptedExtensions.join(",")}
                    required
                  />
                  <button className="button secondary" type="submit">
                    <Upload size={16} />
                    Upload
                  </button>
                </form>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ApplicationDraftForm({
  admissionLeadId,
  draft,
  profile,
  terms,
  offerings
}: {
  admissionLeadId: string;
  draft?: ApplicationDraftSummary;
  profile: PortalProfile;
  terms: ApplicationTermOption[];
  offerings: ApplicationOfferingOption[];
}) {
  const firstName = draft?.firstName ?? profile.person.firstName;
  const lastName = draft?.lastName ?? profile.person.lastName;
  const email = draft?.email ?? profile.email;

  return (
    <form className="apply-form-panel application-draft-form" action={saveApplicationDraft}>
      <input type="hidden" name="admission_lead_id" value={draft?.admissionLeadId ?? admissionLeadId} />
      <div className="section-header">
        <div>
          <h2>Draft application</h2>
          <p>
            {draft?.lastSavedAt
              ? `Last saved ${new Date(draft.lastSavedAt).toLocaleString("en-GB")}`
              : "Save your application as you gather the details admissions needs."}
          </p>
        </div>
        <div className="icon-box">
          <FileText size={18} />
        </div>
      </div>

      <ApplicationSection title="Personal">
        <FormGrid>
          <Field label="Title" htmlFor="application-title">
            <input id="application-title" name="title" className="input" defaultValue={draft?.title ?? ""} />
          </Field>
          <Field label="First name" htmlFor="application-first-name" required>
            <input id="application-first-name" name="first_name" className="input" defaultValue={firstName} required />
          </Field>
          <Field label="Middle names" htmlFor="application-middle-names">
            <input id="application-middle-names" name="middle_names" className="input" defaultValue={draft?.middleNames ?? ""} />
          </Field>
          <Field label="Last name" htmlFor="application-last-name" required>
            <input id="application-last-name" name="last_name" className="input" defaultValue={lastName} required />
          </Field>
          <Field label="Preferred name" htmlFor="application-preferred-name">
            <input id="application-preferred-name" name="preferred_name" className="input" defaultValue={draft?.preferredName ?? profile.person.preferredName ?? ""} />
          </Field>
          <Field label="Previous surname" htmlFor="application-previous-surname">
            <input id="application-previous-surname" name="previous_surname" className="input" defaultValue={draft?.previousSurname ?? ""} />
          </Field>
          <Field label="Date of birth" htmlFor="application-date-of-birth" required>
            <input id="application-date-of-birth" name="date_of_birth" className="input" type="date" defaultValue={draft?.dateOfBirth ?? ""} required />
          </Field>
          <Field label="Previous BETAR/university study" htmlFor="application-previous-study">
            <input id="application-previous-study" name="previous_study_detail" className="input" defaultValue={draft?.previousStudyDetail ?? ""} />
          </Field>
          <Field label="Partner/university student ID" htmlFor="application-partner-student-id">
            <input id="application-partner-student-id" name="partner_student_id" className="input" defaultValue={draft?.partnerStudentId ?? ""} />
          </Field>
        </FormGrid>
      </ApplicationSection>

      <ApplicationSection title="Contact">
        <FormGrid>
          <Field label="Email" htmlFor="application-email" required>
            <input id="application-email" name="email" className="input" type="email" defaultValue={email} required />
          </Field>
          <Field label="Phone" htmlFor="application-phone" required>
            <input id="application-phone" name="phone" className="input" type="tel" defaultValue={draft?.phone ?? ""} required />
          </Field>
          <Field label="Address line 1" htmlFor="application-address-line-1" required>
            <input id="application-address-line-1" name="address_line_1" className="input" defaultValue={draft?.addressLine1 ?? ""} required />
          </Field>
          <Field label="Address line 2" htmlFor="application-address-line-2">
            <input id="application-address-line-2" name="address_line_2" className="input" defaultValue={draft?.addressLine2 ?? ""} />
          </Field>
          <Field label="City/town" htmlFor="application-city" required>
            <input id="application-city" name="city" className="input" defaultValue={draft?.city ?? ""} required />
          </Field>
          <Field label="Postcode" htmlFor="application-postcode" required>
            <input id="application-postcode" name="postcode" className="input" defaultValue={draft?.postcode ?? ""} required />
          </Field>
          <Field label="Country" htmlFor="application-country" required>
            <input id="application-country" name="country" className="input" defaultValue={draft?.country ?? ""} required />
          </Field>
        </FormGrid>
      </ApplicationSection>

      <ApplicationSection title="Employment">
        <FormGrid>
          <Field label="Current clinical role" htmlFor="application-clinical-role" required>
            <input id="application-clinical-role" name="clinical_role" className="input" defaultValue={draft?.clinicalRole ?? ""} required />
          </Field>
          <Field label="Employer/organisation" htmlFor="application-employer" required>
            <input id="application-employer" name="employer" className="input" defaultValue={draft?.employer ?? ""} required />
          </Field>
          <Field label="Department/specialty" htmlFor="application-department-specialty" required>
            <input id="application-department-specialty" name="department_specialty" className="input" defaultValue={draft?.departmentSpecialty ?? ""} required />
          </Field>
          <Field label="Registration body" htmlFor="application-registration-body" required>
            <input id="application-registration-body" name="professional_registration_body" className="input" defaultValue={draft?.professionalRegistrationBody ?? ""} required />
          </Field>
          <Field label="Registration number" htmlFor="application-registration-number" required>
            <input id="application-registration-number" name="professional_registration_number" className="input" defaultValue={draft?.professionalRegistrationNumber ?? ""} required />
          </Field>
        </FormGrid>
        <Field label="Relevant clinical experience" htmlFor="application-work-experience" required>
          <textarea
            id="application-work-experience"
            name="work_experience"
            className="textarea"
            defaultValue={draft?.workExperience ?? ""}
            maxLength={4000}
            required
          />
        </Field>
      </ApplicationSection>

      <ApplicationSection title="Qualifications">
        <FormGrid>
          <Field label="Qualification title/level" htmlFor="application-highest-qualification" required>
            <input id="application-highest-qualification" name="highest_qualification" className="input" defaultValue={draft?.highestQualification ?? ""} required />
          </Field>
          <Field label="Awarding body" htmlFor="application-awarding-body" required>
            <input id="application-awarding-body" name="qualification_awarding_body" className="input" defaultValue={draft?.qualificationAwardingBody ?? ""} required />
          </Field>
          <Field label="Award year" htmlFor="application-qualification-year" required>
            <input
              id="application-qualification-year"
              name="qualification_year"
              className="input"
              type="number"
              min="1900"
              max="2100"
              defaultValue={draft?.qualificationYear ?? ""}
              required
            />
          </Field>
          <Field label="Result/classification" htmlFor="application-qualification-result">
            <input id="application-qualification-result" name="qualification_result" className="input" defaultValue={draft?.qualificationResult ?? ""} />
          </Field>
          <Field label="Country awarded" htmlFor="application-qualification-country">
            <input id="application-qualification-country" name="qualification_country" className="input" defaultValue={draft?.qualificationCountry ?? ""} />
          </Field>
        </FormGrid>
      </ApplicationSection>

      <StudyPlanFields
        programme={draft?.programme ?? "pgcert"}
        intendedStartTermId={draft?.intendedStartTermId ?? null}
        selectedOfferingIds={draft?.selectedOfferingIds ?? []}
        terms={terms}
        offerings={offerings}
      />

      <ApplicationSection title="Nationality And Visa">
        <FormGrid>
          <Field label="Nationality" htmlFor="application-nationality" required>
            <input id="application-nationality" name="nationality" className="input" defaultValue={draft?.nationality ?? ""} required />
          </Field>
          <Field label="Country of birth" htmlFor="application-country-of-birth">
            <input id="application-country-of-birth" name="country_of_birth" className="input" defaultValue={draft?.countryOfBirth ?? ""} />
          </Field>
          <Field label="Country of ordinary residence" htmlFor="application-country-of-residence" required>
            <input id="application-country-of-residence" name="country_of_residence" className="input" defaultValue={draft?.countryOfResidence ?? ""} required />
          </Field>
        </FormGrid>
        <label className="check-option inline-check">
          <input name="needs_visa_check" type="checkbox" defaultChecked={draft?.needsVisaCheck ?? false} /> Needs visa/right-to-study check
        </label>
        <Field label="Visa/right-to-study notes" htmlFor="application-visa-notes">
          <textarea id="application-visa-notes" name="visa_notes" className="textarea" defaultValue={draft?.visaNotes ?? ""} maxLength={1000} />
        </Field>
      </ApplicationSection>

      <ApplicationSection title="Funding">
        <FormGrid>
          <Field label="Expected funding source" htmlFor="application-funding-source">
            <select id="application-funding-source" name="funding_source" className="select" defaultValue={draft?.fundingSource ?? "unknown"}>
              <option value="unknown">Unknown</option>
              <option value="self_funded">Self-funded</option>
              <option value="employer_sponsor">Employer/sponsor</option>
              <option value="nhs_trust">NHS/trust</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Funding organisation" htmlFor="application-funding-organisation">
            <input id="application-funding-organisation" name="funding_organisation" className="input" defaultValue={draft?.fundingOrganisation ?? ""} />
          </Field>
          <Field label="Funding contact" htmlFor="application-funding-contact">
            <input id="application-funding-contact" name="funding_contact" className="input" defaultValue={draft?.fundingContact ?? ""} />
          </Field>
        </FormGrid>
      </ApplicationSection>

      <ApplicationSection title="Support Needs" status="Optional">
        <p className="muted small">
          Disclosure is used to arrange reasonable adjustments or support and does not negatively affect academic consideration.
        </p>
        <label className="check-option inline-check">
          <input name="support_needs_disclosed" type="checkbox" defaultChecked={draft?.supportNeedsDisclosed ?? false} /> I want to disclose support needs
        </label>
        <Field label="Support needs detail" htmlFor="application-support-detail">
          <textarea id="application-support-detail" name="support_needs_detail" className="textarea" defaultValue={draft?.supportNeedsDetail ?? ""} maxLength={3000} />
        </Field>
        <Field label="Requested adjustments" htmlFor="application-support-adjustments">
          <textarea
            id="application-support-adjustments"
            name="support_needs_adjustments"
            className="textarea"
            defaultValue={draft?.supportNeedsAdjustments ?? ""}
            maxLength={2000}
          />
        </Field>
      </ApplicationSection>

      <ApplicationSection title="POCUS Questions">
        <Field label="Your previous experience in POCUS" htmlFor="application-pocus-experience" required>
          <textarea
            id="application-pocus-experience"
            name="pocus_previous_experience"
            className="textarea"
            defaultValue={draft?.pocusPreviousExperience ?? ""}
            maxLength={4000}
            required
          />
        </Field>
        <Field label="Your motivation to enrol in this course" htmlFor="application-pocus-motivation" required>
          <textarea id="application-pocus-motivation" name="pocus_motivation" className="textarea" defaultValue={draft?.pocusMotivation ?? ""} maxLength={4000} required />
        </Field>
        <Field label="Case where POCUS improved clinical management" htmlFor="application-pocus-case-improved" required>
          <textarea
            id="application-pocus-case-improved"
            name="pocus_case_improved_management"
            className="textarea"
            defaultValue={draft?.pocusCaseImprovedManagement ?? ""}
            maxLength={4000}
            required
          />
        </Field>
        <Field label="Case where you recognised POCUS limitations" htmlFor="application-pocus-limitations" required>
          <textarea
            id="application-pocus-limitations"
            name="pocus_limitations_case"
            className="textarea"
            defaultValue={draft?.pocusLimitationsCase ?? ""}
            maxLength={4000}
            required
          />
        </Field>
      </ApplicationSection>

      <ApplicationSection title="Evidence And Preview" status="Draft only">
        <Field label="Evidence summary" htmlFor="application-evidence-summary">
          <textarea
            id="application-evidence-summary"
            name="evidence_summary"
            className="textarea"
            defaultValue={draft?.evidenceSummary ?? ""}
            maxLength={2000}
          />
        </Field>
        <ApplicationSubmitControls applicationId={draft?.id} declarationText={applicationDeclarationText} />
      </ApplicationSection>
    </form>
  );
}

export default async function ApplicationAccessPage({
  searchParams
}: {
  searchParams: Promise<{
    saved?: string;
    submitted?: string;
    document?: string;
    submit_error?: string;
    correction_saved?: string;
    correction_document?: string;
    correction_submitted?: string;
    correction_error?: string;
  }>;
}) {
  const profile = await requireApplicantProfile("/apply/application");
  const {
    saved,
    submitted,
    document,
    submit_error: submitError,
    correction_saved: correctionSaved,
    correction_document: correctionDocument,
    correction_submitted: correctionSubmitted,
    correction_error: correctionError
  } = await searchParams;
  const { invitations, draft, documentSlots, correctionRequest, terms, offerings } = await getApplicantApplicationContext(profile.personId);
  const latestInvitation = invitations[0];
  const claimedInvitation =
    invitations.find((invitation) => invitation.status === "claimed" && invitation.admissionLeadId === draft?.admissionLeadId) ??
    invitations.find((invitation) => invitation.status === "claimed");

  return (
    <main className="apply-page">
      <section className="apply-intake">
        <div className="apply-heading">
          <div className="brand-mark">B</div>
          <div>
            <span className="apply-kicker">Applicant portal</span>
            <h1>University-style application</h1>
            <p>
              Signed in as {profile.person.firstName} {profile.person.lastName}. Save your application draft as you gather your details.
            </p>
          </div>
        </div>

        {saved ? (
          <div className="apply-success" role="status">
            <CheckCircle2 size={22} />
            <div>
              <h2>Draft saved</h2>
              <p>{saved === "demo" ? "Demo mode is running without a Supabase database, so no live draft was saved." : "Your latest changes have been saved. To return later, request a fresh sign-in link from the applicant login page; invitation links are single-use."}</p>
            </div>
          </div>
        ) : null}

        {submitError ? (
          <div className="apply-error" role="alert">
            <LockKeyhole size={22} />
            <div>
              <h2>Application not submitted</h2>
              <p>
                {submitError === "unsaved"
                  ? "Save your latest changes before submitting."
                  : submitError === "study_plan"
                    ? "Choose a current published start term and one or two available module offerings."
                    : submitError === "incomplete"
                      ? "Complete every field marked with a red asterisk and upload both required evidence documents."
                      : "The application could not be submitted. Your saved draft is unchanged; please try again or contact admissions."}
              </p>
            </div>
          </div>
        ) : null}

        {submitted ? (
          <div className="apply-success" role="status">
            <CheckCircle2 size={22} />
            <div>
              <h2>Application submitted</h2>
              <p>
                {submitted === "demo"
                  ? "Demo mode is running without a Supabase database, so no live application was submitted."
                  : "Your application has been locked and sent to admissions review."}
              </p>
            </div>
          </div>
        ) : null}

        {document ? (
          <div className="apply-success" role="status">
            <CheckCircle2 size={22} />
            <div>
              <h2>Document uploaded</h2>
              <p>{document === "demo" ? "Demo mode is running without Supabase storage, so no live document was uploaded." : "Your application evidence has been saved."}</p>
            </div>
          </div>
        ) : null}

        {correctionSaved || correctionDocument ? (
          <div className="apply-success" role="status">
            <CheckCircle2 size={22} />
            <div>
              <h2>Correction response saved</h2>
              <p>{correctionDocument ? "Your replacement evidence has been saved. Address every remaining item, then resubmit the corrections." : "Your corrected information has been saved. Address every remaining item, then resubmit the corrections."}</p>
            </div>
          </div>
        ) : null}

        {correctionSubmitted ? (
          <div className="apply-success" role="status">
            <CheckCircle2 size={22} />
            <div>
              <h2>Corrections resubmitted</h2>
              <p>Your responses are now locked and have been returned to admissions for review.</p>
            </div>
          </div>
        ) : null}

        {correctionError ? (
          <div className="apply-error" role="alert">
            <LockKeyhole size={22} />
            <div>
              <h2>Correction response not saved</h2>
              <p>
                {correctionError === "invalid_file"
                  ? "Choose one of the accepted file types within the stated size limit. Converting the document to PDF may help."
                  : correctionError === "incomplete"
                    ? "Address and save every requested item before resubmitting."
                    : correctionError === "invalid_response"
                      ? "Enter a corrected value or deliberately clear an optional value."
                      : "The correction response could not be saved. Please try again or contact admissions."}
              </p>
            </div>
          </div>
        ) : null}

        <div className="apply-form-panel">
          <div className="section-header">
            <div>
              <h2>Invitation</h2>
              <p>Invitation links are single-use. For later visits, use the applicant login page to request a fresh sign-in link.</p>
            </div>
            <div className="icon-box">
              <LockKeyhole size={18} />
            </div>
          </div>
          {latestInvitation ? (
            <div className="timeline-item" style={{ gridTemplateColumns: "1fr" }}>
              <div>
                <strong>{latestInvitation.email}</strong>
                <p className="muted small">
                  Status: {latestInvitation.status.replaceAll("_", " ")} · Invited{" "}
                  {new Date(latestInvitation.invitedAt).toLocaleDateString("en-GB")} · Expires{" "}
                  {new Date(latestInvitation.expiresAt).toLocaleDateString("en-GB")}
                </p>
              </div>
            </div>
          ) : (
            <p className="muted small">No application invitation is linked to this account yet.</p>
          )}
        </div>

        {draft?.status === "submitted" ? (
          <>
            {correctionRequest ? <ApplicationCorrectionPanel request={correctionRequest} /> : null}
            <ApplicationSubmittedPanel draft={draft} hasActiveCorrections={Boolean(correctionRequest)} />
            <ApplicationDocumentSlotsPanel applicationId={draft.id} documentSlots={documentSlots} editable={false} />
          </>
        ) : claimedInvitation ? (
          <>
            <ApplicationDraftForm
              admissionLeadId={claimedInvitation.admissionLeadId}
              draft={draft}
              profile={profile}
              terms={terms}
              offerings={offerings}
            />
            {draft ? (
              <ApplicationDocumentSlotsPanel applicationId={draft.id} documentSlots={documentSlots} editable />
            ) : (
              <div className="apply-form-panel application-draft-form">
                <div className="section-header">
                  <div>
                    <h2>Application evidence</h2>
                    <p>Save a draft before uploading evidence documents.</p>
                  </div>
                  <div className="icon-box">
                    <Upload size={18} />
                  </div>
                </div>
              </div>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
