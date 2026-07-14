import { notFound } from "next/navigation";

import { restrictsToOwnedRecords } from "@/lib/phase1/auth";
import {
  crmEventReadRowsForWorkspace,
  stateWithCrmEventReadRows
} from "@/lib/phase1/crm-event-read-path";
import { accountDetailReadModelForWorkspace, ownedCrmRecordScope } from "@/lib/phase1/queries";
import { readFastAccountDetailModel } from "@/lib/phase1/crm-detail-read-model";
import { dedupeTimelineActivities } from "@/lib/phase1/crm-display";
import { timelineActivityDisplayForViewer } from "@/lib/phase1/activity-timeline-redaction";
import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { callOutcomes, opportunityStages, userNameForId } from "@/lib/phase1/crm";
import { readKeyAccountFields } from "@/lib/phase1/key-account-fields-read-model";
import { formatCurrency } from "@/lib/utils";
import { AccountWorkbench } from "@/components/crm/cockpit/account-workbench";
import type {
  AccountContactRow,
  AccountDossierData,
  AccountOppRow,
  AccountTaskRow
} from "@/components/crm/cockpit/account-dossier";
import type { FocusTimelineItem } from "@/components/crm/cockpit/focus/focus-types";

export const dynamic = "force-dynamic";

const CLOSED_STAGES = new Set(["Closed won", "Closed lost"]);

// The cockpit account record: the same visual system as the contact page —
// AccountDossier (identity + compliance band + scan strip + tabs) plus a right
// action rail (account-health + add task / opportunity / note / log call).
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

  const stateForRead = state;
  const accountContacts = readModel.contacts;
  const opportunities = readState.opportunities
    .filter((opportunity) => opportunity.workspaceId === workspaceId && opportunity.companyId === account.id)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const tasks = readState.tasks
    .filter((task) => task.workspaceId === workspaceId && task.companyId === account.id)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const activeTasks = tasks.filter((task) => task.status !== "Completed");
  const activities = dedupeTimelineActivities(
    readState.activities
      .filter((activity) => activity.workspaceId === workspaceId && activity.companyId === account.id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  ).slice(0, 20);

  const timeline: FocusTimelineItem[] = activities.flatMap((activity) => {
    const display = timelineActivityDisplayForViewer({
      activity,
      actorName: userNameForId(stateForRead, activity.actorUserId),
      viewerRole: session.role,
      viewerName: session.user.name
    });
    if (display.hidden) {
      return [];
    }
    return [
      {
        id: activity.id,
        type: activity.type,
        title: display.title,
        body: display.body,
        meta: relativeLabel(activity.createdAt)
      }
    ];
  });

  const openPipeline = opportunities
    .filter((opportunity) => !CLOSED_STAGES.has(opportunity.stage))
    .reduce((sum, opportunity) => sum + opportunity.amount, 0);
  const weightedForecast = opportunities.reduce(
    (sum, opportunity) => sum + Math.round(opportunity.amount * (opportunity.probability / 100)),
    0
  );

  const kafMap = await readKeyAccountFields(workspaceId, [account.id]);
  const keyAccountFields = kafMap.get(account.id) ?? [];

  const contactRows: AccountContactRow[] = accountContacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    email: contact.email,
    grade: contact.grade,
    score: contact.score,
    status: contact.status,
    owner: contact.owner
  }));
  const opportunityRows: AccountOppRow[] = opportunities.map((opportunity) => ({
    name: opportunity.name,
    stage: opportunity.stage,
    amountLabel: formatCurrency(opportunity.amount),
    probability: opportunity.probability,
    closeLabel: opportunity.expectedCloseDate ? formatShortDate(opportunity.expectedCloseDate) : "TBD"
  }));
  const taskRows: AccountTaskRow[] = activeTasks.map((task) => ({
    title: task.title,
    dueLabel: task.dueAt ? `Due ${formatShortDate(task.dueAt)}` : "No due date",
    overdue: isOverdue(task.dueAt)
  }));

  const accountData: AccountDossierData = {
    id: account.id,
    name: account.name,
    stage: account.stage,
    priority: account.priority,
    score: account.score,
    owner: account.owner,
    domain: account.domain,
    industry: account.industry,
    location: account.location,
    employees: account.employees,
    revenueBand: account.revenueBand,
    source: account.source,
    compliance: account.compliance,
    complianceClear: !accountContacts.some((contact) => contact.isSuppressed),
    description: account.description,
    pipelineLabel: formatCurrency(openPipeline),
    openTasksCount: activeTasks.length,
    contacts: contactRows,
    opportunities: opportunityRows,
    tasks: taskRows,
    timeline,
    keyAccountFields
  };

  const actionContacts = accountContacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    phone: contact.phone
  }));

  return (
    <AccountWorkbench
      account={accountData}
      health={{
        pipelineLabel: formatCurrency(openPipeline),
        weightedLabel: formatCurrency(weightedForecast),
        contactsCount: accountContacts.length,
        openTasksCount: activeTasks.length
      }}
      actionContacts={actionContacts}
      source={account.source}
      stages={opportunityStages}
      outcomes={callOutcomes}
    />
  );
}

function relativeLabel(value: string): string {
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60000);
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 43200) return `${Math.round(minutes / 1440)}d ago`;
  return `${Math.round(minutes / 43200)}mo ago`;
}

function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isOverdue(dueAt: string | undefined): boolean {
  return Boolean(dueAt && Date.parse(dueAt) < Date.now());
}
