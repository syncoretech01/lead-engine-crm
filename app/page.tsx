import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  CircleDollarSign,
  Database,
  Mail,
  Phone,
  ShieldCheck,
  Upload,
  Users
} from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import {
  complianceReadRowsForWorkspace,
  stateWithComplianceReadRows
} from "@/lib/phase1/compliance-read-path";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import { dashboardSnapshot, sourceHealth } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatCurrency, formatNumber } from "@/lib/utils";

const metricIcons = [Database, BadgeCheck, ShieldCheck, CircleDollarSign];

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { state, workspaceId } = await getWorkspaceContext("view_all_records");
  const [complianceRows, crmRows] = await Promise.all([
    complianceReadRowsForWorkspace(state, workspaceId),
    crmEventReadRowsForWorkspace(state, workspaceId)
  ]);
  const readState = stateWithCrmEventReadRows(
    stateWithComplianceReadRows(state, workspaceId, complianceRows),
    workspaceId,
    crmRows
  );
  const { metrics, pipelineStages, activeJobs, crmReadyCount, accounts, sdrQueues } = dashboardSnapshot(
    readState,
    workspaceId
  );

  return (
    <>
      <PageHeader
        kicker="Revenue operations"
        title="Lead command center"
        copy="Run saved ICP profiles, keep raw data out of the CRM until it is clean, and move verified accounts into SDR workflows with source lineage intact."
        actions={
          <>
            <Link href="/staging" className="button secondary">
              <Upload size={17} aria-hidden="true" />
              Import CSV
            </Link>
            <Link href="/lead-jobs" className="button primary">
              <Activity size={17} aria-hidden="true" />
              View jobs
            </Link>
          </>
        }
      />

      <section className="grid metrics" aria-label="Workspace metrics">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? Database;
          return (
            <MetricCard
              key={metric.label}
              label={metric.label}
              value={metric.value}
              suffix={metric.suffix}
              currency={metric.currency}
              note={metric.note}
              tone={metric.tone as "success" | "info" | "warning"}
              icon={Icon}
            />
          );
        })}
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Lead engine funnel</h2>
              <p className="section-subtitle">Current movement from raw staging to CRM-ready records.</p>
            </div>
            <StatusPill label={`${crmReadyCount} ready now`} tone="success" />
          </div>
          <div className="panel-body stage-list">
            {pipelineStages.map((stage) => (
              <div className="stage-row" key={stage.name}>
                <div className="stage-meta">
                  <strong>{stage.name}</strong>
                  <span>{formatNumber(stage.count)} records</span>
                </div>
                <ProgressBar value={stage.percent} />
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Active job control</h2>
              <p className="section-subtitle">Extraction, enrichment, and review lanes that need attention.</p>
            </div>
            <Link href="/lead-jobs" className="icon-button" aria-label="Open lead jobs">
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
          <div className="panel-body stage-list">
            {activeJobs.map((job) => (
              <div className="stage-row" key={job.id}>
                <div className="stage-meta">
                  <strong>{job.name}</strong>
                  <StatusPill label={job.status} tone={statusTone(job.status)} />
                </div>
                <ProgressBar value={job.progress} />
                <div className="row-meta">
                  <span>{formatNumber(job.normalized)} normalized</span>
                  <span>{job.eta}</span>
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
              <h2 className="section-title">SDR queues</h2>
              <p className="section-subtitle">Assignments, due work, and meeting outcomes by owner.</p>
            </div>
            <Users size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Owner</th>
                  <th>Assigned</th>
                  <th>Due today</th>
                  <th>Overdue</th>
                  <th>Meetings</th>
                  <th>Focus</th>
                </tr>
              </thead>
              <tbody>
                {sdrQueues.map((queue) => (
                  <tr key={queue.owner}>
                    <td>
                      <div className="entity">
                        <strong>{queue.owner}</strong>
                        <span>SDR owner</span>
                      </div>
                    </td>
                    <td>{queue.assigned}</td>
                    <td>{queue.dueToday}</td>
                    <td>
                      <StatusPill
                        label={`${queue.overdue}`}
                        tone={queue.overdue > 0 ? "warning" : "success"}
                      />
                    </td>
                    <td>{queue.bookedMeetings}</td>
                    <td>{queue.focus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Source health</h2>
              <p className="section-subtitle">Connected providers, trust scores, and available data lanes.</p>
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

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Pipeline attribution</h2>
            <p className="section-subtitle">CRM accounts created from the lead engine with source and stage context.</p>
          </div>
          <Link href="/crm/accounts" className="button secondary">
            Open CRM
          </Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Owner</th>
                <th>Stage</th>
                <th>Amount</th>
                <th>Source</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <Link href={`/crm/accounts/${account.id}`} className="entity">
                      <strong>{account.name}</strong>
                      <span>{account.domain}</span>
                    </Link>
                  </td>
                  <td>{account.owner}</td>
                  <td>
                    <StatusPill label={account.stage} tone={statusTone(account.stage)} />
                  </td>
                  <td>{formatCurrency(account.amount)}</td>
                  <td>{account.source}</td>
                  <td>{account.lastActivity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid three">
        <div className="item-card">
          <div className="item-card-header">
            <div>
              <h3 className="card-title">Email gate</h3>
              <p className="section-subtitle">Only A/B grades are treated as verified export candidates.</p>
            </div>
            <Mail size={20} aria-hidden="true" />
          </div>
          <Link href="/exports" className="button secondary">
            Export verified leads
          </Link>
        </div>
        <div className="item-card">
          <div className="item-card-header">
            <div>
              <h3 className="card-title">Phone lane</h3>
              <p className="section-subtitle">DNC checks and phone-ready segments stay visible before assignment.</p>
            </div>
            <Phone size={20} aria-hidden="true" />
          </div>
          <Link href="/staging" className="button secondary">
            Review phone leads
          </Link>
        </div>
        <div className="item-card">
          <div className="item-card-header">
            <div>
              <h3 className="card-title">Compliance guardrails</h3>
              <p className="section-subtitle">Suppression, source labels, and retention policy are workspace-level controls.</p>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <Link href="/compliance" className="button secondary">
            Open controls
          </Link>
        </div>
      </section>
    </>
  );
}
