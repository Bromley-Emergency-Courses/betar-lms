"use client";

import { useEffect, useRef, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { submitApplication } from "@/app/apply/application/actions";

export function ApplicationSubmitControls({
  applicationId,
  declarationText,
  applicationDeadlineAt,
  applicationDeadlinePassed
}: {
  applicationId?: string;
  declarationText: string;
  applicationDeadlineAt?: string;
  applicationDeadlinePassed: boolean;
}) {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const deadlinePassed = !applicationDeadlineAt || applicationDeadlinePassed;

  useEffect(() => {
    const form = controlsRef.current?.closest("form");
    if (!form) {
      return;
    }

    const markUnsaved = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-application-submit-controls]")) {
        return;
      }

      setHasUnsavedChanges(true);
    };

    form.addEventListener("input", markUnsaved);
    form.addEventListener("change", markUnsaved);

    return () => {
      form.removeEventListener("input", markUnsaved);
      form.removeEventListener("change", markUnsaved);
    };
  }, []);

  return (
    <div ref={controlsRef} data-application-submit-controls className="application-actions">
      <div className="application-preview-box">
        <strong>{applicationId ? "Final declaration" : "Preview before submission"}</strong>
        {applicationId ? (
          <>
            <p className="muted small">{declarationText}</p>
            {hasUnsavedChanges ? (
              <p className="muted small" role="status">
                Save your latest changes before submitting.
              </p>
            ) : null}
            {deadlinePassed ? <p className="muted small" role="status">Final submission is unavailable until admissions sets or extends the cohort deadline. You can still save this draft.</p> : null}
            <div className="application-submit-form">
              <input type="hidden" name="application_id" value={applicationId} />
              <label className="check-option inline-check">
                <input name="declaration_accepted" type="checkbox" required disabled={hasUnsavedChanges || deadlinePassed} /> I accept this declaration
              </label>
              <button className="button primary apply-submit" formAction={submitApplication} disabled={hasUnsavedChanges || deadlinePassed}>
                <ShieldCheck size={16} />
                Submit application
              </button>
            </div>
          </>
        ) : (
          <p className="muted small">Save a draft before completing the final declaration.</p>
        )}
      </div>

      <button className="button primary apply-submit" formNoValidate>
        <Save size={16} />
        Save draft
      </button>
    </div>
  );
}
