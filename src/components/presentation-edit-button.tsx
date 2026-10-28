"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { loadWorkspaceTeaching } from "@/app/students/teaching-actions";
import type { TeachingOptions } from "@/lib/student-teaching";
import { TeachingDialog } from "./student-teaching";

export function PresentationEditButton({ studentId, offeringId }: { studentId: string; offeringId: string }) {
  const [options, setOptions] = useState<TeachingOptions | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function open() {
    setPending(true); setMessage("");
    try {
      const result = await loadWorkspaceTeaching(studentId);
      if (!result.ok) { setMessage(result.error); return; }
      const presentations = result.options.presentations?.filter(offering => offering.id === offeringId && offering.ownScore && !offering.ownScore.requiresReview) ?? [];
      if (!presentations.length) { setMessage("Your submission is no longer editable. Refresh to review its status."); return; }
      setOptions({ ...result.options, presentations });
    } catch { setMessage("Your submission could not be loaded. Please try again."); }
    finally { setPending(false); }
  }
  return <><button type="button" style={{ minHeight: 44, fontSize: 16 }} disabled={pending} onClick={open}>Edit your score</button>{message ? <p role="status">{message}</p> : null}{options ? createPortal(<TeachingDialog studentId={studentId} kind="presentation" options={options} termId={null} close={() => setOptions(null)} saved={value => { setOptions(null); setMessage(value); }} />, document.body) : null}</>;
}
