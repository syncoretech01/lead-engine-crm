"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { findActiveNav, resolveNavLabel } from "@/lib/navigation";
import type { Session } from "@/lib/phase1/types";

/**
 * Page-nav trail: an icon anchor + "<Group> › <Section>". On a deeper detail
 * route (e.g. /crm/accounts/[id]) the section becomes a back-link; the record's
 * own name stays the page <h1> (the shell can't see RSC-computed record names).
 * Built as a plain flex nav — not the shadcn <ol>/<li> breadcrumb — because
 * Preflight is off app-wide, so an <ol> would leak a default list marker here.
 */
export function AppBreadcrumbs({ session }: { session: Session }) {
  const pathname = usePathname();
  const active = findActiveNav(pathname, session);

  if (!active) {
    return null;
  }

  const { group, item } = active;
  const Icon = item.icon;
  const label = resolveNavLabel(item, session);
  const onDetailRoute = pathname !== item.href;

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="hidden shrink-0 text-muted-foreground sm:inline">{group.label}</span>
      <ChevronRight
        className="hidden size-3.5 shrink-0 text-muted-foreground/40 sm:inline"
        aria-hidden="true"
      />
      {onDetailRoute ? (
        <Link
          href={item.href}
          className="truncate text-muted-foreground transition-colors hover:text-foreground"
        >
          {label}
        </Link>
      ) : (
        <span className="truncate font-medium text-foreground" aria-current="page">
          {label}
        </span>
      )}
    </nav>
  );
}
