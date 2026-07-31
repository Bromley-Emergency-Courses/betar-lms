import { CheckCircle2, Clock, ListChecks, XCircle } from "lucide-react";
import Link from "next/link";
import { submitModulePreferences } from "@/app/portal/module-preferences/actions";
import { Field, FormGrid } from "@/components/forms";
import { StatusPill } from "@/components/status-pill";
import { requireStudentProfile, type PortalProfile } from "@/lib/portal-auth";
import { getAppData } from "@/lib/seed";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface StudentPreferenceOffering {
  offeringId: string;
  displayOrder: number;
  moduleCode: string;
  moduleTitle: string;
  credits: number;
  mode: "online" | "practical";
  capacity: number;
  alreadyEnrolledCount: number;
  preferenceSelectionCount: number;
  remainingPlaces: number;
  isFull: boolean;
  isUnavailable: boolean;
}

interface StudentPreferenceSubmission {
  id: string;
  choiceCount: number;
  skipReason?: string;
  updatedAt: string;
  offeringIds: string[];
}

interface StudentPreferenceWindow {
  id: string;
  title: string;
  status: "open";
  opensAt: string;
  closesAt: string;
  termName: string;
  termStartsOn: string;
  offerings: StudentPreferenceOffering[];
  submission?: StudentPreferenceSubmission;
}

type RelatedObject = Record<string, unknown>;

type WindowRow = {
  id: string;
  title: string;
  status: "open";
  opens_at: string;
  closes_at: string;
  terms: RelatedObject | RelatedObject[] | null;
  module_preference_window_offerings: RelatedObject[] | null;
};

type SubmissionRow = {
  id: string;
  window_id: string;
  choice_count: number;
  skip_reason: string | null;
  updated_at: string;
  module_preference_submission_choices: RelatedObject[] | null;
};

type CapacityRow = {
  window_id: string;
  offering_id: string;
  capacity: number;
  already_enrolled_count: number;
  preference_selection_count: number;
  remaining_places: number;
  is_full: boolean;
  is_unavailable: boolean;
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
  return value ? new Date(value).toLocaleDateString("en-GB") : "Not set";
}

function formatDateTime(value?: string): string {
  return value ? new Date(value).toLocaleString("en-GB") : "Not set";
}

function capacityKey(windowId: string, offeringId: string): string {
  return `${windowId}:${offeringId}`;
}

function defaultCapacityCounters(capacity: number): Pick<
  StudentPreferenceOffering,
  "alreadyEnrolledCount" | "preferenceSelectionCount" | "remainingPlaces" | "isFull" | "isUnavailable"
> {
  return {
    alreadyEnrolledCount: 0,
    preferenceSelectionCount: 0,
    remainingPlaces: capacity,
    isFull: false,
    isUnavailable: false
  };
}

function capacityCountersFromRow(row: CapacityRow): Pick<
  StudentPreferenceOffering,
  "alreadyEnrolledCount" | "preferenceSelectionCount" | "remainingPlaces" | "isFull" | "isUnavailable"
> {
  return {
    alreadyEnrolledCount: Number(row.already_enrolled_count ?? 0),
    preferenceSelectionCount: Number(row.preference_selection_count ?? 0),
    remainingPlaces: Number(row.remaining_places ?? 0),
    isFull: Boolean(row.is_full),
    isUnavailable: Boolean(row.is_unavailable)
  };
}

function mapWindowOffering(row: RelatedObject): StudentPreferenceOffering | undefined {
  const offering = relatedObject(row.module_offerings);
  const courseModule = relatedObject(offering?.course_modules);
  if (!offering || !courseModule) {
    return undefined;
  }

  return {
    offeringId: String(offering.id),
    displayOrder: Number(row.display_order ?? 0),
    moduleCode: String(courseModule.code ?? ""),
    moduleTitle: String(courseModule.title ?? ""),
    credits: Number(courseModule.credits ?? 0),
    mode: courseModule.mode === "online" ? "online" : "practical",
    capacity: Number(offering.capacity ?? 0),
    ...defaultCapacityCounters(Number(offering.capacity ?? 0))
  };
}

function mapSubmission(row: SubmissionRow): StudentPreferenceSubmission {
  return {
    id: row.id,
    choiceCount: Number(row.choice_count ?? 0),
    skipReason: optionalString(row.skip_reason),
    updatedAt: row.updated_at,
    offeringIds: relatedArray(row.module_preference_submission_choices)
      .sort((first, second) => Number(first.preference_order ?? 0) - Number(second.preference_order ?? 0))
      .map((choice) => String(choice.offering_id ?? ""))
      .filter(Boolean)
  };
}

function demoProfile(): PortalProfile {
  return {
    authUserId: "demo-student-user",
    personId: "demo-student-person",
    email: "student@example.com",
    actorType: "student",
    person: {
      id: "demo-student-person",
      firstName: "Demo",
      lastName: "Student",
      email: "student@example.com"
    }
  };
}

async function getStudentPreferenceWindows(): Promise<StudentPreferenceWindow[]> {
  if (!isSupabaseConfigured()) {
    const data = getAppData();
    const term = data.terms.find((candidate) => candidate.status === "published") ?? data.terms[0];
    if (!term) {
      return [];
    }

    return [
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: `${term.name} module preferences`,
        status: "open",
        opensAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        closesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        termName: term.name,
        termStartsOn: term.startsOn,
        offerings: data.offerings
          .filter((offering) => offering.termId === term.id)
          .slice(0, 4)
          .map((offering, index) => {
            const courseModule = data.modules.find((candidate) => candidate.id === offering.moduleId);
            return {
              offeringId: offering.id,
              displayOrder: index + 1,
              moduleCode: courseModule?.code ?? "",
              moduleTitle: courseModule?.title ?? "",
              credits: courseModule?.credits ?? 0,
              mode: courseModule?.mode ?? "practical",
              capacity: offering.capacity,
              alreadyEnrolledCount: 0,
              preferenceSelectionCount: 0,
              remainingPlaces: offering.capacity,
              isFull: false,
              isUnavailable: false
            };
          })
      }
    ];
  }

  const supabase = await createSupabaseServerClient();
  const studentResult = await supabase.rpc("current_active_student_id_for_module_preferences");

  if (studentResult.error) {
    throw new Error(studentResult.error.message);
  }

  if (!studentResult.data) {
    return [];
  }

  const windowResult = await supabase
    .from("module_preference_windows")
    .select(
      `
        id,
        title,
        status,
        opens_at,
        closes_at,
        terms:term_id (
          name,
          starts_on
        ),
        module_preference_window_offerings (
          offering_id,
          display_order,
          module_offerings:offering_id (
            id,
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
    .eq("status", "open")
    .lte("opens_at", new Date().toISOString())
    .gt("closes_at", new Date().toISOString())
    .order("closes_at", { ascending: true });

  if (windowResult.error) {
    throw new Error(windowResult.error.message);
  }

  const windows = (windowResult.data ?? []) as unknown as WindowRow[];
  const windowIds = windows.map((window) => window.id);
  const capacityResult =
    windowIds.length > 0
      ? await supabase.rpc("module_preference_window_offering_capacity", {
          p_window_ids: windowIds
        })
      : { data: [], error: null };
  const submissionResult =
    windowIds.length > 0
      ? await supabase
          .from("module_preference_submissions")
          .select(
            `
              id,
              window_id,
              choice_count,
              skip_reason,
              updated_at,
              module_preference_submission_choices (
                offering_id,
                preference_order
              )
            `
          )
          .eq("student_id", String(studentResult.data))
          .in("window_id", windowIds)
      : { data: [], error: null };

  if (submissionResult.error) {
    throw new Error(submissionResult.error.message);
  }

  if (capacityResult.error) {
    throw new Error(capacityResult.error.message);
  }

  const submissionByWindow = new Map<string, StudentPreferenceSubmission>();
  ((submissionResult.data ?? []) as unknown as SubmissionRow[]).forEach((submission) => {
    submissionByWindow.set(submission.window_id, mapSubmission(submission));
  });
  const capacityByWindowOffering = new Map<string, CapacityRow>();
  ((capacityResult.data ?? []) as unknown as CapacityRow[]).forEach((row) => {
    capacityByWindowOffering.set(capacityKey(row.window_id, row.offering_id), row);
  });

  return windows.map((row) => {
    const term = relatedObject(row.terms);
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      termName: String(term?.name ?? "Unknown term"),
      termStartsOn: String(term?.starts_on ?? ""),
      offerings: relatedArray(row.module_preference_window_offerings)
        .map(mapWindowOffering)
        .filter((offering): offering is StudentPreferenceOffering => Boolean(offering))
        .map((offering) => ({
          ...offering,
          ...capacityCountersFromRow(
            capacityByWindowOffering.get(capacityKey(row.id, offering.offeringId)) ?? {
              window_id: row.id,
              offering_id: offering.offeringId,
              capacity: offering.capacity,
              already_enrolled_count: 0,
              preference_selection_count: 0,
              remaining_places: offering.capacity,
              is_full: false,
              is_unavailable: false
            }
          )
        }))
        .sort((first, second) => first.displayOrder - second.displayOrder),
      submission: submissionByWindow.get(row.id)
    };
  });
}

function ResultBanner({ submitted, preferenceError }: { submitted?: string; preferenceError?: string }) {
  if (submitted) {
    return (
      <div className="apply-success" role="status">
        <CheckCircle2 size={22} />
        <div>
          <h2>Preferences saved</h2>
          <p>{submitted === "demo" ? "Demo mode did not write to Supabase." : "Your current module preferences have been recorded."}</p>
        </div>
      </div>
    );
  }

  if (!preferenceError) {
    return null;
  }

  const messages: Record<string, string> = {
    closed: "This preference window is not currently open.",
    too_many: "Choose no more than two module offerings.",
    unavailable: "One of the selected module offerings is not available in this window.",
    full: "One of the selected module offerings is full. Choose another available module or keep your current saved choice.",
    ineligible: "Only active students can submit module preferences.",
    invalid_order: "Choose a first preference before a second preference, and do not choose the same module twice.",
    failed: "Your preferences could not be saved. Please try again."
  };

  return (
    <div className="apply-error" role="alert">
      <XCircle size={22} />
      <div>
        <h2>Preferences not saved</h2>
        <p>{messages[preferenceError] ?? messages.failed}</p>
      </div>
    </div>
  );
}

function PreferenceWindowForm({ window }: { window: StudentPreferenceWindow }) {
  const firstChoiceOfferingId = window.submission?.offeringIds[0] ?? "";
  const secondChoiceOfferingId = window.submission?.offeringIds[1] ?? "";
  const currentOfferingIds = new Set(window.submission?.offeringIds ?? []);

  return (
    <form className="apply-form-panel application-draft-form" action={submitModulePreferences} id={`window-${window.id}`}>
      <input type="hidden" name="window_id" value={window.id} />
      <div className="section-header">
        <div>
          <h2>{window.title}</h2>
          <p>
            {window.termName} starts {formatDate(window.termStartsOn)}. Submit by {formatDateTime(window.closesAt)}.
          </p>
        </div>
        <StatusPill value="open" />
      </div>

      {window.submission ? (
        <div className="offer-state-panel success">
          <CheckCircle2 size={18} />
          <div>
            <strong>Current submission saved</strong>
            <p className="muted small">Last updated {formatDateTime(window.submission.updatedAt)}. Submitting again updates this same record.</p>
          </div>
        </div>
      ) : null}

      <div className="application-section">
        <div className="application-section-heading">
          <h3>Module preferences</h3>
          <span>First and second choice</span>
        </div>
        <FormGrid>
          <Field label="First preference" htmlFor={`first-choice-${window.id}`}>
            <select
              id={`first-choice-${window.id}`}
              name="first_choice_offering_id"
              className="select"
              defaultValue={firstChoiceOfferingId}
            >
              <option value="">No module this term</option>
              {window.offerings.map((offering) => (
                <option
                  disabled={offering.isUnavailable && !currentOfferingIds.has(offering.offeringId)}
                  key={offering.offeringId}
                  value={offering.offeringId}
                >
                  {offering.moduleCode} - {offering.moduleTitle}
                  {offering.isUnavailable && !currentOfferingIds.has(offering.offeringId) ? " (full)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Second preference" htmlFor={`second-choice-${window.id}`}>
            <select
              id={`second-choice-${window.id}`}
              name="second_choice_offering_id"
              className="select"
              defaultValue={secondChoiceOfferingId}
            >
              <option value="">No second choice</option>
              {window.offerings.map((offering) => (
                <option
                  disabled={offering.isUnavailable && !currentOfferingIds.has(offering.offeringId)}
                  key={offering.offeringId}
                  value={offering.offeringId}
                >
                  {offering.moduleCode} - {offering.moduleTitle}
                  {offering.isUnavailable && !currentOfferingIds.has(offering.offeringId) ? " (full)" : ""}
                </option>
              ))}
            </select>
          </Field>
        </FormGrid>
        <div className="offer-module-list">
          {window.offerings.map((offering) => (
            <div className="review-offering-row" key={offering.offeringId}>
              <strong>
                {offering.moduleCode} - {offering.moduleTitle}
              </strong>
              <p className="muted small">
                {offering.credits} credits · {offering.mode} · capacity {offering.capacity} · {offering.remainingPlaces} places remaining
                {offering.isUnavailable ? " · full" : ""}
              </p>
            </div>
          ))}
        </div>
      </div>

      <label className="field" htmlFor={`skip-${window.id}`}>
        <span>Reason if choosing no modules</span>
        <textarea
          id={`skip-${window.id}`}
          name="skip_reason"
          className="textarea"
          defaultValue={window.submission?.skipReason ?? ""}
          placeholder="Optional"
        />
      </label>

      <button className="button primary apply-submit" type="submit">
        <ListChecks size={16} />
        Submit preferences
      </button>
    </form>
  );
}

export default async function ModulePreferencesPage({
  searchParams
}: {
  searchParams: Promise<{ submitted?: string; preferenceError?: string }>;
}) {
  const profile = isSupabaseConfigured() ? await requireStudentProfile("/portal/module-preferences") : demoProfile();
  const { submitted, preferenceError } = await searchParams;
  const windows = await getStudentPreferenceWindows();

  return (
    <main className="apply-page">
      <section className="apply-intake">
        <div className="apply-heading">
          <div className="brand-mark">B</div>
          <div>
            <span className="apply-kicker">Student portal</span>
            <h1>Module preferences</h1>
            <p>
              Signed in as {profile.person.firstName} {profile.person.lastName}. Only module offerings configured for an open termly window are selectable.
            </p>
          </div>
        </div>

        <ResultBanner submitted={submitted} preferenceError={preferenceError} />

        {windows.length === 0 ? (
          <div className="apply-form-panel">
            <div className="section-header">
              <div>
                <h2>No open preference windows</h2>
                <p>Open termly preference windows will appear here while submissions are available.</p>
              </div>
              <Clock size={18} />
            </div>
            <Link className="button secondary apply-submit" href="/portal">
              Back to portal
            </Link>
          </div>
        ) : (
          windows.map((window) => <PreferenceWindowForm key={window.id} window={window} />)
        )}
      </section>
    </main>
  );
}
