import type { AssessmentSourceEvidence as SourceEvidence } from "@/lib/assessment/types";
import styles from "./student-workspace.module.css";

export function AssessmentSourceEvidence({ source }: { source: SourceEvidence }) {
  return <details className={styles.revisions}>
    <summary>Imported source evidence · {source.source_system} · {source.versions.length} {source.versions.length === 1 ? "version" : "versions"}</summary>
    <p>{source.state} · Source reference: {source.source_key}</p>
    {source.conflict ? <p className={styles.notice}>{source.conflict}</p> : null}
    <p>These source values are preserved, not edited. A Manual replacement determines the accepted result; later imports cannot overwrite it.</p>
    {source.versions.map(version => <article key={version.id}>
      <strong>Source version {version.revision} · {version.score === null ? "Score not supplied" : `${version.score}%`}</strong>
      <p>{version.component === "theory" ? "Theory" : "Practical"} · Sitting {version.sitting_date} · Student identifier: {version.student_identifier}</p>
      <p>Source pass mark: {version.pass_mark === null ? "Not supplied; see the recorded attempt threshold" : `${version.pass_mark}%`}</p>
      {version.items.length ? <p>{version.items.map(item => `${item.kind === "mcq" ? "MCQ" : item.kind}: ${item.score}%`).join(" · ")}</p> : null}
      <p className={styles.muted}>Received {new Date(version.observed_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</p>
    </article>)}
  </details>;
}
