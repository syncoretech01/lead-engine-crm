"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { CommandPalette } from "@/components/command-palette";
import { UserMenu } from "@/components/user-menu";
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
import { useFocusSession } from "@/components/crm/cockpit/focus/use-focus-session";
import { syncoreBrand } from "@/lib/brand";
import { accessibleNav, findActiveNav, resolveNavLabel } from "@/lib/navigation";
import type { Session } from "@/lib/phase1/types";

type AppShellProps = {
  children: React.ReactNode;
  session: Session;
  defaultSidebarOpen?: boolean;
  /** The signed-in user's RingCentral number, shown in the top bar. */
  ringCentralLabel?: string | null;
};

export function AppShell({ children, session, defaultSidebarOpen = true, ringCentralLabel = null }: AppShellProps) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const focusSession = useFocusSession();

  const groups = React.useMemo(() => accessibleNav(session), [session]);
  const activeHref = findActiveNav(pathname, session)?.item.href ?? null;

  // Auto-collapse the sidebar to the icon rail on the Focus cockpit (it needs the
  // width), and re-expand on any other route — controlled via the shadcn provider.
  // Route transitions adjust the open state during render (React's blessed pattern
  // for deriving state from a changing prop) so the SDR can still re-open it while
  // in Focus without it being forced back.
  const inFocus = pathname.startsWith("/sdr/focus");
  const [sidebarOpen, setSidebarOpen] = React.useState(!inFocus && defaultSidebarOpen);
  const [prevInFocus, setPrevInFocus] = React.useState(inFocus);
  if (inFocus !== prevInFocus) {
    setPrevInFocus(inFocus);
    setSidebarOpen(!inFocus && defaultSidebarOpen);
  }

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
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
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

      <SidebarInset
        className={`bg-[var(--bg-subtle)] ${inFocus ? "h-dvh min-h-0 overflow-hidden" : ""}`}
      >
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4">
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
          <AppBreadcrumbs session={session} />
          {focusSession.active ? (
            <span className="hidden h-7 items-center gap-1.5 rounded-full border border-[var(--teal-700)]/35 bg-[var(--teal-700)]/10 px-2.5 sm:flex">
              <span className="relative flex size-2" aria-hidden="true">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--teal-700)] opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-[var(--teal-700)]" />
              </span>
              <span className="text-[11.5px] font-bold text-[var(--teal-700)]">
                Session · {focusSession.completedCount}/{focusSession.total || "—"}
              </span>
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-3">
            {ringCentralLabel ? (
              <span className="hidden text-[11.5px] font-medium text-muted-foreground md:inline">
                RC · {ringCentralLabel}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-sm text-muted-foreground transition-colors hover:bg-[var(--bg-subtle)]"
              aria-label="Search or jump to a page"
            >
              <Search className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Search or jump to…</span>
              <kbd className="ml-4 hidden rounded border border-[var(--border-default)] bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground sm:inline">
                ⌘K
              </kbd>
            </button>
          </div>
        </header>

        <div
          className={inFocus ? "min-h-0 flex-1 overflow-hidden" : "content"}
          style={inFocus ? undefined : { overflow: "visible" }}
        >
          {children}
        </div>
      </SidebarInset>

      <CommandPalette session={session} open={paletteOpen} onOpenChange={setPaletteOpen} />
    </SidebarProvider>
  );
}
