import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Database,
  Download,
  FileText,
  GitMerge,
  Layers3,
  Play,
  Search,
  ShieldCheck,
  Target,
  Upload,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import { contactRowsForStaging, exportTemplates, sourceHealth } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { canUseLeadGenerationWorkspace, defaultWorkspacePath } from "@/lib/phase1/auth";
import type { Contact, LeadJob, Priority, SearchProfile } from "@/lib/phase1/types";
import { formatNumber } from "@/lib/utils";
import { redirect } from "next/navigation";
import { StatCard } from "@/components/ui-metrics";

type StagedRow = ReturnType<typeof contactRowsForStaging>[number];
type SegmentSummary = {
  name: string;
  count: number;
  priority: Priority;
  action: string;
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { state, session, workspaceId } = await getWorkspaceContext("view_all_records");
  if (!canUseLeadGenerationWorkspace(session)) {
    const fallbackPath = defaultWorkspacePath(session);
    if (fallbackPath !== "/") {
      redirect(fallbackPath);
    }
  }

  const profiles = state.searchProfiles.filter((profile) => profile.workspaceId === workspaceId);
  const jobs = state.leadJobs.filter((job) => job.workspaceId === workspaceId);
  const activeJobs = jobs.filter((job) => job.status !== "Completed");
  const rawLeads = state.rawLeads.filter((lead) => lead.workspaceId === workspaceId);
  const normalizedRecords = state.normalizedRecords.filter((record) => record.workspaceId === workspaceId);
  const contacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId);
  const stagedRows = contactRowsForStaging(state, workspaceId);
  const exportReadyContacts = contacts.filter(
    (contact) => !contact.isSuppressed && (contact.grade === "A" || contact.grade === "B")
  );
  const suppressedContacts = contacts.filter((contact) => contact.isSuppressed);
  const duplicateRows = normalizedRecords.filter((record) => record.duplicateCompanyId || record.duplicateContactId);
  const needsReviewRows = stagedRows.filter(
    (row) => row.status === "In review" || row.status === "Needs enrichment" || row.emailGrade === "C" || row.emailGrade === "D"
  );
  const templates = exportTemplates(state, workspaceId);
  const recentJobRows = recentJobs(jobs).slice(0, 5);
  const canManageProfiles = session.permissions.includes("manage_profiles");
  const canImport = session.permissions.includes("import_csv");
  const nonSuppressedContacts = contacts.filter((contact) => !contact.isSuppressed);
  const verifiedRate = nonSuppressedContacts.length
    ? Math.round((exportReadyContacts.length / nonSuppressedContacts.length) * 100)
    : 0;
  const exportedIds = new Set(
    state.exports
      .filter((exportRecord) => exportRecord.workspaceId === workspaceId)
      .flatMap((exportRecord) => exportRecord.recordIds)
  );
  const exportedCount = exportedIds.size || templates.reduce((total, template) => total + template.eligible, 0);
  const enrichedCount = contacts.filter((contact) => (contact.enrichmentCoverage ?? 0) > 0).length;
  const dedupedCount = Math.max(normalizedRecords.length - duplicateRows.length, 0);
  const funnelMax = Math.max(rawLeads.length, normalizedRecords.length, contacts.length, stagedRows.length, 1);
  const topSegments = segmentSummaries(contacts, stagedRows).slice(0, 5);

  const stats = [
    {
      label: "Leads in staging",
      value: formatNumber(stagedRows.length || rawLeads.length),
      note: `${formatNumber(needsReviewRows.length)} need review`,
      icon: Database,
      tone: "info" as const
    },
    {
      label: "Verified rate",
      value: `${verifiedRate}%`,
      note: `${formatNumber(exportReadyContacts.length)} A/B contacts`,
      icon: BadgeCheck,
      tone: "success" as const
    },
    {
      label: "Export-ready",
      value: formatNumber(exportReadyContacts.length),
      note: `${formatNumber(topSegments.filter((segment) => segment.priority === "P1").length)} P1 segments`,
      icon: Download,
      tone: "success" as const
    },
    {
      label: "Suppressed",
      value: formatNumber(suppressedContacts.length),
      note: `${formatNumber(duplicateRows.length)} duplicate candidates`,
      icon: ShieldCheck,
      tone: suppressedContacts.length ? "warning" as const : "success" as const
    }
  ];

  const funnelStages = [
    {
      label: "Raw data",
      value: rawLeads.length || stagedRows.length,
      note: "Imported and source-read",
      icon: Database,
      tone: "blue" as const
    },
    {
      label: "Normalized",
      value: normalizedRecords.length,
      note: "Mapped to company/contact records",
      icon: GitMerge,
      tone: "blue" as const
    },
    {
      label: "Deduped",
      value: dedupedCount,
      note: `${formatNumber(duplicateRows.length)} duplicates isolated`,
      icon: Search,
      tone: "teal" as const
    },
    {
      label: "Suppressed",
      value: suppressedContacts.length,
      note: "DNC, bounces, customers, invalids",
      icon: ShieldCheck,
      tone: "warn" as const
    },
    {
      label: "Verified",
      value: exportReadyContacts.length,
      note: "A/B email grade",
      icon: BadgeCheck,
      tone: "teal" as const
    },
    {
      label: "Enriched",
      value: enrichedCount,
      note: "Firmographic and persona coverage",
      icon: Layers3,
      tone: "blue" as const
    },
    {
      label: "Exported",
      value: exportedCount,
      note: "CSV and SDR handoff output",
      icon: Download,
      tone: "teal" as const
    }
  ];

  const workflow = [
    {
      title: "Define ICP",
      copy: "Choose the market, geography, titles, source mix, required fields, and compliance note.",
      href: "/search-profiles",
      count: profiles.length,
      label: "profiles",
      icon: Target
    },
    {
      title: "Run lead job",
      copy: "Launch a saved profile or manual job and watch source runs, checkpoints, and progress.",
      href: "/lead-jobs",
      count: activeJobs.length,
      label: "active",
      icon: Activity
    },
    {
      title: "Review staging",
      copy: "Clean records before CRM handoff: verification, dedupe, suppression, and enrichment.",
      href: "/staging",
      count: needsReviewRows.length,
      label: "review",
      icon: Search
    },
    {
      title: "Export clean list",
      copy: "Generate gated CSVs only from verified, non-suppressed records with source lineage.",
      href: "/exports",
      count: exportReadyContacts.length,
      label: "ready",
      icon: Download
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Lead generation"
        title="Lead command center"
        copy="A focused workspace for building targeted lists: define ICP profiles, run acquisition jobs, review staged data, and export only clean, compliant records."
        actions={
          <>
            {canImport ? (
              <Link href="/staging#import-csv" className="button secondary">
                <Upload size={17} aria-hidden="true" />
                Import CSV
              </Link>
            ) : null}
            {canManageProfiles ? (
              <Link href="/search-profiles#create-profile" className="button primary">
                <Target size={17} aria-hidden="true" />
                New profile
              </Link>
            ) : null}
          </>
        }
      />

      <section className="stat-grid" aria-label="Lead generation metrics">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="grid lead-dashboard-main" aria-label="Lead engine overview">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <div className="page-kicker">This week</div>
              <h2 className="section-title">From raw data to SDR-ready</h2>
              <p className="section-subtitle">Every record passes the staging pipeline before it can reach CRM or export.</p>
            </div>
            <Link href="/staging" className="button subtle">
              Open staging
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className="panel-body funnel-list">
            {funnelStages.map((stage) => (
              <FunnelRow key={stage.label} max={funnelMax} {...stage} />
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <div className="page-kicker">Live</div>
              <h2 className="section-title">Top segments</h2>
              <p className="section-subtitle">High-volume groups and the next operator action.</p>
            </div>
            <Users size={20} aria-hidden="true" />
          </div>
          <div className="panel-body segment-list">
            {topSegments.length ? (
              topSegments.map((segment) => (
                <div className="segment-row" key={segment.name}>
                  <div className="segment-copy">
                    <strong>{segment.name}</strong>
                    <span>{segment.action}</span>
                  </div>
                  <div className="segment-metrics">
                    <PriorityBadge priority={segment.priority} />
                    <strong>{formatNumber(segment.count)}</strong>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <Layers3 size={24} aria-hidden="true" />
                <span>No segments calculated yet.</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="lead-action-grid" aria-label="Lead generation workflow">
        {workflow.map((step) => {
          const Icon = step.icon;
          return (
            <Link href={step.href} className="lead-action-card card-hover" key={step.title}>
              <span className="lead-action-icon">
                <Icon size={18} aria-hidden="true" />
              </span>
              <div className="lead-action-copy">
                <strong>{step.title}</strong>
                <span>{step.copy}</span>
              </div>
              <div className="lead-action-meta">
                <StatusPill label={`${formatNumber(step.count)} ${step.label}`} tone={step.count ? "info" : "default"} />
                <ArrowRight size={17} aria-hidden="true" />
              </div>
            </Link>
          );
        })}
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Recent lead jobs</h2>
              <p className="section-subtitle">Extraction and processing runs with source mix, progress, records, and cost.</p>
            </div>
            <Link href="/lead-jobs" className="button secondary">
              View all
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Sources</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Records</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {recentJobRows.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <div className="entity">
                        <strong>{job.name}</strong>
                        <span>{formatDate(job.updatedAt)}</span>
                      </div>
                    </td>
                    <td>
                      <SourceDots sources={job.sources} />
                    </td>
                    <td>
                      <StatusPill label={job.status} tone={statusTone(job.status)} />
                    </td>
                    <td className="progress-cell">
                      <ProgressBar value={job.progress} />
                      <span>{job.progress}%</span>
                    </td>
                    <td>
                      <div className="entity">
                        <strong>{formatNumber(job.normalized || job.raw)}</strong>
                        <span>{formatNumber(job.verified)} verified</span>
                      </div>
                    </td>
                    <td>{formatCurrencyCompact(job.actualCost)}</td>
                  </tr>
                ))}
                {recentJobRows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No lead jobs yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Source readiness</h2>
              <p className="section-subtitle">Selected acquisition sources and the fields each lane is expected to contribute.</p>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            {sourceHealth.map((source) => (
              <div className="stage-row" key={source.source}>
                <div className="stage-meta">
                  <strong>{source.source}</strong>
                  <StatusPill label={source.status} tone={statusTone(source.status)} />
                </div>
                <ProgressBar value={source.trust} />
                <div className="row-meta">
                  <span>{source.trust}% trust score</span>
                  <span>{source.credits}</span>
                </div>
                <div className="chip-row">
                  {source.fields.map((field) => (
                    <span className="source-chip" key={field}>
                      {field}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Staging quality queue</h2>
              <p className="section-subtitle">Records operators should inspect before export or CRM handoff.</p>
            </div>
            <Link href="/staging" className="button secondary">
              Open staging
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Source</th>
                  <th>Grade</th>
                  <th>Score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(needsReviewRows.length ? needsReviewRows : stagedRows).slice(0, 8).map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="entity">
                        <strong>{row.contactName || row.company}</strong>
                        <span>{row.title}</span>
                        <span>{row.company}</span>
                      </div>
                    </td>
                    <td>{row.source}</td>
                    <td>
                      <span className={`grade ${row.emailGrade.toLowerCase()}`}>{row.emailGrade}</span>
                    </td>
                    <td>{row.score}</td>
                    <td>
                      <StatusPill label={row.status} tone={statusTone(row.status)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Export readiness</h2>
              <p className="section-subtitle">Output templates with counts after verification and suppression gates.</p>
            </div>
            <Link href="/exports" className="button secondary">
              Generate export
            </Link>
          </div>
          <div className="panel-body stage-list">
            {templates.map((template) => (
              <div className="list-row" key={template.id}>
                <div className="row-meta">
                  <strong>{template.name}</strong>
                  <StatusPill label={`${formatNumber(template.eligible)} eligible`} tone={template.eligible ? "success" : "warning"} />
                </div>
                <p className="section-subtitle">{template.description}</p>
                <div className="chip-row">
                  {template.columns.slice(0, 5).map((column) => (
                    <span className="pill" key={column}>
                      {column}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Saved ICP profiles</h2>
            <p className="section-subtitle">Reusable list-building definitions with source mix, required fields, routing, and compliance notes.</p>
          </div>
          <Link href="/search-profiles" className="button secondary">
            Manage profiles
          </Link>
        </div>
        <div className="grid three panel-body">
          {profiles.slice(0, 6).map((profile) => (
            <ProfileSummaryCard key={profile.id} profile={profile} />
          ))}
        </div>
      </section>

      <section className="grid three">
        <div className="item-card">
          <FileText size={22} aria-hidden="true" />
          <h2 className="card-title">No CRM clutter</h2>
          <p className="section-subtitle">SDR queues, opportunities, and revenue attribution now belong in the CRM workspace.</p>
        </div>
        <div className="item-card">
          <GitMerge size={22} aria-hidden="true" />
          <h2 className="card-title">Quality first</h2>
          <p className="section-subtitle">Dedupe, suppression, verification, and enrichment stay visible before records move downstream.</p>
        </div>
        <div className="item-card">
          <ShieldCheck size={22} aria-hidden="true" />
          <h2 className="card-title">Export gates</h2>
          <p className="section-subtitle">Operators see eligible counts before producing CSV output or SDR assignment files.</p>
        </div>
      </section>
    </>
  );
}


function FunnelRow({
  icon: Icon,
  label,
  value,
  note,
  max,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  note: string;
  max: number;
  tone: "blue" | "teal" | "warn";
}) {
  const percent = max ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;

  return (
    <div className="funnel-row">
      <div className="funnel-name">
        <Icon size={16} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="funnel-track">
        <span className={`funnel-fill ${tone}`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <div className="funnel-value">
        <strong>{formatNumber(value)}</strong>
        <span>{note}</span>
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`tier-badge tier-${priority.toLowerCase()}`}>
      <span />
      {priority}
    </span>
  );
}

function SourceDots({ sources }: { sources: string[] }) {
  return (
    <span className="source-dot-row">
      {sources.map((source) => (
        <span className="source-dot" key={source} style={{ background: sourceColor(source) }} title={source}>
          {source.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </span>
  );
}

function ProfileSummaryCard({ profile }: { profile: SearchProfile }) {
  return (
    <article className="item-card compact-profile-card">
      <div className="item-card-header">
        <div>
          <h3 className="card-title">{profile.name}</h3>
          <p className="section-subtitle">{profile.targetMarket}</p>
        </div>
        <StatusPill label={`${formatNumber(profile.estimatedVolume)} est.`} tone="info" />
      </div>
      <div className="chip-row">
        {profile.sources.slice(0, 4).map((source) => (
          <span className="source-chip" key={source}>
            {source}
          </span>
        ))}
      </div>
      <div className="chip-row">
        {profile.geographies.slice(0, 4).map((geo) => (
          <span className="pill" key={geo}>
            {geo}
          </span>
        ))}
      </div>
      <p className="section-subtitle">{profile.complianceNote}</p>
      <Link href="/lead-jobs" className="button secondary">
        <Play size={16} aria-hidden="true" />
        Run profile
      </Link>
    </article>
  );
}

function segmentSummaries(contacts: Contact[], stagedRows: StagedRow[]): SegmentSummary[] {
  const rows = contacts.length
    ? contacts
        .filter((contact) => !contact.isSuppressed)
        .map((contact) => ({
          segment: contact.segment,
          priority: contact.priority
        }))
    : stagedRows.map((row) => ({
        segment: row.segment,
        priority: row.priority
      }));
  const segments = new Map<string, { count: number; p1: number; p2: number }>();

  for (const row of rows) {
    const name = row.segment || "Unsegmented";
    const current = segments.get(name) ?? { count: 0, p1: 0, p2: 0 };
    current.count += 1;
    if (row.priority === "P1") current.p1 += 1;
    if (row.priority === "P2") current.p2 += 1;
    segments.set(name, current);
  }

  return Array.from(segments.entries())
    .map(([name, value]) => ({
      name,
      count: value.count,
      priority: value.p1 ? "P1" as const : value.p2 ? "P2" as const : "P3" as const,
      action: segmentAction(name, value.count)
    }))
    .sort((a, b) => b.count - a.count);
}

function segmentAction(name: string, count: number) {
  const normalized = name.toLowerCase();
  if (normalized.includes("local") || normalized.includes("dealer")) return "Check phone readiness and local source coverage";
  if (normalized.includes("ecommerce") || normalized.includes("shopify")) return "Prioritize verified founders and growth leads";
  if (normalized.includes("suppressed")) return "Keep blocked until compliance review clears";
  if (count > 4) return "Review routing before export";
  return "Monitor source quality";
}

function recentJobs(jobs: LeadJob[]) {
  return [...jobs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatCurrencyCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function sourceColor(source: string) {
  const normalized = source.toLowerCase();
  if (normalized.includes("apollo")) return "var(--blue-500)";
  if (normalized.includes("hunter")) return "var(--teal-600)";
  if (normalized.includes("google")) return "var(--warning)";
  if (normalized.includes("csv")) return "var(--ink-600)";
  if (normalized.includes("apify")) return "var(--ink-700)";
  return "var(--syn-primary)";
}
