import { readFastCrmOverviewModel } from "@/lib/phase1/crm-overview-read-model";
import { opportunityStages } from "@/lib/phase1/crm";
import { getWorkspaceSessionContext } from "@/lib/phase1/store";
import { OpportunitiesView, type CockpitOpportunityRow } from "@/components/crm/cockpit/opportunities-view";

export const dynamic = "force-dynamic";

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

function closeLabel(iso?: string): string {
  if (!iso) return "Not set";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleString("en-US", { month: "short", day: "numeric" });
}

export default async function OpportunitiesPage() {
  const { session, workspaceId } = await getWorkspaceSessionContext("manage_crm");
  const isSdr = session.role === "SDR";

  const model = await readFastCrmOverviewModel(session, workspaceId);
  const opportunities = model?.opportunities ?? [];

  const isClosed = (stage: string) => stage === "Closed won" || stage === "Closed lost";
  const open = opportunities.filter((opportunity) => !isClosed(opportunity.stage));
  const openPipeline = open.reduce((sum, opportunity) => sum + opportunity.amount, 0);

  const rows: CockpitOpportunityRow[] = opportunities.map((opportunity) => ({
    id: opportunity.id,
    name: opportunity.name,
    companyId: opportunity.companyId,
    companyName: opportunity.companyName,
    contactName: opportunity.contactName === "No primary contact" ? "" : opportunity.contactName,
    contactId: opportunity.contactId,
    stage: opportunity.stage,
    amount: opportunity.amount,
    amountLabel: money(opportunity.amount),
    probability: opportunity.probability,
    closeLabel: closeLabel(opportunity.expectedCloseDate),
    nextStep: opportunity.lastActivity
  }));

  return (
    <div className="cockpit min-h-full px-6 py-6 md:px-8">
      <OpportunitiesView
        title={isSdr ? "My opportunities" : "Opportunities"}
        subline={`${open.length} open · ${money(openPipeline)} pipeline · probability auto-maps to stage`}
        rows={rows}
        stages={[...opportunityStages]}
      />
    </div>
  );
}
