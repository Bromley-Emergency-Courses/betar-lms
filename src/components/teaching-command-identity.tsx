"use client";

import { useEffect, useRef } from "react";

export function TeachingCommandIdentity() {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = input.current;
    const form = element?.form;
    if (!element || !form) return;
    const renew = () => { element.value = crypto.randomUUID(); };
    const reset = () => queueMicrotask(renew);
    renew();
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, []);
  return <input ref={input} type="hidden" name="command_id" defaultValue="" />;
}
