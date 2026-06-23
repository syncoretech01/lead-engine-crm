"use client";

import { useEffect, useState, type ReactNode } from "react";

const TOAST_EVENT = "syncore:toast";

/** Mounted once on the page; shows a transient confirmation when an action fires. */
export function Toaster() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (!detail) return;
      setMessage(detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 2800);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => {
      window.removeEventListener(TOAST_EVENT, handler);
      clearTimeout(timer);
    };
  }, []);

  if (!message) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="toast-check" aria-hidden="true">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      </span>
      {message}
    </div>
  );
}

/**
 * A submit button that fires an optimistic toast on click. Used inside server-action
 * forms — the click both dispatches the toast and submits the form.
 */
export function ToastButton({
  toast,
  children,
  className = "button primary",
  type = "submit"
}: {
  toast: string;
  children: ReactNode;
  className?: string;
  type?: "submit" | "button";
}) {
  return (
    <button
      type={type}
      className={className}
      onClick={() => window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: toast }))}
    >
      {children}
    </button>
  );
}
