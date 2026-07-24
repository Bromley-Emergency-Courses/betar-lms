"use client";

import { ExternalLink } from "lucide-react";
import { useState, useTransition } from "react";

export function DocumentOpenButton({ fileId }: { fileId?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openDocument() {
    if (!fileId) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/admin/documents/${fileId}/signed-url`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ download: false, expiresInSeconds: 300 })
      });
      const payload = (await response.json().catch(() => null)) as { signedUrl?: string; message?: string } | null;

      if (!response.ok || !payload?.signedUrl) {
        setError(payload?.message ?? "Document could not be opened.");
        return;
      }

      window.open(payload.signedUrl, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <span className="document-open-control">
      <button className="button secondary" type="button" onClick={openDocument} disabled={!fileId || isPending}>
        <ExternalLink size={16} />
        {isPending ? "Opening" : "Open"}
      </button>
      {error ? <span className="muted small">{error}</span> : null}
    </span>
  );
}
