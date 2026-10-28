"use client";

import { useState, type ReactNode } from "react";

export function DeferredDetails({ id, className, summaryClassName, defaultOpen = false, summary, children }: { id?: string; className?: string; summaryClassName?: string; defaultOpen?: boolean; summary: ReactNode; children: ReactNode }) {
  const [opened, setOpened] = useState(defaultOpen);
  return <details id={id} className={className} open={defaultOpen} onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className={summaryClassName}>{summary}</summary>
    {opened ? children : null}
  </details>;
}
