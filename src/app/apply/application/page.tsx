import { CheckCircle2, FileText, LockKeyhole, Save } from "lucide-react";
import { Field, FormGrid } from "@/components/forms";
import { saveApplicationDraft } from "@/app/apply/application/actions";
import { requireApplicantProfile } from "@/lib/portal-auth";
import { getAppData } from "@/lib/seed";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";
import type { CourseModule } from "@/lib/types";

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
  programme: "pgcert" | "microcredential";
  moduleInterestIds: string[];
  clinicalRole?: string;
  employer?: string;
  professionalRegistration?: string;
  highestQualification?: string;
  qualificationAwardingBody?: string;
  qualificationYear?: number;
  workExperience?: string;
  personalStatement?: string;
  lastSavedAt: string;
}

type CourseModuleOption = Pick<CourseModule, "id" | "code" | "title" | "credits" | "mode" | "mandatory">;

type ApplicationDraftRow = {
  id: string;
  admission_lead_id: string;
  programme: "pgcert" | "microcredential";
  module_interest_ids: string[] | null;
  clinical_role: string | null;
  employer: string | null;
  professional_registration: string | null;
  highest_qualification: string | null;
  qualification_awarding_body: string | null;
  qualification_year: number | null;
  work_experience: string | null;
  personal_statement: string | null;
  last_saved_at: string;
};

function optionalString(value: string | null | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function mapApplicationDraft(row: ApplicationDraftRow): ApplicationDraftSummary {
  return {
    id: row.id,
    admissionLeadId: row.admission_lead_id,
    programme: row.programme,
    moduleInterestIds: row.module_interest_ids ?? [],
    clinicalRole: optionalString(row.clinical_role),
    employer: optionalString(row.employer),
    professionalRegistration: optionalString(row.professional_registration),
    highestQualification: optionalString(row.highest_qualification),
    qualificationAwardingBody: optionalString(row.qualification_awarding_body),
    qualificationYear: row.qualification_year ?? undefined,
    workExperience: optionalString(row.work_experience),
    personalStatement: optionalString(row.personal_statement),
    lastSavedAt: row.last_saved_at
  };
}

async function getApplicantApplicationContext(personId: string): Promise<{
  invitations: ApplicantInvitationSummary[];
  draft?: ApplicationDraftSummary;
  modules: CourseModuleOption[];
}> {
  if (!isSupabaseConfigured()) {
    const demoModules = getAppData().modules.filter((courseModule) => courseModule.active);
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
      modules: demoModules.map(({ id, code, title, credits, mode, mandatory }) => ({
        id,
        code,
        title,
        credits,
        mode,
        mandatory
      }))
    };
  }

  const supabase = await createSupabaseServerClient();

  const [invitationResult, draftResult, moduleResult] = await Promise.all([
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
          programme,
          module_interest_ids,
          clinical_role,
          employer,
          professional_registration,
          highest_qualification,
          qualification_awarding_body,
          qualification_year,
          work_experience,
          personal_statement,
          last_saved_at
        `
      )
      .eq("person_id", personId)
      .order("last_saved_at", { ascending: false }),
    supabase
      .from("course_modules")
      .select("id, code, title, credits, mode, mandatory")
      .eq("active", true)
      .order("code")
  ]);

  if (invitationResult.error) {
    throw new Error(invitationResult.error.message);
  }
  if (draftResult.error) {
    throw new Error(draftResult.error.message);
  }
  if (moduleResult.error) {
    throw new Error(moduleResult.error.message);
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

  return {
    invitations,
    draft: draftRows[0] ? mapApplicationDraft(draftRows[0]) : undefined,
    modules: (moduleResult.data ?? []).map((row) => ({
      id: String(row.id),
      code: String(row.code),
      title: String(row.title),
      credits: Number(row.credits),
      mode: row.mode as CourseModule["mode"],
      mandatory: Boolean(row.mandatory)
    }))
  };
}

function ModuleInterestChecklist({
  modules,
  selectedModuleIds
}: {
  modules: CourseModuleOption[];
  selectedModuleIds: string[];
}) {
  return (
    <fieldset className="checkbox-fieldset">
      <legend>Module interests</legend>
      {modules.length === 0 ? (
        <p className="muted small">No active modules are available.</p>
      ) : (
        <div className="checkbox-list compact">
          {modules.map((courseModule) => (
            <label className="check-option" key={courseModule.id}>
              <input
                name="module_interest_ids"
                type="checkbox"
                value={courseModule.id}
                defaultChecked={selectedModuleIds.includes(courseModule.id)}
              />
              <span>
                {courseModule.code} · {courseModule.title}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function ApplicationDraftForm({
  admissionLeadId,
  draft,
  modules
}: {
  admissionLeadId: string;
  draft?: ApplicationDraftSummary;
  modules: CourseModuleOption[];
}) {
  return (
    <form className="apply-form-panel application-draft-form" action={saveApplicationDraft}>
      <input type="hidden" name="admission_lead_id" value={draft?.admissionLeadId ?? admissionLeadId} />
      <div className="section-header">
        <div>
          <h2>Draft application</h2>
          <p>
            {draft?.lastSavedAt
              ? `Last saved ${new Date(draft.lastSavedAt).toLocaleString("en-GB")}`
              : "Save your details before submitting a full application."}
          </p>
        </div>
        <div className="icon-box">
          <FileText size={18} />
        </div>
      </div>

      <FormGrid>
        <Field label="Programme choice" htmlFor="application-programme">
          <select id="application-programme" name="programme" className="select" defaultValue={draft?.programme ?? "pgcert"}>
            <option value="pgcert">PGCert</option>
            <option value="microcredential">Microcredential</option>
          </select>
        </Field>
        <Field label="Clinical role" htmlFor="application-clinical-role">
          <input id="application-clinical-role" name="clinical_role" className="input" defaultValue={draft?.clinicalRole ?? ""} />
        </Field>
        <Field label="Employer" htmlFor="application-employer">
          <input id="application-employer" name="employer" className="input" defaultValue={draft?.employer ?? ""} />
        </Field>
        <Field label="Professional registration" htmlFor="application-professional-registration">
          <input
            id="application-professional-registration"
            name="professional_registration"
            className="input"
            defaultValue={draft?.professionalRegistration ?? ""}
          />
        </Field>
      </FormGrid>

      <ModuleInterestChecklist modules={modules} selectedModuleIds={draft?.moduleInterestIds ?? []} />

      <FormGrid>
        <Field label="Highest qualification" htmlFor="application-highest-qualification">
          <input
            id="application-highest-qualification"
            name="highest_qualification"
            className="input"
            defaultValue={draft?.highestQualification ?? ""}
          />
        </Field>
        <Field label="Awarding body" htmlFor="application-awarding-body">
          <input
            id="application-awarding-body"
            name="qualification_awarding_body"
            className="input"
            defaultValue={draft?.qualificationAwardingBody ?? ""}
          />
        </Field>
        <Field label="Award year" htmlFor="application-qualification-year">
          <input
            id="application-qualification-year"
            name="qualification_year"
            className="input"
            type="number"
            min="1900"
            max="2100"
            defaultValue={draft?.qualificationYear ?? ""}
          />
        </Field>
      </FormGrid>

      <Field label="Relevant work experience" htmlFor="application-work-experience">
        <textarea
          id="application-work-experience"
          name="work_experience"
          className="textarea"
          defaultValue={draft?.workExperience ?? ""}
          maxLength={4000}
        />
      </Field>
      <Field label="Supporting statement" htmlFor="application-personal-statement">
        <textarea
          id="application-personal-statement"
          name="personal_statement"
          className="textarea"
          defaultValue={draft?.personalStatement ?? ""}
          maxLength={4000}
        />
      </Field>

      <button className="button primary apply-submit">
        <Save size={16} />
        Save draft
      </button>
    </form>
  );
}

export default async function ApplicationAccessPage({
  searchParams
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const profile = await requireApplicantProfile("/apply/application");
  const { saved } = await searchParams;
  const { invitations, draft, modules } = await getApplicantApplicationContext(profile.personId);
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
            <h1>Application access</h1>
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
              <p>{saved === "demo" ? "Demo mode is running without a Supabase database, so no live draft was saved." : "Your latest changes have been saved."}</p>
            </div>
          </div>
        ) : null}

        <div className="apply-form-panel">
          <div className="section-header">
            <div>
              <h2>Invitation</h2>
              <p>Magic-link access is active for this applicant identity.</p>
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

        {claimedInvitation ? (
          <ApplicationDraftForm admissionLeadId={claimedInvitation.admissionLeadId} draft={draft} modules={modules} />
        ) : null}
      </section>
    </main>
  );
}
