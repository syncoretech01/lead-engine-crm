"use client";

import { Building2, Check, ChevronsUpDown } from "lucide-react";

import { switchWorkspaceAction } from "@/app/auth/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";

export type WorkspaceOption = { id: string; name: string };

/**
 * In-app workspace switcher shown in the sidebar header. Re-points the current
 * session to another workspace the user belongs to (no re-login) via the existing
 * `switchWorkspaceAction`. Only renders as a switcher when the user has more than
 * one membership; a single-workspace user just sees the workspace name.
 */
export function WorkspaceSwitcher({
  currentWorkspaceId,
  currentWorkspaceName,
  workspaces
}: {
  currentWorkspaceId: string;
  currentWorkspaceName: string;
  workspaces: WorkspaceOption[];
}) {
  const { isMobile } = useSidebar();

  if (workspaces.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
        <Building2 className="size-4 shrink-0 text-white/60" aria-hidden="true" />
        <span className="truncate text-xs font-medium text-white/75">{currentWorkspaceName}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          tooltip={currentWorkspaceName}
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <Building2 className="size-4 shrink-0 text-white/70" aria-hidden="true" />
          <span className="truncate text-xs font-medium text-white/90 group-data-[collapsible=icon]:hidden">
            {currentWorkspaceName}
          </span>
          <ChevronsUpDown className="ml-auto size-4 text-white/60 group-data-[collapsible=icon]:hidden" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
        side={isMobile ? "bottom" : "right"}
        align="start"
        sideOffset={4}
      >
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Switch workspace
        </DropdownMenuLabel>
        {workspaces.map((workspace) => {
          const isCurrent = workspace.id === currentWorkspaceId;
          return (
            // A server-action form per option (no-JS friendly): re-points the session
            // then redirects. The current workspace is disabled (already active).
            <form key={workspace.id} action={switchWorkspaceAction} className="w-full">
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <DropdownMenuItem asChild>
                <button type="submit" disabled={isCurrent} className="w-full">
                  <Building2 aria-hidden="true" />
                  <span className="truncate">{workspace.name}</span>
                  {isCurrent ? <Check className="ml-auto size-4" aria-hidden="true" /> : null}
                </button>
              </DropdownMenuItem>
            </form>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
