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
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
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
import { StatCard, LaneCard } from "@/components/ui-metrics";
import { TileGrid, TileItem } from "@/components/tile-grid";
import { canCustomizeTiles, readUserTileLayout } from "@/lib/phase1/tile-layouts";

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

  const canCustomize = canCustomizeTiles(session);
  const savedLayout = await readUserTileLayout(session.user.id, "crm-accounts");

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
            <Link href={isSdr ? "/crm/contacts" : "/crm"} className="button secondary">
              {isSdr ? <Users size={17} aria-hidden="true" /> : <BarChart3 size={17} aria-hidden="true" />}
              {isSdr ? "Contacts" : "CRM workspace"}
            </Link>
            <Link href={isSdr ? "/sdr/queue" : "/crm/opportunities"} className="button primary">
              {isSdr ? <ClipboardList size={17} aria-hidden="true" /> : <CircleDollarSign size={17} aria-hidden="true" />}
              {isSdr ? "My queue" : "Pipeline"}
            </Link>
          </>
        }
      />

      <TileGrid pageKey="crm-accounts" canCustomize={canCustomize} saved={savedLayout}>
        {metrics.map((metric, index) => (
          <TileItem key={`metric-${index}`} id={`metric-${index}`} x={index * 3} y={0} w={3} h={2} minW={2}>
            <StatCard {...metric} />
          </TileItem>
        ))}
        {lanes.map((lane, index) => (
          <TileItem key={`lane-${index}`} id={`lane-${index}`} x={index * 3} y={2} w={3} h={2} minW={2}>
            <LaneCard {...lane} />
          </TileItem>
        ))}

        <TileItem id="account-watchlist" x={0} y={4} w={7} h={8} minW={4} minH={4}>
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">{isSdr ? "Account focus" : "Account watchlist"}</h2>
              <p className="section-subtitle">
                {isSdr
                  ? "Accounts with assigned contacts, open work, or high priority appear first."
                  : "Accounts with open work, high priority, or strong score should be handled first."}
              </p>
            </div>
            <StatusPill label={`${watchlist.length} focus`} tone="info" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  {!isSdr ? <th>Owner</th> : null}
                  <th>Stage</th>
                  <th>{isSdr ? "Contacts" : "Tasks"}</th>
                  <th>{isSdr ? "Next action" : "Score"}</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <Link href={`/crm/accounts/${account.id}`} className="entity">
                        <strong>{account.name}</strong>
                        <span>{account.domain}</span>
                        <span>{account.source}</span>
                      </Link>
                    </td>
                    {!isSdr ? <td>{account.owner}</td> : null}
                    <td>
                      <StatusPill label={account.stage} tone={statusTone(account.stage)} />
                    </td>
                    <td>
                      {isSdr ? (
                        formatNumber(account.contacts)
                      ) : (
                        <StatusPill label={`${account.openTasks}`} tone={account.openTasks ? "warning" : "success"} />
                      )}
                    </td>
                    <td>
                      {isSdr ? (
                        <StatusPill label={accountNextAction(account).label} tone={accountNextAction(account).tone} />
                      ) : (
                        account.score
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </TileItem>

        <TileItem id="watchlist-side" x={7} y={4} w={5} h={8} minW={3} minH={4}>
        {isSdr ? (
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <h2 className="section-title">Account coverage</h2>
                <p className="section-subtitle">A quick split of the accounts and contacts in your current scope.</p>
              </div>
              <Users size={20} aria-hidden="true" />
            </div>
            <div className="panel-body stage-list">
              <div className="stage-row">
                <div className="stage-meta">
                  <strong>Accounts with contacts</strong>
                  <StatusPill label={`${formatNumber(accounts.filter((account) => account.contacts > 0).length)} accounts`} tone="info" />
                </div>
                <ProgressBar value={accounts.length ? Math.round((accounts.filter((account) => account.contacts > 0).length / accounts.length) * 100) : 0} />
              </div>
              <div className="stage-row">
                <div className="stage-meta">
                  <strong>Open work</strong>
                  <StatusPill label={`${formatNumber(taskAccounts.length)} accounts`} tone={taskAccounts.length ? "warning" : "success"} />
                </div>
                <ProgressBar value={accounts.length ? Math.round((taskAccounts.length / accounts.length) * 100) : 0} />
              </div>
              <div className="stage-row">
                <div className="stage-meta">
                  <strong>Priority focus</strong>
                  <StatusPill label={`${formatNumber(p1Accounts.length)} accounts`} tone={p1Accounts.length ? "success" : "info"} />
                </div>
                <ProgressBar value={accounts.length ? Math.round((p1Accounts.length / accounts.length) * 100) : 0} />
              </div>
            </div>
          </div>
        ) : (
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <h2 className="section-title">Stage overview</h2>
                <p className="section-subtitle">Account distribution by active opportunity stage.</p>
              </div>
              <CircleDollarSign size={20} aria-hidden="true" />
            </div>
            <div className="panel-body stage-list">
              {stageRows.map((row) => (
                <div className="stage-row" key={row.stage}>
                  <div className="stage-meta">
                    <strong>{row.stage}</strong>
                    <StatusPill label={`${formatNumber(row.count)} accounts`} tone={statusTone(row.stage)} />
                  </div>
                  <ProgressBar value={Math.round((row.count / maxStageCount) * 100)} />
                  <div className="row-meta">
                    <span>{formatCurrency(row.amount)}</span>
                    <span>{Math.round((row.count / accounts.length) * 100)}% of accounts</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </TileItem>

        <TileItem id="secondary-left" x={0} y={12} w={7} h={6} minW={4} minH={3}>
        {isSdr ? (
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <h2 className="section-title">Recent account context</h2>
                <p className="section-subtitle">The accounts you are most likely to open while working your queue.</p>
              </div>
              <Target size={20} aria-hidden="true" />
            </div>
            <div className="panel-body stage-list">
              {watchlist.slice(0, 4).map((account) => (
                <div className="list-row" key={account.id}>
                  <div className="row-meta">
                    <strong>{account.name}</strong>
                    <StatusPill label={accountNextAction(account).label} tone={accountNextAction(account).tone} />
                  </div>
                  <p className="section-subtitle">
                    {formatNumber(account.contacts)} contacts, score {account.score}, {account.lastActivity}.
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <h2 className="section-title">Source mix</h2>
                <p className="section-subtitle">Where CRM accounts came from, kept visible for attribution and list quality review.</p>
              </div>
              <Target size={20} aria-hidden="true" />
            </div>
            <div className="panel-body stage-list">
              {sourceRows.map((row) => (
                <div className="list-row" key={row.source}>
                  <div className="row-meta">
                    <strong>{row.source}</strong>
                    <StatusPill label={`${formatNumber(row.count)} accounts`} tone="info" />
                  </div>
                  <p className="section-subtitle">
                    {formatNumber(row.contacts)} contacts, average score {row.averageScore}.
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        </TileItem>

        <TileItem id="account-actions" x={7} y={12} w={5} h={6} minW={3} minH={3}>
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Account actions</h2>
              <p className="section-subtitle">
                {isSdr ? "Fast paths back to daily contact work." : "Shortcuts for the CRM work around account records."}
              </p>
            </div>
            <ArrowRight size={20} aria-hidden="true" />
          </div>
          <div className={`panel-body grid ${isSdr ? "two" : "three"}`}>
            <Link href="/crm/contacts" className="item-card compact-profile-card">
              <Users size={22} aria-hidden="true" />
              <h3 className="card-title">Contacts</h3>
              <p className="section-subtitle">Open people linked to CRM accounts.</p>
            </Link>
            {!isSdr ? (
              <Link href="/crm/opportunities" className="item-card compact-profile-card">
                <CircleDollarSign size={22} aria-hidden="true" />
                <h3 className="card-title">Pipeline</h3>
                <p className="section-subtitle">Review stage, amount, owner, and forecast.</p>
              </Link>
            ) : null}
            <Link href="/sdr/queue" className="item-card compact-profile-card">
              <ClipboardList size={22} aria-hidden="true" />
              <h3 className="card-title">{isSdr ? "My queue" : "SDR queue"}</h3>
              <p className="section-subtitle">Work assigned contacts from account context.</p>
            </Link>
          </div>
        </div>
        </TileItem>

        <TileItem id="account-directory" x={0} y={18} w={12} h={7} minW={6} minH={3}>
        <div className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Account directory</h2>
            <p className="section-subtitle">
              {isSdr
                ? "A compact list of accounts tied to your visible contacts."
                : "A compact account table for scanning owner, stage, activity, and source context."}
            </p>
          </div>
          <StatusPill label={`${formatNumber(accounts.length)} accounts`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                {!isSdr ? <th>Owner</th> : null}
                <th>Stage</th>
                <th>Contacts</th>
                <th>Open work</th>
                {!isSdr ? <th>Pipeline</th> : null}
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <Link href={`/crm/accounts/${account.id}`} className="entity">
                      <strong>{account.name}</strong>
                      <span>{account.domain}</span>
                      <span>{account.location || account.industry}</span>
                    </Link>
                  </td>
                  {!isSdr ? <td>{account.owner}</td> : null}
                  <td>
                    <StatusPill label={account.stage} tone={statusTone(account.stage)} />
                  </td>
                  <td>{formatNumber(account.contacts)}</td>
                  <td>
                    <div className="entity">
                      <strong>{formatNumber(account.openTasks)} tasks</strong>
                      <span>{account.lastActivity}</span>
                    </div>
                  </td>
                  {!isSdr ? <td>{formatCurrency(account.amount)}</td> : null}
                  <td>{account.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
        </TileItem>
      </TileGrid>
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
