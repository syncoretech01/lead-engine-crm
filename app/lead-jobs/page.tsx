import Link from "next/link";
import {
  Activity,
  BadgeCheck,
  Calculator,
  CircleDollarSign,
  Play,
  RefreshCw,
  ShieldCheck,
  TimerReset
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createLeadJobAction, retryLeadJobAction } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import { jobObservabilitySnapshot } from "@/lib/phase1/jobs";
import { createLeadJobPreflight } from "@/lib/phase1/lead-planning";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { StatCard } from "@/components/ui-metrics";

export const dynamic = "force-dynamic";

export default async function LeadJobsPage() {
  const { state, workspaceId } = await getWorkspaceContext("run_jobs");
  const leadJobs = state.leadJobs.filter((job) => job.workspaceId === workspaceId);
  const searchProfiles = state.searchProfiles.filter((profile) => profile.workspaceId === workspaceId);
  const jobRows = leadJobs
    .map((job) => ({
      job,
      observability: jobObservabilitySnapshot(state, workspaceId, job.id)
    }))
    .sort((a, b) => Date.parse(b.job.updatedAt) - Date.parse(a.job.updatedAt));
  const activeJobs = leadJobs.filter((job) => job.status !== "Completed");
  const retryQueue = jobRows.filter(({ observability }) => observability.canRetry || observability.failedRuns > 0);
  const totalVerified = leadJobs.reduce((total, job) => total + job.verified, 0);
  const totalCost = leadJobs.reduce((total, job) => total + job.actualCost, 0);
  const completedJobs = leadJobs.filter((job) => job.status === "Completed");
  const queuedJobs = leadJobs.filter((job) => job.status === "Queued");
  const runningJobs = leadJobs.filter((job) => job.status === "Running");
  const exportReady = leadJobs.reduce((total, job) => total + job.exported + job.pushedToCrm, 0);
  const estimatedPipelineCostCents = leadJobs.reduce((total, job) => total + (job.estimatedCostCents ?? 0), 0);
  const preflightRows = searchProfiles.map((profile) => ({
    profile,
    preflight: createLeadJobPreflight({
      profile,
      sources: profile.sources,
      requestedRecords: profile.estimatedVolume
    })
  }));

  const stats = [
    {
      label: "Active jobs",
      value: formatNumber(activeJobs.length),
      note: `${formatNumber(leadJobs.length)} total lead jobs`,
      icon: Activity,
      tone: activeJobs.length ? "warning" as const : "success" as const
    },
    {
      label: "Verified",
      value: formatNumber(totalVerified),
      note: "Contacts passing verification",
      icon: BadgeCheck,
      tone: "success" as const
    },
    {
      label: "Needs recovery",
      value: formatNumber(retryQueue.length),
      note: "Jobs with failed runs or retry options",
      icon: ShieldCheck,
      tone: retryQueue.length ? "warning" as const : "success" as const
    },
    {
      label: "Spend tracked",
      value: formatCurrencyCompact(totalCost),
      note: `${formatCents(estimatedPipelineCostCents)} estimated pipeline`,
      icon: CircleDollarSign,
      tone: "info" as const
    }
  ];

  const statusCards = [
    {
      label: "Running",
      value: runningJobs.length,
      note: "Workers active now",
      icon: Activity,
      tone: "info" as const
    },
    {
      label: "Queued",
      value: queuedJobs.length,
      note: "Waiting for source capacity",
      icon: TimerReset,
      tone: queuedJobs.length ? "warning" as const : "success" as const
    },
    {
      label: "Completed",
      value: completedJobs.length,
      note: `${formatNumber(exportReady)} downstream writes`,
      icon: BadgeCheck,
      tone: "success" as const
    },
    {
      label: "Recovery",
      value: retryQueue.length,
      note: retryQueue.length ? "Retry or review needed" : "No failed runs",
      icon: RefreshCw,
      tone: retryQueue.length ? "warning" as const : "success" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Lead generation"
        title="Lead jobs"
        copy="Monitor acquisition jobs from profile launch through raw intake, normalization, verification, enrichment, CRM handoff, and export readiness."
        actions={
          <>
            <a href="#create-job" className="button secondary">
              <RefreshCw size={17} aria-hidden="true" />
              Queue manually
            </a>
            <Link href="/staging#import-csv" className="button primary">
              <Play size={17} aria-hidden="true" />
              Import CSV
            </Link>
          </>
        }
      />

      <section className="stat-grid" aria-label="Lead job metrics">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="job-status-strip" aria-label="Lead job status summary">
        {statusCards.map((card) => (
          <JobStatusCard key={card.label} {...card} />
        ))}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Preflight estimates</h2>
            <p className="section-subtitle">Preview projected leads, acquisition cost, credits, enrichment budget, and budget cap before launch.</p>
          </div>
          <Calculator size={20} aria-hidden="true" />
        </div>
        <div className="panel-body profile-card-grid">
          {preflightRows.map(({ profile, preflight }) => (
            <article className="profile-card" key={profile.id}>
              <div className="profile-card-top">
                <div className="profile-glyph">
                  <Calculator size={18} aria-hidden="true" />
                </div>
                <StatusPill label={preflight.budgetStatus} tone={preflight.budgetStatus === "Within budget" ? "success" : "warning"} />
              </div>
              <div className="profile-card-copy">
                <h2 className="card-title">{profile.name}</h2>
                <p>{formatNumber(preflight.estimatedRecords)} projected leads across {preflight.sources.length} sources.</p>
              </div>
              <div className="profile-filter-row">
                <span className="profile-filter-pill strong">{formatCents(preflight.estimatedCostCents)} total</span>
                <span className="profile-filter-pill">{formatNumber(preflight.estimatedCredits)} credits</span>
                <span className="profile-filter-pill">{formatCents(preflight.budgetCapCents)} cap</span>
              </div>
              <div className="stage-list">
                {preflight.sourceEstimates.map((estimate) => (
                  <div className="stage-row" key={`${profile.id}-${estimate.source}`}>
                    <div className="stage-meta">
                      <strong>{estimate.source}</strong>
                      <span>{formatNumber(estimate.estimatedRecords)} leads</span>
                    </div>
                    <p className="section-subtitle">
                      {formatCents(estimate.estimatedCostCents)} estimated, {estimate.confidence}% confidence
                    </p>
                  </div>
                ))}
              </div>
            </article>
          ))}
          {preflightRows.length === 0 ? <p className="section-subtitle">Create a search profile to preview source costs.</p> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Job monitor</h2>
            <p className="section-subtitle">Source-aware job status with recovery, quality, cost, and CRM sync counts.</p>
          </div>
          <StatusPill label={`${leadJobs.length} jobs`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Sources</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Data</th>
                <th>Quality</th>
                <th>CRM</th>
                <th>Cost</th>
                <th>Recovery</th>
              </tr>
            </thead>
            <tbody>
              {jobRows.map(({ job, observability }) => (
                <tr key={job.id}>
                  <td>
                    <div className="entity">
                      <strong>{job.name}</strong>
                      <span>{formatDate(job.updatedAt)}</span>
                      <span>{job.eta}</span>
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
                    <span>{job.progress}% complete</span>
                  </td>
                  <td>
                    <div className="job-data-stack">
                      <strong>{formatNumber(job.raw)} raw</strong>
                      <span>{formatNumber(job.estimatedRecords ?? 0)} estimated</span>
                      <span>{formatNumber(job.normalized)} normalized</span>
                      <span>{formatNumber(job.enriched)} enriched</span>
                    </div>
                  </td>
                  <td>
                    <div className="job-quality-stack">
                      <span className="pill success">{formatNumber(job.verified)} verified</span>
                      <span className="pill warning">{formatNumber(job.duplicates)} dupes</span>
                      <span className="pill danger">{formatNumber(job.suppressed)} blocked</span>
                    </div>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{formatNumber(job.pushedToCrm)}</strong>
                      <span>{formatNumber(job.exported)} exported</span>
                    </div>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{formatCurrency(job.actualCost)} {job.actualCostSource ?? "Actual"}</strong>
                      <span>{formatCents(job.estimatedCostCents ?? 0)} {job.estimatedCostSource ?? "Estimated"}</span>
                      <span>{formatCents(job.budgetCapCents ?? 0)} {job.budgetCapSource ?? "Manual"} cap</span>
                    </div>
                  </td>
                  <td>
                    <div className="job-recovery-cell">
                      <strong>{observability.failedRuns ? `${observability.failedRuns} need review` : "Healthy"}</strong>
                      <span>{observability.latestLog?.message ?? job.errorSummary}</span>
                      {observability.canRetry ? (
                        <form action={retryLeadJobAction}>
                          <input name="id" type="hidden" value={job.id} />
                          <button className="button secondary" type="submit">
                            <RefreshCw size={16} aria-hidden="true" />
                            Retry
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {jobRows.length === 0 ? (
                <tr>
                  <td colSpan={9}>No lead jobs have been queued yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Run activity</h2>
              <p className="section-subtitle">Latest source runs, attempts, provider run IDs, and log messages.</p>
            </div>
            <Activity size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            {jobRows.slice(0, 6).map(({ job, observability }) => (
              <div className="stage-row" key={`run-${job.id}`}>
                <div className="stage-meta">
                  <strong>{job.name}</strong>
                  <StatusPill label={`${observability.attempts} attempts`} tone="info" />
                </div>
                <p className="section-subtitle">
                  {observability.latestRun
                    ? `${observability.latestRun.source} ${observability.latestRun.status} - ${observability.latestRun.providerRunId}`
                    : "No provider run recorded yet."}
                </p>
                <span className="section-subtitle">{observability.latestLog?.message ?? job.errorSummary}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Processing guardrails</h2>
              <p className="section-subtitle">Lead jobs remain retry-safe and source-aware before records move into staging.</p>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            <div className="stage-row">
              <div className="stage-meta">
                <strong>Checkpointing</strong>
                <StatusPill label="Retry-safe" tone="success" />
              </div>
              <p className="section-subtitle">Source pages and provider cursors are tracked before writes.</p>
            </div>
            <div className="stage-row">
              <div className="stage-meta">
                <strong>Rate limits</strong>
                <StatusPill label="Queue aware" tone="info" />
              </div>
              <p className="section-subtitle">Workers keep provider throttle and credit usage visible.</p>
            </div>
            <div className="stage-row">
              <div className="stage-meta">
                <strong>Idempotency</strong>
                <StatusPill label="Re-runnable" tone="success" />
              </div>
              <p className="section-subtitle">Provider record IDs and dedupe keys prevent duplicate inserts.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="panel" id="create-job">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Queue job manually</h2>
            <p className="section-subtitle">Launch a saved search profile or create a manual job when CSV import is not the entry point.</p>
          </div>
          <StatusPill label="Job setup" tone="success" />
        </div>
        <form action={createLeadJobAction} className="panel-body form-grid">
          <div className="field">
            <label htmlFor="name">Job name</label>
            <input id="name" name="name" placeholder="June dealer import" required />
          </div>
          <div className="field">
            <label htmlFor="searchProfileId">Search profile</label>
            <select id="searchProfileId" name="searchProfileId">
              <option value="">Manual job</option>
              {searchProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="requestedRecords">Requested records</label>
            <input id="requestedRecords" name="requestedRecords" type="number" min="1" defaultValue="250" />
          </div>
          <div className="field">
            <label htmlFor="budgetCapDollars">Budget cap</label>
            <input id="budgetCapDollars" name="budgetCapDollars" type="number" min="0" step="0.01" defaultValue="30" />
          </div>
          <div className="field">
            <label htmlFor="enrichmentBudgetDollars">Enrichment budget</label>
            <input id="enrichmentBudgetDollars" name="enrichmentBudgetDollars" type="number" min="0" step="0.01" defaultValue="5" />
          </div>
          <div className="field full">
            <label>Sources</label>
            <div className="chip-row">
              {["CSV Upload", "Apollo", "Hunter", "Google Places", "Apify"].map((source) => (
                <label className="pill" key={source}>
                  <input name="sources" type="checkbox" value={source} defaultChecked={source === "CSV Upload"} /> {source}
                </label>
              ))}
            </div>
          </div>
          <div className="field full">
            <label>Budget controls</label>
            <div className="chip-row">
              <label className="pill">
                <input name="highValueOnlyEnrichment" type="checkbox" defaultChecked /> High-value enrichment only
              </label>
              <label className="pill">
                <input name="budgetConfirmed" type="checkbox" required /> Confirm budget before queueing
              </label>
            </div>
          </div>
          <div className="field full">
            <button className="button primary" type="submit">
              <Play size={17} aria-hidden="true" />
              Queue job
            </button>
          </div>
        </form>
      </section>
    </>
  );
}


function JobStatusCard({
  icon: Icon,
  label,
  value,
  note,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  note: string;
  tone: "info" | "success" | "warning";
}) {
  return (
    <article className={`job-status-card ${tone}`}>
      <div className="job-status-icon">
        <Icon size={18} aria-hidden="true" />
      </div>
      <div className="job-status-copy">
        <span>{label}</span>
        <strong>{formatNumber(value)}</strong>
        <p>{note}</p>
      </div>
    </article>
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

function formatCents(value: number) {
  return formatCurrency(value / 100);
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
