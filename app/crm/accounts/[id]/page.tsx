import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Building2,
  Calendar,
  Check,
  CircleDollarSign,
  Mail,
  NotebookPen,
  Phone,
  Save,
  ShieldCheck,
  Sparkles,
  Users
} from "lucide-react";
import {
  completeTaskAction,
  createCallLogAction,
  createCustomFieldAction,
  createNoteAction,
  createOpportunityAction,
  createTaskAction,
  setCustomFieldValueAction,
  updateOpportunityStageAction
} from "@/app/actions";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/progress-bar";
import { StatusPill, statusTone } from "@/components/status-pill";
import {
  callOutcomes,
  customFieldValuesForObject,
  opportunityStages,
  taskPriorities,
  userNameForId
} from "@/lib/phase1/crm";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import { accountDetailReadModelForWorkspace } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";
import type { ActivityType, CallLog, CustomField, Note } from "@/lib/phase1/types";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const activityIcons: Record<ActivityType, typeof NotebookPen> = {
  Call: Phone,
  Task: Calendar,
  Email: Mail,
  SMS: Mail,
  Note: NotebookPen,
  Meeting: Users,
  "Status change": Sparkles,
  Verification: ShieldCheck,
  Opportunity: CircleDollarSign
};
const metricIcons = [CircleDollarSign, CircleDollarSign, Users, Calendar];

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { state, workspaceId } = await getWorkspaceContext("manage_crm");
  const crmRows = await crmEventReadRowsForWorkspace(state, workspaceId);
  const readState = stateWithCrmEventReadRows(state, workspaceId, crmRows);
  const readModel = await accountDetailReadModelForWorkspace(readState, workspaceId, id);
  const account = readModel.account;
  const company = readModel.company;

  if (!account || !company) {
    notFound();
  }

  const accountContacts = readModel.contacts;
  const opportunities = readState.opportunities
    .filter((opportunity) => opportunity.workspaceId === workspaceId && opportunity.companyId === account.id)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const tasks = readState.tasks
    .filter((task) => task.workspaceId === workspaceId && task.companyId === account.id)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const notes = readState.notes
    .filter((note) => note.workspaceId === workspaceId && note.companyId === account.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const calls = readState.callLogs
    .filter((call) => call.workspaceId === workspaceId && call.companyId === account.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const activities = readState.activities
    .filter((activity) => activity.workspaceId === workspaceId && activity.companyId === account.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 14);
  const companyFields = state.customFields.filter(
    (field) => field.workspaceId === workspaceId && field.objectType === "company"
  );
  const fieldValueMap = customFieldValuesForObject(state, account.id);
  const activeTasks = tasks.filter((task) => task.status !== "Completed");
  const weightedForecast = opportunities.reduce(
    (total, opportunity) => total + Math.round(opportunity.amount * (opportunity.probability / 100)),
    0
  );
  const focusTasks = activeTasks.slice(0, 5);
  const recentInteractions = [...notes.slice(0, 4), ...calls.slice(0, 4)]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 6);

  const metrics = [
    {
      label: "Open pipeline",
      value: account.amount,
      currency: true,
      note: `${account.probability}% primary probability`,
      tone: account.amount ? "success" as const : "info" as const
    },
    {
      label: "Weighted forecast",
      value: weightedForecast,
      currency: true,
      note: `${formatNumber(opportunities.length)} linked opportunities`,
      tone: "info" as const
    },
    {
      label: "Contacts",
      value: accountContacts.length,
      note: `${account.owner} owns the active path`,
      tone: accountContacts.length ? "success" as const : "warning" as const
    },
    {
      label: "Open tasks",
      value: activeTasks.length,
      note: account.lastActivity,
      tone: activeTasks.length ? "warning" as const : "success" as const
    }
  ];

  return (
    <>
      <PageHeader
        kicker="Sales CRM"
        title={account.name}
        copy="Account workspace for SDRs and managers: current health, contacts, pipeline, open work, and recent activity without backend configuration."
        actions={
          <>
            <Link href="/crm/accounts" className="button secondary">
              <ArrowRight size={17} aria-hidden="true" />
              Accounts
            </Link>
            <Link href="/crm/contacts" className="button primary">
              <Users size={17} aria-hidden="true" />
              Contacts
            </Link>
          </>
        }
      />

      <section className="grid metrics" aria-label="Account metrics">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? Building2;
          return <MetricCard key={metric.label} {...metric} icon={Icon} />;
        })}
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Account snapshot</h2>
              <p className="section-subtitle">Firmographics, routing owner, source lineage, and compliance state.</p>
            </div>
            <StatusPill label={account.priority} tone={account.priority === "P1" ? "success" : "warning"} />
          </div>
          <div className="panel-body stage-list">
            {[
              ["Stage", account.stage],
              ["Domain", account.domain],
              ["Industry", account.industry],
              ["Location", account.location],
              ["Employees", account.employees],
              ["Revenue band", account.revenueBand],
              ["Source", account.source],
              ["Compliance", account.compliance]
            ].map(([label, value]) => (
              <div className="stage-row" key={label}>
                <div className="stage-meta">
                  <strong>{label}</strong>
                  <span>{value}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Current work</h2>
              <p className="section-subtitle">Open tasks the CRM team should act on next.</p>
            </div>
            <StatusPill label={`${activeTasks.length} open`} tone={activeTasks.length ? "warning" : "success"} />
          </div>
          <div className="panel-body stage-list">
            {focusTasks.map((task) => (
              <div className="stage-row" key={task.id}>
                <div className="stage-meta">
                  <strong>{task.title}</strong>
                  <StatusPill label={task.status} tone={statusTone(task.status)} />
                </div>
                <div className="chip-row">
                  <span className="pill">{task.priority}</span>
                  <span className="pill">{userNameForId(state, task.ownerUserId)}</span>
                  {task.dueAt ? <span className="pill">Due {formatDate(task.dueAt)}</span> : null}
                </div>
                {task.status !== "Completed" ? (
                  <form action={completeTaskAction}>
                    <input name="id" type="hidden" value={task.id} />
                    <button className="button secondary" type="submit">
                      <Check size={16} aria-hidden="true" />
                      Complete
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
            {focusTasks.length === 0 ? <p className="section-subtitle">No open account tasks right now.</p> : null}
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Pipeline</h2>
              <p className="section-subtitle">Linked opportunities with stage, amount, probability, close date, and owner.</p>
            </div>
            <Link href="/crm/opportunities" className="button secondary">
              Open pipeline
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Opportunity</th>
                  <th>Stage</th>
                  <th>Amount</th>
                  <th>Probability</th>
                  <th>Move</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((opportunity) => (
                  <tr key={opportunity.id}>
                    <td>
                      <div className="entity">
                        <strong>{opportunity.name}</strong>
                        <span>{userNameForId(state, opportunity.ownerUserId)}</span>
                      </div>
                    </td>
                    <td>
                      <StatusPill label={opportunity.stage} tone={statusTone(opportunity.stage)} />
                    </td>
                    <td>{formatCurrency(opportunity.amount)}</td>
                    <td>
                      <div className="entity">
                        <strong>{opportunity.probability}%</strong>
                        <ProgressBar value={opportunity.probability} />
                      </div>
                    </td>
                    <td>
                      <form action={updateOpportunityStageAction} className="inline-form">
                        <input name="id" type="hidden" value={opportunity.id} />
                        <select name="stage" defaultValue={opportunity.stage} aria-label="Stage">
                          {opportunityStages.map((stage) => (
                            <option key={stage} value={stage}>
                              {stage}
                            </option>
                          ))}
                        </select>
                        <button className="icon-button" type="submit" aria-label="Save stage">
                          <Save size={16} aria-hidden="true" />
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {opportunities.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No opportunities are linked to this account yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Contacts</h2>
              <p className="section-subtitle">People linked to this account with verification, score, and owner.</p>
            </div>
            <StatusPill label={`${accountContacts.length} contacts`} tone="info" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Grade</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {accountContacts.map((contact) => (
                  <tr key={contact.id}>
                    <td>
                      <Link href={`/crm/contacts/${contact.id}`} className="entity">
                        <strong>{contact.name}</strong>
                        <span>{contact.title}</span>
                        <span>{contact.email}</span>
                      </Link>
                    </td>
                    <td>
                      <span className={`grade ${contact.grade.toLowerCase()}`}>{contact.grade}</span>
                    </td>
                    <td>{contact.score}</td>
                    <td>
                      <StatusPill label={contact.status} tone={statusTone(contact.status)} />
                    </td>
                    <td>{contact.owner}</td>
                  </tr>
                ))}
                {accountContacts.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No contacts are linked to this account yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Activity timeline</h2>
              <p className="section-subtitle">Calls, notes, tasks, opportunity changes, and system events.</p>
            </div>
            <StatusPill label={`${activities.length} events`} tone="info" />
          </div>
          <div className="panel-body timeline">
            {activities.map((activity) => {
              const Icon = activityIcons[activity.type] ?? NotebookPen;

              return (
                <div className="timeline-item" key={activity.id}>
                  <div className="timeline-icon">
                    <Icon size={17} aria-hidden="true" />
                  </div>
                  <div className="timeline-copy">
                    <div className="row-meta">
                      <strong>{activity.title}</strong>
                      <span>{formatDate(activity.createdAt)}</span>
                    </div>
                    {activity.body ? <p className="section-subtitle">{activity.body}</p> : null}
                    <StatusPill label={userNameForId(state, activity.actorUserId)} tone="default" />
                  </div>
                </div>
              );
            })}
            {activities.length === 0 ? <p className="section-subtitle">No activity has been recorded yet.</p> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Recent notes and calls</h2>
              <p className="section-subtitle">Latest manual account context and call outcomes.</p>
            </div>
            <Phone size={20} aria-hidden="true" />
          </div>
          <div className="panel-body stage-list">
            {recentInteractions.map((item) => (
              <div className="stage-row" key={item.id}>
                <div className="stage-meta">
                  <strong>{isCall(item) ? item.outcome : "Note"}</strong>
                  <span>{formatDate(item.createdAt)}</span>
                </div>
                <p className="section-subtitle">{isCall(item) ? item.notes : item.body}</p>
              </div>
            ))}
            {recentInteractions.length === 0 ? <p className="section-subtitle">No notes or calls have been logged yet.</p> : null}
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel" id="add-account-work">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Add account work</h2>
              <p className="section-subtitle">Create the next task or opportunity from this account record.</p>
            </div>
            <Calendar size={20} aria-hidden="true" />
          </div>
          <form action={createTaskAction} className="panel-body form-grid">
            <input name="companyId" type="hidden" value={account.id} />
            <div className="field">
              <label htmlFor="task-title">Task</label>
              <input id="task-title" name="title" placeholder="Send follow-up email" />
            </div>
            <div className="field">
              <label htmlFor="task-contact">Contact</label>
              <select id="task-contact" name="contactId" defaultValue="">
                <option value="">Account-level task</option>
                {accountContacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-priority">Priority</label>
              <select id="task-priority" name="priority" defaultValue="Normal">
                {taskPriorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-due">Due date</label>
              <input id="task-due" name="dueAt" type="date" />
            </div>
            <div className="field">
              <label htmlFor="task-owner">Owner</label>
              <select id="task-owner" name="ownerUserId" defaultValue={state.users[0]?.id}>
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
                Add task
              </button>
            </div>
          </form>
          <form action={createOpportunityAction} className="panel-body form-grid compact-form">
            <input name="companyId" type="hidden" value={account.id} />
            <div className="field">
              <label htmlFor="opp-name">Opportunity</label>
              <input id="opp-name" name="name" defaultValue={`${account.name} expansion`} />
            </div>
            <div className="field">
              <label htmlFor="opp-contact">Primary contact</label>
              <select id="opp-contact" name="contactId" defaultValue={accountContacts[0]?.id ?? ""}>
                <option value="">No primary contact</option>
                {accountContacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="opp-stage">Stage</label>
              <select id="opp-stage" name="stage" defaultValue="Prospecting">
                {opportunityStages.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="opp-amount">Amount</label>
              <input id="opp-amount" name="amount" type="number" min="0" step="500" defaultValue="25000" />
            </div>
            <div className="field">
              <label htmlFor="opp-close">Expected close</label>
              <input id="opp-close" name="expectedCloseDate" type="date" />
            </div>
            <div className="field">
              <label htmlFor="opp-owner">Owner</label>
              <select id="opp-owner" name="ownerUserId" defaultValue={state.users[0]?.id}>
                {state.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="opp-source">Source</label>
              <input id="opp-source" name="source" defaultValue={account.source} />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button secondary" type="submit">
                Add opportunity
              </button>
            </div>
          </form>
        </div>

        <div className="panel" id="log-account-activity">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Log activity</h2>
              <p className="section-subtitle">Add notes or call outcomes without leaving the account.</p>
            </div>
            <NotebookPen size={20} aria-hidden="true" />
          </div>
          <form action={createNoteAction} className="panel-body form-grid">
            <input name="companyId" type="hidden" value={account.id} />
            <div className="field">
              <label htmlFor="note-contact">Note contact</label>
              <select id="note-contact" name="contactId" defaultValue="">
                <option value="">Account note</option>
                {accountContacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="note-body">Note</label>
              <textarea id="note-body" name="body" placeholder="Add account context" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Add note
              </button>
            </div>
          </form>
          <form action={createCallLogAction} className="panel-body form-grid compact-form">
            <input name="companyId" type="hidden" value={account.id} />
            <div className="field">
              <label htmlFor="call-contact">Call contact</label>
              <select id="call-contact" name="contactId" defaultValue={accountContacts[0]?.id ?? ""}>
                {accountContacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="call-phone">Phone</label>
              <input id="call-phone" name="phone" defaultValue={accountContacts[0]?.phone ?? company.phone} />
            </div>
            <div className="field">
              <label htmlFor="call-outcome">Outcome</label>
              <select id="call-outcome" name="outcome" defaultValue="Connected">
                {callOutcomes.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {outcome}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="call-duration">Minutes</label>
              <input id="call-duration" name="durationMinutes" type="number" min="0" step="1" defaultValue="5" />
            </div>
            <div className="field">
              <label htmlFor="call-notes">Call notes</label>
              <textarea id="call-notes" name="notes" placeholder="Summarize the conversation" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button secondary" type="submit">
                Log call
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel" id="account-custom-fields">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Custom fields</h2>
            <p className="section-subtitle">Account-specific CRM fields for the team.</p>
          </div>
          <StatusPill label={`${companyFields.length} fields`} tone="info" />
        </div>
        <div className="panel-body stage-list">
          {companyFields.map((field) => (
            <form action={setCustomFieldValueAction} className="stage-row" key={field.id}>
              <input name="customFieldId" type="hidden" value={field.id} />
              <input name="objectId" type="hidden" value={account.id} />
              <div className="stage-meta">
                <strong>{field.name}</strong>
                <CustomFieldInput field={field} value={fieldValueMap.get(field.id)?.value ?? ""} />
              </div>
              <button className="button secondary" type="submit">
                <Save size={16} aria-hidden="true" />
                Save field
              </button>
            </form>
          ))}
          <form action={createCustomFieldAction} className="form-grid compact-form">
            <input name="objectType" type="hidden" value="company" />
            <div className="field">
              <label htmlFor="company-field-name">Field name</label>
              <input id="company-field-name" name="name" placeholder="Renewal risk" />
            </div>
            <div className="field">
              <label htmlFor="company-field-type">Type</label>
              <select id="company-field-type" name="fieldType" defaultValue="text">
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Select</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="company-field-options">Options</label>
              <input id="company-field-options" name="options" placeholder="Low, Medium, High" />
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
    </>
  );
}

function CustomFieldInput({ field, value }: { field: CustomField; value: string }) {
  if (field.fieldType === "select") {
    return (
      <select name="value" defaultValue={value} aria-label={field.name}>
        <option value="">Unset</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return <input name="value" type={field.fieldType} defaultValue={value} aria-label={field.name} />;
}

function isCall(item: Note | CallLog): item is CallLog {
  return "outcome" in item;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
