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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { statusTone } from "@/components/status-pill";
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

export const dynamic = "force-dynamic";

// Shared Flexio-style field control classes for inline server-action forms.
const fieldControlClass =
  "h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const fieldLabelClass = "text-xs font-medium text-muted-foreground";

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
  const isSdr = session.role === "SDR";
  const linkedAccountCount = new Set(opportunities.map((opportunity) => opportunity.companyId)).size;
  const openTaskCount = opportunities.reduce((total, opportunity) => total + opportunity.openTasks, 0);
  const focusOpportunities = [...openOpportunities]
    .sort((a, b) => b.amount - a.amount || b.probability - a.probability)
    .slice(0, 8);

  const metrics = isSdr
    ? [
        {
          label: "My open deals",
          value: formatNumber(openOpportunities.length),
          note: `${formatCurrency(openPipeline)} active value`,
          icon: CircleDollarSign,
          tone: openOpportunities.length ? "success" as const : "info" as const
        },
        {
          label: "Weighted value",
          value: formatCurrency(weightedForecast),
          note: "Probability-adjusted value",
          icon: TrendingUp,
          tone: "info" as const
        },
        {
          label: "Proposal stage",
          value: formatNumber(proposalOpportunities.length),
          note: "Late-stage deals to keep warm",
          icon: Calendar,
          tone: proposalOpportunities.length ? "warning" as const : "info" as const
        },
        {
          label: "Linked accounts",
          value: formatNumber(linkedAccountCount),
          note: "Accounts tied to your pipeline",
          icon: Building2,
          tone: "info" as const
        }
      ]
    : [
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

  const lanes = isSdr
    ? [
        {
          label: "Follow-up work",
          value: openTaskCount,
          note: "Open tasks on your deals",
          icon: Calendar,
          tone: openTaskCount ? "warning" as const : "success" as const
        },
        {
          label: "Proposal",
          value: proposalOpportunities.length,
          note: "Late-stage deals",
          icon: Calendar,
          tone: proposalOpportunities.length ? "warning" as const : "info" as const
        },
        {
          label: "Accounts",
          value: linkedAccountCount,
          note: "Account context",
          icon: Building2,
          tone: "info" as const
        },
        {
          label: "Won",
          value: wonOpportunities.length,
          note: "Closed-won history",
          icon: CircleDollarSign,
          tone: "success" as const
        }
      ]
    : [
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
        title={isSdr ? "My opportunities" : "Opportunities"}
        copy={
          isSdr
            ? "Track deal value, stage, account context, and next activity for the opportunities tied to your assigned contacts."
            : "A focused pipeline workspace for managers and SDRs: review deal value, stage health, forecast, next activity, and move opportunities without touching backend settings."
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/crm/accounts">
                <Building2 aria-hidden="true" />
                Accounts
              </Link>
            </Button>
            {isSdr ? (
              <Button asChild>
                <Link href="/sdr/queue">
                  <Users aria-hidden="true" />
                  My queue
                </Link>
              </Button>
            ) : (
              <Button asChild>
                <a href="#create-opportunity">
                  <CircleDollarSign aria-hidden="true" />
                  Add opportunity
                </a>
              </Button>
            )}
          </>
        }
      />

      <section aria-label="Opportunity metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      {!isSdr ? (
        <section aria-label="Opportunity operating lanes" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
      ) : null}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title={isSdr ? "Open deals to watch" : "Pipeline focus"}
          subtitle={
            isSdr
              ? "Deals tied to your assigned accounts, sorted by value and probability."
              : "Highest-value open opportunities with stage, owner, and last activity."
          }
          action={<StatusBadge label={`${focusOpportunities.length} focus`} tone="info" />}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Opportunity</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Amount</TableHead>
                {!isSdr ? <TableHead>Owner</TableHead> : null}
                <TableHead>Activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {focusOpportunities.map((opportunity) => (
                <TableRow key={opportunity.id}>
                  <TableCell>
                    <Link href={`/crm/accounts/${opportunity.companyId}`} className="flex flex-col">
                      <span className="font-medium text-foreground">{opportunity.name}</span>
                      <span className="text-xs text-muted-foreground">{opportunity.companyName}</span>
                      <span className="text-xs text-muted-foreground">{opportunity.contactName}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge label={opportunity.stage} tone={statusTone(opportunity.stage)} />
                  </TableCell>
                  <TableCell className="text-foreground">{formatCurrency(opportunity.amount)}</TableCell>
                  {!isSdr ? <TableCell className="text-muted-foreground">{opportunity.owner}</TableCell> : null}
                  <TableCell className="text-muted-foreground">{opportunity.lastActivity}</TableCell>
                </TableRow>
              ))}
              {focusOpportunities.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isSdr ? 4 : 5} className="text-muted-foreground">
                    No open opportunities are assigned right now.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          title={isSdr ? "Stage snapshot" : "Stage health"}
          subtitle={
            isSdr ? "Where your assigned deals sit today." : "Open and closed stages by count, value, and weighted value."
          }
          action={<ToneIcon icon={SlidersHorizontal} tone="info" />}
        >
          <div className="flex flex-col gap-4">
            {stageRows.map((row) => (
              <div key={row.stage} className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{row.stage}</span>
                  <StatusBadge label={`${formatNumber(row.count)} opps`} tone={statusTone(row.stage)} />
                </div>
                <MeterBar value={Math.round((row.amount / maxStageAmount) * 100)} />
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{formatCurrency(row.amount)}</span>
                  <span>{formatCurrency(row.weighted)} weighted</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      {!isSdr ? (
        <section>
          <Panel
            title="Stage board"
            subtitle="Move opportunities between stages without opening the full account record."
            action={<StatusBadge label={`${formatNumber(opportunities.length)} opportunities`} tone="info" />}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Opportunity pipeline">
              {opportunityStages.map((stage) => {
                const stageOpportunities = opportunities.filter((opportunity) => opportunity.stage === stage);

                return (
                  <div className="flex flex-col gap-3" key={stage}>
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm font-semibold text-foreground">{stage}</strong>
                      <StatusBadge
                        label={`${stageOpportunities.length}`}
                        tone={stageOpportunities.length ? statusTone(stage) : "default"}
                      />
                    </div>
                    {stageOpportunities.map((opportunity) => (
                      <Card className="gap-3 p-4" key={opportunity.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-foreground">{opportunity.name}</h3>
                            <p className="text-xs text-muted-foreground">{opportunity.companyName}</p>
                          </div>
                          <div className="flex w-24 shrink-0 flex-col items-end gap-1">
                            <strong className="text-sm font-semibold text-foreground">{opportunity.probability}%</strong>
                            <MeterBar value={opportunity.probability} showValue={false} />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <StatusBadge label={formatCurrency(opportunity.amount)} tone="info" />
                          <StatusBadge
                            label={`${opportunity.openTasks} tasks`}
                            tone={opportunity.openTasks ? "warning" : "success"}
                          />
                        </div>
                        <form action={updateOpportunityStageAction} className="flex items-center gap-2">
                          <input name="id" type="hidden" value={opportunity.id} />
                          <select name="stage" defaultValue={opportunity.stage} aria-label="Stage" className={fieldControlClass}>
                            {opportunityStages.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" variant="outline" size="icon" aria-label="Save stage">
                            <Save aria-hidden="true" />
                          </Button>
                        </form>
                        <Button asChild variant="outline" size="sm" className="w-full">
                          <Link href={`/crm/accounts/${opportunity.companyId}`}>
                            <ArrowRight aria-hidden="true" />
                            Account
                          </Link>
                        </Button>
                      </Card>
                    ))}
                  </div>
                );
              })}
            </div>
          </Panel>
        </section>
      ) : null}

      {!isSdr ? (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div id="create-opportunity">
            <Panel
              title="Create opportunity"
              subtitle="Create a deal from any CRM account and optional primary contact."
              action={<ToneIcon icon={CircleDollarSign} tone="info" />}
            >
              <form action={createOpportunityAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="companyId" className={fieldLabelClass}>
                    Account
                  </label>
                  <select id="companyId" name="companyId" required className={fieldControlClass}>
                    {accountOptions.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="contactId" className={fieldLabelClass}>
                    Contact
                  </label>
                  <select id="contactId" name="contactId" defaultValue="" className={fieldControlClass}>
                    <option value="">No primary contact</option>
                    {contactOptions.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="name" className={fieldLabelClass}>
                    Name
                  </label>
                  <input id="name" name="name" placeholder="New outbound opportunity" className={fieldControlClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="stage" className={fieldLabelClass}>
                    Stage
                  </label>
                  <select id="stage" name="stage" defaultValue="Prospecting" className={fieldControlClass}>
                    {opportunityStages.map((stage) => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="amount" className={fieldLabelClass}>
                    Amount
                  </label>
                  <input
                    id="amount"
                    name="amount"
                    type="number"
                    min="0"
                    step="500"
                    defaultValue="25000"
                    className={fieldControlClass}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="expectedCloseDate" className={fieldLabelClass}>
                    Expected close
                  </label>
                  <input id="expectedCloseDate" name="expectedCloseDate" type="date" className={fieldControlClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="ownerUserId" className={fieldLabelClass}>
                    Owner
                  </label>
                  <select id="ownerUserId" name="ownerUserId" defaultValue={ownerOptions[0]?.id} className={fieldControlClass}>
                    {ownerOptions.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <Button type="submit" className="w-full">
                    Add opportunity
                  </Button>
                </div>
              </form>
            </Panel>
          </div>

          <Panel
            title="Forecast fields"
            subtitle="Optional custom forecast fields managed by the CRM team."
            action={<StatusBadge label={`${opportunityFields.length} fields`} tone="info" />}
          >
            <div className="flex flex-col gap-6">
              <form action={setCustomFieldValueAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="field-opportunity" className={fieldLabelClass}>
                    Opportunity
                  </label>
                  <select id="field-opportunity" name="objectId" required className={fieldControlClass}>
                    {opportunities.map((opportunity) => (
                      <option key={opportunity.id} value={opportunity.id}>
                        {opportunity.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="customFieldId" className={fieldLabelClass}>
                    Field
                  </label>
                  <select id="customFieldId" name="customFieldId" required className={fieldControlClass}>
                    {opportunityFields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="field-value" className={fieldLabelClass}>
                    Value
                  </label>
                  <input id="field-value" name="value" placeholder="Best case" className={fieldControlClass} />
                </div>
                <div className="flex items-end">
                  <Button type="submit" variant="outline" className="w-full">
                    Save value
                  </Button>
                </div>
              </form>
              <form action={createCustomFieldAction} className="grid grid-cols-1 gap-4 border-t pt-6 sm:grid-cols-2">
                <input name="objectType" type="hidden" value="opportunity" />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="field-name" className={fieldLabelClass}>
                    Field name
                  </label>
                  <input id="field-name" name="name" placeholder="Decision process" className={fieldControlClass} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="field-type" className={fieldLabelClass}>
                    Type
                  </label>
                  <select id="field-type" name="fieldType" defaultValue="text" className={fieldControlClass}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="select">Select</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="field-options" className={fieldLabelClass}>
                    Options
                  </label>
                  <input
                    id="field-options"
                    name="options"
                    placeholder="Pipeline, Best case, Commit"
                    className={fieldControlClass}
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" className="w-full">
                    Create field
                  </Button>
                </div>
              </form>
            </div>
          </Panel>
        </section>
      ) : null}

      <section>
        <Panel
          title={isSdr ? "My opportunity list" : "Opportunity directory"}
          subtitle={
            isSdr
              ? "Assigned pipeline records with the account, stage, value, close date, and latest activity."
              : "Pipeline records with account, contact, source, owner, and custom forecast fields."
          }
          action={<StatusBadge label={`${formatNumber(opportunities.length)} records`} tone="info" />}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Opportunity</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Close</TableHead>
                {!isSdr ? <TableHead>Owner</TableHead> : null}
                {!isSdr ? <TableHead>Fields</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {opportunities.map((opportunity) => {
                const fieldMap = customFieldValuesForObject(customFieldValues, opportunity.id);

                return (
                  <TableRow key={opportunity.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{opportunity.name}</span>
                        <span className="text-xs text-muted-foreground">{opportunity.source}</span>
                        <span className="text-xs text-muted-foreground">{opportunity.lastActivity}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link href={`/crm/accounts/${opportunity.companyId}`} className="flex flex-col">
                        <span className="font-medium text-foreground">{opportunity.companyName}</span>
                        <span className="text-xs text-muted-foreground">{opportunity.contactName}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={opportunity.stage} tone={statusTone(opportunity.stage)} />
                    </TableCell>
                    <TableCell className="text-foreground">{formatCurrency(opportunity.amount)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : "Not set"}
                    </TableCell>
                    {!isSdr ? <TableCell className="text-muted-foreground">{opportunity.owner}</TableCell> : null}
                    {!isSdr ? (
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {opportunityFields.map((field) => (
                            <StatusBadge
                              key={field.id}
                              label={`${field.name}: ${fieldMap.get(field.id)?.value ?? "Unset"}`}
                              tone="default"
                            />
                          ))}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
              {opportunities.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isSdr ? 5 : 7} className="text-muted-foreground">
                    No opportunities are available in this view.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>
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
