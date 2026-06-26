import Link from "next/link";
import {
  BadgeCheck,
  Database,
  Download,
  Filter,
  GitMerge,
  Mail,
  Phone,
  ShieldCheck,
  Upload,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CsvImportForm } from "@/components/csv-import-form";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StagingWorkbench } from "@/components/staging-workbench";
import { StatusPill } from "@/components/status-pill";
import { readFastLeadDashboardState } from "@/lib/phase1/lead-dashboard-read-model";
import { buildLeadEngineMetrics } from "@/lib/phase1/lead-engine-metrics";
import { contactRowsForStaging } from "@/lib/phase1/queries";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";
import { StatCard, LaneCard } from "@/components/ui-metrics";

export const dynamic = "force-dynamic";

type StagedLead = ReturnType<typeof contactRowsForStaging>[number];

export default async function StagingPage() {
  const sessionContext = await getWorkspaceSessionContext("import_csv");
  let { workspaceId } = sessionContext;
  let state = await readFastLeadDashboardState(sessionContext.session, workspaceId);

  if (!state) {
    const context = await getWorkspaceContext("import_csv");
    state = context.state;
    workspaceId = context.workspaceId;
  }

  const profiles = state.searchProfiles
    .filter((profile) => profile.workspaceId === workspaceId)
    .map((profile) => ({ id: profile.id, name: profile.name }));
  const rawLeads = state.rawLeads.filter((lead) => lead.workspaceId === workspaceId);
  const leads = contactRowsForStaging(state, workspaceId);
  const metrics = buildLeadEngineMetrics(state, workspaceId);
  const verified = metrics.verifiedCount;
  const needsReview = metrics.needsReviewCount;
  const suppressed = metrics.suppressedCount;
  const phoneReady = metrics.phoneReadyCount;
  const readyForSdr = metrics.readyForSdrCount;
  const duplicateCandidates = metrics.duplicateGroupCount;
  const exportReady = metrics.exportReadyCount;
  const sourceRows = sourceSummaries(leads).slice(0, 5);
  const segmentRows = segmentSummaries(leads).slice(0, 5);
  const reviewRows = leads.filter((lead) => needsOperatorReview(lead)).slice(0, 5);

  const stats = [
    {
      label: "Staged records",
      value: formatNumber(leads.length),
      note: `${formatNumber(rawLeads.length)} raw rows imported`,
      icon: Database,
      tone: "info" as const
    },
    {
      label: "Ready A/B",
      value: formatNumber(verified),
      note: "Eligible for strict email export",
      icon: BadgeCheck,
      tone: "success" as const
    },
    {
      label: "Needs review",
      value: formatNumber(needsReview),
      note: "Risky, invalid, or enrichment-needed rows",
      icon: Filter,
      tone: needsReview ? "warning" as const : "success" as const
    },
    {
      label: "Phone ready",
      value: formatNumber(phoneReady),
      note: "Rows with callable phone data",
      icon: Phone,
      tone: "info" as const
    }
  ];

  const pipeline = [
    {
      label: "Raw imported",
      value: rawLeads.length,
      note: "Source rows captured",
      icon: Upload,
      tone: "info" as const
    },
    {
      label: "Normalized",
      value: leads.length,
      note: "Company/contact shaped",
      icon: GitMerge,
      tone: "info" as const
    },
    {
      label: "Ready for SDR",
      value: readyForSdr,
      note: "Routed downstream",
      icon: Users,
      tone: "success" as const
    },
    {
      label: "Review queue",
      value: needsReview,
      note: "Operator decision needed",
      icon: Filter,
      tone: needsReview ? "warning" as const : "success" as const
    },
    {
      label: "Blocked",
      value: suppressed,
      note: "Suppression enforced",
      icon: ShieldCheck,
      tone: suppressed ? "warning" as const : "success" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Lead generation"
        title="Lead staging"
        copy="Review normalized leads before CRM handoff: verify grade, dedupe, suppression, enrichment, segment, score, and ownership readiness."
        actions={
          <>
            <a className="button secondary" href="#import-csv">
              <Upload size={17} aria-hidden="true" />
              Import CSV
            </a>
            <Link className="button primary" href="/exports">
              <Download size={17} aria-hidden="true" />
              Export ready leads
            </Link>
          </>
        }
      />

      <section className="stat-grid" aria-label="Lead staging metrics">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="ops-stage-strip" aria-label="Lead staging pipeline">
        {pipeline.map((stage) => (
          <LaneCard key={stage.label} {...stage} />
        ))}
      </section>

      <section className="grid two staging-ops-grid">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <div className="page-kicker">Triage</div>
              <h2 className="section-title">Operator review queue</h2>
              <p className="section-subtitle">The rows most likely to need enrichment, suppression review, or grade confirmation.</p>
            </div>
            <StatusPill label={`${formatNumber(needsReview)} review`} tone={needsReview ? "warning" : "success"} />
          </div>
          <div className="panel-body signal-list">
            {reviewRows.map((lead) => (
              <div className="signal-row" key={lead.id}>
                <div className="signal-main">
                  <span className={`grade ${lead.emailGrade.toLowerCase()}`}>{lead.emailGrade}</span>
                  <div>
                    <strong>{lead.contactName || lead.company}</strong>
                    <span>{lead.verification}</span>
                  </div>
                </div>
                <div className="signal-meta">
                  <StatusPill label={lead.status} tone={lead.status === "Suppressed" ? "warning" : "info"} />
                  <span>{lead.source}</span>
                </div>
              </div>
            ))}
            {reviewRows.length === 0 ? (
              <div className="empty-state compact-empty">
                <BadgeCheck size={22} aria-hidden="true" />
                <span>No staged rows need review right now.</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <div className="page-kicker">Coverage</div>
              <h2 className="section-title">Source and segment lanes</h2>
              <p className="section-subtitle">A quick read on which lanes are producing export-ready records.</p>
            </div>
            <StatusPill label={`${formatNumber(exportReady)} export-ready`} tone={exportReady ? "success" : "warning"} />
          </div>
          <div className="panel-body split-signal-grid">
            <div className="mini-list">
              <h3>Sources</h3>
              {sourceRows.map((source) => (
                <SummaryMeter key={source.name} label={source.name} value={source.ready} total={source.total} note={`${formatNumber(source.review)} review`} />
              ))}
            </div>
            <div className="mini-list">
              <h3>Segments</h3>
              {segmentRows.map((segment) => (
                <SummaryMeter key={segment.name} label={segment.name} value={segment.ready} total={segment.total} note={`${formatNumber(segment.phone)} phone`} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <StagingWorkbench leads={leads} />

      <section className="grid three">
        <GateCard
          icon={Mail}
          title="Verified export gate"
          copy="A/B emails pass; C gets risk-labeled; D and S stay blocked."
          label={`${formatNumber(verified)} eligible`}
          tone="success"
        />
        <GateCard
          icon={Phone}
          title="Phone readiness"
          copy="Phone-ready segments stay separate from email-only exports."
          label={`${formatNumber(phoneReady)} callable`}
          tone="info"
        />
        <GateCard
          icon={ShieldCheck}
          title="Suppression first"
          copy={`${formatNumber(duplicateCandidates)} duplicate candidates and ${formatNumber(suppressed)} blocked rows stay out of export.`}
          label={`${formatNumber(suppressed)} blocked`}
          tone={suppressed ? "warning" : "success"}
        />
      </section>

      <CsvImportForm profiles={profiles} />
    </>
  );
}


function SummaryMeter({
  label,
  value,
  total,
  note
}: {
  label: string;
  value: number;
  total: number;
  note: string;
}) {
  const percent = total ? Math.round((value / total) * 100) : 0;

  return (
    <div className="summary-meter">
      <div className="row-meta">
        <strong>{label}</strong>
        <span>{formatNumber(value)} ready</span>
      </div>
      <ProgressBar value={percent} />
      <div className="row-meta">
        <span>{formatNumber(total)} total</span>
        <span>{note}</span>
      </div>
    </div>
  );
}

function GateCard({
  icon: Icon,
  title,
  copy,
  label,
  tone
}: {
  icon: LucideIcon;
  title: string;
  copy: string;
  label: string;
  tone: "success" | "info" | "warning";
}) {
  return (
    <article className={`lead-gate-card ${tone}`}>
      <span className="lead-gate-icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <div className="lead-gate-copy">
        <div>
          <strong>{title}</strong>
          <span>{copy}</span>
        </div>
        <StatusPill label={label} tone={tone} />
      </div>
    </article>
  );
}

function needsOperatorReview(lead: StagedLead) {
  return (
    lead.reviewReason !== "Ready" ||
    lead.status === "In review" ||
    lead.status === "Needs enrichment" ||
    lead.emailGrade === "C" ||
    lead.emailGrade === "D"
  );
}

function sourceSummaries(leads: StagedLead[]) {
  const rows = new Map<string, { total: number; ready: number; review: number }>();

  for (const lead of leads) {
    const current = rows.get(lead.source) ?? { total: 0, ready: 0, review: 0 };
    current.total += 1;
    if ((lead.emailGrade === "A" || lead.emailGrade === "B") && lead.status !== "Suppressed") current.ready += 1;
    if (needsOperatorReview(lead)) current.review += 1;
    rows.set(lead.source, current);
  }

  return Array.from(rows.entries())
    .map(([name, values]) => ({ name, ...values }))
    .sort((a, b) => b.total - a.total);
}

function segmentSummaries(leads: StagedLead[]) {
  const rows = new Map<string, { total: number; ready: number; phone: number }>();

  for (const lead of leads) {
    const name = lead.segment || "Unsegmented";
    const current = rows.get(name) ?? { total: 0, ready: 0, phone: 0 };
    current.total += 1;
    if ((lead.emailGrade === "A" || lead.emailGrade === "B") && lead.status !== "Suppressed") current.ready += 1;
    if (lead.phone) current.phone += 1;
    rows.set(name, current);
  }

  return Array.from(rows.entries())
    .map(([name, values]) => ({ name, ...values }))
    .sort((a, b) => b.total - a.total);
}
