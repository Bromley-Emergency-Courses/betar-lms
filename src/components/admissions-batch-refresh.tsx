"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AdmissionsBatchRefresh({
  batchId,
  active,
  status,
  completed,
  total
}: {
  batchId: string;
  active: boolean;
  status: string;
  completed: number;
  total: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const resume = () => {
      void fetch(`/api/admissions/batches/${batchId}/resume`, { method: "POST" });
    };
    resume();
    const interval = window.setInterval(() => {
      resume();
      router.refresh();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [active, batchId, router]);

  return (
    <span role="status" aria-live="polite" aria-atomic="true">
      {status} · {completed} of {total} complete
    </span>
  );
}
