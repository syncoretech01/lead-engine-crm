"use client";

import * as React from "react";
import { X } from "lucide-react";

// Shared cockpit slide-over peek — a 440px full-height right panel with a scrim,
// Esc-to-close, and a header / scrollable body / footer, matching the SDR Cockpit
// prototype. Records pages open it from a row (fed by row data, zero fetch).
export function CoPeek({
  open,
  onClose,
  title,
  subtitle,
  badges,
  footer,
  children
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badges?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-[rgba(2,6,38,0.35)]" onClick={onClose} aria-hidden="true" />
      <div className="co-anim-in absolute right-0 top-0 flex h-full w-[440px] max-w-[92vw] flex-col bg-white shadow-[-14px_0_36px_rgba(2,6,38,0.2)]">
        <div className="flex items-start justify-between gap-3 border-b border-co-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[16px] font-extrabold leading-tight text-co-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 truncate text-[12px] text-co-text-3">{subtitle}</p> : null}
            {badges ? <div className="mt-2 flex flex-wrap gap-1.5">{badges}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-md p-1 text-co-muted transition-colors hover:bg-co-sunken hover:text-co-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="border-t border-co-border bg-co-sunken px-5 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

export function CoPeekSummary({ children }: { children: React.ReactNode }) {
  return <p className="pb-1 text-[12.5px] leading-relaxed text-co-text-2">{children}</p>;
}

export function CoPeekSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-co-divider py-3.5">
      <h3 className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-muted">{label}</h3>
      {children}
    </section>
  );
}

export function CoPeekRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="shrink-0 text-[12px] text-co-text-3">{label}</span>
      <span className="min-w-0 text-right text-[12.5px] font-semibold text-co-ink">{value || <span className="text-co-muted-2">—</span>}</span>
    </div>
  );
}
