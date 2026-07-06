"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, CircleDollarSign, User } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from "@/components/ui/command";
import { THEME_OPTIONS } from "@/components/theme-menu-items";
import { useTheme } from "@/hooks/use-theme";
import { accessibleNav, resolveNavLabel } from "@/lib/navigation";
import { searchCrmRecordsAction, type CrmSearchResults } from "@/app/crm/search-actions";
import type { Session } from "@/lib/phase1/types";

type CommandPaletteProps = {
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EMPTY_RESULTS: CrmSearchResults = { contacts: [], companies: [], opportunities: [] };

/**
 * ⌘K / Ctrl+K palette. Navigates permission-filtered pages, toggles theme, and
 * (for CRM users) searches contacts / accounts / opportunities by name via a
 * debounced server action that reuses the list SDR-scoping.
 */
export function CommandPalette({ session, open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const groups = React.useMemo(() => accessibleNav(session), [session]);
  const canSearchRecords = session.permissions.includes("manage_crm");

  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<CrmSearchResults>(EMPTY_RESULTS);
  const [, startTransition] = React.useTransition();

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) setQuery("");
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const go = React.useCallback(
    (href: string) => {
      handleOpenChange(false);
      router.push(href);
    },
    [handleOpenChange, router]
  );

  // Debounced record search. Runs only for CRM users and 2+ char queries.
  const searchable = canSearchRecords && query.trim().length >= 2;
  React.useEffect(() => {
    if (!searchable) return;
    const handle = setTimeout(() => {
      startTransition(async () => {
        try {
          setResults(await searchCrmRecordsAction(query));
        } catch {
          setResults(EMPTY_RESULTS);
        }
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [query, searchable]);

  // Only show records while a query is active; stale results stay hidden.
  const hasRecords =
    searchable &&
    results.contacts.length + results.companies.length + results.opportunities.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Search"
      description="Search records, jump to pages, or change the theme."
      shouldFilter={!hasRecords}
    >
      <CommandInput
        placeholder={canSearchRecords ? "Search records or jump to a page…" : "Jump to a page…"}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        {hasRecords ? (
          <>
            {results.contacts.length > 0 ? (
              <CommandGroup heading="Contacts">
                {results.contacts.map((contact) => (
                  <CommandItem
                    key={contact.id}
                    value={`contact-${contact.id}`}
                    onSelect={() => go(`/crm/contacts/${contact.id}`)}
                  >
                    <User aria-hidden="true" />
                    <span>{contact.name}</span>
                    {contact.email ? (
                      <span className="ml-auto text-xs text-muted-foreground">{contact.email}</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.companies.length > 0 ? (
              <CommandGroup heading="Accounts">
                {results.companies.map((company) => (
                  <CommandItem
                    key={company.id}
                    value={`company-${company.id}`}
                    onSelect={() => go(`/crm/accounts/${company.id}`)}
                  >
                    <Building2 aria-hidden="true" />
                    <span>{company.name}</span>
                    {company.domain ? (
                      <span className="ml-auto text-xs text-muted-foreground">{company.domain}</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.opportunities.length > 0 ? (
              <CommandGroup heading="Opportunities">
                {results.opportunities.map((opportunity) => (
                  <CommandItem
                    key={opportunity.id}
                    value={`opportunity-${opportunity.id}`}
                    onSelect={() => go(`/crm/accounts/${opportunity.companyId}`)}
                  >
                    <CircleDollarSign aria-hidden="true" />
                    <span>{opportunity.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{opportunity.stage}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandSeparator />
          </>
        ) : null}

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
        <CommandGroup heading="Theme">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <CommandItem
                key={option.pref}
                value={`Theme ${option.label}`}
                onSelect={() => {
                  setTheme(option.pref);
                  onOpenChange(false);
                }}
              >
                <Icon aria-hidden="true" />
                <span>{option.label} theme</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
