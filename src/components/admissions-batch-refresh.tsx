"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AdmissionsBatchRefresh({
  active,
  status,
  completed,
  total
}: {
  active: boolean;
  status: string;
  completed: number;
  total: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [active, router]);

  return (
    <span role="status" aria-live="polite" aria-atomic="true">
      {status} · {completed} of {total} complete
    </span>
  );
}
