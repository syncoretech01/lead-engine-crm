"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { updateContactDetailsAction } from "@/app/actions";

type InlineFieldProps = {
  contactId: string;
  field: "name" | "email" | "phone";
  value: string;
  label: string;
  canEdit: boolean;
  type?: "text" | "email" | "tel";
  placeholder?: string;
};

/**
 * Click-to-edit contact field. Saves a single field via the presence-based
 * updateContactDetailsAction with an optimistic value; useOptimistic reverts to
 * the server value automatically when the transition settles (on error it never
 * commits, so the revert is the failure UX). Read-only when the user can't edit.
 */
export function InlineField({
  contactId,
  field,
  value,
  label,
  canEdit,
  type = "text",
  placeholder
}: InlineFieldProps) {
  const [editing, setEditing] = React.useState(false);
  const [optimistic, setOptimistic] = React.useOptimistic(value);
  const [, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = (raw: string) => {
    const next = raw.trim();
    setEditing(false);
    if (next === value) return;
    startTransition(async () => {
      setOptimistic(next);
      try {
        const fd = new FormData();
        fd.set("contactId", contactId);
        fd.set(field, next);
        await updateContactDetailsAction(fd);
        toast.success(`${label} updated`);
      } catch {
        toast.error(`Couldn't update ${label.toLowerCase()}`);
      }
    });
  };

  if (!canEdit) {
    return <span className="text-sm text-foreground">{optimistic || "—"}</span>;
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        type={type}
        defaultValue={optimistic}
        placeholder={placeholder}
        className="h-8 w-full max-w-xs"
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "group inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-sm text-foreground transition-colors hover:bg-muted",
        !optimistic && "text-muted-foreground"
      )}
    >
      {optimistic || "Add…"}
      <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden="true" />
    </button>
  );
}
