"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  Building2,
  CircleDollarSign,
  ClipboardList,
  Database,
  Download,
  Gem,
  GitMerge,
  LayoutDashboard,
  Megaphone,
  PlugZap,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { syncoreBrand } from "@/lib/brand";
import type { Permission, Session } from "@/lib/phase1/types";
import {
  canUseCrmWorkspace,
  canUseDeveloperWorkspace,
  canUseLeadGenerationWorkspace,
  workspaceRoleLabel
} from "@/lib/phase1/auth";
import { StatusPill } from "@/components/status-pill";
import { cn } from "@/lib/utils";

type WorkspaceViewId = "lead-generation" | "crm" | "developer";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  exact?: boolean;
};

type WorkspaceView = {
  id: WorkspaceViewId;
  label: string;
  shortLabel: string;
  href: string;
  description: string;
  canAccess: (session: Session) => boolean;
  requiredPermission?: Permission;
  items: NavItem[];
};

const workspaceViews = [
  {
    id: "lead-generation",
    label: "Lead Generation",
    shortLabel: "Leads",
    href: "/",
    description: "Profiles, jobs, staging, quality, enrichment, and exports.",
    canAccess: canUseLeadGenerationWorkspace,
    items: [
      { href: "/", label: "Lead Dashboard", icon: LayoutDashboard, permission: "view_all_records" },
      { href: "/search-profiles", label: "Search Profiles", icon: Target, permission: "manage_profiles" },
      { href: "/lead-jobs", label: "Lead Jobs", icon: Database, permission: "run_jobs" },
      { href: "/staging", label: "Data Staging", icon: Search, permission: "import_csv" },
      { href: "/data-quality", label: "Data Quality", icon: GitMerge, permission: "run_jobs" },
      { href: "/enrichment", label: "Enrichment", icon: Gem, permission: "manage_enrichment" },
      { href: "/exports", label: "Exports", icon: Download, permission: "export_csv" }
    ]
  },
  {
    id: "crm",
    label: "CRM",
    shortLabel: "CRM",
    href: "/crm",
    description: "Accounts, contacts, opportunities, SDR work, and outreach.",
    canAccess: canUseCrmWorkspace,
    items: [
      { href: "/crm", label: "CRM Dashboard", icon: LayoutDashboard, permission: "view_all_records", exact: true },
      { href: "/crm/accounts", label: "Accounts", icon: Building2, permission: "view_all_records" },
      { href: "/crm/contacts", label: "Contacts", icon: Users, permission: "view_all_records" },
      { href: "/crm/opportunities", label: "Opportunities", icon: CircleDollarSign, permission: "view_all_records" },
      { href: "/sdr/queue", label: "SDR Queue", icon: ClipboardList, permission: "manage_sdr" },
      { href: "/sdr/manager", label: "Manager Dashboard", icon: BarChart3, permission: "manage_sdr" },
      { href: "/outreach/campaigns", label: "Campaigns", icon: Megaphone, permission: "manage_outreach" },
      { href: "/outreach/events", label: "Outreach Events", icon: Bell, permission: "manage_outreach" }
    ]
  },
  {
    id: "developer",
    label: "Developer",
    shortLabel: "Dev",
    href: "/integrations",
    description: "Provider controls, automation, reports, compliance, and system access.",
    canAccess: canUseDeveloperWorkspace,
    requiredPermission: "manage_workspace",
    items: [
      { href: "/integrations", label: "Integration Center", icon: PlugZap, permission: "manage_workspace" },
      { href: "/reports", label: "Admin Reports", icon: BarChart3, permission: "view_reports" },
      { href: "/reports/compliance", label: "Compliance Workflows", icon: ClipboardList, permission: "manage_compliance" },
      { href: "/automation", label: "AI Automation", icon: Sparkles, permission: "manage_ai_automation" },
      { href: "/compliance", label: "Compliance Controls", icon: ShieldCheck, permission: "manage_compliance" }
    ]
  }
] satisfies WorkspaceView[];

type AppShellProps = {
  children: React.ReactNode;
  session: Session;
};

export function AppShell({ children, session }: AppShellProps) {
  const pathname = usePathname();
  const availableViews = workspaceViews.filter((view) => canAccessView(view, session));
  const activeView = resolveActiveView(pathname, availableViews);
  const allowedNavItems = activeView.items.filter((item) => session.permissions.includes(item.permission));
  const canCreateProfile = session.permissions.includes("manage_profiles");
  const searchPlaceholder = searchPlaceholderByView[activeView.id];
  const primaryAction = primaryActionByView[activeView.id];
  const canAccessDeveloperView = canUseDeveloperWorkspace(session);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <img src={syncoreBrand.logo.logomark} alt="" className="brand-mark-image" />
          </span>
          <span className="brand-copy">
            <img src={syncoreBrand.logo.wordmark} alt={syncoreBrand.shortName} className="brand-wordmark" />
            <span className="brand-subtitle">{syncoreBrand.productName}</span>
          </span>
        </Link>

        <div className="view-switcher" aria-label="Workspace view">
          {availableViews.map((view) => (
            <Link
              key={view.id}
              href={view.href}
              className={cn("view-tab", activeView.id === view.id && "active")}
              title={view.description}
            >
              {view.shortLabel}
            </Link>
          ))}
        </div>

        <div className="sidebar-section">
          <span className="sidebar-section-label">{activeView.label}</span>
          <span className="sidebar-section-copy">{activeView.description}</span>
        </div>

        <nav className="nav-list">
          {allowedNavItems.map((item) => {
            const Icon = item.icon;
            const active = isNavItemActive(pathname, item);

            return (
              <Link key={item.href} href={item.href} className={cn("nav-link", active && "active")}>
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="mode-card">
            <span className="mode-label">Current view</span>
            <strong>{activeView.label}</strong>
            <span>{session.permissions.includes("manage_workspace") ? "Developer access enabled" : "Role scoped"}</span>
          </div>
          <div className="workspace-card">
            <div className="workspace-row">
              <strong>{session.workspace.market}</strong>
              <StatusPill label={session.workspace.health} tone="success" />
            </div>
            <span className="metric-note">
              {session.user.name} - {workspaceRoleLabel(session.role)}
            </span>
          </div>
          {canAccessDeveloperView ? (
            <Link href="/compliance" className="button subtle">
              <Settings size={16} aria-hidden="true" />
              Settings
            </Link>
          ) : null}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <label className="search-box">
            <Search size={17} aria-hidden="true" />
            <input placeholder={searchPlaceholder} />
          </label>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Notifications">
              <Bell size={18} aria-hidden="true" />
            </button>
            <Link href={primaryAction.href} className="button secondary">
              {primaryAction.label}
            </Link>
            {activeView.id === "lead-generation" && canCreateProfile ? (
              <Link href="/search-profiles" className="button primary">
                <Plus size={17} aria-hidden="true" />
                New profile
              </Link>
            ) : null}
          </div>
        </div>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

function canAccessView(view: WorkspaceView, session: Session) {
  if (!view.canAccess(session)) {
    return false;
  }

  if (view.requiredPermission && !session.permissions.includes(view.requiredPermission)) {
    return false;
  }

  return view.items.some((item) => session.permissions.includes(item.permission));
}

function resolveActiveView(pathname: string, views: WorkspaceView[]) {
  const matched =
    views.find((view) =>
      view.items.some((item) => isNavItemActive(pathname, item))
    ) ?? views[0];

  return matched ?? workspaceViews[0];
}

function isNavItemActive(pathname: string, item: NavItem) {
  if (item.exact || item.href === "/") {
    return pathname === item.href;
  }

  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

const searchPlaceholderByView: Record<WorkspaceViewId, string> = {
  "lead-generation": "Search profiles, jobs, staged records, exports",
  crm: "Search accounts, contacts, opportunities, SDR work",
  developer: "Search providers, reports, compliance, automation"
};

const primaryActionByView: Record<WorkspaceViewId, { href: string; label: string }> = {
  "lead-generation": { href: "/lead-jobs", label: "Open jobs" },
  crm: { href: "/sdr/queue", label: "Open queue" },
  developer: { href: "/integrations", label: "Provider settings" }
};
