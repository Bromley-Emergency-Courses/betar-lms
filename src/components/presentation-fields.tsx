"use client";

import { useState } from "react";
import { presentationRubricGroups } from "@/lib/presentation-rubric";
import type { PresentationOffering } from "@/lib/student-teaching";
import styles from "./student-workspace.module.css";

export function PresentationFields({ offering, markDirty }: { offering?: PresentationOffering; markDirty: () => void }) {
  const own = offering?.ownScore;
  const [scores, setScores] = useState<Record<string, number>>(own?.scores ?? {});
  const [penalty, setPenalty] = useState(String(own?.timePenalty ?? 0));
  const subtotal = Object.values(scores).reduce((total, score) => total + score, 0);
  const validPenalty = penalty !== "" && Number.isInteger(Number(penalty)) && Number(penalty) >= 0 && Number(penalty) <= subtotal;
  function adjust(delta: number) { setPenalty(String(Math.min(subtotal, Math.max(0, Number(penalty || 0) + delta)))); markDirty(); }
  return <>
    {offering?.event ? <p className={styles.notice}>Existing presentation · {offering.event.presentationType.replaceAll("_", " ")} · {offering.event.durationMinutes} minutes. Date, module and presentation details are shared and cannot be changed here.</p> : <div className={styles.profileGroup}><label>Presentation type<select name="presentationType" defaultValue="case_presentation"><option value="case_presentation">Case presentation</option><option value="journal_club">Journal club</option></select></label><label>Duration (minutes)<input name="duration" type="number" inputMode="numeric" min={1} step={1} max={2147483647} required /></label></div>}
    {presentationRubricGroups.map(group => <fieldset className={styles.taskFields} key={group.name}><legend>{group.name}</legend>{group.criteria.map(criterion => <label className={styles.rubricRow} key={criterion.id}>{criterion.label}<select name={criterion.id} value={scores[criterion.id] ?? ""} onChange={event => setScores(current => ({ ...current, [criterion.id]: Number(event.target.value) }))} required><option value="">Score</option>{[1, 2, 3, 4, 5].map(score => <option value={score} key={score}>{score}</option>)}</select></label>)}</fieldset>)}
    <label>Time penalty (points)<input name="timePenalty" type="number" inputMode="numeric" min={0} max={subtotal} step={1} required value={penalty} onChange={event => setPenalty(event.target.value)} /></label>
    <div className={styles.toolbar}><button type="button" className={styles.button} aria-label="Decrease time penalty" disabled={Number(penalty) <= 0} onClick={() => adjust(-1)}>− 1 point</button><button type="button" className={styles.button} aria-label="Increase time penalty" disabled={Number(penalty) >= subtotal} onClick={() => adjust(1)}>+ 1 point</button></div>
    <p role="status">Rubric subtotal: {subtotal}/50 · Time penalty: {penalty || "Required"} · Final score: {validPenalty ? subtotal - Number(penalty) : "Check penalty"}/50</p>
    <p className={styles.muted}>All ten criteria are required. Enter a manual whole-point deduction only when applicable; no automatic time limit is applied. This is not a module exam result.</p>
  </>;
}
