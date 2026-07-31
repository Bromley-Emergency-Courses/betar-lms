import { CheckCircle2, ClipboardList, Eye, Send, SquarePen, XCircle } from "lucide-react";
import Link from "next/link";
import {
  closeModulePreferenceWindow,
  confirmModulePreferenceWindow,
  openModulePreferenceWindow,
  saveModulePreferenceWindow
} from "@/app/admissions/preferences/actions";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { Field, FormGrid } from "@/components/forms";
import { StatusPill } from "@/components/status-pill";
import {
  canCloseModulePreferenceWindow,
  canConfirmModulePreferenceWindow,
  canOpenModulePreferenceWindow,
  type ModulePreferenceWindowStatus
} from "@/lib/module-preferences";
import { requirePermission } from "@/lib/auth";
import { getAppData } from "@/lib/seed";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";
import type { CourseModule, ModuleOffering, Student, Term } from "@/lib/types";

export const dynamic = "force-dynamic";

interface PreferenceWindowOffering {
  offeringId: string;
  displayOrder: number;
  termId: string;
  moduleCode: string;
  moduleTitle: string;
  credits: number;
  mode: "online" | "practical";
  capacity: number;
  pricePence: number;
}

interface PreferenceSubmission {
  id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  submittedAt: string;
  updatedAt: string;
  choiceCount: number;
  skipReason?: string;
  choices: PreferenceWindowOffering[];
}

interface PreferenceWindow {
  id: string;
  termId: string;
  title: string;
  status: ModulePreferenceWindowStatus;
  opensAt: string;
  closesAt: string;
  notes?: string;
  openedAt?: string;
  closedAt?: string;
  confirmedAt?: string;
  termName: string;
  termStartsOn: string;
  offerings: PreferenceWindowOffering[];
  submissions: PreferenceSubmission[];
  missingStudents: Student[];
}

type RelatedObject = Record<string, unknown>;

type WindowRow = {
  id: string;
  term_id: string;
  title: string;
  status: ModulePreferenceWindowStatus;
  opens_at: string;
  closes_at: string;
  notes: string | null;
  opened_at: string | null;
  closed_at: string | null;
  confirmed_at: string | null;
  terms: RelatedObject | RelatedObject[] | null;
  module_preference_window_offerings: RelatedObject[] | null;
};

type SubmissionRow = {
  id: string;
  window_id: string;
  student_id: string;
  submitted_at: string;
  updated_at: string;
  choice_count: number;
  skip_reason: string | null;
  students: RelatedObject | RelatedObject[] | null;
  module_preference_submission_choices: RelatedObject[] | null;
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

function formatDateTimeInput(value?: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatDateTime(value?: string): string {
  return value ? new Date(value).toLocaleString("en-GB") : "Not set";
}

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleDateString("en-GB") : "Not set";
}

function moduleLabel(offering: PreferenceWindowOffering): string {
  return `${offering.moduleCode} - ${offering.moduleTitle}`;
}

function mapOfferingRelation(value: unknown): PreferenceWindowOffering | undefined {
  const offering = relatedObject(value);
  const courseModule = relatedObject(offering?.course_modules);
  if (!offering || !courseModule) {
    return undefined;
  }

  return {
    offeringId: String(offering.id),
    displayOrder: 0,
    termId: String(offering.term_id),
    moduleCode: String(courseModule.code ?? ""),
    moduleTitle: String(courseModule.title ?? ""),
    credits: Number(courseModule.credits ?? 0),
    mode: courseModule.mode === "online" ? "online" : "practical",
    capacity: Number(offering.capacity ?? 0),
    pricePence: Number(offering.price_pence ?? 0)
  };
}

function mapWindowOffering(row: RelatedObject): PreferenceWindowOffering | undefined {
  const offering = mapOfferingRelation(row.module_offerings);
  return offering ? { ...offering, displayOrder: Number(row.display_order ?? 0) } : undefined;
}

function mapSubmission(row: SubmissionRow): PreferenceSubmission {
  const student = relatedObject(row.students);
  const choices = relatedArray(row.module_preference_submission_choices)
    .map((choice) => {
      const offering = mapOfferingRelation(choice.module_offerings);
      return offering ? { ...offering, displayOrder: Number(choice.preference_order ?? 0) } : undefined;
    })
    .filter((offering): offering is PreferenceWindowOffering => Boolean(offering))
    .sort((first, second) => first.displayOrder - second.displayOrder);

  return {
    id: row.id,
    studentId: row.student_id,
    studentName: `${String(student?.first_name ?? "")} ${String(student?.last_name ?? "")}`.trim() || "Unknown student",
    studentEmail: String(student?.email ?? ""),
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    choiceCount: Number(row.choice_count ?? choices.length),
    skipReason: optionalString(row.skip_reason),
    choices
  };
}

function buildDemoContext(): {
  terms: Term[];
  modules: CourseModule[];
  offerings: ModuleOffering[];
  windows: PreferenceWindow[];
} {
  const data = getAppData();
  const terms = data.terms.filter((candidate) => candidate.status === "published" || candidate.status === "active");
  const modules = data.modules.filter((candidate) => candidate.active);
  const termIds = new Set(terms.map((candidate) => candidate.id));
  const moduleIds = new Set(modules.map((candidate) => candidate.id));
  const offerings = data.offerings.filter((offering) => termIds.has(offering.termId) && moduleIds.has(offering.moduleId));
  const term = terms.find((candidate) => candidate.status === "published") ?? terms[0];
  const availableOfferings = data.offerings
    .filter((offering) => offering.termId === term?.id)
    .map((offering, index) => {
      const courseModule = data.modules.find((candidate) => candidate.id === offering.moduleId);
      return {
        offeringId: offering.id,
        displayOrder: index + 1,
        termId: offering.termId,
        moduleCode: courseModule?.code ?? "",
        moduleTitle: courseModule?.title ?? "",
        credits: courseModule?.credits ?? 0,
        mode: courseModule?.mode ?? "practical",
        capacity: offering.capacity,
        pricePence: offering.pricePence
      };
    });
  const activeStudents = data.students.filter((student) => student.status === "active");

  return {
    terms,
    modules,
    offerings,
    windows: term
      ? [
          {
            id: "11111111-1111-4111-8111-111111111111",
            termId: term.id,
            title: `${term.name} module preferences`,
            status: "open",
            opensAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            closesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            termName: term.name,
            termStartsOn: term.startsOn,
            offerings: availableOfferings,
            submissions: [],
            missingStudents: activeStudents
          }
        ]
      : []
  };
}

async function getPreferenceWindowContext(): Promise<{
  terms: Term[];
  modules: CourseModule[];
  offerings: ModuleOffering[];
  windows: PreferenceWindow[];
}> {
  if (!isSupabaseConfigured()) {
    return buildDemoContext();
  }

  const supabase = await createSupabaseServerClient();
  const [termResult, moduleResult, offeringResult, studentResult, windowResult] = await Promise.all([
    supabase.from("terms").select("*").in("status", ["published", "active"]).order("starts_on", { ascending: true }),
    supabase.from("course_modules").select("*").eq("active", true).order("code", { ascending: true }),
    supabase
      .from("module_offerings")
      .select("id, module_id, term_id, price_pence, capacity")
      .order("created_at", { ascending: true }),
    supabase.from("students").select("*").eq("status", "active").not("person_id", "is", null).order("last_name"),
    supabase
      .from("module_preference_windows")
      .select(
        `
          id,
          term_id,
          title,
          status,
          opens_at,
          closes_at,
          notes,
          opened_at,
          closed_at,
          confirmed_at,
          terms:term_id (
            name,
            starts_on
          ),
          module_preference_window_offerings (
            offering_id,
            display_order,
            module_offerings:offering_id (
              id,
              term_id,
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
      .order("created_at", { ascending: false })
  ]);

  for (const result of [termResult, moduleResult, offeringResult, studentResult, windowResult]) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  const windows = (windowResult.data ?? []) as unknown as WindowRow[];
  const windowIds = windows.map((window) => window.id);
  const submissionResult =
    windowIds.length > 0
      ? await supabase
          .from("module_preference_submissions")
          .select(
            `
              id,
              window_id,
              student_id,
              submitted_at,
              updated_at,
              choice_count,
              skip_reason,
              students:student_id (
                first_name,
                last_name,
                email
              ),
              module_preference_submission_choices (
                preference_order,
                module_offerings:offering_id (
                  id,
                  term_id,
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
          .in("window_id", windowIds)
      : { data: [], error: null };

  if (submissionResult.error) {
    throw new Error(submissionResult.error.message);
  }

  const activeStudents = (studentResult.data ?? []).map((row) => ({
    id: String(row.id),
    personId: optionalString(row.person_id),
    cccuStudentId: optionalString(row.cccu_student_id),
    temporaryId: String(row.temporary_id),
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    email: String(row.email),
    phone: optionalString(row.phone),
    status: row.status as Student["status"],
    admissionStage: row.admission_stage as Student["admissionStage"],
    programme: row.programme as Student["programme"],
    startTermId: optionalString(row.start_term_id),
    photoUrl: optionalString(row.photo_path),
    notes: optionalString(row.notes)
  }));

  const submissionsByWindow = new Map<string, PreferenceSubmission[]>();
  ((submissionResult.data ?? []) as unknown as SubmissionRow[]).forEach((row) => {
    submissionsByWindow.set(row.window_id, [...(submissionsByWindow.get(row.window_id) ?? []), mapSubmission(row)]);
  });

  return {
    terms: (termResult.data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      startsOn: String(row.starts_on),
      endsOn: String(row.ends_on),
      examWindowStartsOn: optionalString(row.exam_window_starts_on),
      examWindowEndsOn: optionalString(row.exam_window_ends_on),
      status: row.status as Term["status"]
    })),
    modules: (moduleResult.data ?? []).map((row) => ({
      id: String(row.id),
      code: String(row.code),
      title: String(row.title),
      credits: Number(row.credits),
      mode: row.mode as CourseModule["mode"],
      mandatory: Boolean(row.mandatory),
      active: Boolean(row.active)
    })),
    offerings: (offeringResult.data ?? []).map((row) => ({
      id: String(row.id),
      moduleId: String(row.module_id),
      termId: String(row.term_id),
      pricePence: Number(row.price_pence),
      capacity: Number(row.capacity),
      attendanceDaysRequiredFirstPractical: 0,
      attendanceDaysRequiredSubsequentPractical: 0,
      presentationRequired: false
    })),
    windows: windows.map((row) => {
      const term = relatedObject(row.terms);
      const submissions = submissionsByWindow.get(row.id) ?? [];
      const submittedStudentIds = new Set(submissions.map((submission) => submission.studentId));
      return {
        id: row.id,
        termId: row.term_id,
        title: row.title,
        status: row.status,
        opensAt: row.opens_at,
        closesAt: row.closes_at,
        notes: optionalString(row.notes),
        openedAt: optionalString(row.opened_at),
        closedAt: optionalString(row.closed_at),
        confirmedAt: optionalString(row.confirmed_at),
        termName: String(term?.name ?? "Unknown term"),
        termStartsOn: String(term?.starts_on ?? ""),
        offerings: relatedArray(row.module_preference_window_offerings)
          .map(mapWindowOffering)
          .filter((offering): offering is PreferenceWindowOffering => Boolean(offering))
          .sort((first, second) => first.displayOrder - second.displayOrder),
        submissions,
        missingStudents: activeStudents.filter((student) => !submittedStudentIds.has(student.id))
      };
    })
  };
}

function WindowForm({
  modules,
  offerings,
  term,
  window
}: {
  modules: CourseModule[];
  offerings: ModuleOffering[];
  term: Term;
  window?: PreferenceWindow;
}) {
  const selectedOfferingIds = new Set(window?.offerings.map((offering) => offering.offeringId) ?? []);
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const selectableOfferings = offerings
    .filter((offering) => offering.termId === term.id)
    .map((offering) => ({ offering, module: moduleById.get(offering.moduleId) }))
    .filter((item) => item.module);

  return (
    <form className="grid preference-window-form" action={saveModulePreferenceWindow}>
      <input type="hidden" name="window_id" value={window?.id ?? ""} />
      <input type="hidden" name="term_id" value={term.id} />
      <div className="section-header">
        <div>
          <h2>{window ? "Edit draft window" : "Create preference window"}</h2>
          <p>
            {term.name} · {term.status} · starts {formatDate(term.startsOn)}
          </p>
        </div>
        <SquarePen size={18} />
      </div>
      <Field label="Window title" htmlFor={window ? `title-${window.id}` : `title-${term.id}`}>
        <input
          id={window ? `title-${window.id}` : `title-${term.id}`}
          name="title"
          className="input"
          defaultValue={window?.title ?? `${term.name} module preferences`}
          placeholder="September 2026 preferences"
          required
        />
      </Field>
      <FormGrid>
        <Field label="Opens" htmlFor={window ? `opens-${window.id}` : "opens-new"}>
          <input
            id={window ? `opens-${window.id}` : "opens-new"}
            name="opens_at"
            className="input"
            type="datetime-local"
            defaultValue={formatDateTimeInput(window?.opensAt)}
            required
          />
        </Field>
        <Field label="Closes" htmlFor={window ? `closes-${window.id}` : "closes-new"}>
          <input
            id={window ? `closes-${window.id}` : "closes-new"}
            name="closes_at"
            className="input"
            type="datetime-local"
            defaultValue={formatDateTimeInput(window?.closesAt)}
            required
          />
        </Field>
      </FormGrid>
      <Field label="Available module offerings" htmlFor={window ? `offerings-${window.id}` : `offerings-${term.id}`}>
        <div className="checkbox-list preference-option-list" id={window ? `offerings-${window.id}` : `offerings-${term.id}`}>
          {selectableOfferings.map(({ offering, module }) => (
            <label className="check-option" key={offering.id}>
              <input name="offering_ids" type="checkbox" value={offering.id} defaultChecked={selectedOfferingIds.has(offering.id)} />
              <span>
                <strong>
                  {module?.code} - {module?.title}
                </strong>
                <small>
                  {module?.mode} · capacity {offering.capacity}
                </small>
              </span>
            </label>
          ))}
        </div>
      </Field>
      <Field label="Staff notes" htmlFor={window ? `notes-${window.id}` : "notes-new"}>
        <textarea id={window ? `notes-${window.id}` : "notes-new"} name="notes" className="textarea" defaultValue={window?.notes ?? ""} />
      </Field>
      <button className="button primary" type="submit">
        <CheckCircle2 size={16} />
        Save window
      </button>
    </form>
  );
}

function WindowLifecycleActions({ window }: { window: PreferenceWindow }) {
  return (
    <div className="toolbar">
      {canOpenModulePreferenceWindow({ status: window.status, closesAt: window.closesAt }) ? (
        <form action={openModulePreferenceWindow}>
          <input type="hidden" name="window_id" value={window.id} />
          <button className="button primary" type="submit">
            <Send size={16} />
            Open
          </button>
        </form>
      ) : null}
      {canCloseModulePreferenceWindow(window.status) ? (
        <form action={closeModulePreferenceWindow}>
          <input type="hidden" name="window_id" value={window.id} />
          <button className="button secondary" type="submit">
            <XCircle size={16} />
            Close
          </button>
        </form>
      ) : null}
      {canConfirmModulePreferenceWindow(window.status) ? (
        <form action={confirmModulePreferenceWindow}>
          <input type="hidden" name="window_id" value={window.id} />
          <button className="button primary" type="submit">
            <CheckCircle2 size={16} />
            Confirm
          </button>
        </form>
      ) : null}
    </div>
  );
}

function PreferenceWindowCard({
  window,
  terms,
  modules,
  offerings
}: {
  window: PreferenceWindow;
  terms: Term[];
  modules: CourseModule[];
  offerings: ModuleOffering[];
}) {
  const windowTerm = terms.find((term) => term.id === window.termId);

  return (
    <article className="panel grid" id={`window-${window.id}`}>
      <div className="section-header">
        <div>
          <h2>{window.title}</h2>
          <p>
            {window.termName} · opens {formatDateTime(window.opensAt)} · closes {formatDateTime(window.closesAt)}
          </p>
        </div>
        <div className="toolbar">
          <StatusPill value={window.status} />
          <WindowLifecycleActions window={window} />
        </div>
      </div>

      <div className="review-data-grid">
        <div className="review-data-item">
          <span>Submitted</span>
          <strong>{window.submissions.length}</strong>
        </div>
        <div className="review-data-item">
          <span>Missing</span>
          <strong>{window.missingStudents.length}</strong>
        </div>
        <div className="review-data-item">
          <span>Available offerings</span>
          <strong>{window.offerings.length}</strong>
        </div>
        <div className="review-data-item">
          <span>Term starts</span>
          <strong>{formatDate(window.termStartsOn)}</strong>
        </div>
      </div>

      <div className="application-section">
        <div className="application-section-heading">
          <h3>Offered in this window</h3>
          <span>Configured from module offerings</span>
        </div>
        <div className="offer-module-list">
          {window.offerings.map((offering) => (
            <div className="review-offering-row" key={offering.offeringId}>
              <strong>{moduleLabel(offering)}</strong>
              <p className="muted small">
                {offering.credits} credits · {offering.mode} · capacity {offering.capacity}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-2">
        <section className="application-section">
          <div className="application-section-heading">
            <h3>Submitted preferences</h3>
            <span>{window.submissions.length}</span>
          </div>
          {window.submissions.length === 0 ? (
            <p className="muted small">No students have submitted preferences for this window.</p>
          ) : (
            <div className="offer-module-list">
              {window.submissions.map((submission) => (
                <div className="review-offering-row" key={submission.id}>
                  <strong>{submission.studentName}</strong>
                  <p className="muted small">
                    {submission.choiceCount === 0
                      ? `Skipping this term${submission.skipReason ? `: ${submission.skipReason}` : ""}`
                      : submission.choices.map(moduleLabel).join("; ")}
                  </p>
                  <p className="muted small">Updated {formatDateTime(submission.updatedAt)}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="application-section">
          <div className="application-section-heading">
            <h3>Missing preferences</h3>
            <span>{window.missingStudents.length}</span>
          </div>
          {window.missingStudents.length === 0 ? (
            <p className="muted small">All eligible active students have a preference submission.</p>
          ) : (
            <div className="offer-module-list">
              {window.missingStudents.map((student) => (
                <div className="review-offering-row" key={student.id}>
                  <strong>
                    {student.firstName} {student.lastName}
                  </strong>
                  <p className="muted small">{student.email}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {window.status === "draft" && windowTerm ? (
        <WindowForm term={windowTerm} modules={modules} offerings={offerings} window={window} />
      ) : null}
    </article>
  );
}

function ResultBanner({ params }: { params: Record<string, string | undefined> }) {
  const key = ["saved", "opened", "closed", "confirmed", "saved_demo", "opened_demo", "closed_demo", "confirmed_demo"].find(
    (candidate) => params[candidate]
  );
  if (!key) {
    return null;
  }

  const label = key.replace("_demo", "");
  return (
    <div className="apply-success" role="status">
      <CheckCircle2 size={22} />
      <div>
        <h2>Preference window {label}</h2>
        <p>{key.endsWith("_demo") ? "Demo mode did not write to Supabase." : "The window state has been updated."}</p>
      </div>
    </div>
  );
}

export default async function AdmissionsPreferencesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("manage_admissions");
  const params = await searchParams;
  const context = await getPreferenceWindowContext();
  const selectedTerm =
    context.terms.find((term) => term.id === params.term) ??
    context.terms.find((term) => term.status === "published") ??
    context.terms[0];

  return (
    <AppShell
      title="Module Preference Windows"
      subtitle="Termly continuing-student module preferences"
      actions={
        <Link className="button" href="/admissions">
          <Eye size={16} />
          Admissions
        </Link>
      }
    >
      <ResultBanner params={params} />
      <section className="grid grid-2">
        <div className="panel grid">
          <div className="section-header">
            <div>
              <h2>Create window</h2>
              <p>Choose the term first; the form only shows offerings from that term.</p>
            </div>
            <SquarePen size={18} />
          </div>
          {context.terms.length === 0 || !selectedTerm ? (
            <EmptyState title="No selectable terms" detail="Preference windows require a published or active term with module offerings." />
          ) : (
            <>
              <div className="toolbar">
                {context.terms.map((term) => (
                  <Link
                    className={term.id === selectedTerm.id ? "button is-active" : "button"}
                    href={`/admissions/preferences?term=${term.id}`}
                    key={term.id}
                  >
                    {term.name}
                  </Link>
                ))}
              </div>
              <WindowForm term={selectedTerm} modules={context.modules} offerings={context.offerings} />
            </>
          )}
        </div>
        <div className="panel grid">
          <div className="section-header">
            <div>
              <h2>Dashboard visibility</h2>
              <p>Submitted and missing preferences are visible per window before enrolment confirmation.</p>
            </div>
            <ClipboardList size={18} />
          </div>
          <div className="review-data-grid">
            <div className="review-data-item">
              <span>Windows</span>
              <strong>{context.windows.length}</strong>
            </div>
            <div className="review-data-item">
              <span>Open</span>
              <strong>{context.windows.filter((window) => window.status === "open").length}</strong>
            </div>
            <div className="review-data-item">
              <span>Total submissions</span>
              <strong>{context.windows.reduce((total, window) => total + window.submissions.length, 0)}</strong>
            </div>
            <div className="review-data-item">
              <span>Missing now</span>
              <strong>{context.windows.reduce((total, window) => total + window.missingStudents.length, 0)}</strong>
            </div>
          </div>
        </div>
      </section>

      {context.windows.length === 0 ? (
        <EmptyState title="No preference windows yet" detail="Create a draft window, choose existing term offerings, then open it for students." />
      ) : (
        <section className="term-groups">
          {context.windows.map((window) => (
            <PreferenceWindowCard
              key={window.id}
              window={window}
              terms={context.terms}
              modules={context.modules}
              offerings={context.offerings}
            />
          ))}
        </section>
      )}
    </AppShell>
  );
}
