"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "@/components/ui/breadcrumb";
import { findActiveNav, resolveNavLabel } from "@/lib/navigation";
import type { Session } from "@/lib/phase1/types";

/**
 * Breadcrumb trail: "<Group> › <Section>". The active nav item is the current
 * page (BreadcrumbPage) on its own route, or a back-link to the section list
 * when we're on a deeper detail route (e.g. /crm/accounts/[id]). The record's
 * own name stays the page <h1> via each page's PageHeader — the shell can't see
 * RSC-computed record names, so it intentionally doesn't render them here.
 */
export function AppBreadcrumbs({ session }: { session: Session }) {
  const pathname = usePathname();
  const active = findActiveNav(pathname, session);

  if (!active) {
    return null;
  }

  const { group, item } = active;
  const label = resolveNavLabel(item, session);
  const onDetailRoute = pathname !== item.href;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="text-muted-foreground">{group.label}</BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {onDetailRoute ? (
            <BreadcrumbLink asChild>
              <Link href={item.href}>{label}</Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>{label}</BreadcrumbPage>
          )}
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
