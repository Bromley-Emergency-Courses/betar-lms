"use client";

import { useState } from "react";
import { Field, FormGrid } from "@/components/forms";
import { createExamPortalMapping } from "@/lib/admin-actions";
import type { ExamPortalPickerExam } from "@/lib/exam-portal";
import type { CourseModule, Term } from "@/lib/types";

function shortDate(value?: string) {
  if (!value) {
    return "Not set";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

export function ExamPortalMappingForm({
  terms,
  modules,
  portalExams
}: {
  terms: Term[];
  modules: CourseModule[];
  portalExams: ExamPortalPickerExam[];
}) {
  const [examKind, setExamKind] = useState<"module_theory" | "physics_equipment">("module_theory");
  const moduleRequired = examKind === "module_theory";

  return (
    <form className="panel grid" action={createExamPortalMapping}>
      <div className="section-header">
        <div>
          <h2>Add Exam Portal Mapping</h2>
          <p>Choose a reviewed Exam Portal exam and attach it to an LMS term/module</p>
        </div>
      </div>
      <Field label="Exam Portal exam" htmlFor="portal-exam-selection">
        {portalExams.length === 0 ? (
          <div className="empty-inline">
            <strong>No reviewed exams found</strong>
            <span className="muted small">Use the search panel or confirm the exam has been reviewed in Exam Portal.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Exam</th>
                  <th>Reviewed</th>
                  <th>Results</th>
                  <th>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {portalExams.map((exam, index) => (
                  <tr key={exam.examId}>
                    <td>
                      <input
                        id={index === 0 ? "portal-exam-selection" : `portal-exam-selection-${exam.examId}`}
                        name="portal_exam_selection"
                        type="radio"
                        required
                        value={JSON.stringify({
                          exam_id: exam.examId,
                          exam_title: exam.examTitle ?? null
                        })}
                      />
                    </td>
                    <td>
                      <strong>{exam.examTitle ?? "Untitled exam"}</strong>
                      <br />
                      <span className="muted small">Created {shortDate(exam.createdAt)}</span>
                    </td>
                    <td>{shortDate(exam.submissionsReviewedAt)}</td>
                    <td>{exam.resultCount}</td>
                    <td>{exam.tokenCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Field>
      <FormGrid>
        <Field label="Exam sitting term" htmlFor="portal-term">
          <select id="portal-term" name="term_id" className="select" required>
            <option value="">Select exam sitting term</option>
            {terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Exam kind" htmlFor="portal-exam-kind">
          <select
            id="portal-exam-kind"
            name="portal_exam_kind"
            className="select"
            value={examKind}
            onChange={(event) => setExamKind(event.target.value as "module_theory" | "physics_equipment")}
          >
            <option value="module_theory">Module theory</option>
            <option value="physics_equipment">Physics/equipment</option>
          </select>
        </Field>
      </FormGrid>
      <Field label="Module for module theory" htmlFor="portal-module">
        <select id="portal-module" name="module_id" className="select" required={moduleRequired} disabled={!moduleRequired}>
          <option value="">{moduleRequired ? "Select module" : "None for physics/equipment"}</option>
          {modules.map((courseModule) => (
            <option key={courseModule.id} value={courseModule.id}>
              {courseModule.code} · {courseModule.title}
            </option>
          ))}
        </select>
      </Field>
      {moduleRequired ? (
        <label className="toolbar small">
          <input name="physics_required" type="checkbox" defaultChecked /> Physics/equipment contributes 50%
        </label>
      ) : null}
      <label className="toolbar small">
        <input name="active" type="checkbox" defaultChecked /> Active
      </label>
      <details>
        <summary className="muted small">Advanced manual exam ID fallback</summary>
        <Field label="Exam Portal exam ID" htmlFor="portal-exam-id">
          <input id="portal-exam-id" name="portal_exam_id" className="input" />
        </Field>
        <Field label="Exam title optional" htmlFor="portal-exam-title">
          <input id="portal-exam-title" name="exam_title" className="input" />
        </Field>
      </details>
      <button className="button primary">Save mapping</button>
    </form>
  );
}
