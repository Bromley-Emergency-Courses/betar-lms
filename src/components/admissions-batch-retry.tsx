"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/components/admissions-workspace.module.css";

export function AdmissionsBatchRetry({ batchId, failedCount }: { batchId: string; failedCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    if (!window.confirm(`Retry only the ${failedCount} failed record${failedCount === 1 ? "" : "s"}? Successful and excluded records will not be repeated.`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admissions/batches/${batchId}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request_key: crypto.randomUUID() })
      });
      const result = await response.json() as { batchId?: string; error?: string };
      if (!response.ok || !result.batchId) throw new Error(result.error ?? "The failed records could not be retried.");
      router.push(`/admissions/batches/${result.batchId}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The failed records could not be retried.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.retryAction}>
      <button className={styles.secondaryButton} type="button" onClick={retry} disabled={busy}>
        <RotateCcw size={13} /> {busy ? "Queueing retry…" : `Retry ${failedCount} failed`}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}
