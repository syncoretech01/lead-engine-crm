"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";

/**
 * Kept for API compatibility with the build-list pages. The global <Toaster />
 * now lives in app/layout.tsx (sonner), so this mount is a no-op.
 */
export function Toaster() {
  return null;
}

/**
 * A submit button that fires a confirmation toast on click. Used inside
 * server-action forms — the click both dispatches the toast and submits the
 * form. Now backed by sonner instead of the bespoke CustomEvent toaster.
 */
export function ToastButton({
  toast: message,
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
    <button type={type} className={className} onClick={() => toast.success(message)}>
      {children}
    </button>
  );
}
