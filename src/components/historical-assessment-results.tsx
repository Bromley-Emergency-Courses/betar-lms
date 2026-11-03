import type { HistoricalAssessmentResult } from "@/lib/assessment/types";
import styles from "./student-workspace.module.css";

export function HistoricalAssessmentResults({ results, onCorrect }: { results: HistoricalAssessmentResult[]; onCorrect?: (result: HistoricalAssessmentResult) => void }) {
  if (!results.length) return null;
  return <section aria-label="Historical source records">
    <h3>Historical source records</h3>
    <p className={styles.muted}>Original records are retained. Audited amendments appear alongside their original scores; missing component breakdowns are not invented. Linked records are source evidence, not additional attempts.</p>
    <ol className={styles.history}>{[...results].sort((first, second) => second.taken_on.localeCompare(first.taken_on) || second.attempt_number - first.attempt_number || first.id.localeCompare(second.id)).map(result => <li className={styles.historyItem} key={result.id}>
      <strong>{result.component === "theory" ? "Theory" : "Practical"} · {result.amendment_revision ? "Attempt" : "Recorded attempt"} {result.attempt_number} · {result.score}% · {result.passed ? "Passed" : "Failed"}</strong>
      <p>Pass mark {result.pass_mark}% · {result.taken_on} · {result.source_system}</p>
      <p>Recorded resit required: {result.resit_required ? "Yes" : "No"} · Recorded as resit: {result.is_resit ? "Yes" : "No"}</p>
      {result.prior_attempt_missing ? <p>Earlier result was recorded as missing.</p> : null}
      <p>{result.represented_by_attempt_id ? "Linked to a new-workflow attempt; not counted twice in exports." : result.amendment_revision ? "Audited historical score — original evidence retained." : "Historical record — not converted to a new-workflow attempt."}</p>
      {onCorrect && result.enrolment_id && !result.represented_by_attempt_id ? <button className={styles.button} onClick={() => onCorrect(result)}>Correct this result</button> : null}
      {result.amendment_history?.length ? <details className={styles.revisions}><summary>Score amendment history ({result.amendment_history.length})</summary>{result.original_score != null ? <p>Original recorded score: {result.original_score}%</p> : null}{result.amendment_history.map(change => <article key={change.revision}><strong>Revision {change.revision} · {change.score}%</strong><p>{change.reason}</p><p>{change.actor_name} · {change.created_at}</p>{change.items.length ? <p>{change.items.map(item => `${item.kind}: ${item.score}%`).join(" · ")}</p> : null}</article>)}</details> : null}
      {!result.enrolment_id ? <p>{result.student_name} · {result.module_title} · {result.original_cohort} · Enrolment ownership requires review.</p> : null}
    </li>)}</ol>
  </section>;
}
