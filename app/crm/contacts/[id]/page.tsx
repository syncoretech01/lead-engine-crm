import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
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
  updateContactComplianceAction,
  updateOpportunityStageAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
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
import { consentStatuses, lawfulBases } from "@/lib/phase1/compliance";
import { contactDetailReadModelForWorkspace } from "@/lib/phase1/queries";
import { getWorkspaceContext } from "@/lib/phase1/store";
import type { ActivityType, CustomField } from "@/lib/phase1/types";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const activityIcons: Record<ActivityType, typeof NotebookPen> = {
  Call: Phone,
  Task: Calendar,
  Email: Mail,
  SMS: Mail,
  Note: NotebookPen,
  Meeting: Users,
  "Status change": Sparkles,
  Verification: BadgeCheck,
  Opportunity: CircleDollarSign
};

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { state, workspaceId } = await getWorkspaceContext("view_all_records");
  const crmRows = await crmEventReadRowsForWorkspace(state, workspaceId);
  const readState = stateWithCrmEventReadRows(state, workspaceId, crmRows);
  const readModel = await contactDetailReadModelForWorkspace(readState, workspaceId, id);
  const contact = readModel.contact;

  if (!contact) {
    notFound();
  }

  const company = readModel.company;
  const opportunities = readState.opportunities
    .filter(
      (opportunity) =>
        opportunity.workspaceId === workspaceId &&
        (opportunity.contactId === contact.id || opportunity.companyId === contact.companyId)
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const tasks = readState.tasks
    .filter((task) => task.workspaceId === workspaceId && task.contactId === contact.id)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const notes = readState.notes
    .filter((note) => note.workspaceId === workspaceId && note.contactId === contact.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const calls = readState.callLogs
    .filter((call) => call.workspaceId === workspaceId && call.contactId === contact.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const activities = readState.activities
    .filter((activity) => activity.workspaceId === workspaceId && activity.contactId === contact.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 16);
  const contactFields = state.customFields.filter(
    (field) => field.workspaceId === workspaceId && field.objectType === "contact"
  );
  const fieldValueMap = customFieldValuesForObject(state, contact.id);
  const activeTasks = tasks.filter((task) => task.status !== "Completed");

  return (
    <>
      <PageHeader
        kicker="Contact workspace"
        title={contact.name}
        copy={`${contact.title} at ${company?.name ?? "unknown account"} with ${contact.verification.toLowerCase()}.`}
        actions={
          <>
            <Link href="/crm/contacts" className="button secondary">
              <ArrowRight size={17} aria-hidden="true" />
              Contact list
            </Link>
            {company ? (
              <Link href={`/crm/accounts/${company.id}`} className="button primary">
                <Building2 size={17} aria-hidden="true" />
                Account
              </Link>
            ) : null}
          </>
        }
      />

      <section className="grid metrics">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Grade</span>
            <BadgeCheck size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{contact.grade}</div>
          <span className="metric-note">{contact.verification}</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Score</span>
            <StatusPill label={contact.priority} tone={contact.priority === "P1" ? "success" : "warning"} />
          </div>
          <div className="metric-value gradient-text">{contact.score}</div>
          <span className="metric-note">{contact.segment}</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Open tasks</span>
            <Calendar size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{activeTasks.length}</div>
          <span className="metric-note">Owned by {contact.owner}</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Opportunities</span>
            <CircleDollarSign size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{opportunities.length}</div>
          <span className="metric-note">{formatCurrency(opportunities.reduce((total, opportunity) => total + opportunity.amount, 0))}</span>
        </article>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Contact details</h2>
              <p className="section-subtitle">Verification, enrichment, contact channels, and source lineage.</p>
            </div>
            <StatusPill label={contact.status} tone={statusTone(contact.status)} />
          </div>
          <div className="panel-body stage-list">
            {[
              ["Account", company?.name ?? "Unknown"],
              ["Email", contact.email],
              ["Phone", contact.phone || "No phone"],
              ["Owner", contact.owner],
              ["Seniority", contact.seniority ?? "Unknown"],
              ["Department", contact.department ?? "Unknown"],
              ["Enrichment", `${contact.enrichmentCoverage ?? 0}% coverage`],
              ["Fit reason", contact.fitReason ?? "No fit reason yet"],
              ["Lawful basis", contact.lawfulBasis],
              ["Consent", contact.consentStatus],
              ["Consent source", contact.consentSource],
              ["Do not contact", contact.doNotContact ? "Yes" : "No"]
            ].map(([label, value]) => (
              <div className="list-row" key={label}>
                <div className="row-meta">
                  <strong>{label}</strong>
                  <span>{value}</span>
                </div>
              </div>
            ))}
          </div>
          <form action={updateContactComplianceAction} className="panel-body form-grid compact-form">
            <input name="contactId" type="hidden" value={contact.id} />
            <div className="field">
              <label htmlFor="lawfulBasis">Lawful basis</label>
              <select id="lawfulBasis" name="lawfulBasis" defaultValue={contact.lawfulBasis}>
                {lawfulBases.map((basis) => (
                  <option key={basis} value={basis}>
                    {basis}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="consentStatus">Consent status</label>
              <select id="consentStatus" name="consentStatus" defaultValue={contact.consentStatus}>
                {consentStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="consentSource">Consent source</label>
              <input id="consentSource" name="consentSource" defaultValue={contact.consentSource} />
            </div>
            <div className="field">
              <label className="pill">
                <input name="doNotContact" type="checkbox" defaultChecked={contact.doNotContact} />
                Do not contact
              </label>
              <button className="button secondary" type="submit">
                <ShieldCheck size={16} aria-hidden="true" />
                Save compliance
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Contact custom fields</h2>
              <p className="section-subtitle">Fields specific to contact workflows and preferences.</p>
            </div>
            <StatusPill label={`${contactFields.length} fields`} tone="info" />
          </div>
          <div className="panel-body stage-list">
            {contactFields.map((field) => (
              <form action={setCustomFieldValueAction} className="list-row" key={field.id}>
                <input name="customFieldId" type="hidden" value={field.id} />
                <input name="objectId" type="hidden" value={contact.id} />
                <div className="row-meta">
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
              <input name="objectType" type="hidden" value="contact" />
              <div className="field">
                <label htmlFor="contact-field-name">Field name</label>
                <input id="contact-field-name" name="name" placeholder="Buying role" />
              </div>
              <div className="field">
                <label htmlFor="contact-field-type">Type</label>
                <select id="contact-field-type" name="fieldType" defaultValue="text">
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="select">Select</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="contact-field-options">Options</label>
                <input id="contact-field-options" name="options" placeholder="Economic, Technical, User" />
              </div>
              <div className="field">
                <label aria-hidden="true">&nbsp;</label>
                <button className="button primary" type="submit">
                  Create field
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Work queue</h2>
              <p className="section-subtitle">Tasks linked directly to this contact.</p>
            </div>
            <StatusPill label={`${activeTasks.length} open`} tone={activeTasks.length ? "warning" : "success"} />
          </div>
          <form action={createTaskAction} className="panel-body form-grid">
            <input name="companyId" type="hidden" value={contact.companyId} />
            <input name="contactId" type="hidden" value={contact.id} />
            <div className="field">
              <label htmlFor="task-title">Task</label>
              <input id="task-title" name="title" placeholder="Call after email reply" />
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
          <div className="panel-body stage-list">
            {tasks.slice(0, 8).map((task) => (
              <div className="list-row" key={task.id}>
                <div className="row-meta">
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
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Timeline</h2>
              <p className="section-subtitle">Contact-level notes, calls, tasks, and opportunity updates.</p>
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
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Notes and calls</h2>
              <p className="section-subtitle">Manual interaction history for this contact.</p>
            </div>
            <Phone size={20} aria-hidden="true" />
          </div>
          <form action={createNoteAction} className="panel-body form-grid">
            <input name="companyId" type="hidden" value={contact.companyId} />
            <input name="contactId" type="hidden" value={contact.id} />
            <div className="field">
              <label htmlFor="note-body">Note</label>
              <textarea id="note-body" name="body" placeholder="Add contact context" />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Add note
              </button>
            </div>
          </form>
          <form action={createCallLogAction} className="panel-body form-grid">
            <input name="companyId" type="hidden" value={contact.companyId} />
            <input name="contactId" type="hidden" value={contact.id} />
            <div className="field">
              <label htmlFor="call-phone">Phone</label>
              <input id="call-phone" name="phone" defaultValue={contact.phone} />
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
          <div className="panel-body stage-list">
            {[...notes.slice(0, 4), ...calls.slice(0, 4)]
              .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
              .slice(0, 6)
              .map((item) => (
                <div className="list-row" key={item.id}>
                  <div className="row-meta">
                    <strong>{"outcome" in item ? item.outcome : "Note"}</strong>
                    <span>{formatDate(item.createdAt)}</span>
                  </div>
                  <p className="section-subtitle">{"outcome" in item ? item.notes : item.body}</p>
                </div>
              ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Related opportunities</h2>
              <p className="section-subtitle">Deals linked to this contact or account.</p>
            </div>
            <Link href="/crm/opportunities" className="button secondary">
              Pipeline
            </Link>
          </div>
          <form action={createOpportunityAction} className="panel-body form-grid">
            <input name="companyId" type="hidden" value={contact.companyId} />
            <input name="contactId" type="hidden" value={contact.id} />
            <div className="field">
              <label htmlFor="opp-name">Name</label>
              <input id="opp-name" name="name" defaultValue={`${company?.name ?? contact.name} opportunity`} />
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
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                Add opportunity
              </button>
            </div>
          </form>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Opportunity</th>
                  <th>Stage</th>
                  <th>Amount</th>
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
              </tbody>
            </table>
          </div>
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

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
