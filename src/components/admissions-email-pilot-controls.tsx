"use client";

import { ShieldCheck, ShieldOff } from "lucide-react";
import { useActionState } from "react";
import { manageAdmissionsEmailPilotRecord, type AdmissionsEmailPilotActionState } from "@/app/admissions/pilot-actions";
import { AdmissionsRecordSubmitButton } from "@/components/admissions-record-actions";
import styles from "@/components/admissions-record.module.css";
import type { AdmissionsEmailPilotRecordType, AdmissionsEmailPilotTestRecord } from "@/lib/admissions-email-pilot";

const initialState: AdmissionsEmailPilotActionState = { status: "idle" };

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AdmissionsEmailPilotControls({
  recordType,
  entityId,
  displayName,
  recipientEmail,
  recipientAllowlisted,
  emailEnabled,
  emailMode,
  configurationReady,
  testRecord
}: {
  recordType: AdmissionsEmailPilotRecordType;
  entityId: string;
  displayName: string;
  recipientEmail?: string;
  recipientAllowlisted: boolean;
  emailEnabled: boolean;
  emailMode: string;
  configurationReady: boolean;
  testRecord?: AdmissionsEmailPilotTestRecord;
}) {
  const [state, action] = useActionState(manageAdmissionsEmailPilotRecord, initialState);
  const activeMarker = testRecord?.active ? testRecord : undefined;

  return (
    <div className={styles.pilotControl}>
      <div className={styles.pilotStatusGrid}>
        <div><span>Record marker</span><strong>{activeMarker ? "Fake pilot record" : "Not marked"}</strong></div>
        <div><span>Current address</span><strong>{recipientEmail ?? "Missing"}</strong></div>
        <div><span>Allowlist</span><strong>{recipientAllowlisted ? "Address allowed" : "Address not allowed"}</strong></div>
        <div><span>Delivery</span><strong>{emailEnabled && configurationReady ? emailMode : "Not ready"}</strong></div>
      </div>

      {activeMarker ? (
        <>
          <div className={styles.pilotMarkerDetail}>
            <ShieldCheck size={16} aria-hidden="true" />
            <div>
              <strong>{activeMarker.label}</strong>
              <p>{activeMarker.reason}</p>
              <small>Marked {formatDate(activeMarker.markedAt)}</small>
            </div>
          </div>
          {!recipientAllowlisted ? <p className={styles.pilotWarning}>This marker is active, but pilot email will remain blocked until the current address is allowlisted.</p> : null}
          <form action={action} className={styles.actionForm}>
            <input type="hidden" name="intent" value="unmark" />
            <input type="hidden" name="record_type" value={recordType} />
            <input type="hidden" name="entity_id" value={entityId} />
            <input type="hidden" name="test_record_id" value={activeMarker.id} />
            <label><span>Reason for removing pilot status</span><textarea name="reason" required rows={2} maxLength={2000} /></label>
            <AdmissionsRecordSubmitButton danger confirmMessage="Remove the controlled email-pilot marker from this record?">
              <ShieldOff size={14} aria-hidden="true" /> Remove pilot marker
            </AdmissionsRecordSubmitButton>
          </form>
        </>
      ) : (
        <form action={action} className={styles.actionForm}>
          <input type="hidden" name="intent" value="mark" />
          <input type="hidden" name="record_type" value={recordType} />
          <input type="hidden" name="entity_id" value={entityId} />
          <label><span>Test label</span><input name="label" required maxLength={160} defaultValue={`${displayName} pilot`} /></label>
          <label><span>Why is this record being used?</span><textarea name="reason" required rows={3} maxLength={2000} placeholder="For example: controlled end-to-end applicant journey using an address I can access." /></label>
          <label className={styles.confirmationCheck}>
            <input type="checkbox" name="confirmed_fake" value="true" required />
            <span>I confirm this is a deliberately fake record and the address is controlled for testing.</span>
          </label>
          <AdmissionsRecordSubmitButton>
            <ShieldCheck size={14} aria-hidden="true" /> Mark as pilot test record
          </AdmissionsRecordSubmitButton>
        </form>
      )}

      {emailMode === "live" ? <p className={styles.pilotWarning}>Live email mode does not require a pilot marker. Return delivery to pilot mode before conducting a controlled test.</p> : null}
      {state.message ? <p className={state.status === "error" ? styles.formError : styles.formSuccess} role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
      <p className={styles.helpText}>Pilot delivery still requires both this marker and an allowlisted current address. The marker never changes genuine contact or academic data.</p>
    </div>
  );
}
