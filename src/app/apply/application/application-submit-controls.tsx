"use client";

import { useEffect, useRef, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { submitApplication } from "@/app/apply/application/actions";

export function ApplicationSubmitControls({
  applicationId,
  declarationText
}: {
  applicationId?: string;
  declarationText: string;
}) {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);

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
            <div className="application-submit-form">
              <input type="hidden" name="application_id" value={applicationId} />
              <label className="check-option inline-check">
                <input name="declaration_accepted" type="checkbox" required disabled={hasUnsavedChanges} /> I accept this declaration
              </label>
              <button className="button primary apply-submit" formAction={submitApplication} disabled={hasUnsavedChanges}>
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
