"use client";

import * as React from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-result";

type ActionFormProps = Omit<React.ComponentProps<"form">, "action"> & {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  /** Fallback success text when the action doesn't return its own message. */
  successMessage?: string;
  /** Called after a successful submit (e.g. to reset local state or close a dialog). */
  onSuccess?: () => void;
};

/**
 * A <form> whose server action returns an ActionResult; surfaces a success or
 * error toast automatically. Actions gain the (prev, formData) signature only
 * when their screen is migrated — see lib/action-result.ts. Server components
 * pass the action straight through as a prop (server actions are serializable).
 *
 * The action is invoked directly inside the form-action handler (rather than via
 * useActionState) so the toast fires from the awaited result — a closure that
 * completes even when the action's revalidatePath refreshes the tree or removes
 * the row this form lives in. React runs `action` props inside a transition.
 */
export function ActionForm({
  action,
  successMessage,
  onSuccess,
  children,
  ...formProps
}: ActionFormProps) {
  async function handle(formData: FormData) {
    const result = await action(null, formData);
    if (result.ok) {
      toast.success(result.message ?? successMessage ?? "Saved");
      onSuccess?.();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form action={handle} {...formProps}>
      {children}
    </form>
  );
}
