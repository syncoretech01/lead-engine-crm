import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Building2,
  CalendarDays,
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  Crosshair,
  Database,
  Download,
  Gem,
  GitMerge,
  Layers,
  LayoutDashboard,
  Megaphone,
  PhoneCall,
  PlugZap,
  ShieldCheck,
  Sparkles,
  Target,
  UserCog,
  Users,
  Workflow
} from "lucide-react";
import {
  canUseCrmWorkspace,
  canUseDeveloperWorkspace,
  canUseLeadGenerationWorkspace
} from "@/lib/phase1/auth";
import type { Permission, Session, WorkspaceRole } from "@/lib/phase1/types";

/**
 * Single source of truth for the primary navigation. Extracted from the shell
 * so the sidebar, command palette, and breadcrumbs share identical grouping and
 * access rules. The access model is intentionally IDENTICAL to the pre-redesign
 * shell (dual gate: the session must hold the item's `permission` AND the item
 * must be visible for the session's role); only the presentation changed — from
 * one-workspace-view-at-a-time to all accessible groups shown together.
 *
 * The "Admin" group is the former "Developer" workspace view, renamed in the UI
 * only (the WorkspaceRole "Admin" value, the `manage_workspace` permission, and
 * `workspaceRoleLabel` are unchanged).
 */

export type NavGroupId = "lead-generation" | "crm" | "records" | "outreach" | "admin";

export type NavItem = {
  href: string;
  label: string;
  /** Label shown to SDRs when different (e.g. "SDR Queue" -> "My Queue"). */
  sdrLabel?: string;
  icon: LucideIcon;
  permission: Permission;
  /** Active only on an exact pathname match (used for section landing pages). */
  exact?: boolean;
  /** When set, the item is only shown to these roles (on top of the permission gate). */
  visibleForRoles?: WorkspaceRole[];
};

export type NavGroup = {
  id: NavGroupId;
  label: string;
  description: string;
  canAccess: (session: Session) => boolean;
  /** Extra permission required to see the whole group (beyond per-item gates). */
  requiredPermission?: Permission;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    id: "lead-generation",
    label: "Lead Generation",
    description: "Profiles, jobs, staging, quality, enrichment, and exports.",
    canAccess: canUseLeadGenerationWorkspace,
    items: [
      { href: "/", label: "Lead Dashboard", icon: LayoutDashboard, permission: "view_records", exact: true },
      { href: "/build-list", label: "Build a Lead List", icon: Sparkles, permission: "manage_profiles" },
      { href: "/search-profiles", label: "Search Profiles", icon: Target, permission: "manage_profiles" },
      { href: "/lead-jobs", label: "Lead Jobs", icon: Database, permission: "run_jobs" },
      { href: "/staging", label: "Data Staging", icon: Layers, permission: "import_csv" },
      { href: "/data-quality", label: "Data Quality", icon: GitMerge, permission: "run_jobs" },
      { href: "/enrichment", label: "Enrichment", icon: Gem, permission: "manage_enrichment" },
      { href: "/waterfalls", label: "Waterfalls", icon: Workflow, permission: "manage_waterfalls" },
      { href: "/exports", label: "Exports", icon: Download, permission: "export_csv" }
    ]
  },
  {
    id: "crm",
    label: "CRM",
    description: "Your day, the calling cockpit, and team overview.",
    canAccess: canUseCrmWorkspace,
    items: [
      {
        href: "/crm",
        label: "CRM Dashboard",
        icon: LayoutDashboard,
        permission: "view_records",
        exact: true,
        visibleForRoles: ["Admin", "Manager"]
      },
      { href: "/sdr/queue", label: "SDR Queue", sdrLabel: "My Day", icon: ClipboardList, permission: "manage_sdr" },
      { href: "/sdr/calendar", label: "Calendar", icon: CalendarDays, permission: "manage_sdr" },
      { href: "/sdr/focus", label: "Focus", icon: Crosshair, permission: "manage_sdr" },
      { href: "/sdr/manager", label: "Manager Dashboard", icon: BarChart3, permission: "manage_sdr_team" }
    ]
  },
  {
    id: "records",
    label: "Records",
    description: "Contacts, accounts, opportunities, and call history.",
    canAccess: canUseCrmWorkspace,
    items: [
      { href: "/crm/contacts", label: "Contacts", icon: Users, permission: "view_records" },
      { href: "/crm/accounts", label: "Accounts", icon: Building2, permission: "view_records" },
      {
        href: "/crm/opportunities",
        label: "Opportunities",
        icon: CircleDollarSign,
        permission: "view_records",
        visibleForRoles: ["Admin", "Manager", "SDR"]
      },
      { href: "/crm/calls", label: "Call Log", sdrLabel: "My Calls", icon: PhoneCall, permission: "manage_sdr" }
    ]
  },
  {
    id: "outreach",
    label: "Outreach",
    description: "Campaigns and direct outreach.",
    canAccess: canUseCrmWorkspace,
    items: [
      { href: "/outreach/campaigns", label: "Campaigns", icon: Megaphone, permission: "manage_outreach" },
      {
        href: "/outreach/events",
        label: "Outreach Events",
        icon: CalendarClock,
        permission: "send_direct_outreach",
        visibleForRoles: ["Admin", "Manager"]
      }
    ]
  },
  {
    id: "admin",
    label: "Admin",
    description: "Provider controls, automation, reports, compliance, and system access.",
    canAccess: canUseDeveloperWorkspace,
    requiredPermission: "manage_workspace",
    items: [
      { href: "/integrations", label: "Integration Center", icon: PlugZap, permission: "manage_workspace" },
      { href: "/access", label: "User Access", icon: UserCog, permission: "manage_workspace" },
      { href: "/reports", label: "Admin Reports", icon: BarChart3, permission: "view_reports" },
      { href: "/reports/compliance", label: "Compliance Workflows", icon: ClipboardList, permission: "manage_compliance" },
      { href: "/automation", label: "AI Automation", icon: Sparkles, permission: "manage_ai_automation" },
      { href: "/compliance", label: "Compliance Controls", icon: ShieldCheck, permission: "manage_compliance" }
    ]
  }
];

export function isNavItemVisibleForRole(item: NavItem, role: WorkspaceRole): boolean {
  return !item.visibleForRoles || item.visibleForRoles.includes(role);
}

/** Dual gate — identical to the pre-redesign shell's `allowedNavItems` filter. */
export function isNavItemAllowed(item: NavItem, session: Session): boolean {
  return session.permissions.includes(item.permission) && isNavItemVisibleForRole(item, session.role);
}

export function allowedItems(group: NavGroup, session: Session): NavItem[] {
  return group.items.filter((item) => isNavItemAllowed(item, session));
}

/** Group is shown only if accessible AND it has at least one allowed item. */
export function canAccessGroup(group: NavGroup, session: Session): boolean {
  if (!group.canAccess(session)) {
    return false;
  }
  if (group.requiredPermission && !session.permissions.includes(group.requiredPermission)) {
    return false;
  }
  return group.items.some((item) => isNavItemAllowed(item, session));
}

export function accessibleNav(session: Session): { group: NavGroup; items: NavItem[] }[] {
  const groups = navGroups
    .filter((group) => canAccessGroup(group, session))
    .map((group) => ({ group, items: allowedItems(group, session) }));

  if (groups.length > 0) {
    return groups;
  }

  // Fallback preserving the pre-redesign shell: when a role can access no
  // workspace group (e.g. Viewer, Compliance Admin), the old shell fell back to
  // the Lead Generation view and still rendered whatever items the role had
  // item-level permission for (typically just the Lead Dashboard). Keep that so
  // those roles aren't stranded with an empty sidebar.
  const leadGeneration = navGroups[0]!;
  const fallbackItems = allowedItems(leadGeneration, session);
  return fallbackItems.length > 0 ? [{ group: leadGeneration, items: fallbackItems }] : [];
}

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.exact || item.href === "/") {
    return pathname === item.href;
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function resolveNavLabel(item: NavItem, session: Session): string {
  if (session.role === "SDR" && item.sdrLabel) {
    return item.sdrLabel;
  }
  return item.label;
}

/**
 * The single active nav entry for the current path: the most specific (longest
 * href) allowed item that matches, so e.g. /reports/compliance highlights
 * "Compliance Workflows" rather than also matching "Admin Reports" (/reports).
 */
export function findActiveNav(pathname: string, session: Session): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const { group, items } of accessibleNav(session)) {
    for (const item of items) {
      if (isNavItemActive(pathname, item) && (!best || item.href.length > best.item.href.length)) {
        best = { group, item };
      }
    }
  }
  return best;
}
