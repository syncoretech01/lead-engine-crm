"use client";

import * as React from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";

/**
 * Attio-style side peek: a right sheet fed entirely by row data the table
 * already has (no fetch), with a link to the full record. Reusable across
 * record types — pass the entity-specific body as children.
 */
export function RecordPeek({
  open,
  onOpenChange,
  title,
  description,
  children
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="flex h-full flex-col overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
