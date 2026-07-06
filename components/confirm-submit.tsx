"use client";

import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Button, type buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";

type ConfirmSubmitProps = {
  /** Trigger button label. */
  children: React.ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Tone of the confirm button (default: destructive). */
  confirmVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerSize?: VariantProps<typeof buttonVariants>["size"];
  className?: string;
  disabled?: boolean;
};

/**
 * A destructive-action confirmation for native server-action forms. Renders its
 * own submit trigger inside the surrounding <form>; on confirm it submits that
 * form (requestSubmit) so the existing server action runs unchanged. Wrap it in
 * the <form action={deleteFooAction}> that owns the hidden inputs.
 */
export function ConfirmSubmit({
  children,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "destructive",
  triggerVariant = "ghost",
  triggerSize = "sm",
  className,
  disabled
}: ConfirmSubmitProps) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const submitOwningForm = () => {
    triggerRef.current?.form?.requestSubmit();
  };

  return (
    <AlertDialog>
      {/* type="button" so opening the dialog never submits the form itself. */}
      <AlertDialogTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant={triggerVariant}
          size={triggerSize}
          className={className}
          disabled={disabled}
        >
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={submitOwningForm}
            className={confirmVariant === "destructive" ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
