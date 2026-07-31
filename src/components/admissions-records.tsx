import Link from "next/link";
import { Field, FormGrid } from "@/components/forms";
import { StatusPill } from "@/components/status-pill";
import { canIssueApplicationInvitationForLead } from "@/lib/application-invitations";
import {
  createAdmissionLead,
  inviteAdmissionLeadToApply,
  importAdmissionsCsv,
  updateAdmissionLead
} from "@/lib/admin-actions";
import type { AdmissionLead, AdmissionLeadStage, AppData } from "@/lib/types";

export const leadStages: AdmissionLeadStage[] = [
  "interest",
  "application_invited",
  "submitted",
  "reviewed",
  "offered",
  "rejected",
  "accepted",
  "registration_in_progress",
  "registration_lapsed",
  "registered",
  "offer_declined",
  "offer_lapsed",
  "archived"
];

function stageLabel(stage: AdmissionLeadStage): string {
  return stage.replaceAll("_", " ");
}

function leadName(lead: Pick<AdmissionLead, "firstName" | "lastName">): string {
  return `${lead.firstName} ${lead.lastName}`;
}

function moduleLabels(data: AppData, moduleIds: string[]): string {
  const labels = moduleIds
    .map((moduleId) => data.modules.find((courseModule) => courseModule.id === moduleId)?.code)
    .filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : "No modules selected";
}

function ModuleInterestChecklist({ data, selectedModuleIds = [] }: { data: AppData; selectedModuleIds?: string[] }) {
  return (
    <fieldset className="checkbox-fieldset">
      <legend>Module interests</legend>
      {data.modules.length === 0 ? (
        <p className="muted small">No modules configured yet.</p>
      ) : (
        <div className="checkbox-list compact">
          {data.modules.map((courseModule) => (
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

function LeadFields({ data, lead }: { data: AppData; lead?: AdmissionLead }) {
  return (
    <>
      <FormGrid>
        <Field label="First name" htmlFor={`lead-first-name-${lead?.id ?? "new"}`}>
          <input id={`lead-first-name-${lead?.id ?? "new"}`} name="first_name" className="input" defaultValue={lead?.firstName ?? ""} required />
        </Field>
        <Field label="Last name" htmlFor={`lead-last-name-${lead?.id ?? "new"}`}>
          <input id={`lead-last-name-${lead?.id ?? "new"}`} name="last_name" className="input" defaultValue={lead?.lastName ?? ""} required />
        </Field>
        <Field label="Email" htmlFor={`lead-email-${lead?.id ?? "new"}`}>
          <input id={`lead-email-${lead?.id ?? "new"}`} name="email" className="input" type="email" defaultValue={lead?.email ?? ""} required />
        </Field>
        <Field label="Phone" htmlFor={`lead-phone-${lead?.id ?? "new"}`}>
          <input id={`lead-phone-${lead?.id ?? "new"}`} name="phone" className="input" defaultValue={lead?.phone ?? ""} />
        </Field>
        <Field label="Stage" htmlFor={`lead-stage-${lead?.id ?? "new"}`}>
          <select id={`lead-stage-${lead?.id ?? "new"}`} name="stage" className="select" defaultValue={lead?.stage ?? "interest"}>
            {leadStages.map((stage) => (
              <option key={stage} value={stage}>
                {stageLabel(stage)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Programme" htmlFor={`lead-programme-${lead?.id ?? "new"}`}>
          <select id={`lead-programme-${lead?.id ?? "new"}`} name="programme" className="select" defaultValue={lead?.programme ?? "pgcert"}>
            <option value="pgcert">PGCert</option>
            <option value="microcredential">Microcredential</option>
          </select>
        </Field>
        <Field label="Source" htmlFor={`lead-source-${lead?.id ?? "new"}`}>
          <input id={`lead-source-${lead?.id ?? "new"}`} name="source" className="input" defaultValue={lead?.source ?? ""} />
        </Field>
        <Field label="Last contacted" htmlFor={`lead-last-contacted-${lead?.id ?? "new"}`}>
          <input
            id={`lead-last-contacted-${lead?.id ?? "new"}`}
            name="last_contacted_on"
            className="input"
            type="date"
            defaultValue={lead?.lastContactedOn ?? ""}
          />
        </Field>
        <Field label="Next action" htmlFor={`lead-next-action-${lead?.id ?? "new"}`}>
          <input
            id={`lead-next-action-${lead?.id ?? "new"}`}
            name="next_action_on"
            className="input"
            type="date"
            defaultValue={lead?.nextActionOn ?? ""}
          />
        </Field>
      </FormGrid>
      <ModuleInterestChecklist data={data} selectedModuleIds={lead?.moduleInterestIds ?? []} />
      <Field label="Notes" htmlFor={`lead-notes-${lead?.id ?? "new"}`}>
        <textarea id={`lead-notes-${lead?.id ?? "new"}`} name="notes" className="textarea" defaultValue={lead?.notes ?? ""} />
      </Field>
    </>
  );
}

export function AdmissionsBoard({ data }: { data: AppData }) {
  const activeLeads = data.admissionLeads.filter((lead) => !lead.archived && !lead.convertedStudentId);
  return (
    <section className="grid grid-4">
      {leadStages.filter((stage) => stage !== "archived").map((stage) => {
        const leads = activeLeads.filter((lead) => lead.stage === stage);
        return (
          <div className="panel" key={stage}>
            <div className="section-header">
              <div>
                <h2>{stageLabel(stage)}</h2>
                <p>{leads.length} leads</p>
              </div>
            </div>
            <div className="timeline">
              {leads.length === 0 ? <p className="muted small">No leads</p> : null}
              {leads.map((lead) => (
                <div className="timeline-item" style={{ gridTemplateColumns: "1fr" }} key={lead.id}>
                  <div>
                    <strong>{leadName(lead)}</strong>
                    <p className="muted small">{lead.email}</p>
                    <p className="muted small">{moduleLabels(data, lead.moduleInterestIds)}</p>
                  </div>
                  <StatusPill value={lead.stage} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function AdmissionsTools({ data }: { data: AppData }) {
  return (
    <section className="grid grid-2">
      <form className="panel grid" action={createAdmissionLead}>
        <div className="section-header">
          <div>
            <h2>Quick Create Lead</h2>
            <p>Lightweight admissions lead before student conversion</p>
          </div>
        </div>
        <LeadFields data={data} />
        <button className="button primary">Create lead</button>
      </form>

      <form className="panel grid" action={importAdmissionsCsv}>
        <div className="section-header">
          <div>
            <h2>Import Students CSV</h2>
            <p>Use this only for later-stage records that should become student records</p>
          </div>
          <Link className="button" href="/api/import-templates/students">
            Template
          </Link>
        </div>
        <Field label="CSV file" htmlFor="admissions-csv-file">
          <input id="admissions-csv-file" name="csv_file" className="input" type="file" accept=".csv,text/csv" required />
        </Field>
        <button className="button primary">Import student CSV</button>
      </form>
    </section>
  );
}

function ApplicationInvitationForm({ lead }: { lead: AdmissionLead }) {
  if (!canIssueApplicationInvitationForLead(lead)) {
    return null;
  }

  return (
    <details className="expected-details">
      <summary>
        Application access
        <span className="muted small">
          {lead.applicationInvitedAt ? `Invited ${new Date(lead.applicationInvitedAt).toLocaleDateString("en-GB")}` : "Not invited yet"}
        </span>
      </summary>
      <form className="grid session-form" action={inviteAdmissionLeadToApply}>
        <input type="hidden" name="lead_id" value={lead.id} />
        <p className="muted small">
          Sends a Supabase magic link to {lead.email} and opens only the applicant access area. The full application form is still a later Phase 1 slice.
          {lead.applicationInvitationExpiresAt ? ` Current link expires ${new Date(lead.applicationInvitationExpiresAt).toLocaleDateString("en-GB")}.` : ""}
        </p>
        <button className="button primary">Send application invitation</button>
      </form>
    </details>
  );
}

export function AdmissionsRecords({ data }: { data: AppData }) {
  const orderedLeads = [...data.admissionLeads].sort((a, b) => {
    const archivedDiff = Number(a.archived || Boolean(a.convertedStudentId)) - Number(b.archived || Boolean(b.convertedStudentId));
    if (archivedDiff !== 0) {
      return archivedDiff;
    }
    const stageDiff = leadStages.indexOf(a.stage) - leadStages.indexOf(b.stage);
    return stageDiff === 0 ? leadName(a).localeCompare(leadName(b)) : stageDiff;
  });

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>Admission Leads</h2>
          <p>Edit early-stage prospects, module interests, and conversion readiness</p>
        </div>
      </div>
      <div className="record-grid">
        {orderedLeads.map((lead) => (
          <div className="panel grid" key={lead.id}>
            <form className="grid" action={updateAdmissionLead}>
              <input type="hidden" name="lead_id" value={lead.id} />
              <div className="section-header">
                <div>
                  <h2>{leadName(lead)}</h2>
                  <p>{lead.email}</p>
                </div>
                <StatusPill value={lead.convertedStudentId ? "completed" : lead.stage} label={lead.convertedStudentId ? "converted" : stageLabel(lead.stage)} />
              </div>
              <LeadFields data={data} lead={lead} />
              <button className="button primary">Save lead</button>
            </form>
            <ApplicationInvitationForm lead={lead} />
          </div>
        ))}
      </div>
    </section>
  );
}
