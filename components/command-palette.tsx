"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { accessibleNav, resolveNavLabel } from "@/lib/navigation";
import type { Session } from "@/lib/phase1/types";

type CommandPaletteProps = {
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * ⌘K / Ctrl+K palette. v1 navigates to permission-filtered pages only (no
 * record search — that needs a backend). Uses the same accessibleNav() gate as
 * the sidebar, so it never exposes a route the user cannot reach.
 */
export function CommandPalette({ session, open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const groups = React.useMemo(() => accessibleNav(session), [session]);

  const go = React.useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router]
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to a page"
      description="Search pages and jump to them."
    >
      <CommandInput placeholder="Search or jump to a page…" />
      <CommandList>
        <CommandEmpty>No matching pages.</CommandEmpty>
        {groups.map(({ group, items }) => (
          <CommandGroup key={group.id} heading={group.label}>
            {items.map((item) => {
              const Icon = item.icon;
              const label = resolveNavLabel(item, session);
              return (
                <CommandItem
                  key={item.href}
                  value={`${group.label} ${label}`}
                  onSelect={() => go(item.href)}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
