"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";

export function WorkspaceAppMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--workspace-app-height", `${element.getBoundingClientRect().height}px`);
    });
    observer.observe(element);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--workspace-app-height"); };
  }, []);

  return <div className="workspace-app-menu" onKeyDown={event => {
    if (event.key === "Escape" && open) { setOpen(false); trigger.current?.focus(); }
  }}>
    <div className="workspace-app-menu-bar" ref={bar}>
      <span><strong>BETAR LMS</strong><small>Student workspace</small></span>
      <button ref={trigger} type="button" className="button" aria-expanded={open} aria-controls="workspace-app-navigation" onClick={event => { event.currentTarget.focus(); setOpen(value => !value); }}>
        {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />} App menu
      </button>
    </div>
    <div id="workspace-app-navigation" className="workspace-app-menu-content" hidden={!open} onClick={event => {
      if ((event.target as HTMLElement).closest("a")) setOpen(false);
    }}>{children}</div>
  </div>;
}
