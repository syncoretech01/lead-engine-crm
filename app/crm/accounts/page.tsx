import Link from "next/link";
import { ArrowRight, Building2, CircleDollarSign, ListChecks, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import { opportunityStages } from "@/lib/phase1/crm";
import { accountViewsForWorkspace, opportunityViews } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const { state, workspaceId } = await getWorkspaceContext("view_all_records");
  const crmRows = await crmEventReadRowsForWorkspace(state, workspaceId);
  const readState = stateWithCrmEventReadRows(state, workspaceId, crmRows);
  const accounts = await accountViewsForWorkspace(readState, workspaceId);
  const opportunities = opportunityViews(readState, workspaceId);
  const stageOrder = opportunityStages.filter((stage) => accounts.some((account) => account.stage === stage));
  const openPipeline = opportunities
    .filter((opportunity) => opportunity.stage !== "Closed won" && opportunity.stage !== "Closed lost")
    .reduce((total, opportunity) => total + opportunity.amount, 0);

  return (
    <>
      <PageHeader
        kicker="Sales CRM"
        title="Accounts"
        copy="Golden company records become CRM accounts with contacts, opportunities, source history, activity, notes, tasks, and compliance context."
        actions={
          <>
            <Link href="/crm/contacts" className="button secondary">
              <ListChecks size={17} aria-hidden="true" />
              Contacts
            </Link>
            <Link href="/crm/opportunities" className="button primary">
              <Building2 size={17} aria-hidden="true" />
              Pipeline
            </Link>
          </>
        }
      />

      <section className="grid metrics">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Accounts</span>
            <Building2 size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{accounts.length}</div>
          <span className="metric-note">Golden companies promoted to CRM accounts.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Open pipeline</span>
            <CircleDollarSign size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatCurrency(openPipeline)}</div>
          <span className="metric-note">{opportunities.length} opportunities tracked.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Open tasks</span>
            <ListChecks size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">
            {readState.tasks.filter((task) => task.workspaceId === workspaceId && task.status !== "Completed").length}
          </div>
          <span className="metric-note">Account and contact work queue.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Activity events</span>
            <Users size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">
            {readState.activities.filter((activity) => activity.workspaceId === workspaceId).length}
          </div>
          <span className="metric-note">Calls, notes, tasks, and stage changes.</span>
        </article>
      </section>

      <section className="kanban" aria-label="Opportunity stages">
        {stageOrder.map((stage) => {
          const stageAccounts = accounts.filter((account) => account.stage === stage);

          return (
            <div className="kanban-column" key={stage}>
              <div className="workspace-row">
                <strong>{stage}</strong>
                <StatusPill label={`${stageAccounts.length}`} tone="info" />
              </div>
              {stageAccounts.map((account) => (
                <Link href={`/crm/accounts/${account.id}`} className="item-card" key={account.id}>
                  <div className="item-card-header">
                    <div>
                      <h2 className="card-title">{account.name}</h2>
                      <p className="section-subtitle">{account.location}</p>
                    </div>
                    <div className="score-ring">{account.score}</div>
                  </div>
                  <div className="chip-row">
                    <StatusPill label={account.priority} tone={account.priority === "P1" ? "success" : "warning"} />
                    <StatusPill label={formatCurrency(account.amount)} tone="info" />
                    <StatusPill label={`${account.openTasks} tasks`} tone={account.openTasks ? "warning" : "success"} />
                  </div>
                  <div className="row-meta">
                    <span>{account.owner}</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          );
        })}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Account table</h2>
            <p className="section-subtitle">Source-attributed accounts with opportunity and task context.</p>
          </div>
          <Users size={20} aria-hidden="true" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Priority</th>
                <th>Owner</th>
                <th>Stage</th>
                <th>Amount</th>
                <th>Contacts</th>
                <th>Opps</th>
                <th>Tasks</th>
                <th>Compliance</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <Link href={`/crm/accounts/${account.id}`} className="entity">
                      <strong>{account.name}</strong>
                      <span>{account.domain}</span>
                      <span>{account.industry}</span>
                    </Link>
                  </td>
                  <td>
                    <StatusPill label={account.priority} tone={account.priority === "P1" ? "success" : "warning"} />
                  </td>
                  <td>{account.owner}</td>
                  <td>
                    <StatusPill label={account.stage} tone={statusTone(account.stage)} />
                  </td>
                  <td>{formatCurrency(account.amount)}</td>
                  <td>{account.contacts}</td>
                  <td>{account.opportunities}</td>
                  <td>{account.openTasks}</td>
                  <td>{account.compliance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid three">
        <Link href="/crm/opportunities" className="item-card">
          <CircleDollarSign size={22} aria-hidden="true" />
          <h2 className="card-title">Opportunity tracking</h2>
          <p className="section-subtitle">Stage, amount, probability, owner, close date, and source attribution.</p>
        </Link>
        <Link href="/crm/contacts" className="item-card">
          <Users size={22} aria-hidden="true" />
          <h2 className="card-title">Contact pages</h2>
          <p className="section-subtitle">Contacts inherit account context while preserving verification, enrichment, and consent metadata.</p>
        </Link>
        <Link href="/crm/accounts" className="item-card">
          <ListChecks size={22} aria-hidden="true" />
          <h2 className="card-title">Activity timeline</h2>
          <p className="section-subtitle">Calls, notes, tasks, emails, SMS events, meetings, and status changes share one timeline pattern.</p>
        </Link>
      </section>
    </>
  );
}
