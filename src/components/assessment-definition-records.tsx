import { DeleteWarning } from "@/components/course-records";
import { Field, FormGrid } from "@/components/forms";
import { StatusPill } from "@/components/status-pill";
import {
  createAssessmentDefinition,
  deleteAssessmentDefinition,
  updateAssessmentDefinition
} from "@/lib/admin-actions";
import type { AppData, AssessmentDefinition } from "@/lib/types";

const domainSlots = Array.from({ length: 8 }, (_, index) => index + 1);

function AssessmentItemInputs({ definition }: { definition?: AssessmentDefinition }) {
  return (
    <div className="domain-grid">
      {domainSlots.map((slot) => {
        const domain = definition?.domains[slot - 1];
        return (
          <div className="domain-row" key={slot}>
            <input type="hidden" name={`domain_${slot}_id`} value={domain?.id ?? ""} />
            <span className="muted small">Item {slot}</span>
            <input
              className="input"
              name={`domain_${slot}_label`}
              placeholder="Assessable option"
              defaultValue={domain?.label ?? ""}
              required={slot === 1}
            />
          </div>
        );
      })}
    </div>
  );
}

export function AssessmentDefinitionCreator({ data }: { data: AppData }) {
  return (
    <form className="panel grid" action={createAssessmentDefinition}>
      <div className="section-header">
        <div>
          <h2>Add Assessment Definition</h2>
          <p>Configurable formative assessment options and score range</p>
        </div>
      </div>
      <FormGrid>
        <Field label="Module" htmlFor="assessment-module">
          <select id="assessment-module" name="module_id" className="select" disabled={data.modules.length === 0} required>
            <option value="">Select module</option>
            {data.modules.map((courseModule) => (
              <option key={courseModule.id} value={courseModule.id}>
                {courseModule.code} · {courseModule.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assessment name" htmlFor="assessment-name">
          <input id="assessment-name" name="name" className="input" placeholder="Focused Cardiac Measurements" required />
        </Field>
      </FormGrid>
      <FormGrid>
        <Field label="Minimum score" htmlFor="assessment-score-min">
          <input id="assessment-score-min" name="score_min" className="input" type="number" defaultValue="0" required />
        </Field>
        <Field label="Maximum score" htmlFor="assessment-score-max">
          <input id="assessment-score-max" name="score_max" className="input" type="number" defaultValue="10" required />
        </Field>
      </FormGrid>
      <label className="toolbar small">
        <input name="active" type="checkbox" defaultChecked /> Active
      </label>
      <AssessmentItemInputs />
      <button className="button primary" disabled={data.modules.length === 0}>
        Save assessment definition
      </button>
    </form>
  );
}

export function AssessmentDefinitionRecords({ data }: { data: AppData }) {
  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>Assessment Definitions</h2>
          <p>Edit formative assessment options and score ranges per module</p>
        </div>
      </div>
      <div className="record-grid">
        {data.assessmentDefinitions.map((definition) => {
          const courseModule = data.modules.find((candidate) => candidate.id === definition.moduleId);
          return (
            <div className="panel grid" key={definition.id}>
              <form className="grid" action={updateAssessmentDefinition}>
                <input type="hidden" name="definition_id" value={definition.id} />
                <FormGrid>
                  <Field label="Module" htmlFor={`assessment-module-${definition.id}`}>
                    <select id={`assessment-module-${definition.id}`} name="module_id" className="select" defaultValue={definition.moduleId}>
                      {data.modules.map((moduleOption) => (
                        <option key={moduleOption.id} value={moduleOption.id}>
                          {moduleOption.code}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Assessment name" htmlFor={`assessment-name-${definition.id}`}>
                    <input id={`assessment-name-${definition.id}`} name="name" className="input" defaultValue={definition.name} required />
                  </Field>
                </FormGrid>
                <FormGrid>
                  <Field label="Minimum score" htmlFor={`assessment-score-min-${definition.id}`}>
                    <input
                      id={`assessment-score-min-${definition.id}`}
                      name="score_min"
                      className="input"
                      type="number"
                      defaultValue={definition.scoreMin}
                      required
                    />
                  </Field>
                  <Field label="Maximum score" htmlFor={`assessment-score-max-${definition.id}`}>
                    <input
                      id={`assessment-score-max-${definition.id}`}
                      name="score_max"
                      className="input"
                      type="number"
                      defaultValue={definition.scoreMax}
                      required
                    />
                  </Field>
                </FormGrid>
                <label className="toolbar small">
                  <input name="active" type="checkbox" defaultChecked={definition.active} /> Active
                </label>
                <AssessmentItemInputs definition={definition} />
                <button className="button primary">Save assessment</button>
              </form>
              <form action={deleteAssessmentDefinition}>
                <DeleteWarning
                  name={`${courseModule?.code ?? "module"} ${definition.name}`}
                  idName="definition_id"
                  idValue={definition.id}
                />
                <button className="button danger">Delete assessment</button>
              </form>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function AssessmentDefinitionOverview({ data }: { data: AppData }) {
  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>Assessment Definitions</h2>
          <p>Configured formative assessment options</p>
        </div>
      </div>
      <div className="grid grid-3">
        {data.assessmentDefinitions.map((definition) => {
          const courseModule = data.modules.find((candidate) => candidate.id === definition.moduleId);
          return (
            <div className="card" key={definition.id}>
              <div className="toolbar" style={{ justifyContent: "space-between" }}>
                <strong>{definition.name}</strong>
                <StatusPill value={definition.active ? "active" : "neutral"} label={definition.active ? "active" : "inactive"} />
              </div>
              <p className="muted small">{courseModule?.code}</p>
              <p className="muted small">
                Overall score {definition.scoreMin}-{definition.scoreMax}
              </p>
              <div className="timeline">
                {definition.domains.map((domain) => (
                  <div className="timeline-item" key={domain.id}>
                    <span>{domain.label}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
