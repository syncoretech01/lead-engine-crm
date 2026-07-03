"use client";

import Link from "next/link";
import { ChevronsUpDown, LogOut, Settings } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { canUseDeveloperWorkspace, workspaceRoleLabel } from "@/lib/phase1/auth";
import type { Session } from "@/lib/phase1/types";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]!}${parts[parts.length - 1]![0]!}`.toUpperCase();
}

export function UserMenu({ session }: { session: Session }) {
  const { isMobile } = useSidebar();
  const canManageWorkspace = canUseDeveloperWorkspace(session);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <Avatar className="size-8 rounded-lg">
            <AvatarFallback className="rounded-lg bg-white text-xs font-semibold text-[var(--syn-primary)]">
              {initials(session.user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium text-white">{session.user.name}</span>
            <span className="truncate text-xs text-white/70">{workspaceRoleLabel(session.role)}</span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 text-white/70" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
        side={isMobile ? "bottom" : "right"}
        align="end"
        sideOffset={4}
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{session.user.name}</span>
            <span className="truncate text-xs text-muted-foreground">{session.user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canManageWorkspace ? (
          <DropdownMenuItem asChild>
            <Link href="/compliance">
              <Settings aria-hidden="true" />
              Settings
            </Link>
          </DropdownMenuItem>
        ) : null}
        {/* Logout stays a server POST (no-JS) so auth/redirect semantics are unchanged. */}
        <form action="/auth/logout" method="post" className="w-full">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut aria-hidden="true" />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
