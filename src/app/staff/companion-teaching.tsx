"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { loadWorkspaceTeaching } from "@/app/students/teaching-actions";
import { TeachingDialog } from "@/components/student-teaching";
import type { TeachingKind, TeachingOptions } from "@/lib/student-teaching";
import styles from "./companion.module.css";
import { CompanionPlanning } from "./companion-planning";

export function CompanionTeaching({ studentId, offeringId, ordinary = true, presentation = false }: { studentId: string; offeringId: string; ordinary?: boolean; presentation?: boolean }) {
  const [task, setTask] = useState<{ kind: TeachingKind; options: TeachingOptions } | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  async function open(kind: TeachingKind) {
    setLoading(true); setMessage("");
    try {
      const result = await loadWorkspaceTeaching(studentId);
      if (!result.ok) { setMessage(result.error); return; }
      const offerings = result.options.offerings.filter(offering => offering.id === offeringId);
      const presentations = result.options.presentations?.filter(offering => offering.id === offeringId);
      if (!(kind === "presentation" ? presentations?.length : offerings.length)) { setMessage("This enrolment is no longer eligible for teaching. Refresh to review its current status."); return; }
      setTask({ kind, options: { offerings, presentations, definitions: result.options.definitions.filter(definition => definition.moduleId === offerings[0]?.moduleId) } });
    } catch { setMessage("Teaching options could not be loaded. Please try again."); }
    finally { setLoading(false); }
  }
  return <div className={styles.teachingActions}>
    {!ordinary ? <p>Teaching records and plans are read-only. Only the existing presentation may be scored or your own score edited.</p> : null}
    {ordinary ? <><button type="button" disabled={loading} onClick={() => open("observation")}>Add encounter</button>
    <button type="button" disabled={loading} onClick={() => open("formative")}>Add formative score</button></> : null}
    {presentation ? <button type="button" disabled={loading} onClick={() => open("presentation")}>Presentation scoring</button> : null}
    {ordinary ? <CompanionPlanning studentId={studentId} offeringId={offeringId} /> : null}
    {loading ? <p role="status">Loading teaching options…</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {task ? createPortal(<TeachingDialog {...task} studentId={studentId} termId={null} close={() => setTask(null)} saved={value => { setTask(null); setMessage(value); }} />, document.body) : null}
  </div>;
}
