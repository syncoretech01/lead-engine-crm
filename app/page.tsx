import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Database,
  Download,
  FileText,
  GitMerge,
  Play,
  Search,
  ShieldCheck,
  Target,
  Upload
} from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import { contactRowsForStaging, exportTemplates, sourceHealth } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { canUseLeadGenerationWorkspace, defaultWorkspacePath } from "@/lib/phase1/auth";
import type { LeadJob, SearchProfile } from "@/lib/phase1/types";
import { formatNumber } from "@/lib/utils";
import { redirect } from "next/navigation";

const metricIcons = [Target, Activity, Database, BadgeCheck];

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
  const stagedRows = contactRowsForStaging(state, workspaceId);
  const exportReadyContacts = state.contacts.filter(
    (contact) => contact.workspaceId === workspaceId && !contact.isSuppressed && (contact.grade === "A" || contact.grade === "B")
  );
  const suppressedContacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId && contact.isSuppressed);
  const duplicateRows = state.normalizedRecords.filter(
    (record) => record.workspaceId === workspaceId && (record.duplicateCompanyId || record.duplicateContactId)
  );
  const needsReviewRows = stagedRows.filter(
    (row) => row.status === "In review" || row.status === "Needs enrichment" || row.emailGrade === "C" || row.emailGrade === "D"
  );
  const templates = exportTemplates(state, workspaceId);
  const monitorJobs = (activeJobs.length ? activeJobs : recentJobs(jobs)).slice(0, 5);
  const canManageProfiles = session.permissions.includes("manage_profiles");
  const canImport = session.permissions.includes("import_csv");

  const metrics = [
    {
      label: "Saved profiles",
      value: profiles.length,
      note: `${formatNumber(profiles.reduce((total, profile) => total + profile.estimatedVolume, 0))} estimated leads`,
      tone: "info" as const
    },
    {
      label: "Active jobs",
      value: activeJobs.length,
      note: `${formatNumber(jobs.length)} total extraction runs`,
      tone: activeJobs.length ? "warning" as const : "success" as const
    },
    {
      label: "Staged records",
      value: stagedRows.length,
      note: `${formatNumber(needsReviewRows.length)} need operator review`,
      tone: needsReviewRows.length ? "warning" as const : "success" as const
    },
    {
      label: "Export-ready contacts",
      value: exportReadyContacts.length,
      note: `${formatNumber(suppressedContacts.length + duplicateRows.length)} blocked by quality gates`,
      tone: "success" as const
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

      <section className="grid metrics" aria-label="Lead generation metrics">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? Database;
          return <MetricCard key={metric.label} {...metric} icon={Icon} />;
        })}
      </section>

      <section className="grid four" aria-label="Lead generation workflow">
        {workflow.map((step) => {
          const Icon = step.icon;
          return (
            <Link href={step.href} className="item-card workflow-card" key={step.title}>
              <div className="item-card-header">
                <div>
                  <h2 className="card-title">{step.title}</h2>
                  <p className="section-subtitle">{step.copy}</p>
                </div>
                <Icon size={20} aria-hidden="true" />
              </div>
              <div className="row-meta">
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
              <h2 className="section-title">Job monitor</h2>
              <p className="section-subtitle">Current extraction and processing runs, with the same counts operators need before moving data forward.</p>
            </div>
            <Link href="/lead-jobs" className="icon-button" aria-label="Open jobs page">
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
          <div className="panel-body stage-list">
            {monitorJobs.length ? (
              monitorJobs.map((job) => <JobMonitorRow key={job.id} job={job} />)
            ) : (
              <div className="empty-state">
                <Activity size={24} aria-hidden="true" />
                <span>No lead jobs yet.</span>
                {canManageProfiles ? (
                  <Link href="/search-profiles#create-profile" className="button secondary">
                    Create profile
                  </Link>
                ) : null}
              </div>
            )}
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

function JobMonitorRow({ job }: { job: LeadJob }) {
  return (
    <div className="stage-row">
      <div className="stage-meta">
        <div className="entity">
          <strong>{job.name}</strong>
          <span>{job.sources.join(", ")}</span>
        </div>
        <StatusPill label={job.status} tone={statusTone(job.status)} />
      </div>
      <ProgressBar value={job.progress} />
      <div className="row-meta">
        <span>{job.progress}% complete</span>
        <span>{job.eta}</span>
      </div>
      <div className="chip-row">
        <span className="pill">{formatNumber(job.raw)} raw</span>
        <span className="pill">{formatNumber(job.normalized)} normalized</span>
        <span className="pill success">{formatNumber(job.verified)} verified</span>
        <span className="pill warning">{formatNumber(job.suppressed)} suppressed</span>
      </div>
    </div>
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

function recentJobs(jobs: LeadJob[]) {
  return [...jobs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
