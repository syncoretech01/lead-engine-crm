import { AccountActions, type AccountActionContact } from "@/components/crm/cockpit/account-actions";
import { AccountDossier, type AccountDossierData } from "@/components/crm/cockpit/account-dossier";

// The standalone cockpit account page: the AccountDossier (identity + compliance
// band + scan strip + 5 tabs) plus a right rail — an account-health summary and
// the shared account actions (add task / opportunity / note / log call). Mirrors
// the contact workbench layout so both record pages read as one system.

export type AccountHealth = {
  pipelineLabel: string;
  weightedLabel: string;
  contactsCount: number;
  openTasksCount: number;
};

export function AccountWorkbench({
  account,
  health,
  actionContacts,
  source,
  stages,
  outcomes
}: {
  account: AccountDossierData;
  health: AccountHealth;
  actionContacts: AccountActionContact[];
  source: string;
  stages: readonly string[];
  outcomes: readonly string[];
}) {
  return (
    <div className="cockpit flex min-h-[calc(100vh-3.5rem)] w-full bg-co-page">
      <main className="min-w-0 flex-1 overflow-y-auto bg-white">
        <AccountDossier account={account} />
      </main>

      <aside className="hidden w-[360px] shrink-0 flex-col gap-4 border-l border-co-border bg-co-sunken p-4 xl:flex [@media(max-width:1200px)]:w-[320px]">
        <div className="rounded-[10px] border border-[#bcd8ff] bg-[#eaf3ff] p-3.5">
          <div className="text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-co-blue-dark">Account health</div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <HealthStat label="Open pipeline" value={health.pipelineLabel} />
            <HealthStat label="Weighted" value={health.weightedLabel} />
            <HealthStat label="Contacts" value={String(health.contactsCount)} />
            <HealthStat label="Open tasks" value={String(health.openTasksCount)} />
          </div>
        </div>

        <AccountActions
          accountId={account.id}
          accountName={account.name}
          source={source}
          contacts={actionContacts}
          stages={stages}
          outcomes={outcomes}
        />
      </aside>
    </div>
  );
}

function HealthStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.05em] text-co-blue-dark opacity-70">{label}</div>
      <div className="mt-0.5 text-[14px] font-extrabold tabular-nums text-co-ink">{value}</div>
    </div>
  );
}
