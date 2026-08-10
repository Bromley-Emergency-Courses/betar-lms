import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  FileCheck2,
  History,
  LockKeyhole,
  Mail,
  ShieldAlert,
  UserRound
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { inviteAdmissionLeadToApply, updateAdmissionLead } from "@/lib/admin-actions";
import {
  abandonNewStudentAdmission,
  reopenAbandonedNewStudentAdmission,
  reissueLapsedApplicationOffer,
  withdrawApplicationOffer
} from "@/app/admissions/new-students/actions";
import {
  cancelApplicationCorrection,
  convertSubmittedAdmissionsRegistration,
  recordApplicationDecision,
  recordApplicationEvidenceOverride,
  recordStaffApplicationReview,
  reopenLapsedAdmissionsRegistration,
  verifyAdmissionsRegistrationDocument,
  verifyApplicationDocument
} from "@/app/admissions/reviews/actions";
import { DocumentOpenButton } from "@/app/admissions/reviews/document-open-button";
import {
  AdmissionsRecordSubmitButton,
  CorrectionRequestComposer,
  CorrectionReviewForm,
  RestrictedSupportNeedsReveal
} from "@/components/admissions-record-actions";
import { AdmissionsEmailPilotControls } from "@/components/admissions-email-pilot-controls";
import styles from "@/components/admissions-record.module.css";
import { AdmissionsLocalNavigation } from "@/components/admissions-workspace-shell";
import workspaceStyles from "@/components/admissions-workspace.module.css";
import { AppShell } from "@/components/app-shell";
import { applicationCorrectionFieldKeys } from "@/lib/application-corrections";
import { admissionsStaffWorkspacesEnabled } from "@/lib/admissions-feature";
import { newStudentJourneyStageLabels } from "@/lib/admissions-staff-workflow";
import { canConvertSubmittedRegistration } from "@/lib/admissions-conversion";
import { canReopenLapsedRegistration } from "@/lib/admissions-registration";
import { plainLanguageAdmissionsLabel } from "@/lib/admissions-workspace";
import { getAdmissionsOverviewData } from "@/lib/admissions-workspace-data";
import { requirePermission } from "@/lib/auth";
import {
  getNewStudentAdmissionRecord,
  type NewStudentAdmissionRecord,
  type NewStudentApplicationRecord
} from "@/lib/new-student-admissions-record";
import { getNewStudentFullRecordAvailability } from "@/lib/new-student-record-workflow";
import { newStudentTerminalActionAvailability } from "@/lib/new-student-terminal-actions";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

const fieldLabels: Record<string, string> = {
  title: "Title",
  first_name: "First name",
  middle_names: "Middle names",
  last_name: "Last name",
  preferred_name: "Preferred name",
  previous_surname: "Previous surname",
  date_of_birth: "Date of birth",
  previous_study_detail: "Previous study",
  partner_student_id: "Partner student ID",
  email: "Email",
  phone: "Phone",
  address_line_1: "Address line 1",
  address_line_2: "Address line 2",
  city: "City",
  postcode: "Postcode",
  country: "Country",
  clinical_role: "Clinical role",
  employer: "Employer",
  department_specialty: "Department or specialty",
  professional_registration_body: "Professional registration body",
  professional_registration_number: "Professional registration number",
  highest_qualification: "Highest qualification",
  qualification_awarding_body: "Awarding body",
  qualification_year: "Qualification year",
  qualification_result: "Qualification result",
  qualification_country: "Qualification country",
  work_experience: "Work experience",
  nationality: "Nationality",
  country_of_birth: "Country of birth",
  country_of_residence: "Country of residence",
  needs_visa_check: "Visa check needed",
  visa_notes: "Visa notes",
  funding_source: "Funding source",
  funding_organisation: "Funding organisation",
  funding_contact: "Funding contact",
  pocus_previous_experience: "Previous POCUS experience",
  pocus_motivation: "POCUS motivation",
  pocus_case_improved_management: "Case where POCUS could improve management",
  pocus_limitations_case: "POCUS limitations and escalation",
  evidence_summary: "Evidence summary"
};

const fieldGroups = [
  {
    title: "Personal and contact details",
    keys: ["title", "first_name", "middle_names", "last_name", "preferred_name", "previous_surname", "date_of_birth", "email", "phone", "address_line_1", "address_line_2", "city", "postcode", "country"]
  },
  {
    title: "Professional and qualification details",
    keys: ["clinical_role", "employer", "department_specialty", "professional_registration_body", "professional_registration_number", "highest_qualification", "qualification_awarding_body", "qualification_year", "qualification_result", "qualification_country", "previous_study_detail", "partner_student_id", "work_experience"]
  },
  {
    title: "Nationality, visa and funding",
    keys: ["nationality", "country_of_birth", "country_of_residence", "needs_visa_check", "visa_notes", "funding_source", "funding_organisation", "funding_contact"]
  },
  {
    title: "POCUS application answers",
    keys: ["pocus_previous_experience", "pocus_motivation", "pocus_case_improved_management", "pocus_limitations_case", "evidence_summary"]
  }
] as const;

const successMessages: Record<string, string> = {
  created: "New enquiry record created.",
  invited: "Application invitation issued and delivery attempted under the configured email mode.",
  document_verified: "Evidence decision saved.",
  review_saved: "Application review saved.",
  correction_requested: "Structured correction request created.",
  correction_reviewed: "Correction review recorded.",
  correction_cancelled: "Correction request cancelled with its history preserved.",
  evidence_override_recorded: "Evidence override recorded.",
  decision_recorded: "Application decision recorded and correspondence attempted when enabled.",
  registration_reopened: "Registration reopened for applicant resubmission.",
  registration_converted: "Registration converted to a student record and planned enrolments.",
  registration_document_verified: "Registration document verification state saved.",
  updated: "Administrative details updated without changing the journey stage.",
  admission_abandoned: "Admissions record closed as abandoned. It remains available and can be reopened.",
  admission_abandoned_demo: "Demo admissions record would be closed as abandoned.",
  abandonment_reopened: "Abandoned admissions record reopened at its previous pre-submission stage.",
  abandonment_reopened_demo: "Demo admissions record would be reopened.",
  offer_reissued: "Lapsed offer reissued with its new deadline and correspondence recorded.",
  offer_reissued_demo: "Demo offer would be reissued with the new deadline.",
  offer_withdrawn: "Offer withdrawn and the admissions record closed with its history preserved.",
  offer_withdrawn_demo: "Demo offer would be withdrawn."
};

function formatDate(value?: string): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

function formatDateTime(value?: string): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function displayValue(value: string | number | boolean | undefined): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === undefined || value === "") return "Not provided";
  return typeof value === "string" && value.includes("_") ? plainLanguageAdmissionsLabel(value) : String(value);
}

function resultMessage(searchParams: Record<string, string | string[] | undefined>): string | undefined {
  const key = Object.keys(successMessages).find((candidate) => searchParams[candidate] && candidate !== "invited");
  if (key) return successMessages[key];
  return ["1", "demo"].includes(String(searchParams.invited ?? "")) ? successMessages.invited : undefined;
}

function warningMessage(searchParams: Record<string, string | string[] | undefined>): string | undefined {
  if (searchParams.invited === "email_disabled") return "The invitation workflow record was created, but email delivery is disabled.";
  if (searchParams.invited === "email_failed") return "The invitation workflow record was created, but email delivery failed. The applicant has not been marked as successfully contacted.";
  if (searchParams.decision_email_failed) return "The decision was recorded, but its email delivery failed. The portal remains the source of truth.";
  if (searchParams.correction_email_disabled) return "The correction request was created, but its email was suppressed by the current delivery controls.";
  if (searchParams.correction_email_failed) return "The correction request was created, but its email delivery failed. Check the correspondence record before contacting the applicant.";
  if (searchParams.offer_reissue_email_failed) return "The offer was reissued, but its email delivery failed. The portal remains the source of truth.";
  if (searchParams.offer_withdrawal_email_failed) return "The offer was withdrawn, but its email delivery failed. The withdrawal remains authoritative.";
  return undefined;
}

function HiddenRecordReferences({ record, application }: { record: NewStudentAdmissionRecord; application: NewStudentApplicationRecord }) {
  return (
    <>
      <input type="hidden" name="admission_id" value={record.lead.id} />
      <input type="hidden" name="application_id" value={application.id} />
    </>
  );
}

function actionAvailability(record: NewStudentAdmissionRecord, application?: NewStudentApplicationRecord) {
  const activeOverrideSlots = new Set(application?.evidenceOverrides.filter((override) => !override.revokedAt).map((override) => override.slotId) ?? []);
  return getNewStudentFullRecordAvailability({
    journeyStage: record.operation.journeyStage,
    sourceLeadStage: record.operation.sourceLeadStage,
    archived: record.lead.archived,
    convertedStudentId: record.lead.convertedStudentId,
    hasApplication: Boolean(application),
    applicationStatus: application?.status,
    readinessStatus: application?.review?.readinessStatus,
    decisionOutcome: application?.decision?.outcome,
    hasActiveCorrection: application?.correctionRequests.some((request) => ["open", "resubmitted"].includes(request.status)) ?? false,
    requiredEvidence: application?.documentSlots.filter((slot) => slot.required).map((slot) => ({
      status: slot.verificationStatus,
      hasActiveOverride: activeOverrideSlots.has(slot.id)
    })) ?? []
  });
}

function AdministrativeDetails({ record }: { record: NewStudentAdmissionRecord }) {
  const editable = !record.lead.archived && !record.lead.convertedStudentId && !["complete", "closed"].includes(record.operation.journeyStage);
  return (
    <section className={styles.surface} id="administrative-details">
      <div className={styles.sectionHeader}>
        <div>
          <h3>Administrative details</h3>
          <p>Contact and operational fields do not directly change the derived admissions stage.</p>
        </div>
        <UserRound size={18} aria-hidden="true" />
      </div>
      {editable ? (
        <form action={updateAdmissionLead} className={styles.actionForm}>
          <input type="hidden" name="lead_id" value={record.lead.id} />
          {record.lead.moduleInterestIds.map((id) => <input type="hidden" name="module_interest_ids" value={id} key={id} />)}
          <div className={styles.twoColumns}>
            <label><span>First name</span><input name="first_name" defaultValue={record.lead.firstName} required maxLength={80} /></label>
            <label><span>Last name</span><input name="last_name" defaultValue={record.lead.lastName} required maxLength={80} /></label>
            <label><span>Email</span><input type="email" name="email" defaultValue={record.lead.email} required /></label>
            <label><span>Phone</span><input name="phone" defaultValue={record.lead.phone} maxLength={40} /></label>
            <label><span>Programme</span><select name="programme" defaultValue={record.lead.programme}><option value="pgcert">PGCert</option><option value="microcredential">Microcredential</option></select></label>
            <label><span>Source</span><input name="source" defaultValue={record.lead.source} maxLength={120} /></label>
            <label><span>Last contacted</span><input type="date" name="last_contacted_on" defaultValue={record.lead.lastContactedOn} /></label>
            <label><span>Next follow-up</span><input type="date" name="next_action_on" defaultValue={record.lead.nextActionOn} /></label>
            <label className={styles.fullWidth}><span>Operational notes</span><textarea name="notes" defaultValue={record.lead.notes} rows={4} maxLength={6000} /></label>
          </div>
          <AdmissionsRecordSubmitButton>Save administrative details</AdmissionsRecordSubmitButton>
        </form>
      ) : <p className={styles.empty}>Complete and closed records are read-only. Workflow history remains available below.</p>}
    </section>
  );
}

function ApplicationDetails({ application }: { application: NewStudentApplicationRecord }) {
  return (
    <>
      {fieldGroups.map((group) => (
        <section className={styles.surface} id={group.title === "Personal and contact details" ? "application" : undefined} key={group.title}>
          <div className={styles.sectionHeader}><div><h3>{group.title}</h3><p>Applicant-submitted snapshot</p></div></div>
          <div className={styles.facts}>
            {group.keys.map((key) => (
              <div className={`${styles.fact} ${["work_experience", "pocus_previous_experience", "pocus_motivation", "pocus_case_improved_management", "pocus_limitations_case", "evidence_summary"].includes(key) ? styles.fullWidth : ""}`} key={key}>
                <span>{fieldLabels[key] ?? plainLanguageAdmissionsLabel(key)}</span>
                <p>{displayValue(application.fields[key])}</p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function StudyPlan({ application }: { application: NewStudentApplicationRecord }) {
  return (
    <section className={styles.surface} id="study-plan">
      <div className={styles.sectionHeader}>
        <div><h3>Intended study plan</h3><p>Application choices are intentions and do not reserve capacity or create enrolments.</p></div>
        <CalendarClock size={18} aria-hidden="true" />
      </div>
      <div className={styles.offeringList}>
        {application.selectedOfferings.map((offering) => (
          <div className={styles.offering} key={offering.id}>
            <div className={styles.offeringHeader}>
              <div><strong>{offering.moduleCode} · {offering.moduleTitle}</strong><p>{offering.termName} · {plainLanguageAdmissionsLabel(offering.mode)}</p></div>
              <span className={styles.pill}>Choice {offering.choiceOrder}</span>
            </div>
            <p>{offering.credits} credits · Planned capacity {offering.capacity} · £{(offering.pricePence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}</p>
          </div>
        ))}
        {application.selectedOfferings.length === 0 ? <div className={styles.empty}>No intended module offerings are recorded.</div> : null}
      </div>
    </section>
  );
}

function EvidenceAndReview({ record, application }: { record: NewStudentAdmissionRecord; application: NewStudentApplicationRecord }) {
  const canReview = actionAvailability(record, application).canReviewEvidence;
  const activeOverrides = new Map(application.evidenceOverrides.filter((override) => !override.revokedAt).map((override) => [override.slotId, override]));
  return (
    <>
      <section className={styles.surface} id="evidence">
        <div className={styles.sectionHeader}>
          <div><h3>Evidence</h3><p>Required evidence must be verified or explicitly overridden before an offer can be issued.</p></div>
          <FileCheck2 size={18} aria-hidden="true" />
        </div>
        <div className={styles.documentList}>
          {application.documentSlots.map((slot) => {
            const evidenceOverride = activeOverrides.get(slot.id);
            const canOverride = canReview && slot.required && slot.verificationStatus !== "verified" && slot.verificationStatus !== "rejected" && !evidenceOverride;
            return (
              <article className={styles.document} key={slot.id}>
                <div className={styles.documentHeader}>
                  <div>
                    <strong>{slot.label}</strong>
                    <p>{slot.filename ?? "No document uploaded"} · {slot.previousVersionCount} previous version{slot.previousVersionCount === 1 ? "" : "s"}</p>
                  </div>
                  <div className={styles.pillRow}>
                    {slot.required ? <span className={styles.pill}>Required</span> : <span className={styles.pill}>Optional</span>}
                    <span className={`${styles.pill} ${slot.verificationStatus === "rejected" ? styles.attentionPill : slot.verificationStatus === "verified" ? styles.readyPill : ""}`}>{plainLanguageAdmissionsLabel(slot.verificationStatus)}</span>
                    {evidenceOverride ? <span className={`${styles.pill} ${styles.readyPill}`}>Override recorded</span> : null}
                  </div>
                </div>
                {slot.verificationNote ? <p>Latest verification note: {slot.verificationNote}</p> : null}
                {evidenceOverride ? <p>Override reason: {evidenceOverride.reason}</p> : null}
                <div className={styles.buttonRow}>{slot.managedFileId ? <DocumentOpenButton fileId={slot.managedFileId} /> : null}</div>
                {canReview ? (
                  <div className={styles.documentActions}>
                    <form action={verifyApplicationDocument} className={styles.actionForm}>
                      <HiddenRecordReferences record={record} application={application} />
                      <input type="hidden" name="slot_id" value={slot.id} />
                      <label><span>Evidence decision</span><select name="verification_status" defaultValue={slot.verificationStatus}><option value="unverified">Reset to unverified</option><option value="verified">Verify</option><option value="rejected">Reject</option></select></label>
                      <label><span>Verification note</span><textarea name="verification_note" defaultValue={slot.verificationNote} rows={2} maxLength={4000} /></label>
                      <AdmissionsRecordSubmitButton>Save evidence decision</AdmissionsRecordSubmitButton>
                    </form>
                    {canOverride ? (
                      <form action={recordApplicationEvidenceOverride} className={styles.actionForm}>
                        <HiddenRecordReferences record={record} application={application} />
                        <input type="hidden" name="slot_id" value={slot.id} />
                        <label><span>Exceptional override reason</span><textarea name="reason" rows={3} required maxLength={4000} /></label>
                        <p className={styles.helpText}>Overrides cannot cover rejected evidence and are tied to the eventual decision.</p>
                        <AdmissionsRecordSubmitButton>Record evidence override</AdmissionsRecordSubmitButton>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
          {application.documentSlots.length === 0 ? <div className={styles.empty}>No application evidence slots are recorded.</div> : null}
        </div>
      </section>
      <section className={styles.surface} id="review">
        <div className={styles.sectionHeader}><div><h3>Staff review and readiness</h3><p>Readiness is a reviewed fact; it does not itself issue an offer or rejection.</p></div><BadgeCheck size={18} aria-hidden="true" /></div>
        {canReview ? (
          <form action={recordStaffApplicationReview} className={styles.actionForm}>
            <HiddenRecordReferences record={record} application={application} />
            <label><span>Decision readiness</span><select name="readiness_status" defaultValue={application.review?.readinessStatus ?? "not_ready"}><option value="not_ready">Not ready</option><option value="needs_information">Needs information</option><option value="ready_for_decision">Ready for decision</option></select></label>
            <label><span>Review notes</span><textarea name="review_notes" defaultValue={application.review?.reviewNotes} rows={4} maxLength={4000} /></label>
            <label><span>Decision reason notes</span><textarea name="decision_reason_notes" defaultValue={application.review?.decisionReasonNotes} rows={3} maxLength={4000} /></label>
            <AdmissionsRecordSubmitButton>Save review</AdmissionsRecordSubmitButton>
          </form>
        ) : (
          <div className={styles.facts}>
            <div className={styles.fact}><span>Readiness</span><strong>{plainLanguageAdmissionsLabel(application.review?.readinessStatus ?? "not_reviewed")}</strong></div>
            <div className={styles.fact}><span>Last reviewed</span><strong>{formatDateTime(application.review?.lastReviewedAt)}</strong></div>
            <div className={`${styles.fact} ${styles.fullWidth}`}><span>Review notes</span><p>{application.review?.reviewNotes ?? "No review notes recorded."}</p></div>
          </div>
        )}
      </section>
    </>
  );
}

function Corrections({ record, application }: { record: NewStudentAdmissionRecord; application: NewStudentApplicationRecord }) {
  const activeRequest = application.correctionRequests.find((request) => ["open", "resubmitted"].includes(request.status));
  const canCreate = actionAvailability(record, application).canCreateCorrection;
  const referenceTime = new Date(record.referenceTime).getTime();
  const dueDate = new Date(referenceTime + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const activeRequestOverdue = activeRequest ? new Date(activeRequest.dueAt).getTime() < referenceTime : false;
  return (
    <section className={styles.surface} id="corrections">
      <div className={styles.sectionHeader}>
        <div><h3>Application corrections</h3><p>Specific items, applicant drafts, resubmissions and staff outcomes remain preserved.</p></div>
        <History size={18} aria-hidden="true" />
      </div>
      {activeRequest?.status === "resubmitted" ? (
        <CorrectionReviewForm
          admissionId={record.lead.id}
          applicationId={application.id}
          requestId={activeRequest.id}
          items={activeRequest.items.filter((item) => item.status === "resubmitted")}
        />
      ) : null}
      {activeRequest ? (
        <div className={styles.actionGroup}>
          <div className={styles.correctionHeader}>
            <div><strong>Active request {activeRequest.versionNumber}</strong><p>{plainLanguageAdmissionsLabel(activeRequest.status)} · due {formatDate(activeRequest.dueAt)} · revision {activeRequest.revisionNumber}</p></div>
            <span className={`${styles.pill} ${activeRequestOverdue ? styles.attentionPill : ""}`}>{activeRequestOverdue ? "Overdue" : "Active"}</span>
          </div>
          {activeRequest.status === "open" ? <p className={styles.helpText}>Waiting for the applicant to address every open item and resubmit.</p> : null}
          <form action={cancelApplicationCorrection} className={styles.actionForm}>
            <HiddenRecordReferences record={record} application={application} />
            <input type="hidden" name="request_id" value={activeRequest.id} />
            <label><span>Cancellation reason</span><textarea name="reason" required rows={2} maxLength={4000} /></label>
            <AdmissionsRecordSubmitButton danger>Cancel correction request</AdmissionsRecordSubmitButton>
          </form>
        </div>
      ) : null}
      {canCreate ? (
        <CorrectionRequestComposer
          admissionId={record.lead.id}
          applicationId={application.id}
          defaultDueDate={dueDate}
          fieldOptions={applicationCorrectionFieldKeys.map((key) => ({ key, label: fieldLabels[key] ?? plainLanguageAdmissionsLabel(key) }))}
          documentOptions={application.documentSlots.map((slot) => ({ key: slot.slotKey, label: slot.label }))}
        />
      ) : null}
      <div className={styles.correctionList}>
        {application.correctionRequests.map((request) => (
          <article className={styles.correction} key={request.id}>
            <div className={styles.correctionHeader}>
              <div><strong>Request {request.versionNumber}</strong><p>Requested {formatDateTime(request.requestedAt)} · due {formatDate(request.dueAt)}</p></div>
              <span className={styles.pill}>{plainLanguageAdmissionsLabel(request.status)}</span>
            </div>
            {request.summary ? <p>{request.summary}</p> : null}
            {request.items.map((item) => (
              <div className={styles.fact} key={item.id}>
                <span>{item.targetType === "document_slot" ? "Evidence" : "Field"} · {fieldLabels[item.targetKey] ?? plainLanguageAdmissionsLabel(item.targetKey)}</span>
                <p>{item.instructions}</p>
                <p>Status: <strong>{plainLanguageAdmissionsLabel(item.status)}</strong> · {item.submittedVersions.length} submitted version{item.submittedVersions.length === 1 ? "" : "s"}</p>
                {item.applicantResponseNote ? <p>Applicant note: {item.applicantResponseNote}</p> : null}
                {item.replacementManagedFileId ? (
                  <div className={styles.buttonRow}>
                    <strong>{item.replacementFilename ?? "Replacement evidence"}</strong>
                    <DocumentOpenButton fileId={item.replacementManagedFileId} label="Open replacement" />
                  </div>
                ) : null}
              </div>
            ))}
            {request.cancellationReason ? <p>Cancellation reason: {request.cancellationReason}</p> : null}
          </article>
        ))}
        {application.correctionRequests.length === 0 && !canCreate ? <div className={styles.empty}>No correction history is recorded.</div> : null}
      </div>
    </section>
  );
}

function AdmissionClosureActions({ record }: { record: NewStudentAdmissionRecord }) {
  const application = record.application;
  const availability = newStudentTerminalActionAvailability({
    journeyStage: record.operation.journeyStage,
    sourceLeadStage: record.operation.sourceLeadStage,
    archived: record.lead.archived,
    convertedStudentId: record.lead.convertedStudentId,
    applicationStatus: application?.status,
    hasActiveAbandonment: record.abandonmentPeriods.some((period) => !period.reopenedAt),
    offerStatus: application?.offer?.status,
    hasRegistration: Boolean(application?.registration)
  });

  if (!availability.canAbandon && !availability.canReopenAbandonment && record.abandonmentPeriods.length === 0) return null;

  return (
    <section className={styles.surface} id="workflow-actions">
      <div className={styles.sectionHeader}>
        <div><h3>Pre-submission closure</h3><p>Abandonment closes an enquiry or unsubmitted application without archiving or deleting it.</p></div>
        <ShieldAlert size={18} aria-hidden="true" />
      </div>
      {availability.canAbandon ? (
        <form action={abandonNewStudentAdmission} className={styles.actionForm}>
          <input type="hidden" name="admission_id" value={record.lead.id} />
          <label><span>Reason for closing as abandoned</span><textarea name="reason" required rows={3} maxLength={4000} /></label>
          <p className={styles.helpText}>This removes the record from active work, preserves its history and allows a deliberate reopening later.</p>
          <AdmissionsRecordSubmitButton danger confirmMessage="Close this pre-submission admissions record as abandoned? Its history will be preserved and it can be reopened later.">Close as abandoned</AdmissionsRecordSubmitButton>
        </form>
      ) : null}
      {availability.canReopenAbandonment ? (
        <form action={reopenAbandonedNewStudentAdmission} className={styles.actionForm}>
          <input type="hidden" name="admission_id" value={record.lead.id} />
          <label><span>Reason for reopening</span><textarea name="reason" required rows={3} maxLength={4000} /></label>
          <p className={styles.helpText}>The record returns to the same enquiry or application-invited stage it held before abandonment.</p>
          <AdmissionsRecordSubmitButton>Reopen admission</AdmissionsRecordSubmitButton>
        </form>
      ) : null}
      {record.abandonmentPeriods.length > 0 ? (
        <div className={styles.timeline}>
          {record.abandonmentPeriods.map((period) => (
            <div className={styles.timelineItem} key={period.id}>
              <span>{formatDateTime(period.abandonedAt)} · from {plainLanguageAdmissionsLabel(period.previousLeadStage)}</span>
              <strong>Closed as abandoned</strong>
              <p>{period.reason}</p>
              {period.reopenedAt ? <p>Reopened {formatDateTime(period.reopenedAt)}: {period.reopenReason}</p> : <p>Currently closed</p>}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DecisionOfferRegistration({ record, application }: { record: NewStudentAdmissionRecord; application: NewStudentApplicationRecord }) {
  const availability = actionAvailability(record, application);
  const terminalAvailability = newStudentTerminalActionAvailability({
    journeyStage: record.operation.journeyStage,
    sourceLeadStage: record.operation.sourceLeadStage,
    archived: record.lead.archived,
    convertedStudentId: record.lead.convertedStudentId,
    applicationStatus: application.status,
    hasActiveAbandonment: record.abandonmentPeriods.some((period) => !period.reopenedAt),
    offerStatus: application.offer?.status,
    hasRegistration: Boolean(application.registration)
  });
  const registration = application.registration;
  const earliestOfferDeadline = new Date(new Date(record.referenceTime).getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const reopenAccess = canReopenLapsedRegistration(registration ? { registrationStatus: registration.status, leadStage: record.operation.sourceLeadStage, convertedStudentId: registration.studentId ?? record.lead.convertedStudentId } : undefined);
  const conversionAccess = canConvertSubmittedRegistration({
    registrationStatus: registration?.status ?? "not_started",
    registrationDeadlineAt: registration?.deadlineAt,
    leadStage: record.operation.sourceLeadStage,
    convertedStudentId: registration?.studentId ?? record.lead.convertedStudentId,
    moduleConfirmationAccepted: registration?.moduleConfirmationAccepted ?? false,
    termsAcceptedAt: registration?.termsAcceptedAt,
    requiredDocumentCount: registration?.requiredDocumentCount ?? 0,
    uploadedRequiredDocumentCount: registration?.uploadedRequiredDocumentCount ?? 0
  });
  return (
    <section className={styles.surface} id="decision">
      <div className={styles.sectionHeader}><div><h3>Decision, offer and registration</h3><p>Consequential actions are available only from eligible authoritative states.</p></div><CheckCircle2 size={18} aria-hidden="true" /></div>
      {application.decision ? (
        <div className={styles.facts}>
          <div className={styles.fact}><span>Decision</span><strong>{plainLanguageAdmissionsLabel(application.decision.outcome)}</strong></div>
          <div className={styles.fact}><span>Decided</span><strong>{formatDateTime(application.decision.decidedAt)}</strong></div>
          <div className={`${styles.fact} ${styles.fullWidth}`}><span>Internal reason</span><p>{application.decision.reason ?? "Not recorded"}</p></div>
        </div>
      ) : (
        <div className={styles.actionGroup}>
          {!availability.canReject ? <div className={styles.warningBanner}><AlertTriangle size={16} /><span>Decision unavailable: {plainLanguageAdmissionsLabel(availability.decisionBlockedReason ?? "not_eligible")}.</span></div> : null}
          {availability.canReject && !availability.canOffer ? <div className={styles.warningBanner}><AlertTriangle size={16} /><span>An offer is blocked until active corrections are resolved and every required evidence slot is verified or validly overridden. Rejection remains available.</span></div> : null}
          {availability.canOffer ? (
            <form action={recordApplicationDecision} className={styles.actionForm}>
              <HiddenRecordReferences record={record} application={application} />
              <input type="hidden" name="decision_outcome" value="offer" />
              <label><span>Offer deadline (optional; defaults to 14 days)</span><input type="date" name="offer_deadline_at" /></label>
              <label><span>Offer decision reason</span><textarea name="decision_reason" required rows={3} maxLength={4000} /></label>
              <AdmissionsRecordSubmitButton>Issue offer</AdmissionsRecordSubmitButton>
            </form>
          ) : null}
          {availability.canReject ? (
            <form action={recordApplicationDecision} className={styles.actionForm}>
              <HiddenRecordReferences record={record} application={application} />
              <input type="hidden" name="decision_outcome" value="rejection" />
              <input type="hidden" name="offer_deadline_at" value="" />
              <label><span>Rejection reason</span><textarea name="decision_reason" required rows={3} maxLength={4000} /></label>
              <p className={styles.helpText}>Rejection records a genuine terminal outcome and cancels any active correction request.</p>
              <AdmissionsRecordSubmitButton danger>Record rejection</AdmissionsRecordSubmitButton>
            </form>
          ) : null}
        </div>
      )}
      {application.offer ? (
        <div className={styles.actionGroup}>
          <h4>Offer</h4>
          <div className={styles.facts}>
            <div className={styles.fact}><span>Reference</span><strong>{application.offer.reference}</strong></div>
            <div className={styles.fact}><span>Status</span><strong>{plainLanguageAdmissionsLabel(application.offer.status)}</strong></div>
            <div className={styles.fact}><span>Issued</span><strong>{formatDateTime(application.offer.issuedAt)}</strong></div>
            <div className={styles.fact}><span>Deadline</span><strong>{formatDateTime(application.offer.deadlineAt)}</strong></div>
            {application.offer.withdrawnAt ? <div className={styles.fact}><span>Withdrawn</span><strong>{formatDateTime(application.offer.withdrawnAt)}</strong></div> : null}
            <div className={styles.fact}><span>Reissues</span><strong>{application.offer.reissueCount}</strong></div>
            {application.offer.withdrawalReason ? <div className={`${styles.fact} ${styles.fullWidth}`}><span>Withdrawal reason</span><p>{application.offer.withdrawalReason}</p></div> : null}
          </div>
          {terminalAvailability.canReissueOffer ? (
            <form action={reissueLapsedApplicationOffer} className={styles.actionForm}>
              <HiddenRecordReferences record={record} application={application} />
              <input type="hidden" name="offer_id" value={application.offer.id} />
              <label><span>New response deadline</span><input type="date" name="new_deadline_at" min={earliestOfferDeadline} required /></label>
              <label><span>Reason for reissue</span><textarea name="reason" required rows={3} maxLength={4000} /></label>
              <p className={styles.helpText}>Reissue keeps this offer and its prior lapse history, opens it for response again and deliberately attempts applicant correspondence.</p>
              <AdmissionsRecordSubmitButton confirmMessage="Reissue this offer with the new deadline and attempt applicant correspondence?">Reissue lapsed offer</AdmissionsRecordSubmitButton>
            </form>
          ) : null}
          {terminalAvailability.canWithdrawOffer ? (
            <form action={withdrawApplicationOffer} className={styles.actionForm}>
              <HiddenRecordReferences record={record} application={application} />
              <input type="hidden" name="offer_id" value={application.offer.id} />
              <label><span>Reason for withdrawing the offer</span><textarea name="reason" required rows={3} maxLength={4000} /></label>
              <p className={styles.helpText}>Withdrawal is terminal for this admissions record. A later application must use a new admissions record.</p>
              <AdmissionsRecordSubmitButton danger confirmMessage="Withdraw this offer? This is terminal for the current admissions record and cannot be reopened.">Withdraw offer</AdmissionsRecordSubmitButton>
            </form>
          ) : null}
          {application.offer.reissues.length > 0 ? (
            <div className={styles.timeline}>
              {application.offer.reissues.map((reissue) => (
                <div className={styles.timelineItem} key={reissue.id}>
                  <span>{formatDateTime(reissue.reissuedAt)} · new deadline {formatDateTime(reissue.newDeadlineAt)}</span>
                  <strong>Offer reissued</strong>
                  <p>{reissue.reason}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {registration ? (
        <div className={styles.actionGroup} id="registration">
          <h4>Registration</h4>
          <div className={styles.facts}>
            <div className={styles.fact}><span>Status</span><strong>{plainLanguageAdmissionsLabel(registration.status)}</strong></div>
            <div className={styles.fact}><span>Deadline</span><strong>{formatDateTime(registration.deadlineAt)}</strong></div>
            <div className={styles.fact}><span>Required document routes recorded</span><strong>{registration.uploadedRequiredDocumentCount}/{registration.requiredDocumentCount}</strong></div>
            <div className={styles.fact}><span>Terms accepted</span><strong>{registration.termsAcceptedAt ? "Yes" : "No"}</strong></div>
          </div>
          <div className={styles.documentList}>
            {registration.documentSlots.map((slot) => (
              <div className={styles.document} key={slot.id}>
                <div className={styles.documentHeader}>
                  <div>
                    <strong>{slot.label}</strong>
                    <p>
                      {slot.managedFileId
                        ? `${slot.filename ?? "Uploaded file"}${slot.uploadedAt ? ` · uploaded ${formatDateTime(slot.uploadedAt)}` : ""}`
                        : slot.verificationRoute === "in_person"
                          ? "Applicant will bring the original to induction"
                          : "No file or later-verification route recorded"}
                    </p>
                    {slot.verificationNote ? <p>Staff note: {slot.verificationNote}</p> : null}
                  </div>
                  <span className={`${styles.pill} ${slot.verificationStatus === "verified" ? styles.readyPill : slot.verificationStatus === "rejected" ? styles.attentionPill : ""}`}>
                    {slot.verificationRoute === "in_person" && slot.verificationStatus === "unverified"
                      ? "Needs induction verification"
                      : plainLanguageAdmissionsLabel(slot.verificationStatus)}
                  </span>
                </div>
                <div className={styles.documentActions}>
                  <DocumentOpenButton fileId={slot.managedFileId} />
                  <form action={verifyAdmissionsRegistrationDocument} className={styles.actionForm}>
                    <HiddenRecordReferences record={record} application={application} />
                    <input type="hidden" name="registration_id" value={registration.id} />
                    <input type="hidden" name="slot_id" value={slot.id} />
                    <input type="hidden" name="verification_route" value={slot.managedFileId ? "upload" : "in_person"} />
                    <p className={styles.helpText}>
                      {slot.managedFileId
                        ? "Review the uploaded document."
                        : "No file is available; keep this marked as needing induction verification until staff have checked the original."}
                    </p>
                    <label>
                      <span>Verification state</span>
                      <select name="verification_status" defaultValue={slot.verificationStatus}>
                        <option value="unverified">Needs verification</option>
                        <option value="verified">Verified</option>
                        {slot.managedFileId ? <option value="rejected">Rejected / replace</option> : null}
                      </select>
                    </label>
                    <label><span>Verification note</span><textarea name="verification_note" defaultValue={slot.verificationNote} rows={2} maxLength={4000} required /></label>
                    <AdmissionsRecordSubmitButton>Save document check</AdmissionsRecordSubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </div>
          {reopenAccess.allowed ? (
            <form action={reopenLapsedAdmissionsRegistration} className={styles.actionForm}>
              <HiddenRecordReferences record={record} application={application} />
              <input type="hidden" name="registration_id" value={registration.id} />
              <label><span>Reason for reopening</span><textarea name="reopen_reason" required rows={3} maxLength={4000} /></label>
              <label><span>New deadline (optional)</span><input type="date" name="new_deadline_at" /></label>
              <AdmissionsRecordSubmitButton>Reopen registration</AdmissionsRecordSubmitButton>
            </form>
          ) : null}
          {conversionAccess.allowed ? (
            <form action={convertSubmittedAdmissionsRegistration} className={styles.actionForm}>
              <HiddenRecordReferences record={record} application={application} />
              <input type="hidden" name="registration_id" value={registration.id} />
              <p className={styles.helpText}>Creates or activates the linked student and idempotently creates planned initial enrolments. Finance remains separate.</p>
              <AdmissionsRecordSubmitButton>Convert to student</AdmissionsRecordSubmitButton>
            </form>
          ) : null}
          {!reopenAccess.allowed && !conversionAccess.allowed ? <p className={styles.helpText}>No consequential registration action is currently eligible: {plainLanguageAdmissionsLabel(registration.status)}.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function HistoryAndCorrespondence({ record }: { record: NewStudentAdmissionRecord }) {
  return (
    <>
      <section className={styles.surface} id="correspondence">
        <div className={styles.sectionHeader}><div><h3>Correspondence</h3><p>Delivery state is evidence of an attempt; portal workflow state remains authoritative.</p></div><Mail size={18} /></div>
        <div className={styles.correspondenceList}>
          {record.correspondence.map((item) => (
            <div className={styles.correspondenceItem} key={item.id}>
              <span>{plainLanguageAdmissionsLabel(item.templateKey)} · {formatDateTime(item.sentAt ?? item.createdAt)}</span>
              <strong>{item.subject}</strong>
              <p>{item.recipientEmail} · {plainLanguageAdmissionsLabel(item.deliveryStatus)}</p>
            </div>
          ))}
          {record.correspondence.length === 0 ? <div className={styles.empty}>No correspondence linked to this admissions record is visible.</div> : null}
        </div>
      </section>
      <section className={styles.surface} id="history">
        <div className={styles.sectionHeader}><div><h3>Workflow history</h3><p>Redacted audit actions across this admissions record and its authoritative child records.</p></div><History size={18} /></div>
        <div className={styles.timeline}>
          {record.history.map((event) => (
            <div className={styles.timelineItem} key={event.id}>
              <span>{formatDateTime(event.createdAt)} · {plainLanguageAdmissionsLabel(event.entityType)}</span>
              <strong>{plainLanguageAdmissionsLabel(event.action)}</strong>
            </div>
          ))}
          {record.history.length === 0 ? <div className={styles.empty}>No audit history is visible for this record.</div> : null}
        </div>
      </section>
    </>
  );
}

export default async function NewStudentAdmissionRecordPage({
  params,
  searchParams
}: {
  params: Promise<{ admissionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("manage_admissions");
  if (!admissionsStaffWorkspacesEnabled()) redirect("/admissions");
  const parsedId = idSchema.safeParse((await params).admissionId);
  if (!parsedId.success) notFound();

  const [record, overview, query] = await Promise.all([
    getNewStudentAdmissionRecord(parsedId.data),
    getAdmissionsOverviewData(),
    searchParams
  ]);
  if (!record) notFound();
  const message = resultMessage(query);
  const warning = warningMessage(query);
  const application = record.application;
  const canInvite = actionAvailability(record, application).canInvite
    && !record.operation.hasOpenEmailDuplicate
    && record.operation.applicationDeadlineState === "due";

  return (
    <AppShell title="New-student admission" subtitle="Complete applicant record and guarded workflow actions">
      <div className={workspaceStyles.workspace}>
        <AdmissionsLocalNavigation active="new_students" newAttention={overview.newStudents.attention} returningAttention={overview.returningStudents.attention} />
        <main className={styles.record}>
          <header className={styles.recordHeader}>
            <div>
              <Link className={styles.backLink} href="/admissions/new-students"><ArrowLeft size={14} /> Back to New students</Link>
              <h2>{record.operation.applicantName}</h2>
              <p>Admission {record.lead.id.slice(0, 8)} · {record.lead.email}</p>
            </div>
            <div className={styles.headerPills}>
              <span className={styles.pill}>{newStudentJourneyStageLabels[record.operation.journeyStage]}</span>
              {record.pilotTestRecord?.active ? <span className={`${styles.pill} ${styles.readyPill}`}><LockKeyhole size={12} /> Pilot test record</span> : null}
              {record.operation.leadingAttentionIndicator ? <span className={`${styles.pill} ${styles.attentionPill}`}><AlertTriangle size={12} /> {plainLanguageAdmissionsLabel(record.operation.leadingAttentionIndicator)}</span> : null}
            </div>
          </header>
          {message ? <div className={styles.successBanner} role="status"><CheckCircle2 size={16} /> {message}</div> : null}
          {warning ? <div className={styles.warningBanner} role="status"><AlertTriangle size={16} /> {warning}</div> : null}
          <div className={styles.emailBanner}><LockKeyhole size={16} /><span>Email mode: <strong>{plainLanguageAdmissionsLabel(record.email.mode)}</strong>. Delivery is {record.email.enabled ? "enabled under server-side recipient controls" : "disabled"}; workflow records remain authoritative.</span></div>
          {record.operation.hasDataInconsistency ? <div className={styles.warningBanner}><AlertTriangle size={16} /><span>Data inconsistency—repair required. Ordinary progression is blocked and no direct stage override is available.</span></div> : null}
          {["not_configured", "overdue"].includes(record.operation.applicationDeadlineState) && ["enquiry", "application"].includes(record.operation.journeyStage) ? (
            <div className={styles.warningBanner}><CalendarClock size={16} /><span>{record.operation.applicationDeadlineState === "overdue" ? "The cohort application deadline has passed." : "The cohort application deadline is not configured."} <Link className={styles.textLink} href="/admissions/new-students">Update the deadline</Link> before issuing another invitation.</span></div>
          ) : null}
          {record.operation.hasOpenEmailDuplicate ? (
            <div className={styles.warningBanner}>
              <AlertTriangle size={16} />
              <div className={styles.duplicateWarningContent}>
                <div>
                  <strong>Duplicate email—do not invite this record.</strong>
                  <p>
                    The normalized email matches the earlier open admissions record for {record.operation.duplicateOpenApplicantName ?? "this applicant"}.
                    {record.operation.duplicateOpenAdmissionLeadId ? (
                      <> <Link className={styles.textLink} href={`/admissions/new-students/${record.operation.duplicateOpenAdmissionLeadId}`}>Open the earlier record</Link>.</>
                    ) : null}
                  </p>
                </div>
                {record.operation.primaryNextAction === "abandon_duplicate" ? (
                  <form action={abandonNewStudentAdmission} className={styles.inlineAction}>
                    <input type="hidden" name="admission_id" value={record.lead.id} />
                    <input type="hidden" name="reason" value="Duplicate applicant: normalized email matches an earlier open admissions record." />
                    <AdmissionsRecordSubmitButton danger confirmMessage="Abandon this admissions record as a duplicate? Its history will be preserved.">Abandon as duplicate</AdmissionsRecordSubmitButton>
                  </form>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className={styles.summaryGrid}>
            <div className={styles.summaryCard}><span>Stage</span><strong>{newStudentJourneyStageLabels[record.operation.journeyStage]}</strong></div>
            <div className={styles.summaryCard}><span>Programme</span><strong>{record.lead.programme === "pgcert" ? "PGCert" : "Microcredential"}</strong></div>
            <div className={styles.summaryCard}><span>Target intake</span><strong>{application?.intendedStartTermName ?? application?.intendedStartTermId ?? "Not selected"}</strong></div>
            <div className={styles.summaryCard}><span>Current deadline</span><strong>{formatDate(record.operation.currentDeadlineAt)}</strong></div>
          </div>
          <div className={styles.layout}>
            <div className={styles.main}>
              <AdministrativeDetails record={record} />
              <AdmissionClosureActions record={record} />
              {application ? <StudyPlan application={application} /> : null}
              {application ? <ApplicationDetails application={application} /> : (
                <section className={styles.surface} id="application"><div className={styles.sectionHeader}><div><h3>Application</h3><p>No application record exists yet.</p></div></div><div className={styles.empty}>The applicant must claim an invitation and create an application before application details are available.</div></section>
              )}
              {application?.supportNeedsDisclosed ? (
                <section className={styles.surface} id="support-needs">
                  <div className={styles.sectionHeader}><div><h3>Restricted support needs</h3><p>Sensitive information stays separate from the ordinary dossier.</p></div><LockKeyhole size={18} /></div>
                  <RestrictedSupportNeedsReveal admissionId={record.lead.id} applicationId={application.id} />
                </section>
              ) : null}
              {application ? <EvidenceAndReview record={record} application={application} /> : null}
              {application ? <Corrections record={record} application={application} /> : null}
              {application ? <DecisionOfferRegistration record={record} application={application} /> : null}
              <HistoryAndCorrespondence record={record} />
            </div>
            <aside className={styles.sidebar} aria-label="Admission record actions and navigation">
              <section className={styles.sideCard}>
                <h3>Primary next action</h3>
                <div className={styles.nextAction}><span>Recommended</span><strong>{plainLanguageAdmissionsLabel(record.operation.primaryNextAction)}</strong></div>
                {canInvite ? (
                  <form action={inviteAdmissionLeadToApply} className={styles.actionForm}>
                    <input type="hidden" name="lead_id" value={record.lead.id} />
                    <p className={styles.helpText}>Creates an invitation and attempts a secure access email only under the configured delivery controls.</p>
                    <AdmissionsRecordSubmitButton>Invite applicant</AdmissionsRecordSubmitButton>
                  </form>
                ) : null}
                {record.operation.primaryNextAction === "reissue_offer" ? <p className={styles.helpText}>Use the reissue action in the offer section to set a new response deadline.</p> : null}
              </section>
              <section className={styles.sideCard}>
                <h3>Email pilot safety</h3>
                <AdmissionsEmailPilotControls
                  recordType="new_applicant"
                  entityId={record.lead.id}
                  displayName={record.operation.applicantName}
                  recipientEmail={record.lead.email}
                  recipientAllowlisted={record.email.recipientAllowlisted}
                  emailEnabled={record.email.enabled}
                  emailMode={record.email.mode}
                  configurationReady={record.email.missing.length === 0}
                  testRecord={record.pilotTestRecord}
                />
              </section>
              <section className={styles.sideCard}>
                <h3>Record sections</h3>
                <nav className={styles.quickNav} aria-label="Applicant record sections">
                  <a href="#administrative-details">Administrative details</a>
                  {record.abandonmentPeriods.length > 0 || ["enquiry", "application"].includes(record.operation.journeyStage) ? <a href="#workflow-actions">Pre-submission closure</a> : null}
                  <a href="#application">Application</a>
                  {application ? <a href="#study-plan">Study plan</a> : null}
                  {application ? <a href="#evidence">Evidence</a> : null}
                  {application ? <a href="#review">Staff review</a> : null}
                  {application ? <a href="#corrections">Corrections</a> : null}
                  {application ? <a href="#decision">Decision and registration</a> : null}
                  <a href="#correspondence">Correspondence</a>
                  <a href="#history">Workflow history</a>
                </nav>
              </section>
            </aside>
          </div>
        </main>
      </div>
    </AppShell>
  );
}
