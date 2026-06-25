import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Calendar,
  CircleDollarSign,
  Save,
  SlidersHorizontal,
  TrendingUp,
  Users
} from "lucide-react";
import {
  createCustomFieldAction,
  createOpportunityAction,
  setCustomFieldValueAction,
  updateOpportunityStageAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import {
  readFastCrmOverviewModel,
  type FastCrmOption,
  type FastCrmOpportunityView
} from "@/lib/phase1/crm-overview-read-model";
import { opportunityStages } from "@/lib/phase1/crm";
import { restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { opportunityViews, ownedCrmRecordScope } from "@/lib/phase1/queries";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import type { CustomField, CustomFieldValue, User } from "@/lib/phase1/types";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { StatCard, LaneCard } from "@/components/ui-metrics";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const sessionContext = await getWorkspaceSessionContext("manage_crm");
  let session = sessionContext.session;
  let workspaceId = sessionContext.workspaceId;
  let opportunities: FastCrmOpportunityView[] = [];
  let opportunityFields: CustomField[] = [];
  let customFieldValues: CustomFieldValue[] = [];
  let accountOptions: FastCrmOption[] = [];
  let contactOptions: FastCrmOption[] = [];
  let ownerOptions: User[] = [];
  const fastModel = await readFastCrmOverviewModel(session, workspaceId);

  if (fastModel) {
    opportunities = fastModel.opportunities;
    opportunityFields = fastModel.opportunityFields;
    customFieldValues = fastModel.customFieldValues;
    accountOptions = fastModel.accountOptions;
    contactOptions = fastModel.contactOptions;
    ownerOptions = fastModel.users;
  } else {
    const context = await getWorkspaceContext("manage_crm");
    const state = context.state;
    session = context.session;
    workspaceId = context.workspaceId;
    const crmRows = await crmEventReadRowsForWorkspace(state, workspaceId);
    const readState = stateWithCrmEventReadRows(state, workspaceId, crmRows);
    const ownedScope = restrictsToOwnedRecords(session) ? ownedCrmRecordScope(readState, session) : null;
    opportunities = ownedScope
      ? opportunityViews(readState, workspaceId).filter((opportunity) => opportunity.ownerUserId === session.user.id)
      : opportunityViews(readState, workspaceId);
    opportunityFields = state.customFields.filter(
      (field) => field.workspaceId === workspaceId && field.objectType === "opportunity"
    );
    customFieldValues = state.customFieldValues;
    accountOptions = state.companies
      .filter((company) => company.workspaceId === workspaceId && (!ownedScope || ownedScope.companyIds.has(company.id)))
      .map((company) => ({ id: company.id, name: company.name }));
    contactOptions = state.contacts
      .filter((contact) => contact.workspaceId === workspaceId && (!ownedScope || ownedScope.contactIds.has(contact.id)))
      .map((contact) => ({ id: contact.id, name: contact.name }));
    ownerOptions = state.users;
  }
  const openOpportunities = opportunities.filter((opportunity) => !isClosedStage(opportunity.stage));
  const openPipeline = openOpportunities.reduce((total, opportunity) => total + opportunity.amount, 0);
  const weightedForecast = openOpportunities.reduce(
    (total, opportunity) => total + Math.round(opportunity.amount * (opportunity.probability / 100)),
    0
  );
  const proposalOpportunities = opportunities.filter((opportunity) => opportunity.stage === "Proposal");
  const wonOpportunities = opportunities.filter((opportunity) => opportunity.stage === "Closed won");
  const stageRows = stageSummary(opportunities);
  const maxStageAmount = Math.max(...stageRows.map((row) => row.amount), 1);
  const focusOpportunities = [...openOpportunities]
    .sort((a, b) => b.amount - a.amount || b.probability - a.probability)
    .slice(0, 8);

  const metrics = [
    {
      label: "Open pipeline",
      value: formatCurrency(openPipeline),
      note: `${formatNumber(openOpportunities.length)} open opportunities`,
      icon: CircleDollarSign,
      tone: "success" as const
    },
    {
      label: "Weighted forecast",
      value: formatCurrency(weightedForecast),
      note: "Amount weighted by probability",
      icon: TrendingUp,
      tone: "info" as const
    },
    {
      label: "Proposal stage",
      value: formatNumber(proposalOpportunities.length),
      note: "Late-stage active opportunities",
      icon: Calendar,
      tone: proposalOpportunities.length ? "warning" as const : "info" as const
    },
    {
      label: "Closed won",
      value: formatNumber(wonOpportunities.length),
      note: `${formatCurrency(wonOpportunities.reduce((total, opportunity) => total + opportunity.amount, 0))} retained in history`,
      icon: CircleDollarSign,
      tone: "success" as const
    }
  ];

  const lanes = [
    {
      label: "Open deals",
      value: openOpportunities.length,
      note: formatCurrency(openPipeline),
      icon: CircleDollarSign,
      tone: "success" as const
    },
    {
      label: "Proposal",
      value: proposalOpportunities.length,
      note: "Late stage",
      icon: Calendar,
      tone: proposalOpportunities.length ? "warning" as const : "info" as const
    },
    {
      label: "Stage columns",
      value: stageRows.filter((row) => row.count > 0).length,
      note: "Active pipeline stages",
      icon: SlidersHorizontal,
      tone: "info" as const
    },
    {
      label: "Forecast fields",
      value: opportunityFields.length,
      note: "Custom CRM fields",
      icon: TrendingUp,
      tone: "info" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Sales CRM"
        title="Opportunities"
        copy="A focused pipeline workspace for managers and SDRs: review deal value, stage health, forecast, next activity, and move opportunities without touching backend settings."
        actions={
          <>
            <Link href="/crm/accounts" className="button secondary">
              <Building2 size={17} aria-hidden="true" />
              Accounts
            </Link>
            <a href="#create-opportunity" className="button primary">
              <CircleDollarSign size={17} aria-hidden="true" />
              Add opportunity
            </a>
          </>
        }
      />

      <section className="stat-grid" aria-label="Opportunity metrics">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className="ops-stage-strip four-up" aria-label="Opportunity operating lanes">
        {lanes.map((lane) => (
          <LaneCard key={lane.label} {...lane} />
        ))}
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Pipeline focus</h2>
              <p className="section-subtitle">Highest-value open opportunities with stage, owner, and last activity.</p>
            </div>
            <StatusPill label={`${focusOpportunities.length} focus`} tone="info" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Opportunity</th>
                  <th>Stage</th>
                  <th>Amount</th>
                  <th>Owner</th>
                  <th>Activity</th>
                </tr>
              </thead>
              <tbody>
                {focusOpportunities.map((opportunity) => (
                  <tr key={opportunity.id}>
                    <td>
                      <Link href={`/crm/accounts/${opportunity.companyId}`} className="entity">
                        <strong>{opportunity.name}</strong>
                        <span>{opportunity.companyName}</span>
                        <span>{opportunity.contactName}</span>
                      </Link>
                    </td>
                    <td>
                      <StatusPill label={opportunity.stage} tone={statusTone(opportunity.stage)} />
                    </td>
                    <td>{formatCurrency(opportunity.amount)}</td>
                    <td>{opportunity.owner}</td>
                    <td>{opportunity.lastActivity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Stage health</h2>
              <p className="section-subtitle">Open and closed stages by count, value, and weighted value.</p>
            </div>
            <SlidersHorizontal size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            {stageRows.map((row) => (
              <div className="stage-row" key={row.stage}>
                <div className="stage-meta">
                  <strong>{row.stage}</strong>
                  <StatusPill label={`${formatNumber(row.count)} opps`} tone={statusTone(row.stage)} />
                </div>
                <ProgressBar value={Math.round((row.amount / maxStageAmount) * 100)} />
                <div className="row-meta">
                  <span>{formatCurrency(row.amount)}</span>
                  <span>{formatCurrency(row.weighted)} weighted</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Stage board</h2>
            <p className="section-subtitle">Move opportunities between stages without opening the full account record.</p>
          </div>
          <StatusPill label={`${formatNumber(opportunities.length)} opportunities`} tone="info" />
        </div>
        <div className="kanban" aria-label="Opportunity pipeline">
          {opportunityStages.map((stage) => {
            const stageOpportunities = opportunities.filter((opportunity) => opportunity.stage === stage);

            return (
              <div className="kanban-column" key={stage}>
                <div className="workspace-row">
                  <strong>{stage}</strong>
                  <StatusPill label={`${stageOpportunities.length}`} tone={stageOpportunities.length ? statusTone(stage) : "default"} />
                </div>
                {stageOpportunities.map((opportunity) => (
                  <article className="item-card compact-profile-card" key={opportunity.id}>
                    <div className="item-card-header">
                      <div>
                        <h3 className="card-title">{opportunity.name}</h3>
                        <p className="section-subtitle">{opportunity.companyName}</p>
                      </div>
                      <div className="table-score-cell">
                        <strong>{opportunity.probability}%</strong>
                        <ProgressBar value={opportunity.probability} />
                      </div>
                    </div>
                    <div className="chip-row">
                      <StatusPill label={formatCurrency(opportunity.amount)} tone="info" />
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
        </div>
      </section>

      <section className="grid two">
        <div className="panel" id="create-opportunity">
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
                {accountOptions.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="contactId">Contact</label>
              <select id="contactId" name="contactId" defaultValue="">
                <option value="">No primary contact</option>
                {contactOptions.map((contact) => (
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
              <select id="ownerUserId" name="ownerUserId" defaultValue={ownerOptions[0]?.id}>
                {ownerOptions.map((user) => (
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
              <h2 className="section-title">Forecast fields</h2>
              <p className="section-subtitle">Optional custom forecast fields managed by the CRM team.</p>
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
          <form action={createCustomFieldAction} className="panel-body form-grid compact-form">
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
            <h2 className="section-title">Opportunity directory</h2>
            <p className="section-subtitle">Pipeline records with account, contact, source, owner, and custom forecast fields.</p>
          </div>
          <StatusPill label={`${formatNumber(opportunities.length)} records`} tone="info" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Account</th>
                <th>Stage</th>
                <th>Amount</th>
                <th>Close</th>
                <th>Owner</th>
                <th>Fields</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((opportunity) => {
                const fieldMap = customFieldValuesForObject(customFieldValues, opportunity.id);

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
                        <span>{opportunity.contactName}</span>
                      </Link>
                    </td>
                    <td>
                      <StatusPill label={opportunity.stage} tone={statusTone(opportunity.stage)} />
                    </td>
                    <td>{formatCurrency(opportunity.amount)}</td>
                    <td>{opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : "Not set"}</td>
                    <td>{opportunity.owner}</td>
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

type OpportunityView = FastCrmOpportunityView;


function isClosedStage(stage: OpportunityView["stage"]) {
  return stage === "Closed won" || stage === "Closed lost";
}

function customFieldValuesForObject(values: CustomFieldValue[], objectId: string) {
  return new Map(values.filter((value) => value.objectId === objectId).map((value) => [value.customFieldId, value]));
}

function stageSummary(opportunities: OpportunityView[]) {
  return opportunityStages.map((stage) => {
    const stageOpportunities = opportunities.filter((opportunity) => opportunity.stage === stage);
    const amount = stageOpportunities.reduce((total, opportunity) => total + opportunity.amount, 0);
    const weighted = stageOpportunities.reduce(
      (total, opportunity) => total + Math.round(opportunity.amount * (opportunity.probability / 100)),
      0
    );

    return { stage, count: stageOpportunities.length, amount, weighted };
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
