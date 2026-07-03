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
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { fieldClass, fieldLabelClass, fieldTextareaClass } from "@/components/ui/field";
import { statusTone } from "@/components/status-pill";
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
import { restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { accountDetailReadModelForWorkspace, ownedCrmRecordScope } from "@/lib/phase1/queries";
import { readFastAccountDetailModel } from "@/lib/phase1/crm-detail-read-model";
import { dedupeTimelineActivities } from "@/lib/phase1/crm-display";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import type { ActivityType, CallLog, CustomField, Note } from "@/lib/phase1/types";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { TileGrid, TileItem } from "@/components/tile-grid";
import { canCustomizeTiles, readUserTileLayout } from "@/lib/phase1/tile-layouts";

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

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionContext = await getWorkspaceSessionContext("manage_crm");
  const fastModel = await readFastAccountDetailModel(sessionContext.session, sessionContext.workspaceId, id);
  let state = fastModel?.state;
  let session = sessionContext.session;
  let workspaceId = sessionContext.workspaceId;
  let readState = fastModel?.state;
  let readModel = fastModel?.readModel;
  const fastReadCheckedVisibility = Boolean(fastModel);

  if (fastModel && !fastModel.visible) {
    notFound();
  }

  if (!fastModel) {
    const context = await getWorkspaceContext("manage_crm");
    state = context.state;
    session = context.session;
    workspaceId = context.workspaceId;
    const crmRows = await crmEventReadRowsForWorkspace(state, workspaceId);
    readState = stateWithCrmEventReadRows(state, workspaceId, crmRows);
    readModel = await accountDetailReadModelForWorkspace(readState, workspaceId, id);
  }

  if (!state || !readState || !readModel) {
    notFound();
  }

  const account = readModel.account;
  const company = readModel.company;

  if (!account || !company) {
    notFound();
  }

  if (
    !fastReadCheckedVisibility &&
    restrictsToOwnedRecords(session) &&
    !ownedCrmRecordScope(readState, session).companyIds.has(company.id)
  ) {
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
  const activities = dedupeTimelineActivities(
    readState.activities
      .filter((activity) => activity.workspaceId === workspaceId && activity.companyId === account.id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  ).slice(0, 14);
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
      value: formatCurrency(account.amount),
      note: `${account.probability}% primary probability`,
      icon: CircleDollarSign,
      tone: account.amount ? "success" as const : "info" as const
    },
    {
      label: "Weighted forecast",
      value: formatCurrency(weightedForecast),
      note: `${formatNumber(opportunities.length)} linked opportunities`,
      icon: CircleDollarSign,
      tone: "info" as const
    },
    {
      label: "Contacts",
      value: formatNumber(accountContacts.length),
      note: `${account.owner} owns the active path`,
      icon: Users,
      tone: accountContacts.length ? "success" as const : "warning" as const
    },
    {
      label: "Open tasks",
      value: formatNumber(activeTasks.length),
      note: account.lastActivity,
      icon: Calendar,
      tone: activeTasks.length ? "warning" as const : "success" as const
    }
  ];

  const lanes = [
    {
      label: "Account score",
      value: account.score,
      note: `${account.priority} priority`,
      icon: Building2,
      tone: account.priority === "P1" ? "success" as const : "info" as const
    },
    {
      label: "Current work",
      value: focusTasks.length,
      note: `${formatNumber(activeTasks.length)} open tasks`,
      icon: Check,
      tone: activeTasks.length ? "warning" as const : "success" as const
    },
    {
      label: "Recent activity",
      value: recentInteractions.length,
      note: `${formatNumber(activities.length)} timeline events`,
      icon: NotebookPen,
      tone: recentInteractions.length ? "info" as const : "success" as const
    },
    {
      label: "Custom fields",
      value: companyFields.length,
      note: "Account CRM fields",
      icon: Sparkles,
      tone: "info" as const
    }
  ];

  const canCustomize = canCustomizeTiles(session);
  const savedLayout = await readUserTileLayout(session.user.id, "crm-account-detail");

  return (
    <>
      <PageHeader
        kicker="Sales CRM"
        title={account.name}
        copy="Account workspace for SDRs and managers: current health, contacts, pipeline, open work, and recent activity without backend configuration."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/crm/accounts">
                <ArrowRight aria-hidden="true" />
                Accounts
              </Link>
            </Button>
            <Button asChild>
              <Link href="/crm/contacts">
                <Users aria-hidden="true" />
                Contacts
              </Link>
            </Button>
          </>
        }
      />

      <TileGrid pageKey="crm-account-detail" canCustomize={canCustomize} saved={savedLayout}>
        {metrics.map((metric, index) => (
          <TileItem key={`metric-${index}`} id={`metric-${index}`} x={index * 3} y={0} w={3} h={2} minW={2}>
            <StatCard
              icon={metric.icon}
              label={metric.label}
              value={metric.value}
              note={metric.note}
              tone={metric.tone}
              fill
            />
          </TileItem>
        ))}
        {lanes.map((lane, index) => (
          <TileItem key={`lane-${index}`} id={`lane-${index}`} x={index * 3} y={2} w={3} h={2} minW={2}>
            <div className="bg-card flex h-full items-center gap-3 rounded-xl border p-4 shadow-sm">
              <ToneIcon icon={lane.icon} tone={lane.tone} />
              <div className="min-w-0">
                <div className="text-lg font-semibold text-foreground">{formatNumber(lane.value)}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {lane.label} · {lane.note}
                </div>
              </div>
            </div>
          </TileItem>
        ))}

        <TileItem id="account-snapshot" x={0} y={4} w={7} h={7} minW={4} minH={3}>
        <Panel
          title="Account snapshot"
          subtitle="Firmographics, routing owner, source lineage, and compliance state."
          action={<StatusBadge label={account.priority} tone={account.priority === "P1" ? "success" : "warning"} />}
          fill
        >
          <div className="flex flex-col gap-3">
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
              <div className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0" key={label}>
                <span className="text-sm font-medium text-foreground">{label}</span>
                <span className="text-sm text-muted-foreground">{value}</span>
              </div>
            ))}
          </div>
        </Panel>
        </TileItem>

        <TileItem id="current-work" x={7} y={4} w={5} h={7} minW={3} minH={3}>
        <Panel
          title="Current work"
          subtitle="Open tasks the CRM team should act on next."
          action={<StatusBadge label={`${activeTasks.length} open`} tone={activeTasks.length ? "warning" : "success"} />}
          fill
        >
          <div className="flex flex-col gap-4">
            {focusTasks.map((task) => (
              <div className="flex flex-col gap-2 border-b pb-4 last:border-0 last:pb-0" key={task.id}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{task.title}</span>
                  <StatusBadge label={task.status} tone={statusTone(task.status)} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge label={task.priority} tone="default" />
                  <StatusBadge label={userNameForId(state, task.ownerUserId)} tone="default" />
                  {task.dueAt ? <StatusBadge label={`Due ${formatDate(task.dueAt)}`} tone="default" /> : null}
                </div>
                {task.status !== "Completed" ? (
                  <form action={completeTaskAction}>
                    <input name="id" type="hidden" value={task.id} />
                    <SubmitButton className={buttonVariants({ variant: "outline", size: "sm" })} pendingLabel="Completing…">
                      <Check size={16} aria-hidden="true" />
                      Complete
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
            ))}
            {focusTasks.length === 0 ? <p className="text-xs text-muted-foreground">No open account tasks right now.</p> : null}
          </div>
        </Panel>
        </TileItem>

        <TileItem id="pipeline" x={0} y={11} w={7} h={7} minW={4} minH={3}>
        <Panel
          title="Pipeline"
          subtitle="Linked opportunities with stage, amount, probability, close date, and owner."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/crm/opportunities">Open pipeline</Link>
            </Button>
          }
          flush
          fill
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Opportunity</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Probability</TableHead>
                <TableHead>Move</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opportunities.map((opportunity) => (
                <TableRow key={opportunity.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{opportunity.name}</span>
                      <span className="text-xs text-muted-foreground">{userNameForId(state, opportunity.ownerUserId)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge label={opportunity.stage} tone={statusTone(opportunity.stage)} />
                  </TableCell>
                  <TableCell className="text-foreground">{formatCurrency(opportunity.amount)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-foreground">{opportunity.probability}%</span>
                      <MeterBar value={opportunity.probability} showValue={false} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <form action={updateOpportunityStageAction} className="flex items-center gap-2">
                      <input name="id" type="hidden" value={opportunity.id} />
                      <select name="stage" defaultValue={opportunity.stage} aria-label="Stage" className={fieldClass}>
                        {opportunityStages.map((stage) => (
                          <option key={stage} value={stage}>
                            {stage}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" variant="outline" size="icon" aria-label="Save stage">
                        <Save size={16} aria-hidden="true" />
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
              {opportunities.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">No opportunities are linked to this account yet.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>
        </TileItem>

        <TileItem id="contacts" x={7} y={11} w={5} h={7} minW={3} minH={3}>
        <Panel
          title="Contacts"
          subtitle="People linked to this account with verification, score, and owner."
          action={<StatusBadge label={`${accountContacts.length} contacts`} tone="info" />}
          flush
          fill
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accountContacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell>
                    <Link href={`/crm/contacts/${contact.id}`} className="flex flex-col">
                      <span className="font-medium text-foreground">{contact.name}</span>
                      <span className="text-xs text-muted-foreground">{contact.title}</span>
                      <span className="text-xs text-muted-foreground">{contact.email}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge label={contact.grade} tone={statusTone(contact.grade)} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{contact.score}</TableCell>
                  <TableCell>
                    <StatusBadge label={contact.status} tone={statusTone(contact.status)} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{contact.owner}</TableCell>
                </TableRow>
              ))}
              {accountContacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">No contacts are linked to this account yet.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>
        </TileItem>

        <TileItem id="activity-timeline" x={0} y={18} w={7} h={7} minW={4} minH={3}>
        <Panel
          title="Activity timeline"
          subtitle="Calls, notes, tasks, opportunity changes, and system events."
          action={<StatusBadge label={`${activities.length} events`} tone="info" />}
          fill
        >
          <div className="flex flex-col gap-4">
            {activities.map((activity) => {
              const Icon = activityIcons[activity.type] ?? NotebookPen;

              return (
                <div className="flex gap-3 border-b pb-4 last:border-0 last:pb-0" key={activity.id}>
                  <ToneIcon icon={Icon} tone="info" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-foreground">{activity.title}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(activity.createdAt)}</span>
                    </div>
                    {activity.body ? <p className="mt-0.5 text-xs text-muted-foreground">{activity.body}</p> : null}
                    <div className="mt-1.5">
                      <StatusBadge label={userNameForId(state, activity.actorUserId)} tone="default" />
                    </div>
                  </div>
                </div>
              );
            })}
            {activities.length === 0 ? <p className="text-xs text-muted-foreground">No activity has been recorded yet.</p> : null}
          </div>
        </Panel>
        </TileItem>

        <TileItem id="recent-notes-calls" x={7} y={18} w={5} h={7} minW={3} minH={3}>
        <Panel
          title="Recent notes and calls"
          subtitle="Latest manual account context and call outcomes."
          action={<ToneIcon icon={Phone} tone="info" />}
          fill
        >
          <div className="flex flex-col gap-4">
            {recentInteractions.map((item) => (
              <div className="flex flex-col gap-1.5 border-b pb-4 last:border-0 last:pb-0" key={item.id}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{isCall(item) ? item.outcome : "Note"}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{isCall(item) ? item.notes : item.body}</p>
              </div>
            ))}
            {recentInteractions.length === 0 ? <p className="text-xs text-muted-foreground">No notes or calls have been logged yet.</p> : null}
          </div>
        </Panel>
        </TileItem>

        <TileItem id="add-account-work" x={0} y={25} w={7} h={12} minW={4} minH={5}>
        <Panel
          title="Add account work"
          subtitle="Create the next task or opportunity from this account record."
          action={<ToneIcon icon={Calendar} tone="info" />}
          fill
        >
          <div className="flex flex-col gap-6">
            <form action={createTaskAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input name="companyId" type="hidden" value={account.id} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="task-title" className={fieldLabelClass}>Task</label>
                <input id="task-title" name="title" placeholder="Send follow-up email" className={fieldClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="task-contact" className={fieldLabelClass}>Contact</label>
                <select id="task-contact" name="contactId" defaultValue="" className={fieldClass}>
                  <option value="">Account-level task</option>
                  {accountContacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="task-priority" className={fieldLabelClass}>Priority</label>
                <select id="task-priority" name="priority" defaultValue="Normal" className={fieldClass}>
                  {taskPriorities.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="task-due" className={fieldLabelClass}>Due date</label>
                <input id="task-due" name="dueAt" type="date" className={fieldClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="task-owner" className={fieldLabelClass}>Owner</label>
                <select id="task-owner" name="ownerUserId" defaultValue={state.users[0]?.id} className={fieldClass}>
                  {state.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <SubmitButton className={buttonVariants({ className: "w-full" })} pendingLabel="Adding…">
                  Add task
                </SubmitButton>
              </div>
            </form>
            <form action={createOpportunityAction} className="grid grid-cols-1 gap-4 border-t pt-6 sm:grid-cols-2">
              <input name="companyId" type="hidden" value={account.id} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="opp-name" className={fieldLabelClass}>Opportunity</label>
                <input id="opp-name" name="name" defaultValue={`${account.name} expansion`} className={fieldClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="opp-contact" className={fieldLabelClass}>Primary contact</label>
                <select id="opp-contact" name="contactId" defaultValue={accountContacts[0]?.id ?? ""} className={fieldClass}>
                  <option value="">No primary contact</option>
                  {accountContacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="opp-stage" className={fieldLabelClass}>Stage</label>
                <select id="opp-stage" name="stage" defaultValue="Prospecting" className={fieldClass}>
                  {opportunityStages.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="opp-amount" className={fieldLabelClass}>Amount</label>
                <input id="opp-amount" name="amount" type="number" min="0" step="500" defaultValue="25000" className={fieldClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="opp-close" className={fieldLabelClass}>Expected close</label>
                <input id="opp-close" name="expectedCloseDate" type="date" className={fieldClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="opp-owner" className={fieldLabelClass}>Owner</label>
                <select id="opp-owner" name="ownerUserId" defaultValue={state.users[0]?.id} className={fieldClass}>
                  {state.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="opp-source" className={fieldLabelClass}>Source</label>
                <input id="opp-source" name="source" defaultValue={account.source} className={fieldClass} />
              </div>
              <div className="flex items-end">
                <SubmitButton className={buttonVariants({ variant: "outline", className: "w-full" })} pendingLabel="Adding…">
                  Add opportunity
                </SubmitButton>
              </div>
            </form>
          </div>
        </Panel>
        </TileItem>

        <TileItem id="log-activity" x={7} y={25} w={5} h={12} minW={3} minH={5}>
        <Panel
          title="Log activity"
          subtitle="Add notes or call outcomes without leaving the account."
          action={<ToneIcon icon={NotebookPen} tone="info" />}
          fill
        >
          <div className="flex flex-col gap-6">
            <form action={createNoteAction} className="flex flex-col gap-4">
              <input name="companyId" type="hidden" value={account.id} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="note-contact" className={fieldLabelClass}>Note contact</label>
                <select id="note-contact" name="contactId" defaultValue="" className={fieldClass}>
                  <option value="">Account note</option>
                  {accountContacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="note-body" className={fieldLabelClass}>Note</label>
                <textarea id="note-body" name="body" placeholder="Add account context" className={fieldTextareaClass} />
              </div>
              <div>
                <SubmitButton className={buttonVariants({ className: "w-full" })} pendingLabel="Adding…">
                  Add note
                </SubmitButton>
              </div>
            </form>
            <form action={createCallLogAction} className="grid grid-cols-1 gap-4 border-t pt-6 sm:grid-cols-2">
              <input name="companyId" type="hidden" value={account.id} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="call-contact" className={fieldLabelClass}>Call contact</label>
                <select id="call-contact" name="contactId" defaultValue={accountContacts[0]?.id ?? ""} className={fieldClass}>
                  {accountContacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="call-phone" className={fieldLabelClass}>Phone</label>
                <input id="call-phone" name="phone" defaultValue={accountContacts[0]?.phone ?? company.phone} className={fieldClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="call-outcome" className={fieldLabelClass}>Outcome</label>
                <select id="call-outcome" name="outcome" defaultValue="Connected" className={fieldClass}>
                  {callOutcomes.map((outcome) => (
                    <option key={outcome} value={outcome}>
                      {outcome}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="call-duration" className={fieldLabelClass}>Minutes</label>
                <input id="call-duration" name="durationMinutes" type="number" min="0" step="1" defaultValue="5" className={fieldClass} />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="call-notes" className={fieldLabelClass}>Call notes</label>
                <textarea id="call-notes" name="notes" placeholder="Summarize the conversation" className={fieldTextareaClass} />
              </div>
              <div className="flex items-end sm:col-span-2">
                <SubmitButton className={buttonVariants({ variant: "outline", className: "w-full" })} pendingLabel="Logging…">
                  Log call
                </SubmitButton>
              </div>
            </form>
          </div>
        </Panel>
        </TileItem>

        <TileItem id="custom-fields" x={0} y={37} w={12} h={7} minW={6} minH={3}>
        <Panel
          title="Custom fields"
          subtitle="Account-specific CRM fields for the team."
          action={<StatusBadge label={`${companyFields.length} fields`} tone="info" />}
          fill
        >
          <div className="flex flex-col gap-4">
            {companyFields.map((field) => (
              <form action={setCustomFieldValueAction} className="flex items-end gap-3 border-b pb-4 last:border-0 last:pb-0" key={field.id}>
                <input name="customFieldId" type="hidden" value={field.id} />
                <input name="objectId" type="hidden" value={account.id} />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label className={fieldLabelClass}>{field.name}</label>
                  <CustomFieldInput field={field} value={fieldValueMap.get(field.id)?.value ?? ""} />
                </div>
                <SubmitButton className={buttonVariants({ variant: "outline" })} pendingLabel="Saving…">
                  <Save size={16} aria-hidden="true" />
                  Save field
                </SubmitButton>
              </form>
            ))}
            <form action={createCustomFieldAction} className="grid grid-cols-1 gap-4 border-t pt-6 sm:grid-cols-2">
              <input name="objectType" type="hidden" value="company" />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="company-field-name" className={fieldLabelClass}>Field name</label>
                <input id="company-field-name" name="name" placeholder="Renewal risk" className={fieldClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="company-field-type" className={fieldLabelClass}>Type</label>
                <select id="company-field-type" name="fieldType" defaultValue="text" className={fieldClass}>
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="select">Select</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="company-field-options" className={fieldLabelClass}>Options</label>
                <input id="company-field-options" name="options" placeholder="Low, Medium, High" className={fieldClass} />
              </div>
              <div className="flex items-end">
                <SubmitButton className={buttonVariants({ className: "w-full" })} pendingLabel="Creating…">
                  Create field
                </SubmitButton>
              </div>
            </form>
          </div>
        </Panel>
        </TileItem>
      </TileGrid>
    </>
  );
}

function CustomFieldInput({ field, value }: { field: CustomField; value: string }) {
  if (field.fieldType === "select") {
    return (
      <select name="value" defaultValue={value} aria-label={field.name} className={fieldClass}>
        <option value="">Unset</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return <input name="value" type={field.fieldType} defaultValue={value} aria-label={field.name} className={fieldClass} />;
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
