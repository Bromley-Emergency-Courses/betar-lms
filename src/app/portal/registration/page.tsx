import Link from "next/link";
import { CheckCircle2, FileText, GraduationCap, LockKeyhole, ShieldCheck, Upload } from "lucide-react";
import {
  beginAdmissionsRegistration,
  saveAdmissionsRegistration,
  setAdmissionsRegistrationDocumentVerificationRoute,
  submitAdmissionsRegistration,
  uploadAdmissionsRegistrationDocument
} from "@/app/portal/registration/actions";
import { Field, FormGrid } from "@/components/forms";
import { StatusPill } from "@/components/status-pill";
import {
  admissionsRegistrationDocumentSlotDefinitions,
  admissionsRegistrationTermsText,
  admissionsRegistrationTermsVersion,
  type AdmissionsRegistrationDocumentSlotKey,
  type AdmissionsRegistrationDocumentVerificationRoute,
  type AdmissionsRegistrationStatus
} from "@/lib/admissions-registration";
import type { ApplicationDocumentVerificationStatus } from "@/lib/application-documents";
import { requireApplicantProfile } from "@/lib/portal-auth";
import { getAppData } from "@/lib/seed";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface RegistrationModuleSummary {
  id: string;
  choiceOrder: number;
  code: string;
  title: string;
  credits: number;
  mode: "online" | "practical";
  pricePence: number;
  capacity: number;
}

interface AcceptedOfferSummary {
  id: string;
  applicationId: string;
  admissionLeadId: string;
  offerReference: string;
  programme: "pgcert" | "microcredential";
  acceptedAt?: string;
  termName?: string;
  termStartsOn?: string;
  modules: RegistrationModuleSummary[];
}

interface RegistrationDocumentSlotSummary {
  slotKey: AdmissionsRegistrationDocumentSlotKey;
  label: string;
  required: boolean;
  managedFileId?: string;
  originalFilename?: string;
  sanitizedFilename?: string;
  contentType?: string;
  sizeBytes?: number;
  uploadedAt?: string;
  verificationStatus: ApplicationDocumentVerificationStatus;
  verificationRoute: AdmissionsRegistrationDocumentVerificationRoute;
  verificationNote?: string;
}

interface RegistrationTermsSummary {
  version: string;
  text: string;
}

interface RegistrationSummary {
  id: string;
  status: AdmissionsRegistrationStatus;
  registrationDeadlineAt?: string;
  title?: string;
  firstName: string;
  middleNames?: string;
  lastName: string;
  preferredName?: string;
  previousSurname?: string;
  dateOfBirth?: string;
  email: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postcode?: string;
  country?: string;
  moduleConfirmationAccepted: boolean;
  moduleConfirmedAt?: string;
  savedAt?: string;
  submittedAt?: string;
  lapsedAt?: string;
  lapsedReason?: string;
  reopenedAt?: string;
  reopenedReason?: string;
  convertedAt?: string;
  termsVersion?: string;
  termsAcceptedAt?: string;
  modules: RegistrationModuleSummary[];
  documentSlots: RegistrationDocumentSlotSummary[];
}

type RelatedObject = Record<string, unknown>;

type OfferRow = {
  id: string;
  application_id: string;
  offer_reference: string;
  programme: "pgcert" | "microcredential";
  accepted_at: string | null;
  applications: RelatedObject | RelatedObject[] | null;
  terms: RelatedObject | RelatedObject[] | null;
  application_offer_module_offerings: RelatedObject[] | null;
};

type RegistrationRow = {
  id: string;
  status: AdmissionsRegistrationStatus;
  registration_deadline_at: string | null;
  title: string | null;
  first_name: string;
  middle_names: string | null;
  last_name: string;
  preferred_name: string | null;
  previous_surname: string | null;
  date_of_birth: string | null;
  email: string;
  phone: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  module_confirmation_accepted: boolean;
  module_confirmed_at: string | null;
  saved_at: string | null;
  submitted_at: string | null;
  lapsed_at: string | null;
  lapsed_reason: string | null;
  reopened_at: string | null;
  reopened_reason: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
  converted_at: string | null;
};

type RegistrationChoiceRow = {
  registration_id: string;
  choice_order: number;
  module_code: string;
  module_title: string;
  module_credits: number;
  module_mode: "online" | "practical";
  price_pence: number;
  capacity: number;
};

type RegistrationDocumentSlotRow = {
  slot_key: AdmissionsRegistrationDocumentSlotKey;
  label: string;
  required: boolean;
  managed_file_id: string | null;
  original_filename: string | null;
  sanitized_filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_at: string | null;
  verification_status: ApplicationDocumentVerificationStatus;
  verification_route: AdmissionsRegistrationDocumentVerificationRoute;
  verification_note: string | null;
};

function relatedObject(value: unknown): RelatedObject | undefined {
  if (Array.isArray(value)) {
    return value[0] && typeof value[0] === "object" ? (value[0] as RelatedObject) : undefined;
  }
  return value && typeof value === "object" ? (value as RelatedObject) : undefined;
}

function relatedArray(value: unknown): RelatedObject[] {
  return Array.isArray(value) ? value.filter((item): item is RelatedObject => Boolean(item) && typeof item === "object") : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleDateString("en-GB") : "Not recorded";
}

function formatDateTime(value?: string): string {
  return value ? new Date(value).toLocaleString("en-GB") : "Not recorded";
}

function formatCurrency(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(pence / 100);
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

function mapOfferModules(rows: RelatedObject[] | null): RegistrationModuleSummary[] {
  return relatedArray(rows)
    .map((choice) => {
      const offering = relatedObject(choice.module_offerings);
      const courseModule = relatedObject(offering?.course_modules);
      const mode: RegistrationModuleSummary["mode"] = courseModule?.mode === "practical" ? "practical" : "online";
      return {
        id: String(offering?.id ?? ""),
        choiceOrder: Number(choice.choice_order ?? 0),
        code: String(courseModule?.code ?? ""),
        title: String(courseModule?.title ?? ""),
        credits: Number(courseModule?.credits ?? 0),
        mode,
        pricePence: Number(offering?.price_pence ?? 0),
        capacity: Number(offering?.capacity ?? 0)
      };
    })
    .filter((module) => module.id)
    .sort((first, second) => first.choiceOrder - second.choiceOrder);
}

function mapRegistrationModules(rows: RegistrationChoiceRow[]): RegistrationModuleSummary[] {
  return rows
    .map((choice) => {
      const mode: RegistrationModuleSummary["mode"] = choice.module_mode === "practical" ? "practical" : "online";
      return {
        id: `${choice.registration_id}-${choice.choice_order}`,
        choiceOrder: Number(choice.choice_order ?? 0),
        code: choice.module_code,
        title: choice.module_title,
        credits: Number(choice.module_credits ?? 0),
        mode,
        pricePence: Number(choice.price_pence ?? 0),
        capacity: Number(choice.capacity ?? 0)
      };
    })
    .sort((first, second) => first.choiceOrder - second.choiceOrder);
}

function mapOffer(row: OfferRow): AcceptedOfferSummary {
  const application = relatedObject(row.applications);
  const term = relatedObject(row.terms);
  return {
    id: row.id,
    applicationId: row.application_id,
    admissionLeadId: String(application?.admission_lead_id ?? ""),
    offerReference: row.offer_reference,
    programme: row.programme,
    acceptedAt: optionalString(row.accepted_at),
    termName: optionalString(term?.name),
    termStartsOn: optionalString(term?.starts_on),
    modules: mapOfferModules(row.application_offer_module_offerings)
  };
}

function mapRegistration(
  row: RegistrationRow,
  modules: RegistrationModuleSummary[],
  documentSlots: RegistrationDocumentSlotRow[]
): RegistrationSummary {
  return {
    id: row.id,
    status: row.status,
    registrationDeadlineAt: optionalString(row.registration_deadline_at),
    title: optionalString(row.title),
    firstName: row.first_name,
    middleNames: optionalString(row.middle_names),
    lastName: row.last_name,
    preferredName: optionalString(row.preferred_name),
    previousSurname: optionalString(row.previous_surname),
    dateOfBirth: optionalString(row.date_of_birth),
    email: row.email,
    phone: optionalString(row.phone),
    addressLine1: optionalString(row.address_line_1),
    addressLine2: optionalString(row.address_line_2),
    city: optionalString(row.city),
    postcode: optionalString(row.postcode),
    country: optionalString(row.country),
    moduleConfirmationAccepted: row.module_confirmation_accepted,
    moduleConfirmedAt: optionalString(row.module_confirmed_at),
    savedAt: optionalString(row.saved_at),
    submittedAt: optionalString(row.submitted_at),
    lapsedAt: optionalString(row.lapsed_at),
    lapsedReason: optionalString(row.lapsed_reason),
    reopenedAt: optionalString(row.reopened_at),
    reopenedReason: optionalString(row.reopened_reason),
    convertedAt: optionalString(row.converted_at),
    termsVersion: optionalString(row.terms_version),
    termsAcceptedAt: optionalString(row.terms_accepted_at),
    modules,
    documentSlots: documentSlots.map((slot) => ({
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
      verificationRoute: slot.verification_route,
      verificationNote: optionalString(slot.verification_note)
    }))
  };
}

async function getRegistrationContext(personId: string): Promise<{
  acceptedOffer?: AcceptedOfferSummary;
  registration?: RegistrationSummary;
  registrationTerms: RegistrationTermsSummary;
}> {
  if (!isSupabaseConfigured()) {
    const data = getAppData();
    const term = data.terms.find((candidate) => candidate.status === "published") ?? data.terms[0];
    const modules = data.offerings
      .filter((offering) => offering.termId === term?.id)
      .slice(0, 2)
      .map((offering, index) => {
        const courseModule = data.modules.find((candidate) => candidate.id === offering.moduleId);
        return {
          id: offering.id,
          choiceOrder: index + 1,
          code: courseModule?.code ?? "",
          title: courseModule?.title ?? "",
          credits: courseModule?.credits ?? 0,
          mode: courseModule?.mode ?? "online",
          pricePence: offering.pricePence,
          capacity: offering.capacity
        };
      });

    return {
      registrationTerms: {
        version: admissionsRegistrationTermsVersion,
        text: admissionsRegistrationTermsText
      },
      acceptedOffer: {
        id: "66666666-6666-4666-8666-666666666666",
        applicationId: "77777777-7777-4777-8777-777777777777",
        admissionLeadId: "11111111-1111-4111-8111-111111111111",
        offerReference: "BETAR-DEMO-OFFER",
        programme: "pgcert",
        acceptedAt: new Date().toISOString(),
        termName: term?.name,
        termStartsOn: term?.startsOn,
        modules
      }
    };
  }

  const supabase = await createSupabaseServerClient();
  const [offerResult, termsResult] = await Promise.all([
    supabase
      .from("application_offers")
      .select(
        `
          id,
          application_id,
          offer_reference,
          programme,
          accepted_at,
          applications:application_id (
            admission_lead_id
          ),
          terms:intended_start_term_id (
            name,
            starts_on
          ),
          application_offer_module_offerings (
            choice_order,
            module_offerings:offering_id (
              id,
              price_pence,
              capacity,
              course_modules:module_id (
                code,
                title,
                credits,
                mode
              )
            )
          )
        `
      )
      .eq("person_id", personId)
      .eq("status", "accepted")
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle<OfferRow>(),
    supabase
      .from("admissions_registration_terms_versions")
      .select("version, body_text")
      .eq("active", true)
      .maybeSingle()
  ]);

  if (offerResult.error) {
    throw new Error(offerResult.error.message);
  }
  if (termsResult.error) {
    throw new Error(termsResult.error.message);
  }

  const registrationTerms = termsResult.data
    ? {
        version: String(termsResult.data.version),
        text: String(termsResult.data.body_text)
      }
    : {
        version: admissionsRegistrationTermsVersion,
        text: admissionsRegistrationTermsText
      };

  if (!offerResult.data) {
    return { registrationTerms };
  }

  const acceptedOffer = mapOffer(offerResult.data);
  const registrationResult = await supabase
    .from("admissions_registrations")
    .select(
      `
        id,
        status,
        registration_deadline_at,
        title,
        first_name,
        middle_names,
        last_name,
        preferred_name,
        previous_surname,
        date_of_birth,
        email,
        phone,
        address_line_1,
        address_line_2,
        city,
        postcode,
        country,
        module_confirmation_accepted,
        module_confirmed_at,
        saved_at,
        submitted_at,
        lapsed_at,
        lapsed_reason,
        reopened_at,
        reopened_reason,
        terms_version,
        terms_accepted_at,
        converted_at
      `
    )
    .eq("application_offer_id", acceptedOffer.id)
    .maybeSingle<RegistrationRow>();

  if (registrationResult.error) {
    throw new Error(registrationResult.error.message);
  }

  if (!registrationResult.data) {
    return { acceptedOffer, registrationTerms };
  }

  const [choiceResult, documentSlotResult] = await Promise.all([
    supabase
      .from("admissions_registration_module_offerings")
      .select("registration_id, choice_order, module_code, module_title, module_credits, module_mode, price_pence, capacity")
      .eq("registration_id", registrationResult.data.id)
      .order("choice_order"),
    supabase
      .from("admissions_registration_document_slots")
      .select(
        "slot_key, label, required, managed_file_id, original_filename, sanitized_filename, content_type, size_bytes, uploaded_at, verification_status, verification_route, verification_note"
      )
      .eq("registration_id", registrationResult.data.id)
      .order("required", { ascending: false })
  ]);

  if (choiceResult.error) {
    throw new Error(choiceResult.error.message);
  }
  if (documentSlotResult.error) {
    throw new Error(documentSlotResult.error.message);
  }

  return {
    acceptedOffer,
    registrationTerms,
    registration: mapRegistration(
      registrationResult.data,
      mapRegistrationModules((choiceResult.data ?? []) as RegistrationChoiceRow[]),
      (documentSlotResult.data ?? []) as RegistrationDocumentSlotRow[]
    )
  };
}

function NoticeBanner({
  type,
  title,
  children
}: {
  type: "success" | "error";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={type === "success" ? "apply-success" : "apply-error"} role="status">
      {type === "success" ? <CheckCircle2 size={22} /> : <LockKeyhole size={22} />}
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </div>
  );
}

function CoursePanel({ offer, modules }: { offer: AcceptedOfferSummary; modules: RegistrationModuleSummary[] }) {
  return (
    <div className="application-section">
      <div className="application-section-heading">
        <h3>Course Of Study</h3>
        <span>{offer.offerReference}</span>
      </div>
      <div className="offer-summary-grid">
        <div className="review-data-item">
          <span>Programme</span>
          <strong>{offer.programme === "pgcert" ? "PGCert" : "Microcredential"}</strong>
        </div>
        <div className="review-data-item">
          <span>Start term</span>
          <strong>{offer.termName ?? "Term to be confirmed"}</strong>
          <p className="muted small">{offer.termStartsOn ? `Starts ${formatDate(offer.termStartsOn)}` : "Start date unavailable"}</p>
        </div>
      </div>

      <div className="offer-module-list">
        {modules.length === 0 ? <p className="muted small">No module offering snapshot is linked to this accepted offer.</p> : null}
        {modules.map((module) => (
          <div className="review-offering-row" key={module.id}>
            <strong>
              Choice {module.choiceOrder}: {module.code}
            </strong>
            <p className="muted small">
              {module.title} · {module.credits} credits · {module.mode} · {formatCurrency(module.pricePence)} · capacity {module.capacity}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RegistrationDocumentSlotsPanel({
  registrationId,
  documentSlots,
  editable
}: {
  registrationId: string;
  documentSlots: RegistrationDocumentSlotSummary[];
  editable: boolean;
}) {
  const slotByKey = new Map(documentSlots.map((slot) => [slot.slotKey, slot]));

  return (
    <div className="application-section">
      <div className="application-section-heading">
        <h3>Documents</h3>
        <span>Upload now or verify at induction</span>
      </div>
      <div className="application-document-list">
        {admissionsRegistrationDocumentSlotDefinitions.map((definition) => {
          const uploadedSlot = slotByKey.get(definition.key);
          const uploadedAt = uploadedSlot?.uploadedAt ? formatDateTime(uploadedSlot.uploadedAt) : null;

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
                  <p className="muted small">
                    {uploadedSlot?.verificationRoute === "in_person"
                      ? "Verification will be completed in person at induction."
                      : "No file uploaded."}
                  </p>
                )}
                {uploadedSlot?.verificationNote ? <p className="muted small">Staff note: {uploadedSlot.verificationNote}</p> : null}
                {definition.required && editable ? (
                  <p className="muted small">
                    PDF is recommended; the maximum size is {Math.floor(definition.maxBytes / 1024 / 1024)} MB. If you cannot upload a suitable file, choose verification at induction and bring the original document with you.
                  </p>
                ) : null}
              </div>

              {editable ? (
                <form className="application-document-upload-form" action={uploadAdmissionsRegistrationDocument}>
                  <input type="hidden" name="registration_id" value={registrationId} />
                  <input type="hidden" name="slot_key" value={definition.key} />
                  <input className="input" name="document" type="file" accept={definition.acceptedExtensions.join(",")} required />
                  <button className="button secondary" type="submit">
                    <Upload size={16} />
                    Upload
                  </button>
                </form>
              ) : null}
              {editable && definition.required && !uploadedSlot?.managedFileId ? (
                <form action={setAdmissionsRegistrationDocumentVerificationRoute}>
                  <input type="hidden" name="registration_id" value={registrationId} />
                  <input type="hidden" name="slot_key" value={definition.key} />
                  <input
                    type="hidden"
                    name="verification_route"
                    value={uploadedSlot?.verificationRoute === "in_person" ? "upload" : "in_person"}
                  />
                  <button className="button secondary" type="submit">
                    {uploadedSlot?.verificationRoute === "in_person" ? "Upload instead" : "Verify later at induction"}
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

function BeginRegistrationPanel({ offer }: { offer: AcceptedOfferSummary }) {
  return (
    <div className="apply-form-panel application-draft-form">
      <div className="section-header">
        <div>
          <h2>Registration not started</h2>
          <p>Start registration from your accepted offer. No student record, enrolment, or finance row will be created yet.</p>
        </div>
        <StatusPill value="not_started" />
      </div>

      <CoursePanel offer={offer} modules={offer.modules} />

      <form action={beginAdmissionsRegistration}>
        <input type="hidden" name="offer_id" value={offer.id} />
        <button className="button primary" type="submit">
          <GraduationCap size={16} />
          Begin registration
        </button>
      </form>
    </div>
  );
}

function RegistrationForm({
  offer,
  registration,
  registrationTerms
}: {
  offer: AcceptedOfferSummary;
  registration: RegistrationSummary;
  registrationTerms: RegistrationTermsSummary;
}) {
  return (
    <div className="apply-form-panel application-draft-form">
      <div className="section-header">
        <div>
          <h2>Registration in progress</h2>
          <p>
            {registration.reopenedAt
              ? `Reopened ${formatDateTime(registration.reopenedAt)}. Current deadline: ${formatDateTime(registration.registrationDeadlineAt)}.`
              : registration.savedAt
                ? `Last saved ${formatDateTime(registration.savedAt)}. Deadline: ${formatDateTime(registration.registrationDeadlineAt)}.`
                : `Save a draft as you check your details. Deadline: ${formatDateTime(registration.registrationDeadlineAt)}.`}
          </p>
        </div>
        <StatusPill value={registration.status} />
      </div>

      <form className="grid" action={saveAdmissionsRegistration}>
        <input type="hidden" name="registration_id" value={registration.id} />
        <CoursePanel offer={offer} modules={registration.modules} />

        <label className="check-option inline-check">
          <input
            name="module_confirmation_accepted"
            type="checkbox"
            defaultChecked={registration.moduleConfirmationAccepted}
            required
          />{" "}
          I confirm this course of study and these intended first-term modules match my accepted offer
        </label>

        <div className="application-section">
          <div className="application-section-heading">
            <h3>Personal Details</h3>
            <span>Versioned on save</span>
          </div>
          <FormGrid>
            <Field label="Title" htmlFor="registration-title">
              <input id="registration-title" name="title" className="input" defaultValue={registration.title ?? ""} />
            </Field>
            <Field label="First name" htmlFor="registration-first-name" required>
              <input id="registration-first-name" name="first_name" className="input" defaultValue={registration.firstName} required />
            </Field>
            <Field label="Middle names" htmlFor="registration-middle-names">
              <input id="registration-middle-names" name="middle_names" className="input" defaultValue={registration.middleNames ?? ""} />
            </Field>
            <Field label="Last name" htmlFor="registration-last-name" required>
              <input id="registration-last-name" name="last_name" className="input" defaultValue={registration.lastName} required />
            </Field>
            <Field label="Preferred name" htmlFor="registration-preferred-name">
              <input id="registration-preferred-name" name="preferred_name" className="input" defaultValue={registration.preferredName ?? ""} />
            </Field>
            <Field label="Previous surname" htmlFor="registration-previous-surname">
              <input id="registration-previous-surname" name="previous_surname" className="input" defaultValue={registration.previousSurname ?? ""} />
            </Field>
            <Field label="Date of birth" htmlFor="registration-date-of-birth" required>
              <input
                id="registration-date-of-birth"
                name="date_of_birth"
                className="input"
                type="date"
                defaultValue={registration.dateOfBirth ?? ""}
                required
              />
            </Field>
            <Field label="Email" htmlFor="registration-email" required>
              <input id="registration-email" name="email" className="input" type="email" defaultValue={registration.email} required />
            </Field>
            <Field label="Phone" htmlFor="registration-phone" required>
              <input id="registration-phone" name="phone" className="input" type="tel" defaultValue={registration.phone ?? ""} required />
            </Field>
            <Field label="Address line 1" htmlFor="registration-address-line-1" required>
              <input
                id="registration-address-line-1"
                name="address_line_1"
                className="input"
                defaultValue={registration.addressLine1 ?? ""}
                required
              />
            </Field>
            <Field label="Address line 2" htmlFor="registration-address-line-2">
              <input
                id="registration-address-line-2"
                name="address_line_2"
                className="input"
                defaultValue={registration.addressLine2 ?? ""}
              />
            </Field>
            <Field label="City/town" htmlFor="registration-city" required>
              <input id="registration-city" name="city" className="input" defaultValue={registration.city ?? ""} required />
            </Field>
            <Field label="Postcode" htmlFor="registration-postcode" required>
              <input id="registration-postcode" name="postcode" className="input" defaultValue={registration.postcode ?? ""} required />
            </Field>
            <Field label="Country" htmlFor="registration-country" required>
              <input id="registration-country" name="country" className="input" defaultValue={registration.country ?? ""} required />
            </Field>
          </FormGrid>
        </div>

        <div className="application-section">
          <div className="application-section-heading">
            <h3>Terms And Conditions</h3>
            <span>{registrationTerms.version}</span>
          </div>
          <p className="muted small">{registrationTerms.text}</p>
          <label className="check-option inline-check">
            <input name="terms_accepted" type="checkbox" required /> I accept the registration terms and conditions
          </label>
        </div>

        <div className="offer-action-row">
          <button className="button primary" type="submit" formNoValidate>
            <FileText size={16} />
            Save draft
          </button>
          <button className="button primary" type="submit" formAction={submitAdmissionsRegistration}>
            <ShieldCheck size={16} />
            Submit registration
          </button>
        </div>
      </form>

      <RegistrationDocumentSlotsPanel registrationId={registration.id} documentSlots={registration.documentSlots} editable />
    </div>
  );
}

function SubmittedRegistrationPanel({ offer, registration }: { offer: AcceptedOfferSummary; registration: RegistrationSummary }) {
  const complete = registration.status === "complete";
  return (
    <div className="apply-form-panel application-draft-form">
      <div className="section-header">
        <div>
          <h2>{complete ? "Registration complete" : "Registration submitted"}</h2>
          <p>
            {complete
              ? `Converted to a student record ${formatDateTime(registration.convertedAt)}.`
              : `Submitted ${formatDateTime(registration.submittedAt)}. Admissions can now review the submitted registration status.`}
          </p>
        </div>
        <StatusPill value={complete ? "complete" : "submitted"} />
      </div>

      <CoursePanel offer={offer} modules={registration.modules} />
      <div className="review-data-grid">
        <div className="review-data-item">
          <span>Name</span>
          <strong>{[registration.title, registration.firstName, registration.middleNames, registration.lastName].filter(Boolean).join(" ")}</strong>
        </div>
        <div className="review-data-item">
          <span>Email</span>
          <strong>{registration.email}</strong>
        </div>
        <div className="review-data-item">
          <span>T&C version</span>
          <strong>{registration.termsVersion ?? "Not recorded"}</strong>
          <p className="muted small">Accepted {formatDateTime(registration.termsAcceptedAt)}</p>
        </div>
      </div>
      <RegistrationDocumentSlotsPanel registrationId={registration.id} documentSlots={registration.documentSlots} editable={false} />
    </div>
  );
}

function LapsedRegistrationPanel({ offer, registration }: { offer: AcceptedOfferSummary; registration: RegistrationSummary }) {
  return (
    <div className="apply-form-panel application-draft-form">
      <div className="section-header">
        <div>
          <h2>Registration lapsed</h2>
          <p>
            This registration lapsed {formatDateTime(registration.lapsedAt)}. Admissions must reopen it before you can submit or update
            it.
          </p>
        </div>
        <StatusPill value="lapsed" />
      </div>

      <CoursePanel offer={offer} modules={registration.modules} />
      <div className="review-data-grid">
        <div className="review-data-item">
          <span>Deadline</span>
          <strong>{formatDateTime(registration.registrationDeadlineAt)}</strong>
        </div>
        <div className="review-data-item">
          <span>Last saved</span>
          <strong>{formatDateTime(registration.savedAt)}</strong>
        </div>
        <div className="review-data-item">
          <span>Submitted</span>
          <strong>{formatDateTime(registration.submittedAt)}</strong>
        </div>
      </div>
      <p className="muted small">No applicant email has been sent from this placeholder workflow.</p>
      <RegistrationDocumentSlotsPanel registrationId={registration.id} documentSlots={registration.documentSlots} editable={false} />
    </div>
  );
}

export default async function PortalRegistrationPage({
  searchParams
}: {
  searchParams: Promise<{
    started?: string;
    saved?: string;
    submitted?: string;
    document?: string;
    document_route?: string;
    document_error?: string;
    registration_error?: string;
  }>;
}) {
  const profile = await requireApplicantProfile("/portal/registration");
  const {
    started,
    saved,
    submitted,
    document,
    document_route: documentRoute,
    document_error: documentError,
    registration_error: registrationError
  } = await searchParams;
  const { acceptedOffer, registration, registrationTerms } = await getRegistrationContext(profile.personId);

  return (
    <main className="apply-page">
      <section className="apply-intake">
        <div className="apply-heading">
          <div className="brand-mark">B</div>
          <div>
            <span className="apply-kicker">Applicant portal</span>
            <h1>Registration</h1>
            <p>
              Signed in as {profile.person.firstName} {profile.person.lastName}. Registration is available only after you accept an offer.
            </p>
          </div>
        </div>

        {started ? (
          <NoticeBanner type="success" title="Registration started">
            {started === "demo" ? "Demo mode is running without a Supabase database, so no live registration was started." : "Your registration draft is ready."}
          </NoticeBanner>
        ) : null}
        {saved ? (
          <NoticeBanner type="success" title="Registration saved">
            {saved === "demo" ? "Demo mode is running without a Supabase database, so no live registration was saved." : "Your registration draft has been saved."}
          </NoticeBanner>
        ) : null}
        {document ? (
          <NoticeBanner type="success" title="Document uploaded">
            {document === "demo" ? "Demo mode is running without Supabase storage, so no live document was uploaded." : "Your registration document has been saved."}
          </NoticeBanner>
        ) : null}
        {documentRoute ? (
          <NoticeBanner type="success" title="Document verification choice saved">
            {documentRoute === "in_person"
              ? "Bring the original document to induction for verification. You can still upload it here before submitting registration."
              : "Upload is selected for this document."}
          </NoticeBanner>
        ) : null}
        {documentError ? (
          <NoticeBanner type="error" title="Document not uploaded">
            {documentError === "size"
              ? "The file is larger than the limit shown beside that document. Convert or compress it to PDF, or choose verification at induction and bring the original."
              : "Use one of the file types shown by the upload control. PDF is recommended for documents."}
          </NoticeBanner>
        ) : null}
        {registrationError ? (
          <NoticeBanner type="error" title="Registration not submitted">
            {registrationError === "incomplete"
              ? "Complete every field marked with a red asterisk and either upload each required document or choose verification at induction."
              : registrationError === "deadline"
                ? "The registration deadline has passed. Contact admissions to reopen it."
                : "Your saved registration is unchanged. Please review the form and try again, or contact admissions."}
          </NoticeBanner>
        ) : null}
        {submitted ? (
          <NoticeBanner type="success" title="Registration submitted">
            {submitted === "demo" ? "Demo mode is running without a Supabase database, so no live registration was submitted." : "Your registration has been submitted."}
          </NoticeBanner>
        ) : null}

        {!acceptedOffer ? (
          <div className="apply-form-panel">
            <div className="section-header">
              <div>
                <h2>Registration unavailable</h2>
                <p>You need an accepted offer before registration can begin.</p>
              </div>
              <div className="icon-box">
                <LockKeyhole size={18} />
              </div>
            </div>
            <Link className="button secondary apply-submit" href="/portal">
              Back to portal
            </Link>
          </div>
        ) : !registration ? (
          <BeginRegistrationPanel offer={acceptedOffer} />
        ) : registration.status === "lapsed" ? (
          <LapsedRegistrationPanel offer={acceptedOffer} registration={registration} />
        ) : registration.status === "submitted" || registration.status === "complete" ? (
          <SubmittedRegistrationPanel offer={acceptedOffer} registration={registration} />
        ) : (
          <RegistrationForm offer={acceptedOffer} registration={registration} registrationTerms={registrationTerms} />
        )}
      </section>
    </main>
  );
}
