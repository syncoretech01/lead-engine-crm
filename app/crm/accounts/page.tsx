import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CircleDollarSign,
  ClipboardList,
  Target,
  Users
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { MeterBar } from "@/components/ui/meter-bar";
import { Panel } from "@/components/ui/panel";
import { StatCard, ToneIcon } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import {
  readFastCrmOverviewModel,
  type FastCrmAccountView,
  type FastCrmOpportunityView
} from "@/lib/phase1/crm-overview-read-model";
import { opportunityStages } from "@/lib/phase1/crm";
import { restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { accountViewsForWorkspace, opportunityViews, ownedCrmRecordScope } from "@/lib/phase1/queries";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const sessionContext = await getWorkspaceSessionContext("manage_crm");
  let session = sessionContext.session;
  let workspaceId = sessionContext.workspaceId;
  let accounts: FastCrmAccountView[] = [];
  let opportunities: FastCrmOpportunityView[] = [];
  const fastModel = await readFastCrmOverviewModel(session, workspaceId);

  if (fastModel) {
    accounts = fastModel.accounts;
    opportunities = fastModel.opportunities;
  } else {
    const context = await getWorkspaceContext("manage_crm");
    const state = context.state;
    session = context.session;
    workspaceId = context.workspaceId;
    const crmRows = await crmEventReadRowsForWorkspace(state, workspaceId);
    const readState = stateWithCrmEventReadRows(state, workspaceId, crmRows);
    const ownedScope = restrictsToOwnedRecords(session) ? ownedCrmRecordScope(readState, session) : null;
    const allAccounts = await accountViewsForWorkspace(readState, workspaceId);
    accounts = ownedScope ? allAccounts.filter((account) => ownedScope.companyIds.has(account.id)) : allAccounts;
    opportunities = ownedScope
      ? opportunityViews(readState, workspaceId).filter((opportunity) => opportunity.ownerUserId === session.user.id)
      : opportunityViews(readState, workspaceId);
  }
  const isSdr = session.role === "SDR";
  const openOpportunities = opportunities.filter(
    (opportunity) => opportunity.stage !== "Closed won" && opportunity.stage !== "Closed lost"
  );
  const openPipeline = openOpportunities.reduce((total, opportunity) => total + opportunity.amount, 0);
  const taskAccounts = accounts.filter((account) => account.openTasks > 0);
  const p1Accounts = accounts.filter((account) => account.priority === "P1");
  const totalContacts = accounts.reduce((total, account) => total + account.contacts, 0);
  const stageRows = opportunityStages
    .map((stage) => {
      const stageAccounts = accounts.filter((account) => account.stage === stage);
      const stageAmount = stageAccounts.reduce((total, account) => total + account.amount, 0);

      return { stage, count: stageAccounts.length, amount: stageAmount };
    })
    .filter((row) => row.count > 0);
  const maxStageCount = Math.max(...stageRows.map((row) => row.count), 1);
  const watchlist = [...accounts]
    .sort((a, b) => b.openTasks - a.openTasks || priorityWeight(a.priority) - priorityWeight(b.priority) || b.score - a.score)
    .slice(0, 8);
  const sourceRows = sourceSummary(accounts).slice(0, 5);

  const metrics = [
    {
      label: isSdr ? "My accounts" : "CRM accounts",
      value: formatNumber(accounts.length),
      note: `${formatNumber(totalContacts)} linked contacts`,
      icon: Building2,
      tone: "info" as const
    },
    {
      label: isSdr ? "Contacts" : "P1 accounts",
      value: formatNumber(isSdr ? totalContacts : p1Accounts.length),
      note: isSdr ? "People tied to these accounts" : "Highest-priority account focus",
      icon: isSdr ? Users : Target,
      tone: p1Accounts.length || isSdr ? "success" as const : "info" as const
    },
    {
      label: "Accounts with tasks",
      value: formatNumber(taskAccounts.length),
      note: "Open account or contact work",
      icon: ClipboardList,
      tone: taskAccounts.length ? "warning" as const : "success" as const
    },
    {
      label: isSdr ? "Priority accounts" : "Open pipeline",
      value: isSdr ? formatNumber(p1Accounts.length) : formatCurrency(openPipeline),
      note: isSdr ? "Highest account priority" : `${formatNumber(openOpportunities.length)} open opportunities`,
      icon: isSdr ? Target : CircleDollarSign,
      tone: p1Accounts.length || !isSdr ? "success" as const : "info" as const
    }
  ];

  const lanes = [
    {
      label: "P1 accounts",
      value: p1Accounts.length,
      note: "Highest account priority",
      icon: Target,
      tone: p1Accounts.length ? "success" as const : "info" as const
    },
    {
      label: "Open work",
      value: taskAccounts.length,
      note: "Accounts with tasks",
      icon: ClipboardList,
      tone: taskAccounts.length ? "warning" as const : "success" as const
    },
    {
      label: isSdr ? "Contacts" : "Open deals",
      value: isSdr ? totalContacts : openOpportunities.length,
      note: isSdr ? "Linked to accounts" : formatCurrency(openPipeline),
      icon: isSdr ? Users : CircleDollarSign,
      tone: isSdr ? "info" as const : "success" as const
    },
    {
      label: "Sources",
      value: sourceRows.length,
      note: "Account acquisition lanes",
      icon: Building2,
      tone: "info" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Sales CRM"
        title={isSdr ? "My accounts" : "Accounts"}
        copy={
          isSdr
            ? "Assigned account context for the people you are working: contacts, tasks, priority, and recent activity."
            : "A clean account workspace for SDRs and managers: spot priority companies, see pipeline stage health, and open the right account without digging through backend details."
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={isSdr ? "/crm/contacts" : "/crm"}>
                {isSdr ? <Users aria-hidden="true" /> : <BarChart3 aria-hidden="true" />}
                {isSdr ? "Contacts" : "CRM workspace"}
              </Link>
            </Button>
            <Button asChild>
              <Link href={isSdr ? "/sdr/queue" : "/crm/opportunities"}>
                {isSdr ? <ClipboardList aria-hidden="true" /> : <CircleDollarSign aria-hidden="true" />}
                {isSdr ? "My queue" : "Pipeline"}
              </Link>
            </Button>
          </>
        }
      />

      <section aria-label="Account metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <StatCard
            key={metric.label}
            icon={metric.icon}
            label={metric.label}
            value={metric.value}
            note={metric.note}
            tone={metric.tone}
          />
        ))}
      </section>

      <section aria-label="Account lanes" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {lanes.map((lane) => (
          <div key={lane.label} className="bg-card flex items-center gap-3 rounded-xl border p-4 shadow-sm">
            <ToneIcon icon={lane.icon} tone={lane.tone} />
            <div className="min-w-0">
              <div className="text-lg font-semibold text-foreground">{formatNumber(lane.value)}</div>
              <div className="truncate text-xs text-muted-foreground">
                {lane.label} · {lane.note}
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title={isSdr ? "Account focus" : "Account watchlist"}
          subtitle={
            isSdr
              ? "Accounts with assigned contacts, open work, or high priority appear first."
              : "Accounts with open work, high priority, or strong score should be handled first."
          }
          action={<StatusBadge label={`${watchlist.length} focus`} tone="info" />}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                {!isSdr ? <TableHead>Owner</TableHead> : null}
                <TableHead>Stage</TableHead>
                <TableHead>{isSdr ? "Contacts" : "Tasks"}</TableHead>
                <TableHead>{isSdr ? "Next action" : "Score"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {watchlist.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>
                    <Link href={`/crm/accounts/${account.id}`} className="flex flex-col">
                      <span className="font-medium text-foreground">{account.name}</span>
                      <span className="text-xs text-muted-foreground">{account.domain}</span>
                      <span className="text-xs text-muted-foreground">{account.source}</span>
                    </Link>
                  </TableCell>
                  {!isSdr ? <TableCell className="text-muted-foreground">{account.owner}</TableCell> : null}
                  <TableCell>
                    <StatusBadge label={account.stage} />
                  </TableCell>
                  <TableCell>
                    {isSdr ? (
                      <span className="text-muted-foreground">{formatNumber(account.contacts)}</span>
                    ) : (
                      <StatusBadge label={`${account.openTasks}`} tone={account.openTasks ? "warning" : "success"} />
                    )}
                  </TableCell>
                  <TableCell>
                    {isSdr ? (
                      <StatusBadge label={accountNextAction(account).label} tone={accountNextAction(account).tone} />
                    ) : (
                      <span className="text-muted-foreground">{account.score}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>

        {isSdr ? (
          <Panel
            title="Account coverage"
            subtitle="A quick split of the accounts and contacts in your current scope."
            action={<ToneIcon icon={Users} tone="info" />}
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">Accounts with contacts</span>
                  <StatusBadge
                    label={`${formatNumber(accounts.filter((account) => account.contacts > 0).length)} accounts`}
                    tone="info"
                  />
                </div>
                <MeterBar value={accounts.length ? Math.round((accounts.filter((account) => account.contacts > 0).length / accounts.length) * 100) : 0} />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">Open work</span>
                  <StatusBadge label={`${formatNumber(taskAccounts.length)} accounts`} tone={taskAccounts.length ? "warning" : "success"} />
                </div>
                <MeterBar value={accounts.length ? Math.round((taskAccounts.length / accounts.length) * 100) : 0} />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">Priority focus</span>
                  <StatusBadge label={`${formatNumber(p1Accounts.length)} accounts`} tone={p1Accounts.length ? "success" : "info"} />
                </div>
                <MeterBar value={accounts.length ? Math.round((p1Accounts.length / accounts.length) * 100) : 0} />
              </div>
            </div>
          </Panel>
        ) : (
          <Panel
            title="Stage overview"
            subtitle="Account distribution by active opportunity stage."
            action={<ToneIcon icon={CircleDollarSign} tone="info" />}
          >
            <div className="flex flex-col gap-4">
              {stageRows.map((row) => (
                <div className="flex flex-col gap-1.5" key={row.stage}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">{row.stage}</span>
                    <StatusBadge label={`${formatNumber(row.count)} accounts`} />
                  </div>
                  <MeterBar value={Math.round((row.count / maxStageCount) * 100)} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatCurrency(row.amount)}</span>
                    <span>{Math.round((row.count / accounts.length) * 100)}% of accounts</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {isSdr ? (
          <Panel
            title="Recent account context"
            subtitle="The accounts you are most likely to open while working your queue."
            action={<ToneIcon icon={Target} tone="info" />}
          >
            <div className="flex flex-col gap-4">
              {watchlist.slice(0, 4).map((account) => (
                <div key={account.id} className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">{account.name}</span>
                    <StatusBadge label={accountNextAction(account).label} tone={accountNextAction(account).tone} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(account.contacts)} contacts, score {account.score}, {account.lastActivity}.
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        ) : (
          <Panel
            title="Source mix"
            subtitle="Where CRM accounts came from, kept visible for attribution and list quality review."
            action={<ToneIcon icon={Target} tone="info" />}
          >
            <div className="flex flex-col gap-4">
              {sourceRows.map((row) => (
                <div key={row.source} className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">{row.source}</span>
                    <StatusBadge label={`${formatNumber(row.count)} accounts`} tone="info" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(row.contacts)} contacts, average score {row.averageScore}.
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <Panel
          title="Account actions"
          subtitle={isSdr ? "Fast paths back to daily contact work." : "Shortcuts for the CRM work around account records."}
          action={<ToneIcon icon={ArrowRight} tone="info" />}
        >
          <div className={`grid gap-4 ${isSdr ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
            <Link
              href="/crm/contacts"
              className="group bg-card flex flex-col gap-2 rounded-xl border p-4 shadow-sm transition-colors hover:border-[var(--syn-primary)]"
            >
              <ToneIcon icon={Users} tone="info" />
              <h3 className="text-sm font-semibold text-foreground">Contacts</h3>
              <p className="text-xs text-muted-foreground">Open people linked to CRM accounts.</p>
            </Link>
            {!isSdr ? (
              <Link
                href="/crm/opportunities"
                className="group bg-card flex flex-col gap-2 rounded-xl border p-4 shadow-sm transition-colors hover:border-[var(--syn-primary)]"
              >
                <ToneIcon icon={CircleDollarSign} tone="info" />
                <h3 className="text-sm font-semibold text-foreground">Pipeline</h3>
                <p className="text-xs text-muted-foreground">Review stage, amount, owner, and forecast.</p>
              </Link>
            ) : null}
            <Link
              href="/sdr/queue"
              className="group bg-card flex flex-col gap-2 rounded-xl border p-4 shadow-sm transition-colors hover:border-[var(--syn-primary)]"
            >
              <ToneIcon icon={ClipboardList} tone="info" />
              <h3 className="text-sm font-semibold text-foreground">{isSdr ? "My queue" : "SDR queue"}</h3>
              <p className="text-xs text-muted-foreground">Work assigned contacts from account context.</p>
            </Link>
          </div>
        </Panel>
      </section>

      <section aria-label="Account directory">
        <Panel
          title="Account directory"
          subtitle={
            isSdr
              ? "A compact list of accounts tied to your visible contacts."
              : "A compact account table for scanning owner, stage, activity, and source context."
          }
          action={<StatusBadge label={`${formatNumber(accounts.length)} accounts`} tone="info" />}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                {!isSdr ? <TableHead>Owner</TableHead> : null}
                <TableHead>Stage</TableHead>
                <TableHead>Contacts</TableHead>
                <TableHead>Open work</TableHead>
                {!isSdr ? <TableHead>Pipeline</TableHead> : null}
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>
                    <Link href={`/crm/accounts/${account.id}`} className="flex flex-col">
                      <span className="font-medium text-foreground">{account.name}</span>
                      <span className="text-xs text-muted-foreground">{account.domain}</span>
                      <span className="text-xs text-muted-foreground">{account.location || account.industry}</span>
                    </Link>
                  </TableCell>
                  {!isSdr ? <TableCell className="text-muted-foreground">{account.owner}</TableCell> : null}
                  <TableCell>
                    <StatusBadge label={account.stage} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatNumber(account.contacts)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{formatNumber(account.openTasks)} tasks</span>
                      <span className="text-xs text-muted-foreground">{account.lastActivity}</span>
                    </div>
                  </TableCell>
                  {!isSdr ? <TableCell className="text-muted-foreground">{formatCurrency(account.amount)}</TableCell> : null}
                  <TableCell className="text-muted-foreground">{account.source}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </section>
    </>
  );
}

type AccountView = FastCrmAccountView;

function accountNextAction(account: AccountView): { label: string; tone: "success" | "info" | "warning" | "danger" } {
  if (account.openTasks > 0) {
    return { label: "Work task", tone: "warning" };
  }

  if (account.contacts > 0) {
    return { label: "Open contacts", tone: "info" };
  }

  if (account.amount > 0) {
    return { label: "Review account", tone: "info" };
  }

  return { label: "Review", tone: "warning" };
}


function sourceSummary(accounts: AccountView[]) {
  const rows = new Map<string, { source: string; count: number; contacts: number; score: number }>();

  for (const account of accounts) {
    const existing = rows.get(account.source) ?? { source: account.source, count: 0, contacts: 0, score: 0 };
    existing.count += 1;
    existing.contacts += account.contacts;
    existing.score += account.score;
    rows.set(account.source, existing);
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      averageScore: row.count ? Math.round(row.score / row.count) : 0
    }))
    .sort((a, b) => b.count - a.count);
}

function priorityWeight(priority: string) {
  if (priority === "P1") return 1;
  if (priority === "P2") return 2;
  if (priority === "P3") return 3;
  if (priority === "P4") return 4;
  return 5;
}
