"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { CommandPalette } from "@/components/command-palette";
import { UserMenu } from "@/components/user-menu";
import { WorkspaceSwitcher, type WorkspaceOption } from "@/components/workspace-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger
} from "@/components/ui/sidebar";
import { syncoreBrand } from "@/lib/brand";
import { accessibleNav, findActiveNav, resolveNavLabel } from "@/lib/navigation";
import type { Session } from "@/lib/phase1/types";

type AppShellProps = {
  children: React.ReactNode;
  session: Session;
  workspaces: WorkspaceOption[];
  defaultSidebarOpen?: boolean;
};

export function AppShell({ children, session, workspaces, defaultSidebarOpen = true }: AppShellProps) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  const groups = React.useMemo(() => accessibleNav(session), [session]);
  const activeHref = findActiveNav(pathname, session)?.item.href ?? null;

  // ⌘K / Ctrl+K opens the command palette (the sidebar owns ⌘B for collapse).
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-md px-1 py-2 transition-colors hover:bg-white/5"
          >
            <Image
              src={syncoreBrand.logo.logomark}
              alt=""
              width={32}
              height={32}
              className="size-8 shrink-0 rounded-md"
              priority
            />
            <span className="truncate text-sm font-semibold tracking-tight text-white group-data-[collapsible=icon]:hidden">
              {syncoreBrand.shortName}
            </span>
          </Link>
          <WorkspaceSwitcher
            currentWorkspaceId={session.workspace.id}
            currentWorkspaceName={session.workspace.name}
            workspaces={workspaces}
          />
        </SidebarHeader>

        <SidebarContent>
          {groups.map(({ group, items }) => (
            <SidebarGroup key={group.id}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const Icon = item.icon;
                    const label = resolveNavLabel(item, session);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild isActive={item.href === activeHref} tooltip={label}>
                          <Link href={item.href}>
                            <Icon aria-hidden="true" />
                            <span>{label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <UserMenu session={session} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="bg-[var(--bg-subtle)]">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4">
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
          <AppBreadcrumbs session={session} />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-auto inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-sm text-muted-foreground transition-colors hover:bg-[var(--bg-subtle)]"
            aria-label="Search or jump to a page"
          >
            <Search className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Search or jump to…</span>
            <kbd className="ml-4 hidden rounded border border-[var(--border-default)] bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground sm:inline">
              ⌘K
            </kbd>
          </button>
        </header>

        <div className="content" style={{ overflow: "visible" }}>
          {children}
        </div>
      </SidebarInset>

      <CommandPalette session={session} open={paletteOpen} onOpenChange={setPaletteOpen} />
    </SidebarProvider>
  );
}
