"use client";

import { useState } from "react";
import type { CompanionProfile } from "@/lib/staff-companion";
import { CompanionTeaching } from "./companion-teaching";
import styles from "./companion.module.css";

export function CompanionEntry({ profile, enabled }: { profile: CompanionProfile; enabled: boolean }) {
  const eligible = profile.modules.filter(courseModule => profile.teachingOfferingIds.includes(courseModule.offeringId) || profile.presentationOfferingIds?.includes(courseModule.offeringId));
  const [selection, setSelection] = useState("");
  const offeringId = eligible.some(courseModule => courseModule.offeringId === selection) ? selection : eligible.length === 1 ? eligible[0].offeringId : "";
  const selected = eligible.find(courseModule => courseModule.offeringId === offeringId);
  return <section className={styles.entryPanel} aria-label="Teaching entry">
    {!enabled ? <p className={styles.empty}>Teaching input is not enabled in this release. Existing records remain readable.</p> : !eligible.length ? <p className={styles.empty}>No eligible active module enrolments. Historical and completed records remain readable in Student.</p> : <>
      <label>Module<select aria-label="Module" value={offeringId} onChange={event => setSelection(event.target.value)}><option value="">Choose a module and term</option>{eligible.map(courseModule => <option key={courseModule.id} value={courseModule.offeringId}>{courseModule.code} · {courseModule.title} · {courseModule.term}</option>)}</select></label>
      {selected ? <><p className={styles.quiet}>{selected.status} · Presentation {selected.presentation.toLowerCase()}</p><h2>Choose an action</h2><CompanionTeaching key={offeringId} studentId={profile.id} offeringId={offeringId} ordinary={profile.teachingOfferingIds.includes(offeringId)} presentation={profile.presentationOfferingIds?.includes(offeringId)} /></> : <p className={styles.quiet}>Only eligible enrolments are offered. Choose the module before entering teaching information or planning dates.</p>}
    </>}
  </section>;
}
