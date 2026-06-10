import { Mail, Phone, ShieldCheck } from "lucide-react";
import { CsvImportForm } from "@/components/csv-import-form";
import { PageHeader } from "@/components/page-header";
import { StagingWorkbench } from "@/components/staging-workbench";
import { StatusPill } from "@/components/status-pill";
import { contactRowsForStaging } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";

export const dynamic = "force-dynamic";

export default async function StagingPage() {
  const { state, workspaceId } = await getWorkspaceContext("import_csv");
  const profiles = state.searchProfiles
    .filter((profile) => profile.workspaceId === workspaceId)
    .map((profile) => ({ id: profile.id, name: profile.name }));
  const leads = contactRowsForStaging(state, workspaceId);

  return (
    <>
      <PageHeader
        kicker="Raw staging and QA"
        title="Lead staging"
        copy="Normalize, dedupe, suppress, verify, enrich, segment, and score records before anything reaches SDR assignment or verified exports."
        actions={
          <>
            <a className="button secondary" href="#import-csv">
              Import CSV
            </a>
            <a className="button primary" href="/exports">
              Export ready leads
            </a>
          </>
        }
      />

      <CsvImportForm profiles={profiles} />
      <StagingWorkbench leads={leads} />

      <section className="grid three">
        <div className="item-card">
          <div className="item-card-header">
            <div>
              <h2 className="card-title">Verified export gate</h2>
              <p className="section-subtitle">A/B emails pass; C gets risk-labeled; D and S stay blocked.</p>
            </div>
            <Mail size={20} aria-hidden="true" />
          </div>
          <StatusPill label="Deliverability protected" tone="success" />
        </div>
        <div className="item-card">
          <div className="item-card-header">
            <div>
              <h2 className="card-title">Phone readiness</h2>
              <p className="section-subtitle">Phone-ready segments stay separate from email-only exports.</p>
            </div>
            <Phone size={20} aria-hidden="true" />
          </div>
          <StatusPill label="DNC aware" tone="info" />
        </div>
        <div className="item-card">
          <div className="item-card-header">
            <div>
              <h2 className="card-title">Suppression first</h2>
              <p className="section-subtitle">Existing customers, unsubscribes, bounces, and DNC records are blocked early.</p>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <StatusPill label="Global blocklist" tone="warning" />
        </div>
      </section>
    </>
  );
}
