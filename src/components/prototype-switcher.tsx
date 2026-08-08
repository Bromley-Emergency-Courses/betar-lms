"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export type PrototypeVariant = {
  key: string;
  name: string;
};

export function PrototypeSwitcher({
  variants,
  current
}: {
  variants: PrototypeVariant[];
  current: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function move(direction: -1 | 1) {
    const currentIndex = Math.max(0, variants.findIndex((variant) => variant.key === current));
    const nextIndex = (currentIndex + direction + variants.length) % variants.length;
    const params = new URLSearchParams(searchParams.toString());
    params.set("variant", variants[nextIndex].key);
    router.replace(`?${params.toString()}`);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) {
        return;
      }
      if (event.key === "ArrowLeft") {
        move(-1);
      }
      if (event.key === "ArrowRight") {
        move(1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const active = variants.find((variant) => variant.key === current) ?? variants[0];

  return (
    <div className="prototype-switcher" role="group" aria-label="Prototype variants">
      <button type="button" onClick={() => move(-1)} aria-label="Previous prototype variant">
        <ArrowLeft size={16} />
      </button>
      <span>
        <strong>{active.key}</strong> — {active.name}
      </span>
      <button type="button" onClick={() => move(1)} aria-label="Next prototype variant">
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
