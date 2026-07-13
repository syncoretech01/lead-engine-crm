import { readFastCrmOverviewModel } from "@/lib/phase1/crm-overview-read-model";
import { getWorkspaceSessionContext } from "@/lib/phase1/store";
import { AccountsView, type CockpitAccountRow } from "@/components/crm/cockpit/accounts-view";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const { session, workspaceId } = await getWorkspaceSessionContext("manage_crm");
  const isSdr = session.role === "SDR";

  const model = await readFastCrmOverviewModel(session, workspaceId);
  const accounts = model?.accounts ?? [];

  const rows: CockpitAccountRow[] = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    domain: account.domain,
    industry: account.industry,
    location: account.location,
    stage: account.stage,
    primaryContactName: account.primaryContactName ?? "",
    primaryContactTitle: account.primaryContactTitle ?? "",
    lastActivity: account.lastActivity,
    hasOpportunity: account.opportunities > 0
  }));

  return (
    <div className="cockpit min-h-full px-6 py-6 md:px-8">
      <AccountsView
        title={isSdr ? "My accounts" : "Accounts"}
        subline={`${rows.length} account${rows.length === 1 ? "" : "s"} in your book`}
        rows={rows}
      />
    </div>
  );
}
