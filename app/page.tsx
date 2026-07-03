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
import { statusTone } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MeterBar } from "@/components/ui/meter-bar";
import { Panel } from "@/components/ui/panel";
import { StatCard, ToneIcon } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { contactRowsForStaging, exportTemplates, sourceHealth } from "@/lib/phase1/queries";
import { readFastLeadDashboardState } from "@/lib/phase1/lead-dashboard-read-model";
import { buildLeadEngineMetrics } from "@/lib/phase1/lead-engine-metrics";
import { isMeaningfulCompanyName, isMeaningfulPersonName } from "@/lib/phase1/lead-data-quality";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { canUseLeadGenerationWorkspace, defaultWorkspacePath } from "@/lib/phase1/auth";
import type { Contact, LeadJob, Priority, SearchProfile } from "@/lib/phase1/types";
import { formatNumber } from "@/lib/utils";
import { redirect } from "next/navigation";

type StagedRow = ReturnType<typeof contactRowsForStaging>[number];
type SegmentSummary = {
  name: string;
  count: number;
  priority: Priority;
  action: string;
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const sessionContext = await getWorkspaceSessionContext("view_records");
  let { session, workspaceId } = sessionContext;
  let state = await readFastLeadDashboardState(session, workspaceId);

  if (!state) {
    const context = await getWorkspaceContext("view_records");
    state = context.state;
    session = context.session;
    workspaceId = context.workspaceId;
  }

  if (!canUseLeadGenerationWorkspace(session)) {
    const fallbackPath = defaultWorkspacePath(session);
    if (fallbackPath !== "/") {
      redirect(fallbackPath);
    }
  }

  const profiles = state.searchProfiles.filter((profile) => profile.workspaceId === workspaceId);
  const jobs = state.leadJobs.filter((job) => job.workspaceId === workspaceId);
  const metrics = buildLeadEngineMetrics(state, workspaceId);
  const activeJobs = jobs.filter((job) => job.status !== "Completed");
  const contacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId);
  const stagedRows = contactRowsForStaging(state, workspaceId);
  const needsReviewRows = stagedRows.filter(
    (row) =>
      row.reviewReason !== "Ready" ||
      row.status === "In review" ||
      row.status === "Needs enrichment" ||
      row.emailGrade === "C" ||
      row.emailGrade === "D"
  );
  const templates = exportTemplates(state, workspaceId);
  const recentJobRows = recentJobs(jobs).slice(0, 5);
  const canManageProfiles = session.permissions.includes("manage_profiles");
  const canImport = session.permissions.includes("import_csv");
  const funnelMax = Math.max(metrics.rawCount, metrics.normalizedCount, metrics.contactCount, metrics.stagedCount, 1);
  const topSegments = segmentSummaries(contacts, stagedRows).slice(0, 5);

  const stats = [
    {
      label: "Leads in staging",
      value: formatNumber(metrics.stagedCount || metrics.rawCount),
      note: `${formatNumber(metrics.needsReviewCount)} need review`,
      icon: Database,
      tone: "info" as const
    },
    {
      label: "Verified A/B rate",
      value: `${metrics.verifiedRate}%`,
      note: `${formatNumber(metrics.verifiedCount)} A/B contacts`,
      icon: BadgeCheck,
      tone: "success" as const
    },
    {
      label: "Assignment-ready",
      value: formatNumber(metrics.readyForSdrCount),
      note: `${formatNumber(metrics.assignmentBlockedCount)} held by quality gates`,
      icon: Download,
      tone: "success" as const
    },
    {
      label: "Open duplicates",
      value: formatNumber(metrics.duplicateGroupCount),
      note: `${formatNumber(metrics.hiddenDuplicatePairCount)} stale pairs hidden`,
      icon: GitMerge,
      tone: metrics.duplicateGroupCount ? "warning" as const : "success" as const
    }
  ];

  const funnelStages = [
    {
      label: "Raw data",
      value: metrics.rawCount || metrics.stagedCount,
      note: "Imported and source-read",
      icon: Database,
      tone: "blue" as const
    },
    {
      label: "Normalized",
      value: metrics.normalizedCount,
      note: "Mapped to company/contact records",
      icon: GitMerge,
      tone: "blue" as const
    },
    {
      label: "Deduped",
      value: Math.max(metrics.normalizedCount - metrics.actionableDuplicatePairCount, 0),
      note: `${formatNumber(metrics.duplicateGroupCount)} groups to resolve`,
      icon: Search,
      tone: "teal" as const
    },
    {
      label: "Suppressed",
      value: metrics.suppressedCount,
      note: "DNC, bounces, customers, invalids",
      icon: ShieldCheck,
      tone: "warn" as const
    },
    {
      label: "Verified",
      value: metrics.verifiedCount,
      note: "A/B email grade",
      icon: BadgeCheck,
      tone: "teal" as const
    },
    {
      label: "Enriched",
      value: metrics.enrichedCount,
      note: "Firmographic and persona coverage",
      icon: Layers3,
      tone: "blue" as const
    },
    {
      label: "Exported",
      value: metrics.crmHandoffCount,
      note: `${formatNumber(metrics.exportedCount)} exported rows`,
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
      count: metrics.needsReviewCount,
      label: "review",
      icon: Search
    },
    {
      title: "Export clean list",
      copy: "Generate gated CSVs or SDR handoff lists only from verified, non-suppressed records.",
      href: "/exports",
      count: metrics.exportReadyCount,
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
              <Button asChild variant="outline">
                <Link href="/staging#import-csv">
                  <Upload aria-hidden="true" />
                  Import CSV
                </Link>
              </Button>
            ) : null}
            {canManageProfiles ? (
              <Button asChild>
                <Link href="/search-profiles#create-profile">
                  <Target aria-hidden="true" />
                  New profile
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <section aria-label="Lead generation metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            icon={stat.icon}
            label={stat.label}
            value={stat.value}
            note={stat.note}
            tone={stat.tone}
          />
        ))}
      </section>

      <section aria-label="Lead engine overview" className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="From raw data to SDR-ready"
          subtitle="Every record passes the staging pipeline before it can reach CRM or export."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/staging">
                Open staging
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            {funnelStages.map((stage) => (
              <FunnelRow key={stage.label} max={funnelMax} {...stage} />
            ))}
          </div>
        </Panel>

        <Panel
          title="Top segments"
          subtitle="High-volume groups and the next operator action."
          action={<ToneIcon icon={Users} tone="info" />}
        >
          <div className="flex flex-col gap-4">
            {topSegments.length ? (
              topSegments.map((segment) => (
                <div
                  key={segment.name}
                  className="flex items-start justify-between gap-3 border-b pb-4 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{segment.name}</div>
                    <p className="text-xs text-muted-foreground">{segment.action}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <PriorityBadge priority={segment.priority} />
                    <span className="font-semibold text-foreground tabular-nums">{formatNumber(segment.count)}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                <Layers3 className="size-6" aria-hidden="true" />
                <span className="text-sm">No segments calculated yet.</span>
              </div>
            )}
          </div>
        </Panel>
      </section>

      <section aria-label="Lead generation workflow" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {workflow.map((step) => {
          const Icon = step.icon;
          return (
            <Link
              key={step.title}
              href={step.href}
              className="group bg-card flex flex-col gap-4 rounded-xl border p-5 shadow-sm transition-colors hover:border-[var(--syn-primary)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground">{step.title}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{step.copy}</p>
                </div>
                <ToneIcon icon={Icon} tone="info" />
              </div>
              <div className="mt-auto flex items-center justify-between">
                <StatusBadge label={`${formatNumber(step.count)} ${step.label}`} tone={step.count ? "info" : "default"} />
                <ArrowRight
                  className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </div>
            </Link>
          );
        })}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Recent lead jobs"
          subtitle="Extraction and processing runs with source mix, progress, records, and cost."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/lead-jobs">View all</Link>
            </Button>
          }
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Sources</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Records</TableHead>
                <TableHead>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentJobRows.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{job.name}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(job.updatedAt)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <SourceDots sources={job.sources} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge label={job.status} tone={statusTone(job.status)} />
                  </TableCell>
                  <TableCell>
                    <MeterBar value={job.progress} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{formatNumber(job.normalized || job.raw)}</span>
                      <span className="text-xs text-muted-foreground">{formatNumber(job.verified)} A/B verified</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatCurrencyCompact(job.actualCost)}</TableCell>
                </TableRow>
              ))}
              {recentJobRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No lead jobs yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="Source readiness"
          subtitle="Selected acquisition sources and the fields each lane is expected to contribute."
          action={<ToneIcon icon={ShieldCheck} tone="info" />}
        >
          <div className="flex flex-col gap-4">
            {sourceHealth.map((source) => (
              <div key={source.source} className="flex flex-col gap-2 border-b pb-4 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{source.source}</span>
                  <StatusBadge label={source.status} tone={statusTone(source.status)} />
                </div>
                <MeterBar value={source.trust} />
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{source.trust}% trust score</span>
                  <span>{source.credits}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {source.fields.map((field) => (
                    <StatusBadge key={field} label={field} tone="default" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Staging quality queue"
          subtitle="Records operators should inspect before export or CRM handoff."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/staging">Open staging</Link>
            </Button>
          }
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(needsReviewRows.length ? needsReviewRows : stagedRows).slice(0, 8).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{displayStagedLeadName(row)}</span>
                      <span className="text-xs text-muted-foreground">{row.title}</span>
                      <span className="text-xs text-muted-foreground">{displayStagedAccountName(row)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.source}</TableCell>
                  <TableCell>
                    <StatusBadge label={row.emailGrade} tone={gradeTone(row.emailGrade)} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.score}</TableCell>
                  <TableCell>
                    <StatusBadge label={row.status} tone={statusTone(row.status)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title="Export readiness"
          subtitle="Output templates with counts after verification and suppression gates."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/exports">Generate export</Link>
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            {templates.map((template) => (
              <div key={template.id} className="flex flex-col gap-2 border-b pb-4 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{template.name}</span>
                  <StatusBadge
                    label={`${formatNumber(template.eligible)} eligible`}
                    tone={template.eligible ? "success" : "warning"}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{template.description}</p>
                <div className="flex flex-wrap gap-2">
                  {template.columns.slice(0, 5).map((column) => (
                    <StatusBadge key={column} label={column} tone="default" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <Panel
        title="Saved ICP profiles"
        subtitle="Reusable list-building definitions with source mix, required fields, routing, and compliance notes."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/search-profiles">Manage profiles</Link>
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {profiles.slice(0, 6).map((profile) => (
            <ProfileSummaryCard key={profile.id} profile={profile} />
          ))}
        </div>
      </Panel>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="gap-3 p-5">
          <ToneIcon icon={FileText} tone="info" />
          <h2 className="text-sm font-semibold text-foreground">No CRM clutter</h2>
          <p className="text-xs text-muted-foreground">
            SDR queues, opportunities, and revenue attribution now belong in the CRM workspace.
          </p>
        </Card>
        <Card className="gap-3 p-5">
          <ToneIcon icon={GitMerge} tone="info" />
          <h2 className="text-sm font-semibold text-foreground">Quality first</h2>
          <p className="text-xs text-muted-foreground">
            Dedupe, suppression, verification, and enrichment stay visible before records move downstream.
          </p>
        </Card>
        <Card className="gap-3 p-5">
          <ToneIcon icon={ShieldCheck} tone="info" />
          <h2 className="text-sm font-semibold text-foreground">Export gates</h2>
          <p className="text-xs text-muted-foreground">
            Operators see eligible counts before producing CSV output or SDR assignment files.
          </p>
        </Card>
      </section>
    </>
  );
}

const funnelFillTone: Record<"blue" | "teal" | "warn", string> = {
  blue: "bg-[var(--syn-primary)]",
  teal: "bg-[var(--teal-600)]",
  warn: "bg-[#b45309]"
};

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
    <div className="flex items-center gap-3">
      <div className="flex w-28 shrink-0 items-center gap-2 text-sm text-foreground">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--ink-100)]">
        <span
          className={`block h-full rounded-full ${funnelFillTone[tone]}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <div className="flex w-40 shrink-0 flex-col text-right">
        <span className="font-semibold text-foreground tabular-nums">{formatNumber(value)}</span>
        <span className="text-xs text-muted-foreground">{note}</span>
      </div>
    </div>
  );
}

function gradeTone(grade: string): "success" | "info" | "warning" | "danger" | "default" {
  const normalized = grade.toUpperCase();
  if (normalized === "A") return "success";
  if (normalized === "B") return "info";
  if (normalized === "C") return "warning";
  if (normalized === "D") return "danger";
  return "default";
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const tone = priority === "P1" ? "success" : priority === "P2" ? "info" : "default";
  return <StatusBadge label={priority} tone={tone} />;
}

function SourceDots({ sources }: { sources: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {sources.map((source) => (
        <span
          key={source}
          title={source}
          className="flex size-5 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ background: sourceColor(source) }}
        >
          {source.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </span>
  );
}

function ProfileSummaryCard({ profile }: { profile: SearchProfile }) {
  return (
    <article className="bg-card flex flex-col gap-3 rounded-xl border p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{profile.name}</h3>
          <p className="text-xs text-muted-foreground">{profile.targetMarket}</p>
        </div>
        <StatusBadge label={`${formatNumber(profile.estimatedVolume)} est.`} tone="info" />
      </div>
      <div className="flex flex-wrap gap-2">
        {profile.sources.slice(0, 4).map((source) => (
          <StatusBadge key={source} label={source} tone="default" />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {profile.geographies.slice(0, 4).map((geo) => (
          <StatusBadge key={geo} label={geo} tone="default" />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{profile.complianceNote}</p>
      <Button asChild variant="outline" size="sm" className="self-start">
        <Link href="/lead-jobs">
          <Play aria-hidden="true" />
          Run profile
        </Link>
      </Button>
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

function displayStagedLeadName(row: StagedRow) {
  if (isMeaningfulPersonName(row.contactName)) {
    return row.contactName;
  }

  return row.email || displayStagedAccountName(row);
}

function displayStagedAccountName(row: StagedRow) {
  return isMeaningfulCompanyName(row.company) ? row.company : "No company";
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
