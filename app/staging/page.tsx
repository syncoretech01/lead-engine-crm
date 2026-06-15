import { BadgeCheck, Mail, Phone, ShieldCheck, Upload } from "lucide-react";
import { CsvImportForm } from "@/components/csv-import-form";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { StagingWorkbench } from "@/components/staging-workbench";
import { StatusPill } from "@/components/status-pill";
import { contactRowsForStaging } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const metricIcons = [BadgeCheck, ShieldCheck, Mail, Phone];

export default async function StagingPage() {
  const { state, workspaceId } = await getWorkspaceContext("import_csv");
  const profiles = state.searchProfiles
    .filter((profile) => profile.workspaceId === workspaceId)
    .map((profile) => ({ id: profile.id, name: profile.name }));
  const leads = contactRowsForStaging(state, workspaceId);
  const verified = leads.filter((lead) => lead.emailGrade === "A" || lead.emailGrade === "B").length;
  const needsReview = leads.filter(
    (lead) => lead.status === "In review" || lead.status === "Needs enrichment" || lead.emailGrade === "C" || lead.emailGrade === "D"
  ).length;
  const suppressed = leads.filter((lead) => lead.status === "Suppressed" || lead.emailGrade === "S").length;
  const phoneReady = leads.filter((lead) => lead.phone).length;

  const metrics = [
    {
      label: "Staged records",
      value: leads.length,
      note: "Normalized rows awaiting review",
      tone: "info" as const
    },
    {
      label: "Ready A/B",
      value: verified,
      note: "Eligible for strict email export",
      tone: "success" as const
    },
    {
      label: "Needs review",
      value: needsReview,
      note: "Risky, invalid, or enrichment-needed rows",
      tone: needsReview ? "warning" as const : "success" as const
    },
    {
      label: "Phone ready",
      value: phoneReady,
      note: "Rows with callable phone data",
      tone: "info" as const
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
            <a className="button primary" href="/exports">
              Export ready leads
            </a>
          </>
        }
      />

      <section className="grid metrics" aria-label="Lead staging metrics">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? BadgeCheck;
          return <MetricCard key={metric.label} {...metric} icon={Icon} />;
        })}
      </section>

      <StagingWorkbench leads={leads} />

      <section className="grid three">
        <div className="item-card workflow-card">
          <div className="item-card-header">
            <div>
              <h2 className="card-title">Verified export gate</h2>
              <p className="section-subtitle">A/B emails pass; C gets risk-labeled; D and S stay blocked.</p>
            </div>
            <Mail size={20} aria-hidden="true" />
          </div>
          <StatusPill label={`${formatNumber(verified)} eligible`} tone="success" />
        </div>
        <div className="item-card workflow-card">
          <div className="item-card-header">
            <div>
              <h2 className="card-title">Phone readiness</h2>
              <p className="section-subtitle">Phone-ready segments stay separate from email-only exports.</p>
            </div>
            <Phone size={20} aria-hidden="true" />
          </div>
          <StatusPill label={`${formatNumber(phoneReady)} callable`} tone="info" />
        </div>
        <div className="item-card workflow-card">
          <div className="item-card-header">
            <div>
              <h2 className="card-title">Suppression first</h2>
              <p className="section-subtitle">Existing customers, unsubscribes, bounces, and DNC records are blocked early.</p>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <StatusPill label={`${formatNumber(suppressed)} blocked`} tone={suppressed ? "warning" : "success"} />
        </div>
      </section>

      <CsvImportForm profiles={profiles} />
    </>
  );
}
