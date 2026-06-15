import Link from "next/link";
import { Activity, BadgeCheck, CircleDollarSign, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { createLeadJobAction, retryLeadJobAction } from "@/app/actions";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import { jobObservabilitySnapshot } from "@/lib/phase1/jobs";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const metricIcons = [Activity, BadgeCheck, ShieldCheck, CircleDollarSign];

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

  const metrics = [
    {
      label: "Active jobs",
      value: activeJobs.length,
      note: `${formatNumber(leadJobs.length)} total lead jobs`,
      tone: activeJobs.length ? "warning" as const : "success" as const
    },
    {
      label: "Verified",
      value: totalVerified,
      note: "Contacts passing verification",
      tone: "success" as const
    },
    {
      label: "Needs recovery",
      value: retryQueue.length,
      note: "Jobs with failed runs or retry options",
      tone: retryQueue.length ? "warning" as const : "success" as const
    },
    {
      label: "Spend tracked",
      value: totalCost,
      currency: true,
      note: "Local provider cost simulation",
      tone: "info" as const
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

      <section className="grid metrics" aria-label="Lead job metrics">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? Activity;
          return <MetricCard key={metric.label} {...metric} icon={Icon} />;
        })}
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
                      <span>{job.sources.join(", ")}</span>
                      <span>{formatDate(job.updatedAt)}</span>
                    </div>
                  </td>
                  <td>
                    <StatusPill label={job.status} tone={statusTone(job.status)} />
                  </td>
                  <td style={{ minWidth: 160 }}>
                    <ProgressBar value={job.progress} />
                    <div className="section-subtitle">{job.progress}% complete</div>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{formatNumber(job.raw)} raw</strong>
                      <span>{formatNumber(job.normalized)} normalized</span>
                    </div>
                  </td>
                  <td>
                    <div className="chip-row">
                      <span className="pill success">{formatNumber(job.verified)} verified</span>
                      <span className="pill warning">{formatNumber(job.duplicates)} dupes</span>
                      <span className="pill danger">{formatNumber(job.suppressed)} blocked</span>
                    </div>
                  </td>
                  <td>{formatNumber(job.pushedToCrm)}</td>
                  <td>{formatCurrency(job.actualCost)}</td>
                  <td>
                    <div className="entity">
                      <strong>{observability.failedRuns ? `${observability.failedRuns} need review` : "Healthy"}</strong>
                      <span>{observability.latestLog?.message ?? job.eta}</span>
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
                  <td colSpan={8}>No lead jobs have been queued yet.</td>
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
            <label>Sources</label>
            <div className="chip-row">
              {["CSV Upload", "Apollo", "Hunter", "Google Places"].map((source) => (
                <label className="pill" key={source}>
                  <input name="sources" type="checkbox" value={source} defaultChecked={source === "CSV Upload"} /> {source}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label aria-hidden="true">&nbsp;</label>
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

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
