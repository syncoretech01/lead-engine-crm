import { PauseCircle, Play, RefreshCw } from "lucide-react";
import { createLeadJobAction, retryLeadJobAction } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import { jobObservabilitySnapshot } from "@/lib/phase1/jobs";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function LeadJobsPage() {
  const { state, workspaceId } = await getWorkspaceContext("run_jobs");
  const leadJobs = state.leadJobs.filter((job) => job.workspaceId === workspaceId);
  const searchProfiles = state.searchProfiles.filter((profile) => profile.workspaceId === workspaceId);
  const jobRows = leadJobs.map((job) => ({
    job,
    observability: jobObservabilitySnapshot(state, workspaceId, job.id)
  }));

  return (
    <>
      <PageHeader
        kicker="Async processing"
        title="Lead jobs"
        copy="Each extraction gets its own resumable job with source runs, raw staging counts, normalization, dedupe, suppression, verification, enrichment, export, and CRM sync metrics."
        actions={
          <>
            <a href="#create-job" className="button secondary">
              <RefreshCw size={17} aria-hidden="true" />
              Create manually
            </a>
            <a href="/staging#import-csv" className="button primary">
              <Play size={17} aria-hidden="true" />
              Import CSV
            </a>
          </>
        }
      />

      <section className="panel" id="create-job">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Create Lead Job</h2>
            <p className="section-subtitle">Queue a job from a saved profile. CSV import can attach raw rows and complete processing.</p>
          </div>
          <StatusPill label="Job tracking" tone="success" />
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

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Job monitor</h2>
            <p className="section-subtitle">Source-aware processing status with cost, recovery, and CRM sync counts.</p>
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
                <th>Raw</th>
                <th>Normalized</th>
                <th>Duplicates</th>
                <th>Suppressed</th>
                <th>Verified</th>
                <th>CRM</th>
                <th>Cost</th>
                <th>Attempts</th>
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
                    </div>
                  </td>
                  <td>
                    <StatusPill label={job.status} tone={statusTone(job.status)} />
                  </td>
                  <td style={{ minWidth: 150 }}>
                    <ProgressBar value={job.progress} />
                    <div className="section-subtitle">{job.progress}% complete</div>
                  </td>
                  <td>{formatNumber(job.raw)}</td>
                  <td>{formatNumber(job.normalized)}</td>
                  <td>{formatNumber(job.duplicates)}</td>
                  <td>{formatNumber(job.suppressed)}</td>
                  <td>{formatNumber(job.verified)}</td>
                  <td>{formatNumber(job.pushedToCrm)}</td>
                  <td>{formatCurrency(job.actualCost)}</td>
                  <td>
                    <div className="entity">
                      <strong>{formatNumber(observability.attempts)}</strong>
                      <span>{observability.failedRuns ? `${observability.failedRuns} need review` : "Healthy"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="entity">
                      <strong>{job.eta}</strong>
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
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid two">
        {jobRows.slice(0, 4).map(({ job, observability }) => (
          <div className="panel" key={`job-detail-${job.id}`}>
            <div className="panel-header">
              <div className="panel-title-wrap">
                <h2 className="section-title">{job.name}</h2>
                <p className="section-subtitle">Provider run IDs, idempotency, checkpoints, and latest log history.</p>
              </div>
              <StatusPill label={`${observability.runs.length} runs`} tone="info" />
            </div>
            <div className="panel-body stage-list">
              {observability.runs.slice(0, 3).map((run) => (
                <div className="list-row" key={run.id}>
                  <div className="row-meta">
                    <strong>
                      {run.source} attempt {run.attempt}
                    </strong>
                    <span>{run.providerRunId}</span>
                    <span>{run.idempotencyKey}</span>
                  </div>
                  <StatusPill label={run.status} tone={statusTone(run.status)} />
                </div>
              ))}
              {observability.logs.slice(0, 3).map((log) => (
                <div className="list-row" key={log.id}>
                  <div className="row-meta">
                    <strong>{log.message}</strong>
                    <span>{new Date(log.createdAt).toLocaleString("en-US")}</span>
                  </div>
                  <StatusPill label={log.level} tone={log.level === "Error" ? "danger" : log.level === "Warning" ? "warning" : "success"} />
                </div>
              ))}
              {observability.idempotencyRecords.length ? (
                <div className="list-row">
                  <div className="row-meta">
                    <strong>Idempotency</strong>
                    <span>{observability.idempotencyRecords[0].key}</span>
                  </div>
                  <StatusPill label={observability.idempotencyRecords[0].status} tone="success" />
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <section className="grid three">
        <div className="item-card">
          <div className="item-card-header">
            <div>
              <h2 className="card-title">Checkpointing</h2>
              <p className="section-subtitle">Source pages and provider cursors are tracked before writes.</p>
            </div>
            <RefreshCw size={20} aria-hidden="true" />
          </div>
          <StatusPill label="Retry-safe" tone="success" />
        </div>
        <div className="item-card">
          <div className="item-card-header">
            <div>
              <h2 className="card-title">Rate limits</h2>
              <p className="section-subtitle">Workers keep provider throttle and credit usage visible.</p>
            </div>
            <PauseCircle size={20} aria-hidden="true" />
          </div>
          <StatusPill label="Queue aware" tone="info" />
        </div>
        <div className="item-card">
          <div className="item-card-header">
            <div>
              <h2 className="card-title">Idempotency</h2>
              <p className="section-subtitle">Provider record IDs and dedupe keys prevent duplicate inserts.</p>
            </div>
            <RefreshCw size={20} aria-hidden="true" />
          </div>
          <StatusPill label="Re-runnable" tone="success" />
        </div>
      </section>
    </>
  );
}
