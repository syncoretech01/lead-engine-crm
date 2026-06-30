"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

type SubmitButtonProps = {
  children: ReactNode;
  /** Shown (and announced) while the form action is in flight. */
  pendingLabel?: string;
  className?: string;
  /** Extra disabled condition OR'd with the pending state. */
  disabled?: boolean;
};

// Submit button that reflects the parent <form>'s pending state via
// useFormStatus: it disables itself and swaps to `pendingLabel` while the server
// action runs. This gives users immediate "in-progress" feedback so they don't
// refresh mid-action (which would abort the write). Must be rendered inside a
// <form>.
export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  className = "button primary",
  disabled = false
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
