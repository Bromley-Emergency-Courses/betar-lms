"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";

type AttendanceFormAction = (formData: FormData) => Promise<void>;

interface RegisteredDirtyForm {
  isDirty: () => boolean;
  save: () => Promise<void>;
}

interface UnsavedChangesContextValue {
  registerForm: (id: string, form: RegisteredDirtyForm) => () => void;
}

interface DirtyFormContextValue {
  dirty: boolean;
  pending: boolean;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);
const DirtyFormContext = createContext<DirtyFormContextValue | null>(null);

function formSignature(form: HTMLFormElement): string {
  return Array.from(new FormData(form).entries())
    .filter(([key]) => !key.startsWith("__attendance_"))
    .map(([key, entry]) => `${key}=${entry instanceof File ? entry.name : String(entry)}`)
    .sort()
    .join("&");
}

function isPlainNavigationClick(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !anchor.target &&
    !anchor.hasAttribute("download")
  );
}

export function AttendanceUnsavedChangesBoundary({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const formsRef = useRef(new Map<string, RegisteredDirtyForm>());
  const currentHrefRef = useRef("");
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registerForm = useCallback((id: string, form: RegisteredDirtyForm) => {
    formsRef.current.set(id, form);
    return () => {
      formsRef.current.delete(id);
    };
  }, []);

  const contextValue = useMemo(() => ({ registerForm }), [registerForm]);

  const dirtyForms = useCallback(() => {
    return Array.from(formsRef.current.values()).filter((form) => form.isDirty());
  }, []);

  const saveDirtyForms = useCallback(async () => {
    const forms = dirtyForms();
    if (forms.length === 0) {
      return;
    }
    await Promise.all(forms.map((form) => form.save()));
  }, [dirtyForms]);

  const continueToHref = useCallback(
    (href: string) => {
      const url = new URL(href, window.location.href);
      if (url.origin === window.location.origin) {
        currentHrefRef.current = url.href;
        router.push(`${url.pathname}${url.search}${url.hash}`);
      } else {
        window.location.href = url.href;
      }
    },
    [router]
  );

  useEffect(() => {
    currentHrefRef.current = window.location.href;
  }, [pathname, searchKey]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (dirtyForms().length === 0) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }

    function handleDocumentClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || !isPlainNavigationClick(event, anchor)) {
        return;
      }
      const href = anchor.href;
      if (href === window.location.href || dirtyForms().length === 0) {
        return;
      }
      event.preventDefault();
      setError(null);
      setPendingHref(href);
    }

    function handlePopState() {
      const targetHref = window.location.href;
      const currentHref = currentHrefRef.current;
      if (!currentHref || targetHref === currentHref) {
        return;
      }
      if (dirtyForms().length === 0) {
        currentHrefRef.current = targetHref;
        return;
      }
      window.history.pushState(window.history.state, "", currentHref);
      setError(null);
      setPendingHref(targetHref);
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);
    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [dirtyForms]);

  async function saveAndContinue() {
    if (!pendingHref) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveDirtyForms();
      continueToHref(pendingHref);
      setPendingHref(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Changes could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <UnsavedChangesContext.Provider value={contextValue}>
      {children}
      {pendingHref ? (
        <div className="attendance-unsaved-backdrop" role="presentation">
          <div className="attendance-unsaved-dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-unsaved-title">
            <h2 id="attendance-unsaved-title">Unsaved attendance changes</h2>
            <p>Save your changes before leaving this page?</p>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="attendance-unsaved-actions">
              <button className="button primary" type="button" onClick={saveAndContinue} disabled={saving}>
                {saving ? "Saving..." : "Save changes"}
              </button>
              <button
                className="button"
                type="button"
                onClick={() => {
                  continueToHref(pendingHref);
                  setPendingHref(null);
                }}
                disabled={saving}
              >
                Leave without saving
              </button>
              <button className="button" type="button" onClick={() => setPendingHref(null)} disabled={saving}>
                Stay here
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </UnsavedChangesContext.Provider>
  );
}

export function AttendanceDirtyForm({
  action,
  className,
  children
}: {
  action: AttendanceFormAction;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const router = useRouter();
  const unsavedChanges = useContext(UnsavedChangesContext);
  const formRef = useRef<HTMLFormElement>(null);
  const baselineRef = useRef("");
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateDirtyState = useCallback(() => {
    const form = formRef.current;
    if (!form) {
      return false;
    }
    const nextDirty = formSignature(form) !== baselineRef.current;
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
    return nextDirty;
  }, []);

  const save = useCallback(async () => {
    const form = formRef.current;
    if (!form || !updateDirtyState()) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await action(new FormData(form));
      baselineRef.current = formSignature(form);
      dirtyRef.current = false;
      setDirty(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Changes could not be saved.");
      throw caught;
    } finally {
      setPending(false);
    }
  }, [action, router, updateDirtyState]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) {
      return;
    }
    baselineRef.current = formSignature(form);
    dirtyRef.current = false;
    setDirty(false);
  }, []);

  useEffect(() => {
    return unsavedChanges?.registerForm(id, {
      isDirty: () => dirtyRef.current,
      save
    });
  }, [id, save, unsavedChanges]);

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save();
  }

  return (
    <DirtyFormContext.Provider value={{ dirty, pending }}>
      <form ref={formRef} className={className} onChange={updateDirtyState} onInput={updateDirtyState} onSubmit={submitForm}>
        {children}
        {error ? <p className="form-error attendance-form-error">{error}</p> : null}
      </form>
    </DirtyFormContext.Provider>
  );
}

export function AttendanceDirtySubmitButton({
  children,
  className = "button",
  primary = false
}: {
  children: ReactNode;
  className?: string;
  primary?: boolean;
}) {
  const dirtyForm = useContext(DirtyFormContext);
  const visible = dirtyForm?.dirty ?? true;
  const pending = dirtyForm?.pending ?? false;

  if (!visible) {
    return null;
  }

  return (
    <button className={primary ? `${className} primary` : className} type="submit" disabled={pending}>
      {pending ? "Saving..." : children}
    </button>
  );
}
