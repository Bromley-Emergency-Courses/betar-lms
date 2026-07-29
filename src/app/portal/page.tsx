import Link from "next/link";
import { CheckCircle2, Clock, FileText, GraduationCap, XCircle } from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import { respondToApplicationOffer } from "@/app/portal/actions";
import { canRespondToApplicationOffer, type ApplicationOfferStatus } from "@/lib/application-offers";
import { requireCurrentPortalProfile } from "@/lib/portal-auth";
import { getAppData } from "@/lib/seed";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface PortalOfferModule {
  id: string;
  choiceOrder: number;
  code: string;
  title: string;
  credits: number;
  mode: "online" | "practical";
  pricePence: number;
  capacity: number;
}

interface PortalOfferSummary {
  id: string;
  applicationId: string;
  admissionLeadId: string;
  offerReference: string;
  programme: "pgcert" | "microcredential";
  status: ApplicationOfferStatus;
  issuedAt: string;
  deadlineAt?: string;
  acceptedAt?: string;
  declinedAt?: string;
  lapsedAt?: string;
  deadlinePassed: boolean;
  termName?: string;
  termStartsOn?: string;
  modules: PortalOfferModule[];
}

interface PortalRegistrationSummary {
  id: string;
  status: "not_started" | "in_progress" | "submitted";
  savedAt?: string;
  submittedAt?: string;
}

type RelatedObject = Record<string, unknown>;

type PortalOfferRow = {
  id: string;
  application_id: string;
  offer_reference: string;
  programme: "pgcert" | "microcredential";
  status: ApplicationOfferStatus;
  issued_at: string;
  deadline_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  lapsed_at: string | null;
  applications: RelatedObject | RelatedObject[] | null;
  terms: RelatedObject | RelatedObject[] | null;
  application_offer_module_offerings: RelatedObject[] | null;
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

function formatDateTime(value?: string): string {
  return value ? new Date(value).toLocaleString("en-GB") : "Not set";
}

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleDateString("en-GB") : "No deadline";
}

function formatCurrency(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(pence / 100);
}

function mapOfferRow(row: PortalOfferRow): PortalOfferSummary {
  const application = relatedObject(row.applications);
  const term = relatedObject(row.terms);
  const modules = relatedArray(row.application_offer_module_offerings)
    .map((choice) => {
      const offering = relatedObject(choice.module_offerings);
      const courseModule = relatedObject(offering?.course_modules);
      const mode: PortalOfferModule["mode"] = courseModule?.mode === "practical" ? "practical" : "online";
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

  return {
    id: row.id,
    applicationId: row.application_id,
    admissionLeadId: String(application?.admission_lead_id ?? ""),
    offerReference: row.offer_reference,
    programme: row.programme,
    status: row.status,
    issuedAt: row.issued_at,
    deadlineAt: optionalString(row.deadline_at),
    acceptedAt: optionalString(row.accepted_at),
    declinedAt: optionalString(row.declined_at),
    lapsedAt: optionalString(row.lapsed_at),
    deadlinePassed: row.status === "issued" && row.deadline_at ? new Date(row.deadline_at).getTime() <= Date.now() : false,
    termName: optionalString(term?.name),
    termStartsOn: optionalString(term?.starts_on),
    modules
  };
}

async function getPortalOfferContext(personId: string): Promise<{
  currentOffer?: PortalOfferSummary;
  registration?: PortalRegistrationSummary;
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
      currentOffer: {
        id: "66666666-6666-4666-8666-666666666666",
        applicationId: "77777777-7777-4777-8777-777777777777",
        admissionLeadId: "11111111-1111-4111-8111-111111111111",
        offerReference: "BETAR-DEMO-OFFER",
        programme: "pgcert",
        status: "issued",
        issuedAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        deadlinePassed: false,
        termName: term?.name,
        termStartsOn: term?.startsOn,
        modules
      }
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("application_offers")
    .select(
      `
        id,
        application_id,
        offer_reference,
        programme,
        status,
        issued_at,
        deadline_at,
        accepted_at,
        declined_at,
        lapsed_at,
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
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle<PortalOfferRow>();

  if (error) {
    throw new Error(error.message);
  }

  const currentOffer = data ? mapOfferRow(data) : undefined;
  if (!currentOffer) {
    return {};
  }

  const registrationResult = await supabase
    .from("admissions_registrations")
    .select("id, status, saved_at, submitted_at")
    .eq("application_offer_id", currentOffer.id)
    .maybeSingle();

  if (registrationResult.error) {
    throw new Error(registrationResult.error.message);
  }

  return {
    currentOffer,
    registration: registrationResult.data
      ? {
          id: String(registrationResult.data.id),
          status:
            registrationResult.data.status === "submitted"
              ? "submitted"
              : registrationResult.data.status === "in_progress"
                ? "in_progress"
                : "not_started",
          savedAt: optionalString(registrationResult.data.saved_at),
          submittedAt: optionalString(registrationResult.data.submitted_at)
        }
      : undefined
  };
}

function OfferResponseBanner({ offerResult }: { offerResult?: string }) {
  if (!offerResult) {
    return null;
  }

  const accepted = offerResult.startsWith("accepted");
  return (
    <div className="apply-success" role="status">
      {accepted ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
      <div>
        <h2>{accepted ? "Offer accepted" : "Offer declined"}</h2>
        <p>
          {offerResult.endsWith("demo")
            ? "Demo mode is running without a Supabase database, so no live offer response was saved."
            : "Your response has been recorded in the portal."}
        </p>
      </div>
    </div>
  );
}

function OfferResponseErrorBanner({ offerError }: { offerError?: string }) {
  if (!offerError) {
    return null;
  }

  const messages: Record<string, string> = {
    deadline: "The offer deadline has passed. Admissions will need to reissue the offer before you can respond.",
    not_issued: "This offer is no longer awaiting a response.",
    stage: "This admissions record is no longer at the offer-response stage.",
    not_found: "This offer could not be found for your applicant account.",
    failed: "Your offer response could not be recorded. Please try again."
  };

  return (
    <div className="apply-error" role="alert">
      <XCircle size={22} />
      <div>
        <h2>Offer response not recorded</h2>
        <p>{messages[offerError] ?? messages.failed}</p>
      </div>
    </div>
  );
}

function OfferActions({ offer }: { offer: PortalOfferSummary }) {
  const access = canRespondToApplicationOffer({ status: offer.status, deadlineAt: offer.deadlineAt });

  if (!access.allowed) {
    const message =
      access.reason === "offer_deadline_passed"
        ? "The response deadline has passed. Admissions will need to reissue the offer before you can respond."
        : "This offer is no longer awaiting a response.";
    return <p className="muted small">{message}</p>;
  }

  return (
    <div className="offer-action-row">
      <form action={respondToApplicationOffer}>
        <input type="hidden" name="offer_id" value={offer.id} />
        <input type="hidden" name="offer_response" value="accept" />
        <button className="button primary" type="submit">
          <CheckCircle2 size={16} />
          Accept offer
        </button>
      </form>
      <form action={respondToApplicationOffer}>
        <input type="hidden" name="offer_id" value={offer.id} />
        <input type="hidden" name="offer_response" value="decline" />
        <button className="button secondary danger-button" type="submit">
          <XCircle size={16} />
          Decline offer
        </button>
      </form>
    </div>
  );
}

function OfferStatePanel({ offer, registration }: { offer: PortalOfferSummary; registration?: PortalRegistrationSummary }) {
  if (offer.status === "accepted") {
    const registrationStatus = registration?.status ?? "not_started";
    const detail =
      registrationStatus === "submitted"
        ? `Your registration was submitted ${formatDateTime(registration?.submittedAt)}.`
        : registrationStatus === "in_progress"
          ? `Your registration draft was last saved ${formatDateTime(registration?.savedAt)}.`
          : `Your offer was accepted ${formatDateTime(offer.acceptedAt)}. Start registration when you are ready.`;

    return (
      <div className="offer-state-panel success">
        <GraduationCap size={18} />
        <div>
          <strong>Registration {registrationStatus.replaceAll("_", " ")}</strong>
          <p className="muted small">{detail}</p>
          <Link className="button secondary apply-submit" href="/portal/registration">
            Open registration
          </Link>
        </div>
      </div>
    );
  }

  if (offer.status === "declined") {
    return (
      <div className="offer-state-panel declined">
        <XCircle size={18} />
        <div>
          <strong>Offer declined</strong>
          <p className="muted small">Your decline was recorded {formatDateTime(offer.declinedAt)}.</p>
        </div>
      </div>
    );
  }

  if (offer.status === "lapsed") {
    return (
      <div className="offer-state-panel declined">
        <Clock size={18} />
        <div>
          <strong>Offer lapsed</strong>
          <p className="muted small">This offer lapsed {formatDateTime(offer.lapsedAt)}.</p>
        </div>
      </div>
    );
  }

  if (offer.deadlinePassed) {
    return (
      <div className="offer-state-panel declined">
        <Clock size={18} />
        <div>
          <strong>Offer deadline passed</strong>
          <p className="muted small">This offer cannot be accepted or declined unless admissions reissues it.</p>
        </div>
      </div>
    );
  }

  return null;
}

function CurrentOfferPanel({ offer, registration }: { offer: PortalOfferSummary; registration?: PortalRegistrationSummary }) {
  return (
    <div className="apply-form-panel application-draft-form">
      <div className="section-header">
        <div>
          <h2>Current offer</h2>
          <p>Reference {offer.offerReference}</p>
        </div>
        <StatusPill value={offer.status} />
        {offer.deadlinePassed ? <StatusPill value="watch" label="deadline passed" /> : null}
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
        <div className="review-data-item">
          <span>Issued</span>
          <strong>{formatDate(offer.issuedAt)}</strong>
        </div>
        <div className="review-data-item">
          <span>Response deadline</span>
          <strong>{formatDate(offer.deadlineAt)}</strong>
        </div>
      </div>

      <div className="application-section">
        <div className="application-section-heading">
          <h3>Offered modules</h3>
          <span>{offer.modules.length} selected</span>
        </div>
        <div className="offer-module-list">
          {offer.modules.length === 0 ? <p className="muted small">No module offering snapshot is linked to this offer.</p> : null}
          {offer.modules.map((module) => (
            <div className="review-offering-row" key={module.id}>
              <strong>
                {module.code} · {module.title}
              </strong>
              <p className="muted small">
                {module.credits} credits · {module.mode} · {formatCurrency(module.pricePence)} · capacity {module.capacity}
              </p>
            </div>
          ))}
        </div>
      </div>

      <OfferStatePanel offer={offer} registration={registration} />
      <OfferActions offer={offer} />
    </div>
  );
}

export default async function PortalPage({
  searchParams
}: {
  searchParams: Promise<{ offer?: string; offerError?: string }>;
}) {
  const profile = await requireCurrentPortalProfile("/portal");
  const { offer: offerResult, offerError } = await searchParams;
  const { currentOffer, registration } = await getPortalOfferContext(profile.personId);

  return (
    <main className="apply-page">
      <section className="apply-intake">
        <div className="apply-heading">
          <div className="brand-mark">B</div>
          <div>
            <span className="apply-kicker">Applicant portal</span>
            <h1>Offer and registration</h1>
            <p>
              Signed in as {profile.person.firstName} {profile.person.lastName}. Your portal shows the authoritative admissions state.
            </p>
          </div>
        </div>

        <OfferResponseBanner offerResult={offerResult} />
        <OfferResponseErrorBanner offerError={offerError} />

        {currentOffer ? (
          <CurrentOfferPanel offer={currentOffer} registration={registration} />
        ) : (
          <div className="apply-form-panel">
            <div className="section-header">
              <div>
                <h2>No current offer</h2>
                <p>Submitted applications and issued offers will appear here.</p>
              </div>
              <div className="icon-box">
                <FileText size={18} />
              </div>
            </div>
            <Link className="button secondary apply-submit" href="/apply/application">
              View application
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
