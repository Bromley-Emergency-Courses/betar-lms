import { rowsToCsv } from "@/lib/exports";
import type { AssessmentAttempt, AssessmentOutcome, AssessmentSource, HistoricalAssessmentResult } from "./types";

function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
}

export function assessmentExportCsv(report: "outcomes" | "attempts" | "reconciliation" | "cccu", outcomes: AssessmentOutcome[], attempts: AssessmentAttempt[], sources: AssessmentSource[], historicalResults: HistoricalAssessmentResult[] = []): string {
  let rows: unknown[][];
  const includeBasis = historicalResults.length > 0 || outcomes.some(outcome => outcome.assessment.historical || outcome.assessment.activation);
  if (report === "outcomes") {
    rows = [["Student ID", "Student Name", "Original Cohort", "Module Code", "Theory", "Practical", "Effective Status", "Calculated Status", "Indicators", "Theory Attempts", "Practical Attempts", "Credits", "Calculated Credits", "Overrides"]];
    if (includeBasis) rows[0].push("Record basis", "Recorded Final mark", "Recorded Grade", "Original recorded status", "Original recorded credits");
    for (const row of outcomes) {
      const assessment = row.assessment;
      const original = assessment.historical ?? assessment.activation?.original_record;
      rows.push([row.student_identifier, row.student_name, row.original_cohort, row.module_code, assessment.components?.theory?.score,
        !assessment.historical && assessment.plan?.mode === "online" ? "N/A" : assessment.components?.practical?.score, assessment.historical?.protected ? assessment.effective_status : assessment.historical?.status ?? assessment.effective_status, assessment.historical ? "" : assessment.calculated_status,
        assessment.effective_indicators, assessment.components?.theory?.attempt_count, assessment.components?.practical?.attempt_count,
        assessment.awarded_credits, assessment.historical ? "" : assessment.calculated_credits, assessment.historical && !assessment.historical.protected ? "" : assessment.overrides,
        ...(includeBasis ? [assessment.historical ? "Historical record — original preserved; amendments audited" : assessment.activation ? `Activated current enrolment — original preserved; ${assessment.activation.preserved_credits === null ? "calculated credits" : "existing credits retained unless explicitly amended"}` : "New workflow", original?.final_mark, original?.grade, original?.status, original ? original.credits ?? row.legacy_credits : ""] : [])]);
    }
  } else if (report === "reconciliation") {
    rows = [["Source", "Source Key", "Student ID", "Student Name", "Module", "Component", "Lifecycle", "Conflict", "Identity Override", "Replacement Agrees", "Latest Payload"]];
    for (const row of sources.filter((source) => source.state !== "Matched" || source.conflict || source.identity_override_reason)) rows.push([
      row.source_system, row.source_key, row.student_identifier, row.student_name, row.module_id, row.component, row.state, row.conflict,
      row.identity_override_reason, row.replacement_agrees, row.payload
    ]);
  } else {
    rows = report === "cccu"
      ? [["Student ID", "Student Name", "Term", "Module Code", "Module Title", "Component", "Score", "Pass Mark", "Passed", "Resit Required", "Attempt Number", "Is Resit", "Prior Attempt Missing", "Taken On", "Source System", "Original Cohort", "Revision", "Current Result"]]
      : [["Enrolment", "Attempt", "Sequence", "Revision", "Component", "Score", "Pass Mark", "Passed", "Sitting Date", "Sitting Term", "Source", "Current Result", "Previous Result Unavailable"]];
    if (includeBasis) rows[0].push("Record basis", "Historical record ID");
    for (const attempt of attempts.filter((attempt) => attempt.active)) {
      const outcome = outcomes.find((outcome) => outcome.enrolment_id === attempt.enrolment_id);
      if (!outcome) continue;
      rows.push(report === "cccu" ? [outcome.student_identifier, outcome.student_name, attempt.sitting_term, outcome.module_code, outcome.module_title,
        attempt.component, attempt.score, attempt.pass_mark, attempt.passed ? "Yes" : "No", attempt.is_current && !attempt.passed ? "Yes" : "No",
        attempt.sequence, attempt.ordinal > 1 || attempt.previous_result_unavailable ? "Yes" : "No", attempt.previous_result_unavailable ? "Yes" : "No",
        attempt.sitting_date, attempt.origin, outcome.original_cohort, attempt.revision, attempt.is_current, ...(includeBasis ? ["New workflow", ""] : [])]
        : [attempt.enrolment_id, attempt.id, attempt.sequence, attempt.revision, attempt.component, attempt.score, attempt.pass_mark, attempt.passed,
          attempt.sitting_date, attempt.sitting_term, attempt.origin, attempt.is_current, attempt.previous_result_unavailable, ...(includeBasis ? ["New workflow", ""] : [])]);
    }
    for (const record of historicalResults.filter(record => !record.represented_by_attempt_id)) {
      rows.push(report === "cccu" ? [record.student_identifier, record.student_name, "", record.module_code, record.module_title,
        record.component, record.score, record.pass_mark, record.passed ? "Yes" : "No", record.resit_required ? "Yes" : "No",
        record.attempt_number, record.is_resit ? "Yes" : "No", record.prior_attempt_missing ? "Yes" : "No", record.taken_on,
        record.source_system, record.original_cohort, "", "", "Historical record — as recorded; review required", record.id]
        : [record.enrolment_id, "", record.attempt_number, "", record.component, record.score, record.pass_mark, record.passed,
          record.taken_on, "", record.source_system, "", record.prior_attempt_missing ? "Recorded prior result missing" : "", "Historical record — as recorded; review required", record.id]);
    }
  }
  return rowsToCsv(rows.map((row) => row.map(cell)));
}
