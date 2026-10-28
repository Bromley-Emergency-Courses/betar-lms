import type { HistoricalAssessmentResult } from "@/lib/assessment/types";
import styles from "./student-workspace.module.css";

export function HistoricalAssessmentResults({ results }: { results: HistoricalAssessmentResult[] }) {
  if (!results.length) return null;
  return <section aria-label="Historical source records">
    <h3>Historical source records</h3>
    <p className={styles.muted}>Read-only values as recorded. Missing component breakdowns have not been invented. Linked records are source evidence, not additional attempts.</p>
    <ol className={styles.history}>{[...results].sort((first, second) => second.taken_on.localeCompare(first.taken_on) || second.attempt_number - first.attempt_number || first.id.localeCompare(second.id)).map(result => <li className={styles.historyItem} key={result.id}>
      <strong>{result.component === "theory" ? "Theory" : "Practical"} · Recorded attempt {result.attempt_number} · {result.score}% · {result.passed ? "Passed" : "Failed"}</strong>
      <p>Pass mark {result.pass_mark}% · {result.taken_on} · {result.source_system}</p>
      <p>Recorded resit required: {result.resit_required ? "Yes" : "No"} · Recorded as resit: {result.is_resit ? "Yes" : "No"}</p>
      {result.prior_attempt_missing ? <p>Earlier result was recorded as missing.</p> : null}
      <p>{result.represented_by_attempt_id ? "Linked to a new-workflow attempt; not counted twice in exports." : "Historical record — not converted to a new-workflow attempt."}</p>
      {!result.enrolment_id ? <p>{result.student_name} · {result.module_title} · {result.original_cohort} · Enrolment ownership requires review.</p> : null}
    </li>)}</ol>
  </section>;
}
