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
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Users
} from "lucide-react";
import { syncoreBrand } from "@/lib/brand";
import type { Permission, Session } from "@/lib/phase1/types";
import { StatusPill } from "@/components/status-pill";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Command Center", icon: LayoutDashboard, permission: "view_all_records" },
  { href: "/search-profiles", label: "Search Profiles", icon: Target, permission: "manage_profiles" },
  { href: "/lead-jobs", label: "Lead Jobs", icon: Database, permission: "run_jobs" },
  { href: "/staging", label: "Staging", icon: Search, permission: "import_csv" },
  { href: "/data-quality", label: "Data Quality", icon: GitMerge, permission: "run_jobs" },
  { href: "/enrichment", label: "Enrichment", icon: Gem, permission: "manage_enrichment" },
  { href: "/crm/accounts", label: "CRM Accounts", icon: Building2, permission: "view_all_records" },
  { href: "/crm/contacts", label: "CRM Contacts", icon: Users, permission: "view_all_records" },
  { href: "/crm/opportunities", label: "Opportunities", icon: CircleDollarSign, permission: "view_all_records" },
  { href: "/sdr/queue", label: "SDR Queue", icon: ClipboardList, permission: "manage_sdr" },
  { href: "/outreach/campaigns", label: "Outreach", icon: Megaphone, permission: "manage_outreach" },
  { href: "/reports", label: "Reports", icon: BarChart3, permission: "view_reports" },
  { href: "/automation", label: "AI Automation", icon: Sparkles, permission: "manage_ai_automation" },
  { href: "/exports", label: "Exports", icon: Download, permission: "export_csv" },
  { href: "/compliance", label: "Compliance", icon: ShieldCheck, permission: "manage_compliance" }
] satisfies Array<{ href: string; label: string; icon: typeof LayoutDashboard; permission: Permission }>;

type AppShellProps = {
  children: React.ReactNode;
  session: Session;
};

export function AppShell({ children, session }: AppShellProps) {
  const pathname = usePathname();
  const allowedNavItems = navItems.filter((item) => session.permissions.includes(item.permission));
  const canCreateProfile = session.permissions.includes("manage_profiles");

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

        <nav className="nav-list">
          {allowedNavItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/" ? pathname === item.href : pathname.startsWith(item.href);

            return (
              <Link key={item.href} href={item.href} className={cn("nav-link", active && "active")}>
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="workspace-card">
            <div className="workspace-row">
              <strong>{session.workspace.market}</strong>
              <StatusPill label={session.workspace.health} tone="success" />
            </div>
            <span className="metric-note">
              {session.user.name} - {session.role}
            </span>
          </div>
          <Link href="/compliance" className="button subtle">
            <Settings size={16} aria-hidden="true" />
            Settings
          </Link>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <label className="search-box">
            <Search size={17} aria-hidden="true" />
            <input placeholder="Search accounts, contacts, jobs, exports" />
          </label>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Notifications">
              <Bell size={18} aria-hidden="true" />
            </button>
            {canCreateProfile ? (
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
