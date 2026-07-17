"use client";

import Link from "next/link";
import { Save } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Field, FormGrid } from "@/components/forms";
import { StatusPill } from "@/components/status-pill";
import {
  createAssessmentAttempt,
  createEncounterLog,
  createPresentationScore
} from "@/lib/admin-actions";
import { presentationRubricGroups } from "@/lib/presentation-rubric";
import { studentDisplayName } from "@/lib/rules";
import type { AppData, Enrolment, PresentationScore, Student } from "@/lib/types";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formativeAttemptSummary(data: AppData, definitionId: string, itemIds: string[]): string {
  const definition = data.assessmentDefinitions.find((candidate) => candidate.id === definitionId);
  if (!definition || itemIds.length === 0) {
    return "";
  }
  const labels = itemIds
    .map((itemId) => definition.domains.find((domain) => domain.id === itemId)?.label)
    .filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : "";
}

function offeringLabel(data: AppData, enrolment: Enrolment): string | undefined {
  const offering = data.offerings.find((candidate) => candidate.id === enrolment.offeringId);
  const courseModule = offering ? data.modules.find((candidate) => candidate.id === offering.moduleId) : undefined;
  return offering && courseModule ? `${courseModule.code} · ${courseModule.title}` : undefined;
}

function moduleLabelForOffering(data: AppData, offeringId: string): string | undefined {
  const offering = data.offerings.find((candidate) => candidate.id === offeringId);
  const courseModule = offering ? data.modules.find((candidate) => candidate.id === offering.moduleId) : undefined;
  return offering && courseModule ? `${courseModule.code} · ${courseModule.title}` : undefined;
}

function presentationTypeLabel(type: PresentationScore["presentationType"]): string | undefined {
  if (type === "case_presentation") {
    return "Case presentation";
  }
  if (type === "journal_club") {
    return "Journal club";
  }
  return undefined;
}

function presentationMetadata(data: AppData, presentation: PresentationScore): string {
  return [
    moduleLabelForOffering(data, presentation.offeringId),
    presentationTypeLabel(presentation.presentationType),
    typeof presentation.durationMinutes === "number" ? `${presentation.durationMinutes} mins` : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}

export function StaffWorkflow({
  data,
  selectedStudentId,
  selectedOfferingId
}: {
  data: AppData;
  selectedStudentId?: string;
  selectedOfferingId?: string;
}) {
  const activeTerm = data.terms.find((term) => term.status === "active");
  if (!activeTerm) {
    return (
      <EmptyState
        title="No active term set"
        detail="Set the current teaching term to active in Course before staff teaching forms can be used."
      />
    );
  }

  const activeTermOfferingIds = new Set(
    data.offerings.filter((offering) => offering.termId === activeTerm.id).map((offering) => offering.id)
  );
  const activeTermEnrolments = data.enrolments.filter((enrolment) => activeTermOfferingIds.has(enrolment.offeringId));
  const activeTermStudentIds = new Set(activeTermEnrolments.map((enrolment) => enrolment.studentId));
  const activeStudents = data.students
    .filter((student) => student.status === "active" && activeTermStudentIds.has(student.id))
    .sort((first, second) => studentDisplayName(first).localeCompare(studentDisplayName(second)));

  if (activeStudents.length === 0) {
    return (
      <EmptyState
        title="No active enrolled students"
        detail={`Staff teaching forms require active students enrolled in ${activeTerm.name}.`}
      />
    );
  }

  return (
    <StaffWorkflowContent
      activeStudents={activeStudents}
      activeTermEnrolments={activeTermEnrolments}
      data={data}
      selectedOfferingId={selectedOfferingId}
      selectedStudentId={selectedStudentId}
    />
  );
}

function StaffWorkflowContent({
  activeStudents,
  activeTermEnrolments,
  data,
  selectedStudentId,
  selectedOfferingId
}: {
  activeStudents: Student[];
  activeTermEnrolments: Enrolment[];
  data: AppData;
  selectedStudentId?: string;
  selectedOfferingId?: string;
}) {
  const initialStudent = activeStudents.find((student) => student.id === selectedStudentId) ?? activeStudents[0];
  const [selectedStudentIdState, setSelectedStudentIdState] = useState(initialStudent.id);
  const selectedStudent = activeStudents.find((student) => student.id === selectedStudentIdState) ?? activeStudents[0];
  const studentEnrolments = useMemo(
    () => activeTermEnrolments.filter((enrolment) => enrolment.studentId === selectedStudent.id),
    [activeTermEnrolments, selectedStudent.id]
  );
  const requestedOfferingIsValid = studentEnrolments.some((enrolment) => enrolment.offeringId === selectedOfferingId);
  const initialOfferingId = requestedOfferingIsValid ? selectedOfferingId : studentEnrolments[0]?.offeringId;
  const [selectedOfferingIdState, setSelectedOfferingIdState] = useState(initialOfferingId ?? "");
  const selectedOfferingIdForStudent = studentEnrolments.some(
    (enrolment) => enrolment.offeringId === selectedOfferingIdState
  )
    ? selectedOfferingIdState
    : studentEnrolments[0]?.offeringId;
  const selectedOffering = data.offerings.find((offering) => offering.id === selectedOfferingIdForStudent);
  const selectedModule = selectedOffering
    ? data.modules.find((courseModule) => courseModule.id === selectedOffering.moduleId)
    : undefined;
  const assessmentDefinitions = selectedModule
    ? data.assessmentDefinitions.filter((definition) => definition.moduleId === selectedModule.id && definition.active)
    : [];
  const recentEncounters = data.encounters
    .filter((encounter) => encounter.studentId === selectedStudent.id)
    .slice(0, 5);
  const recentAttempts = data.assessmentAttempts
    .filter((attempt) => attempt.studentId === selectedStudent.id)
    .slice(0, 5);
  const recentPresentations = data.presentationScores
    .filter((presentation) => presentation.studentId === selectedStudent.id)
    .slice(0, 5);

  if (!selectedOffering || !selectedModule) {
    return (
      <EmptyState
        title="No offering available"
        detail="This student has enrolments, but the linked offering or module could not be found."
      />
    );
  }

  return (
    <div className="grid grid-2">
      <section className="section">
        <div className="panel grid">
          <FormGrid>
            <Field label="Student" htmlFor="student-select">
              <select
                id="student-select"
                className="select"
                form="staff-selector"
                name="studentId"
                value={selectedStudent.id}
                onChange={(event) => {
                  const nextStudentId = event.target.value;
                  const nextEnrolment = activeTermEnrolments.find((enrolment) => enrolment.studentId === nextStudentId);
                  setSelectedStudentIdState(nextStudentId);
                  setSelectedOfferingIdState(nextEnrolment?.offeringId ?? "");
                }}
              >
                {activeStudents.map((student) => (
                  <option key={student.id} value={student.id}>
                    {studentDisplayName(student)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Module" htmlFor="offering-select">
              <select
                id="offering-select"
                className="select"
                form="staff-selector"
                name="offeringId"
                value={selectedOffering?.id ?? ""}
                onChange={(event) => setSelectedOfferingIdState(event.target.value)}
              >
                {studentEnrolments.map((enrolment) => {
                  const label = offeringLabel(data, enrolment);
                  return label ? (
                    <option key={enrolment.id} value={enrolment.offeringId}>
                      {label}
                    </option>
                  ) : null;
                })}
              </select>
            </Field>
          </FormGrid>
          <form id="staff-selector" action="/staff">
            <button className="button">Load selection</button>
          </form>
        </div>

        <form className="panel grid" action={createEncounterLog}>
          <input type="hidden" name="student_id" value={selectedStudent.id} />
          <input type="hidden" name="offering_id" value={selectedOffering.id} />
          <div className="section-header">
            <div>
              <h2>Encounter Log</h2>
              <p>Daily teaching note for {studentDisplayName(selectedStudent)}</p>
            </div>
          </div>
          <FormGrid>
            <Field label="Date" htmlFor="encounter-date">
              <input id="encounter-date" name="occurred_on" className="input" type="date" defaultValue={todayIsoDate()} required />
            </Field>
            <Field label="Concern level" htmlFor="concern-level">
              <select id="concern-level" name="concern_level" className="select" defaultValue="none">
                <option value="none">None</option>
                <option value="watch">Watch</option>
                <option value="support_needed">Support needed</option>
              </select>
            </Field>
          </FormGrid>
          <Field label="Summary" htmlFor="encounter-summary">
            <textarea id="encounter-summary" name="summary" className="textarea" required />
          </Field>
          <button className="button primary">
            <Save size={16} />
            Save log
          </button>
        </form>
      </section>

      <section className="section">
        <div className="panel grid">
          <div className="section-header">
            <div>
              <h2>Formative Assessment</h2>
              <p>{selectedModule.code}</p>
            </div>
          </div>
          {assessmentDefinitions.length === 0 ? (
            <p className="muted">No assessment definitions configured for this module yet.</p>
          ) : (
            assessmentDefinitions.map((definition) => (
              <form className="grid" action={createAssessmentAttempt} key={definition.id}>
                <input type="hidden" name="student_id" value={selectedStudent.id} />
                <input type="hidden" name="offering_id" value={selectedOffering.id} />
                <input type="hidden" name="definition_id" value={definition.id} />
                <strong>{definition.name}</strong>
                <Field label="Date" htmlFor={`assessment-date-${definition.id}`}>
                  <input id={`assessment-date-${definition.id}`} name="occurred_on" className="input" type="date" defaultValue={todayIsoDate()} required />
                </Field>
                <fieldset className="checkbox-fieldset">
                  <legend>Assessing</legend>
                  <div className="checkbox-list">
                    {definition.domains.map((domain) => (
                      <label className="check-option" key={domain.id}>
                        <input name="assessed_item_ids" type="checkbox" value={domain.id} />
                        <span>{domain.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Field
                  label={`Overall score (${definition.scoreMin}-${definition.scoreMax})`}
                  htmlFor={`overall-score-${definition.id}`}
                >
                    <input
                      id={`overall-score-${definition.id}`}
                      name="overall_score"
                      className="input"
                      type="number"
                      min={definition.scoreMin}
                      max={definition.scoreMax}
                      required
                    />
                </Field>
                <Field label="Comments" htmlFor={`assessment-comments-${definition.id}`}>
                  <textarea id={`assessment-comments-${definition.id}`} name="comments" className="textarea" />
                </Field>
                <button className="button primary">
                  <Save size={16} />
                  Save assessment
                </button>
              </form>
            ))
          )}
        </div>

        <form className="panel grid" action={createPresentationScore}>
          <input type="hidden" name="student_id" value={selectedStudent.id} />
          <input type="hidden" name="offering_id" value={selectedOffering.id} />
          <div className="section-header">
            <div>
              <h2>Presentation Score</h2>
              <p>Rubric criteria scored 1-5</p>
            </div>
          </div>
          <FormGrid>
            <Field label="Date" htmlFor="presentation-date">
              <input id="presentation-date" name="occurred_on" className="input" type="date" defaultValue={todayIsoDate()} required />
            </Field>
            <Field label="Duration (mins)" htmlFor="presentation-duration">
              <input id="presentation-duration" name="duration_minutes" className="input" type="number" min="1" step="1" required />
            </Field>
          </FormGrid>
          <fieldset className="rubric-fieldset">
            <legend>Presentation type</legend>
            <div className="checkbox-list">
              <label className="check-option">
                <input name="presentation_type" type="radio" value="case_presentation" defaultChecked required /> Case presentation
              </label>
              <label className="check-option">
                <input name="presentation_type" type="radio" value="journal_club" required /> Journal club
              </label>
            </div>
          </fieldset>
          <div className="presentation-rubric">
            {presentationRubricGroups.map((group) => (
              <fieldset className="rubric-fieldset" key={group.name}>
                <legend>{group.name}</legend>
                <div className="rubric-fields">
                  {group.criteria.map((criterion) => (
                    <Field label={criterion.label} htmlFor={`presentation-${criterion.id}`} key={criterion.id}>
                      <input
                        id={`presentation-${criterion.id}`}
                        name={criterion.id}
                        className="input"
                        type="number"
                        min="1"
                        max="5"
                        required
                      />
                    </Field>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <Field label="Comments" htmlFor="presentation-comments">
            <textarea id="presentation-comments" name="comments" className="textarea" />
          </Field>
          <button className="button primary">
            <Save size={16} />
            Save presentation
          </button>
        </form>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2>Recent Teaching Records</h2>
            <p>Saved records for the selected student</p>
          </div>
          <Link className="button" href={`/students/${selectedStudent.id}`}>
            Open profile
          </Link>
        </div>
        <div className="panel timeline">
          {recentEncounters.length === 0 && recentAttempts.length === 0 && recentPresentations.length === 0 ? (
            <p className="muted">No teaching records saved yet.</p>
          ) : null}
          {recentEncounters.map((encounter) => (
            <div className="timeline-item" key={encounter.id}>
              <span className="muted small">{encounter.occurredOn}</span>
              <div>
                <StatusPill value={encounter.concernLevel} />
                <p>{encounter.summary}</p>
              </div>
            </div>
          ))}
          {recentAttempts.map((attempt) => (
            <div className="timeline-item" key={attempt.id}>
              <span className="muted small">{attempt.occurredOn}</span>
              <div>
                <strong>
                  Formative assessment
                  {typeof attempt.overallScore === "number" ? `: ${attempt.overallScore}` : ""}
                </strong>
                {formativeAttemptSummary(data, attempt.definitionId, attempt.assessedItemIds) ? (
                  <p className="muted small">{formativeAttemptSummary(data, attempt.definitionId, attempt.assessedItemIds)}</p>
                ) : null}
                <p>{attempt.comments ?? "No comments recorded"}</p>
              </div>
            </div>
          ))}
          {recentPresentations.map((presentation) => {
            const metadata = presentationMetadata(data, presentation);
            return (
              <div className="timeline-item" key={presentation.id}>
                <span className="muted small">{presentation.occurredOn}</span>
                <div>
                  <strong>Presentation score: {presentation.totalScore}</strong>
                  {metadata ? <p className="muted small">{metadata}</p> : null}
                  <p>{presentation.comments ?? "No comments recorded"}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
