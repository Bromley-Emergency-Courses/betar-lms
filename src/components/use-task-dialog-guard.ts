"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function useTaskDialogGuard(close: () => void) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const dirtyRef = useRef(false);
  const pendingRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [exitTarget, setExitTarget] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    const originalUrl = window.location.href;
    const originalState = window.history.state;
    function beforeUnload(event: BeforeUnloadEvent) {
      if (dirtyRef.current || pendingRef.current) { event.preventDefault(); event.returnValue = ""; }
    }
    function popState(event: PopStateEvent) {
      if (!dirtyRef.current && !pendingRef.current) return;
      const target = window.location.href;
      event.stopImmediatePropagation();
      window.history.pushState(originalState, "", originalUrl);
      if (!pendingRef.current) setExitTarget(target);
    }
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const restoreWebKitTraversal = window.navigator.vendor === "Apple Computer, Inc.";
    function beforeNavigate(event: Event) {
      const navigationEvent = event as Event & { destination: { url: string; sameDocument: boolean }; navigationType: string };
      if (restoreWebKitTraversal && navigationEvent.navigationType === "traverse" && navigationEvent.destination.sameDocument) return;
      const target = navigationEvent.destination.url;
      if ((!dirtyRef.current && !pendingRef.current) || target === originalUrl || !event.cancelable) return;
      event.preventDefault();
      if (!pendingRef.current) setExitTarget(target);
    }
    navigation?.addEventListener("navigate", beforeNavigate);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", popState, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", popState, true);
      navigation?.removeEventListener("navigate", beforeNavigate);
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => { if (exitTarget) keepEditing.current?.focus(); }, [exitTarget]);

  function requestClose() {
    if (pendingRef.current) return;
    if (dirtyRef.current) setExitTarget("close");
    else { close(); router.refresh(); }
  }
  function discard() {
    dirtyRef.current = false;
    if (exitTarget && exitTarget !== "close") window.location.assign(exitTarget);
    else { close(); router.refresh(); }
  }
  function markDirty() { dirtyRef.current = true; setDirty(true); }

  return { dialog, keepEditing, dirtyRef, pendingRef, dirty, pending, setPending, exitTarget, setExitTarget, requestClose, discard, markDirty };
}
