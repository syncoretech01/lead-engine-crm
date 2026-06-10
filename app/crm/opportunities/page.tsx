import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Calendar,
  CircleDollarSign,
  Save,
  SlidersHorizontal,
  Users
} from "lucide-react";
import {
  createCustomFieldAction,
  createOpportunityAction,
  setCustomFieldValueAction,
  updateOpportunityStageAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import { customFieldValuesForObject, opportunityStages, userNameForId } from "@/lib/phase1/crm";
import { opportunityViews } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const { state, workspaceId } = await getWorkspaceContext("view_all_records");
  const crmRows = await crmEventReadRowsForWorkspace(state, workspaceId);
  const readState = stateWithCrmEventReadRows(state, workspaceId, crmRows);
  const opportunities = opportunityViews(readState, workspaceId);
  const openOpportunities = opportunities.filter(
    (opportunity) => opportunity.stage !== "Closed won" && opportunity.stage !== "Closed lost"
  );
  const openPipeline = openOpportunities.reduce((total, opportunity) => total + opportunity.amount, 0);
  const weightedForecast = openOpportunities.reduce(
    (total, opportunity) => total + Math.round(opportunity.amount * (opportunity.probability / 100)),
    0
  );
  const opportunityFields = state.customFields.filter(
    (field) => field.workspaceId === workspaceId && field.objectType === "opportunity"
  );

  return (
    <>
      <PageHeader
        kicker="Sales CRM"
        title="Opportunities"
        copy="Track deal stage, amount, probability, expected close date, source attribution, owner, activities, and custom forecast fields."
        actions={
          <>
            <Link href="/crm/accounts" className="button secondary">
              <Building2 size={17} aria-hidden="true" />
              Accounts
            </Link>
            <Link href="/crm/contacts" className="button primary">
              <Users size={17} aria-hidden="true" />
              Contacts
            </Link>
          </>
        }
      />

      <section className="grid metrics">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Open pipeline</span>
            <CircleDollarSign size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatCurrency(openPipeline)}</div>
          <span className="metric-note">{formatNumber(openOpportunities.length)} open opportunities.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Weighted forecast</span>
            <SlidersHorizontal size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatCurrency(weightedForecast)}</div>
          <span className="metric-note">Amount multiplied by stage probability.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Proposal stage</span>
            <Calendar size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">
            {opportunities.filter((opportunity) => opportunity.stage === "Proposal").length}
          </div>
          <span className="metric-note">Late-stage active opportunities.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Closed won</span>
            <CircleDollarSign size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">
            {opportunities.filter((opportunity) => opportunity.stage === "Closed won").length}
          </div>
          <span className="metric-note">Won opportunities retained in history.</span>
        </article>
      </section>

      <section className="kanban" aria-label="Opportunity pipeline">
        {opportunityStages.map((stage) => {
          const stageOpportunities = opportunities.filter((opportunity) => opportunity.stage === stage);

          return (
            <div className="kanban-column" key={stage}>
              <div className="workspace-row">
                <strong>{stage}</strong>
                <StatusPill label={`${stageOpportunities.length}`} tone={stageOpportunities.length ? statusTone(stage) : "default"} />
              </div>
              {stageOpportunities.map((opportunity) => (
                <article className="item-card" key={opportunity.id}>
                  <div className="item-card-header">
                    <div>
                      <h2 className="card-title">{opportunity.name}</h2>
                      <p className="section-subtitle">{opportunity.companyName}</p>
                    </div>
                    <div className="score-ring">{opportunity.probability}%</div>
                  </div>
                  <div className="chip-row">
                    <StatusPill label={formatCurrency(opportunity.amount)} tone="info" />
                    <StatusPill label={opportunity.owner} tone="default" />
                    <StatusPill label={`${opportunity.openTasks} tasks`} tone={opportunity.openTasks ? "warning" : "success"} />
                  </div>
                  <form action={updateOpportunityStageAction} className="inline-form">
                    <input name="id" type="hidden" value={opportunity.id} />
                    <select name="stage" defaultValue={opportunity.stage} aria-label="Stage">
                      {opportunityStages.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <button className="icon-button" type="submit" aria-label="Save stage">
                      <Save size={16} aria-hidden="true" />
                    </button>
                  </form>
                  <Link href={`/crm/accounts/${opportunity.companyId}`} className="button secondary">
                    <ArrowRight size={16} aria-hidden="true" />
                    Account
                  </Link>
                </article>
              ))}
            </div>
          );
        })}
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Create opportunity</h2>
              <p className="section-subtitle">Create a deal from any CRM account and optional primary contact.</p>
            </div>
            <CircleDollarSign size={20} aria-hidden="true" />
          </div>
          <form action={createOpportunityAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="companyId">Account</label>
              <select id="companyId" name="companyId" required>
                {state.companies
                  .filter((company) => company.workspaceId === workspaceId)
                  .map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="contactId">Contact</label>
              <select id="contactId" name="contactId" defaultValue="">
                <option value="">No primary contact</option>
                {state.contacts
                  .filter((contact) => contact.workspaceId === workspaceId)
                  .map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" placeholder="New outbound opportunity" />
            </div>
            <div className="field">
              <label htmlFor="stage">Stage</label>
              <select id="stage" name="stage" defaultValue="Prospecting">
                {opportunityStages.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="amount">Amount</label>
              <input id="amount" name="amount" type="number" min="0" step="500" defaultValue="25000" />
            </div>
            <div className="field">
              <label htmlFor="expectedCloseDate">Expected close</label>
              <input id="expectedCloseDate" name="expectedCloseDate" type="date" />
            </div>
            <div className="field">
              <label htmlFor="ownerUserId">Owner</label>
              <select id="ownerUserId" name="ownerUserId" defaultValue={state.users[0]?.id}>
                {state.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Add opportunity
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Opportunity custom fields</h2>
              <p className="section-subtitle">Forecast and pipeline fields managed by the CRM team.</p>
            </div>
            <StatusPill label={`${opportunityFields.length} fields`} tone="info" />
          </div>
          <form action={setCustomFieldValueAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="field-opportunity">Opportunity</label>
              <select id="field-opportunity" name="objectId" required>
                {opportunities.map((opportunity) => (
                  <option key={opportunity.id} value={opportunity.id}>
                    {opportunity.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="customFieldId">Field</label>
              <select id="customFieldId" name="customFieldId" required>
                {opportunityFields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="field-value">Value</label>
              <input id="field-value" name="value" placeholder="Best case" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button secondary" type="submit">
                Save value
              </button>
            </div>
          </form>
          <form action={createCustomFieldAction} className="panel-body form-grid">
            <input name="objectType" type="hidden" value="opportunity" />
            <div className="field">
              <label htmlFor="field-name">Field name</label>
              <input id="field-name" name="name" placeholder="Decision process" />
            </div>
            <div className="field">
              <label htmlFor="field-type">Type</label>
              <select id="field-type" name="fieldType" defaultValue="text">
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Select</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="field-options">Options</label>
              <input id="field-options" name="options" placeholder="Pipeline, Best case, Commit" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Create field
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Opportunity table</h2>
            <p className="section-subtitle">Pipeline records with account, contact, source, owner, and latest activity.</p>
          </div>
          <StatusPill label={`${opportunities.length} records`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Account</th>
                <th>Contact</th>
                <th>Stage</th>
                <th>Amount</th>
                <th>Close</th>
                <th>Owner</th>
                <th>Custom fields</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((opportunity) => {
                const fieldMap = customFieldValuesForObject(state, opportunity.id);

                return (
                  <tr key={opportunity.id}>
                    <td>
                      <div className="entity">
                        <strong>{opportunity.name}</strong>
                        <span>{opportunity.source}</span>
                        <span>{opportunity.lastActivity}</span>
                      </div>
                    </td>
                    <td>
                      <Link href={`/crm/accounts/${opportunity.companyId}`} className="entity">
                        <strong>{opportunity.companyName}</strong>
                        <span>{opportunity.companyDomain}</span>
                      </Link>
                    </td>
                    <td>{opportunity.contactName}</td>
                    <td>
                      <StatusPill label={opportunity.stage} tone={statusTone(opportunity.stage)} />
                    </td>
                    <td>{formatCurrency(opportunity.amount)}</td>
                    <td>{opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : "Not set"}</td>
                    <td>{userNameForId(state, opportunity.ownerUserId)}</td>
                    <td>
                      <div className="chip-row">
                        {opportunityFields.map((field) => (
                          <span className="pill" key={field.id}>
                            {field.name}: {fieldMap.get(field.id)?.value ?? "Unset"}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
