"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import styles from "./prototype-switcher.module.css";

export function PrototypeSwitcher({ current, variants, onChange }: {
  current: string;
  variants: { key: string; name: string }[];
  onChange?: (key: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const index = Math.max(0, variants.findIndex((variant) => variant.key === current));

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (document.querySelector("dialog[open]")) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, button, [contenteditable], [role=region], [role=slider], [role=tablist], [role=radiogroup]")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next = (index + (event.key === "ArrowLeft" ? -1 : 1) + variants.length) % variants.length;
      const params = new URLSearchParams(searchParams.toString());
      params.set("variant", variants[next].key);
      onChange?.(variants[next].key);
      router.replace(`${pathname}?${params}`, { scroll: false });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, pathname, router, searchParams, variants, onChange]);

  function cycle(direction: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("variant", variants[(index + direction + variants.length) % variants.length].key);
    onChange?.(variants[(index + direction + variants.length) % variants.length].key);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }

  if (process.env.NODE_ENV === "production") return null;

  return <aside className={styles.switcher} aria-label="Prototype variants">
    <button type="button" aria-label="Previous layout" onClick={() => cycle(-1)}><ChevronLeft size={18} /></button>
    <span aria-live="polite"><small>PROTOTYPE</small>{current} · {variants[index].name}</span>
    <button type="button" aria-label="Next layout" onClick={() => cycle(1)}><ChevronRight size={18} /></button>
  </aside>;
}
