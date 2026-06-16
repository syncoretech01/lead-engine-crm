import Link from "next/link";
import {
  BarChart3,
  Database,
  Gauge,
  PieChart,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users
} from "lucide-react";
import { generateReportSnapshotsAction } from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import {
  complianceReadRowsForWorkspace,
  stateWithComplianceReadRows
} from "@/lib/phase1/compliance-read-path";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import { exportReadRowsForWorkspace, stateWithExportReadRows } from "@/lib/phase1/export-read-path";
import {
  outreachEventReadRowsForWorkspace,
  stateWithOutreachEventReadRows
} from "@/lib/phase1/outreach-read-path";
import { reportCategories, reportingDashboardSnapshot } from "@/lib/phase1/reporting";
import { getDeveloperWorkspaceContext } from "@/lib/phase1/store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { StatCard } from "@/components/ui-metrics";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const { state, workspaceId } = await getDeveloperWorkspaceContext();
  const [complianceRows, crmRows, outreachRows, exportRows] = await Promise.all([
    complianceReadRowsForWorkspace(state, workspaceId),
    crmEventReadRowsForWorkspace(state, workspaceId),
    outreachEventReadRowsForWorkspace(state, workspaceId),
    exportReadRowsForWorkspace(state, workspaceId)
  ]);
  const readState = stateWithExportReadRows(
    stateWithOutreachEventReadRows(
      stateWithCrmEventReadRows(
        stateWithComplianceReadRows(state, workspaceId, complianceRows),
        workspaceId,
        crmRows
      ),
      workspaceId,
      outreachRows
    ),
    workspaceId,
    exportRows
  );
  const snapshot = reportingDashboardSnapshot(readState, workspaceId);
  const latestSnapshot = snapshot.snapshots[0];
  const stats = [
    {
      label: "Verified contacts",
      value: formatNumber(snapshot.metrics.verifiedContacts),
      note: `${formatRate(snapshot.funnelRows[2].rate)} raw-to-verified from ${formatNumber(snapshot.metrics.rawLeads)} raw leads.`,
      icon: Database,
      tone: "success" as const
    },
    {
      label: "Reply to meeting",
      value: formatRate(snapshot.funnelRows[7].rate),
      note: `${formatNumber(snapshot.metrics.replies)} replies and ${formatNumber(snapshot.metrics.meetings)} meetings.`,
      icon: Users,
      tone: snapshot.metrics.meetings ? "success" as const : "info" as const
    },
    {
      label: "Open pipeline",
      value: formatCurrency(snapshot.metrics.openPipeline),
      note: `${formatCurrency(snapshot.metrics.wonRevenue)} revenue won.`,
      icon: TrendingUp,
      tone: "success" as const
    },
    {
      label: "Actual lead cost",
      value: formatCurrency(snapshot.metrics.actualLeadCost),
      note: `${formatCurrency(snapshot.metrics.estimatedLeadCost)} estimated pipeline.`,
      icon: PieChart,
      tone: "info" as const
    },
    {
      label: "Cost per SDR-ready",
      value: formatCurrency(snapshot.metrics.costPerSdrReadyLead),
      note: `${formatCurrency(snapshot.metrics.costPerValidPhone)} per valid phone.`,
      icon: BarChart3,
      tone: "info" as const
    },
    {
      label: "Deliverability alerts",
      value: formatNumber(snapshot.metrics.openDeliverabilityAlerts),
      note: `Bounce ${formatRate(snapshot.metrics.bounceRate)}, spam ${formatRate(snapshot.metrics.spamComplaintRate)}.`,
      icon: Gauge,
      tone: snapshot.metrics.openDeliverabilityAlerts ? "warning" as const : "success" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Phase 7"
        title="Admin reports"
        copy="Executive, source, SDR, campaign, deliverability, pipeline, data quality, enrichment, activity, compliance, and revenue reporting from the local Syncore workspace."
        actions={
          <>
            <Link href="/reports/compliance" className="button secondary">
              <ShieldCheck size={17} aria-hidden="true" />
              Compliance workflows
            </Link>
            <form action={generateReportSnapshotsAction}>
              <button className="button primary" type="submit">
                <RefreshCw size={17} aria-hidden="true" />
                Generate snapshots
              </button>
            </form>
          </>
        }
      />

      <section className="stat-grid" aria-label="Report metrics">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Dashboard categories</h2>
            <p className="section-subtitle">
              Phase 7 reporting categories with saved point-in-time snapshots for audit and management review.
            </p>
          </div>
          <StatusPill
            label={latestSnapshot ? `Latest ${new Date(latestSnapshot.generatedAt).toLocaleTimeString("en-US")}` : "No snapshot"}
            tone="info"
          />
        </div>
        <div className="panel-body">
          <div className="chip-row">
            {reportCategories.map((category) => (
              <span className="pill info" key={category}>
                {category}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Conversion funnel</h2>
              <p className="section-subtitle">Blueprint KPI path from raw lead capture to closed-won opportunity.</p>
            </div>
            <BarChart3 size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.funnelRows.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{formatNumber(row.from)}</td>
                    <td>{formatNumber(row.to)}</td>
                    <td>
                      <StatusPill label={formatRate(row.rate)} tone={row.rate >= 50 ? "success" : row.rate >= 20 ? "info" : "warning"} />
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
              <h2 className="section-title">Pipeline dashboard</h2>
              <p className="section-subtitle">Opportunity value, weighted value, and stage distribution.</p>
            </div>
            <PieChart size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Opps</th>
                  <th>Amount</th>
                  <th>Weighted</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.pipeline.map((row) => (
                  <tr key={row.stage}>
                    <td>
                      <StatusPill label={row.stage} tone={statusTone(row.stage)} />
                    </td>
                    <td>{formatNumber(row.opportunities)}</td>
                    <td>{formatCurrency(row.amount)}</td>
                    <td>{formatCurrency(row.weightedAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Lead source performance</h2>
            <p className="section-subtitle">Raw volume, verification, enrichment, opportunities, spend, and revenue by source lineage.</p>
          </div>
          <StatusPill label={`${snapshot.sourcePerformance.length} sources`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Raw</th>
                <th>Normalized</th>
                <th>Verified</th>
                <th>Enriched</th>
                <th>Opps</th>
                <th>Cost / verified</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.sourcePerformance.map((row) => (
                <tr key={row.source}>
                  <td>{row.source}</td>
                  <td>{formatNumber(row.raw)}</td>
                  <td>{formatNumber(row.normalized)}</td>
                  <td>{formatNumber(row.verified)}</td>
                  <td>{formatNumber(row.enriched)}</td>
                  <td>{formatNumber(row.opportunities)}</td>
                  <td>{formatCurrency(row.costPerVerified)}</td>
                  <td>{formatCurrency(row.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">SDR performance</h2>
              <p className="section-subtitle">Assignments, touches, replies, meetings, opportunities, revenue, and SLA health.</p>
            </div>
            <Users size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SDR</th>
                  <th>Assigned</th>
                  <th>Touched</th>
                  <th>Replies</th>
                  <th>Meetings</th>
                  <th>SLA</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.sdrPerformance.map((row) => (
                  <tr key={row.userId}>
                    <td>
                      <div className="entity">
                        <strong>{row.name}</strong>
                        <span>{formatCurrency(row.wonRevenue)} won revenue</span>
                      </div>
                    </td>
                    <td>{formatNumber(row.assigned)}</td>
                    <td>{formatNumber(row.touched)}</td>
                    <td>{formatNumber(row.replies)}</td>
                    <td>{formatNumber(row.meetings)}</td>
                    <td>
                      <StatusPill label={formatRate(row.slaRate)} tone={row.overdue ? "warning" : "success"} />
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
              <h2 className="section-title">Deliverability health</h2>
              <p className="section-subtitle">Bounce, complaint, unsubscribe, auth, usage, and alert guardrails.</p>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Rates</th>
                  <th>Usage</th>
                  <th>Auth</th>
                  <th>Alerts</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.deliverabilityHealth.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="entity">
                        <strong>{row.provider}</strong>
                        <span>{row.sender}</span>
                      </div>
                    </td>
                    <td>
                      <div className="chip-row">
                        <span className="pill">Bounce {formatRate(row.bounceRate)}</span>
                        <span className="pill">Spam {formatRate(row.complaintRate)}</span>
                        <span className="pill">Unsub {formatRate(row.unsubscribeRate)}</span>
                      </div>
                    </td>
                    <td>{formatRate(row.dailyUsage)}</td>
                    <td>{row.authChecks}/4</td>
                    <td>
                      <StatusPill label={`${row.alertCount} open`} tone={row.alertCount ? "warning" : "success"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Campaign performance</h2>
            <p className="section-subtitle">Campaign outcomes tied to replies, bounces, meetings, opportunities, and revenue won.</p>
          </div>
          <StatusPill label={`${snapshot.campaignPerformance.length} campaigns`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Leads</th>
                <th>Sent</th>
                <th>Replies</th>
                <th>Deliverability</th>
                <th>Meetings</th>
                <th>Opps</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.campaignPerformance.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <div className="entity">
                      <strong>{campaign.name}</strong>
                      <span>{campaign.targetSegment}</span>
                    </div>
                  </td>
                  <td>
                    <StatusPill label={campaign.status} tone={statusTone(campaign.status)} />
                  </td>
                  <td>{formatNumber(campaign.totalLeads)}</td>
                  <td>{formatNumber(campaign.sent)}</td>
                  <td>{formatNumber(campaign.replies)}</td>
                  <td>
                    <span className="metric-note">
                      Bounce {formatRate(campaign.bounceRate)} / Unsub {formatRate(campaign.unsubscribeRate)}
                    </span>
                  </td>
                  <td>{formatNumber(campaign.meetings)}</td>
                  <td>{formatNumber(campaign.opportunities)}</td>
                  <td>{formatCurrency(campaign.revenueWon)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid three">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Data quality</h2>
              <p className="section-subtitle">Duplicate, suppression, verification, and catch-all checks.</p>
            </div>
          </div>
          <div className="panel-body stage-list">
            {snapshot.dataQuality.map((row) => (
              <div className="list-row" key={row.label}>
                <div className="row-meta">
                  <strong>{row.label}</strong>
                  <StatusPill label={formatNumber(row.value)} tone={row.value ? "info" : "success"} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Enrichment performance</h2>
              <p className="section-subtitle">Provider volume, confidence, cache entries, and cache hits.</p>
            </div>
          </div>
          <div className="panel-body stage-list">
            {snapshot.enrichmentPerformance.map((row) => (
              <div className="list-row" key={row.provider}>
                <div className="row-meta">
                  <strong>{row.provider}</strong>
                  <StatusPill label={`${row.avgConfidence}%`} tone="success" />
                </div>
                <p className="section-subtitle">
                  {formatNumber(row.records)} records, {formatNumber(row.cacheEntries)} cache entries, {formatNumber(row.cacheHits)} hits.
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Activity volume</h2>
              <p className="section-subtitle">Email, SMS, call, and CRM activity totals.</p>
            </div>
          </div>
          <div className="panel-body stage-list">
            {snapshot.activityVolume.map((row) => (
              <div className="list-row" key={row.channel}>
                <div className="row-meta">
                  <strong>{row.channel}</strong>
                  <StatusPill label={formatNumber(row.count)} tone="info" />
                </div>
                <p className="section-subtitle">{row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleString("en-US") : "No activity yet"}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Revenue attribution</h2>
              <p className="section-subtitle">Revenue by source and SDR dimension.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dimension</th>
                  <th>Type</th>
                  <th>Opps</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.revenueAttribution.slice(0, 10).map((row) => (
                  <tr key={`${row.type}-${row.dimension}`}>
                    <td>{row.dimension}</td>
                    <td>
                      <StatusPill label={row.type} tone="info" />
                    </td>
                    <td>{formatNumber(row.opportunities)}</td>
                    <td>{formatCurrency(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Saved report snapshots</h2>
              <p className="section-subtitle">Point-in-time KPI evidence generated from Phase 7 dashboards.</p>
            </div>
            <StatusPill label={`${snapshot.snapshots.length} saved`} tone="info" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Generated</th>
                  <th>Metrics</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.snapshots.slice(0, 12).map((report) => (
                  <tr key={report.id}>
                    <td>{report.category}</td>
                    <td>{new Date(report.generatedAt).toLocaleString("en-US")}</td>
                    <td>
                      <div className="chip-row">
                        {report.metrics.slice(0, 3).map((metric) => (
                          <span className="pill" key={metric.label}>
                            {metric.label}: {formatSnapshotMetric(metric.value, metric.unit)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}


function formatRate(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function formatSnapshotMetric(value: number, unit?: "count" | "percent" | "currency") {
  if (unit === "currency") {
    return formatCurrency(value);
  }

  if (unit === "percent") {
    return formatRate(value);
  }

  return formatNumber(value);
}
