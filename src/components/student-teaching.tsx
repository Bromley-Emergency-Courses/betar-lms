"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, X } from "lucide-react";
import { loadWorkspaceTeaching, saveWorkspaceTeaching } from "@/app/students/teaching-actions";
import { teachingKindLabels, type TeachingKind, type TeachingOptions } from "@/lib/student-teaching";
import { presentationRubricCriteria, presentationRubricGroups } from "@/lib/presentation-rubric";
import type { WorkspaceTeachingRecord } from "@/lib/student-workspace";
import { useTaskDialogGuard } from "./use-task-dialog-guard";
import styles from "./student-workspace.module.css";

function TeachingDialog({ studentId, kind, options, termId, close, saved }: {
  studentId: string; kind: TeachingKind; options: TeachingOptions; termId: string | null; close: () => void; saved: (message: string) => void;
}) {
  const [snapshot] = useState(options);
  const [recordId] = useState(() => crypto.randomUUID());
  const [offeringId, setOfferingId] = useState(() => {
    const matching = options.offerings.filter(offering => !termId || offering.termId === termId);
    return matching.length === 1 ? matching[0].id : "";
  });
  const [definitionId, setDefinitionId] = useState("");
  const [error, setError] = useState("");
  const titleId = useId();
  const router = useRouter();
  const { dialog, keepEditing, dirtyRef, pendingRef, dirty, pending, setPending, exitTarget, setExitTarget, requestClose, discard, markDirty } = useTaskDialogGuard(close);
  const offering = snapshot.offerings.find(candidate => candidate.id === offeringId);
  const definitions = snapshot.definitions.filter(definition => definition.moduleId === offering?.moduleId);
  const definition = definitions.find(candidate => candidate.id === definitionId);
  const ready = Boolean(offering && (kind !== "formative" || definition));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || !ready) return;
    const fields = new FormData(event.currentTarget);
    const base = { id: recordId, student_id: studentId, offering_id: offeringId, offering_token: offering!.token, occurred_on: String(fields.get("date")), kind };
    const comments = String(fields.get("comments") ?? "").trim() || null;
    const command = kind === "observation" ? { ...base, summary: String(fields.get("summary")), concern_level: String(fields.get("concern")) } :
      kind === "formative" ? { ...base, definition_id: definition!.id, definition_token: definition!.token, assessed_item_ids: fields.getAll("items").map(String), overall_score: Number(fields.get("overall")), comments } :
      { ...base, presentation_type: String(fields.get("presentationType")), duration_minutes: Number(fields.get("duration")), scores: Object.fromEntries(presentationRubricCriteria.map(criterion => [criterion.id, Number(fields.get(criterion.id))])), comments };
    pendingRef.current = true; setPending(true); setError("");
    try {
      const result = await saveWorkspaceTeaching(command);
      if (!result.ok) { setError(result.error); return; }
      dirtyRef.current = false; saved(result.message); router.refresh();
    } catch { setError("The save could not be confirmed. Your entries have been kept; review the timeline before retrying."); }
    finally { pendingRef.current = false; setPending(false); }
  }
  return <dialog ref={dialog} className={`${styles.dialog} ${styles.teachingDialog}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className={styles.dialogHeader}><h2 id={titleId}>Add {teachingKindLabels[kind].toLowerCase()}</h2><button type="button" className={styles.iconButton} onClick={requestClose} disabled={pending} aria-label="Close editor"><X size={22} /></button></header>
    <form className={styles.dialogBody} onSubmit={submit} data-unsaved={dirty}>
      <fieldset className={styles.taskFields} disabled={pending || Boolean(exitTarget)}>
        <p className={styles.notice}>{kind === "presentation" ? "Record the presentation using the existing 1–5 rubric. This may satisfy a presentation requirement; it does not create an exam score." : kind === "formative" ? "Record formative teaching feedback, not a module exam or resit result. Choose the assessed items and one overall score using the configured scale." : "Record an observation and any concern for this student’s teaching offering."} Your signed-in staff identity is recorded as the author.</p>
        <label>Teaching offering / cohort<select value={offeringId} disabled={dirty} onChange={event => { setOfferingId(event.target.value); setDefinitionId(""); setError(""); }}><option value="">Choose a teaching offering</option>{snapshot.offerings.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label>
        {!snapshot.offerings.length ? <p className={styles.empty}>Teaching records require an active student enrolled in the current active teaching term, as in the Staff workspace. Historical records remain readable.</p> : null}
        {kind === "formative" && offering ? <label>Formative assessment definition<select value={definitionId} disabled={dirty} onChange={event => { setDefinitionId(event.target.value); setError(""); }}><option value="">Choose a formative assessment</option>{definitions.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label> : null}
        {kind === "formative" && offering && !definitions.length ? <p className={styles.notice}>No active formative assessment is configured for this module. An administrator must configure it before recording a score.</p> : null}
        {dirty ? <p className={styles.muted}>Save or discard this draft before changing the offering or assessment definition.</p> : null}
        {ready ? <div className={styles.taskFields} key={`${offeringId}:${definitionId}`} onChange={markDirty}>
          <label>Date<input name="date" type="date" defaultValue={new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" })} required /></label>
          {kind === "observation" ? <><label>Observation details<textarea name="summary" maxLength={10000} required /></label><label>Concern level<select name="concern" defaultValue="none"><option value="none">No concern</option><option value="watch">Watch</option><option value="support_needed">Support needed</option></select></label></> : kind === "formative" ? <>
            <fieldset className={styles.taskFields}><legend>Assessed items — select at least one</legend>{definition!.domains.map(domain => <label className={styles.confirmation} key={domain.id}><input type="checkbox" name="items" value={domain.id} />{domain.label}</label>)}</fieldset>
            <label>Overall score ({definition!.scoreMin}–{definition!.scoreMax})<input name="overall" type="number" min={definition!.scoreMin} max={definition!.scoreMax} step={1} required /></label>
          </> : <>
            <div className={styles.profileGroup}><label>Presentation type<select name="presentationType" defaultValue="case_presentation"><option value="case_presentation">Case presentation</option><option value="journal_club">Journal club</option></select></label><label>Duration (minutes)<input name="duration" type="number" min={1} step={1} max={2147483647} required /></label></div>
            {presentationRubricGroups.map(group => <fieldset className={styles.taskFields} key={group.name}><legend>{group.name}</legend>{group.criteria.map(criterion => <label className={styles.rubricRow} key={criterion.id}>{criterion.label}<select name={criterion.id} defaultValue="" required><option value="">Score</option>{[1, 2, 3, 4, 5].map(score => <option value={score} key={score}>{score}</option>)}</select></label>)}</fieldset>)}
            <p className={styles.muted}>All ten criteria are required. The total is calculated when saving; it is not a percentage or module exam result.</p>
          </>}
          {kind !== "observation" ? <label>Comments<textarea name="comments" maxLength={10000} /></label> : null}
        </div> : null}
      </fieldset>
      {error ? <div role="alert" className={styles.notice}><p>{error}</p><p>Your entries have been kept. Discard and reopen if newer configuration needs reviewing.</p></div> : null}
      {exitTarget ? <div role="alert" className={styles.notice}><strong>Discard unsaved changes?</strong><p>Your entries have not been saved.</p><div className={styles.toolbar}><button type="button" ref={keepEditing} className={styles.button} onClick={() => setExitTarget(null)}>Keep editing</button><button type="button" className={styles.button} onClick={discard}>Discard changes</button></div></div> : <footer className={styles.toolbar}><button type="submit" className={styles.primaryButton} disabled={pending || !ready}>{pending ? "Saving…" : "Save record"}</button><button type="button" className={styles.button} disabled={pending} onClick={requestClose}>Cancel</button></footer>}
    </form>
  </dialog>;
}

export function StudentTeachingSection({ studentId, records, canTeach }: { studentId: string; records: WorkspaceTeachingRecord[]; canTeach: boolean }) {
  const params = useSearchParams();
  const [task, setTask] = useState<{ kind: TeachingKind; options: TeachingOptions } | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  async function open(kind: TeachingKind) {
    setLoading(true); setMessage("");
    try { const result = await loadWorkspaceTeaching(studentId); if (result.ok) setTask({ kind, options: result.options }); else setMessage(result.error); }
    catch { setMessage("Teaching options could not be loaded. Please try again."); }
    finally { setLoading(false); }
  }
  return <section className={styles.panel}>
    <div className={styles.sectionHeading}><div><h2>Teaching records</h2><p className={styles.muted}>Observations, formative assessments and presentations — separate from module exam results.</p></div></div>
    {canTeach ? <div className={styles.toolbar}>{(["observation", "formative", "presentation"] as const).map(kind => <button className={styles.button} key={kind} disabled={loading} onClick={() => open(kind)}>Add {teachingKindLabels[kind].toLowerCase()}</button>)}<Link className={styles.textButton} href={`/staff?studentId=${encodeURIComponent(studentId)}`}>Open teaching workspace <ArrowUpRight size={15} /></Link></div> : null}
    {loading ? <p role="status">Loading current teaching options…</p> : null}{message ? <p className={styles.notice} role="status">{message}</p> : null}
    {records.map(record => <article className={styles.teachingRecord} key={`${record.type}:${record.id}`}><div className={styles.sectionHeading}><strong>{record.type}</strong><time>{new Date(`${record.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</time></div><p className={styles.muted}>{record.module} · {record.author}</p>{record.concern && record.concern !== "none" ? <span className={styles.flag}>{record.concern.replaceAll("_", " ")}</span> : null}{record.text ? <p>{record.text}</p> : null}{record.details.length ? <dl className={styles.facts}>{record.details.map((detail, index) => <div key={`${detail.label}-${index}`}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl> : null}</article>)}
    {!records.length ? <p className={styles.empty}>No teaching records yet.</p> : null}
    {task ? <TeachingDialog {...task} studentId={studentId} termId={params.get("term")} close={() => setTask(null)} saved={value => { setTask(null); setMessage(value); }} /> : null}
  </section>;
}
