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
  const openOpportunities = opportunities.filter(
    (opportunity) => opportunity.stage !== "Closed won" && opportunity.stage !== "Closed lost"
  );
  const openPipeline = openOpportunities.reduce((total, opportunity) => total + opportunity.amount, 0);
  const taskAccounts = accounts.filter((account) => account.openTasks > 0);
  const p1Accounts = accounts.filter((account) => account.priority === "P1");
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
      label: "CRM accounts",
      value: formatNumber(accounts.length),
      note: `${formatNumber(accounts.reduce((total, account) => total + account.contacts, 0))} linked contacts`,
      icon: Building2,
      tone: "info" as const
    },
    {
      label: "P1 accounts",
      value: formatNumber(p1Accounts.length),
      note: "Highest-priority account focus",
      icon: Target,
      tone: p1Accounts.length ? "success" as const : "info" as const
    },
    {
      label: "Open pipeline",
      value: formatCurrency(openPipeline),
      note: `${formatNumber(openOpportunities.length)} open opportunities`,
      icon: CircleDollarSign,
      tone: "success" as const
    },
    {
      label: "Accounts with tasks",
      value: formatNumber(taskAccounts.length),
      note: "Open account or contact work",
      icon: ClipboardList,
      tone: taskAccounts.length ? "warning" as const : "success" as const
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
      label: "Open deals",
      value: openOpportunities.length,
      note: formatCurrency(openPipeline),
      icon: CircleDollarSign,
      tone: "success" as const
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
        title="Accounts"
        copy="A clean account workspace for SDRs and managers: spot priority companies, see pipeline stage health, and open the right account without digging through backend details."
        actions={
          <>
            <Link href="/crm" className="button secondary">
              <BarChart3 size={17} aria-hidden="true" />
              CRM workspace
            </Link>
            <Link href="/crm/opportunities" className="button primary">
              <CircleDollarSign size={17} aria-hidden="true" />
              Pipeline
            </Link>
          </>
        }
      />

      <section className="stat-grid" aria-label="Account metrics">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className="ops-stage-strip four-up" aria-label="Account operating lanes">
        {lanes.map((lane) => (
          <LaneCard key={lane.label} {...lane} />
        ))}
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Account watchlist</h2>
              <p className="section-subtitle">Accounts with open work, high priority, or strong score should be handled first.</p>
            </div>
            <StatusPill label={`${watchlist.length} focus`} tone="info" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Owner</th>
                  <th>Stage</th>
                  <th>Tasks</th>
                  <th>Score</th>
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
                    <td>{account.owner}</td>
                    <td>
                      <StatusPill label={account.stage} tone={statusTone(account.stage)} />
                    </td>
                    <td>
                      <StatusPill label={`${account.openTasks}`} tone={account.openTasks ? "warning" : "success"} />
                    </td>
                    <td>{account.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

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
      </section>

      <section className="grid two">
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

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Account actions</h2>
              <p className="section-subtitle">Shortcuts for the CRM work around account records.</p>
            </div>
            <ArrowRight size={20} aria-hidden="true" />
          </div>
          <div className="panel-body grid three">
            <Link href="/crm/contacts" className="item-card compact-profile-card">
              <Users size={22} aria-hidden="true" />
              <h3 className="card-title">Contacts</h3>
              <p className="section-subtitle">Open people linked to CRM accounts.</p>
            </Link>
            <Link href="/crm/opportunities" className="item-card compact-profile-card">
              <CircleDollarSign size={22} aria-hidden="true" />
              <h3 className="card-title">Pipeline</h3>
              <p className="section-subtitle">Review stage, amount, owner, and forecast.</p>
            </Link>
            <Link href="/sdr/queue" className="item-card compact-profile-card">
              <ClipboardList size={22} aria-hidden="true" />
              <h3 className="card-title">SDR queue</h3>
              <p className="section-subtitle">Work assigned contacts from account context.</p>
            </Link>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Account directory</h2>
            <p className="section-subtitle">A compact account table for scanning owner, stage, activity, and source context.</p>
          </div>
          <StatusPill label={`${formatNumber(accounts.length)} accounts`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Owner</th>
                <th>Stage</th>
                <th>Contacts</th>
                <th>Open work</th>
                <th>Pipeline</th>
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
                  <td>{account.owner}</td>
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
                  <td>{formatCurrency(account.amount)}</td>
                  <td>{account.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

type AccountView = FastCrmAccountView;


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
