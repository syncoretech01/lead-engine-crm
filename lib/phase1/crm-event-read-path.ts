import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type {
  Activity,
  ActivityType,
  AppState,
  CallLog,
  CrmTask,
  Note,
  Opportunity,
  OpportunityStage,
  TaskPriority,
  TaskStatus
} from "@/lib/phase1/types";

export type CrmEventReadRows = {
  opportunities: Opportunity[];
  activities: Activity[];
  tasks: CrmTask[];
  notes: Note[];
  callLogs: CallLog[];
};

type AccountRelation = { companyId: string | null } | null;
type CrmContactRelation = { contactId: string | null } | null;

type PrismaOpportunityReadRow = {
  id: string;
  workspaceId: string;
  accountId: string;
  contactId: string | null;
  name: string;
  stage: string;
  amountCents: number;
  probability: number;
  expectedCloseDate: Date | string | null;
  ownerUserId: string | null;
  source: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  account: AccountRelation;
  contact: CrmContactRelation;
};

type PrismaActivityReadRow = {
  id: string;
  workspaceId: string;
  accountId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  actorUserId: string | null;
  type: string;
  title: string;
  body: string | null;
  metadata: unknown;
  occurredAt: Date | string;
  account: AccountRelation;
  contact: CrmContactRelation;
};

type PrismaTaskReadRow = {
  id: string;
  workspaceId: string;
  accountId: string | null;
  contactId: string | null;
  title: string;
  status: string;
  priority: string;
  dueAt: Date | string | null;
  ownerUserId: string | null;
  createdById: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt: Date | string | null;
  account: AccountRelation;
  contact: CrmContactRelation;
};

type PrismaNoteReadRow = {
  id: string;
  workspaceId: string;
  accountId: string | null;
  contactId: string | null;
  body: string;
  createdById: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  account: AccountRelation;
  contact: CrmContactRelation;
};

type PrismaCallLogReadRow = {
  id: string;
  workspaceId: string;
  accountId: string | null;
  contactId: string | null;
  phone: string;
  outcome: string;
  durationSeconds: number;
  notes: string | null;
  createdById: string | null;
  createdAt: Date | string;
  account: AccountRelation;
  contact: CrmContactRelation;
};

export async function crmEventReadRowsForWorkspace(
  state: AppState,
  workspaceId: string
): Promise<CrmEventReadRows> {
  const snapshotRows = crmEventReadRowsFromState(state, workspaceId);

  if (resolveStorageDriver() !== "prisma") {
    return snapshotRows;
  }

  try {
    const normalizedRows = await readNormalizedCrmEventRowsFromPrisma(workspaceId);
    const snapshotHasRows = hasCrmEventRows(snapshotRows);
    const normalizedHasRows = hasCrmEventRows(normalizedRows);

    if (snapshotHasRows && !normalizedHasRows) {
      return snapshotRows;
    }

    return normalizedRows;
  } catch (error) {
    console.warn("Falling back to snapshot CRM event rows after normalized Prisma read failed.", error);
    return snapshotRows;
  }
}

export function crmEventReadRowsFromState(state: AppState, workspaceId: string): CrmEventReadRows {
  return {
    opportunities: state.opportunities.filter((opportunity) => opportunity.workspaceId === workspaceId),
    activities: state.activities.filter((activity) => activity.workspaceId === workspaceId),
    tasks: state.tasks.filter((task) => task.workspaceId === workspaceId),
    notes: state.notes.filter((note) => note.workspaceId === workspaceId),
    callLogs: state.callLogs.filter((call) => call.workspaceId === workspaceId)
  };
}

export function stateWithCrmEventReadRows(
  state: AppState,
  workspaceId: string,
  rows: CrmEventReadRows
): AppState {
  return {
    ...state,
    opportunities: [
      ...state.opportunities.filter((opportunity) => opportunity.workspaceId !== workspaceId),
      ...rows.opportunities
    ],
    activities: [
      ...state.activities.filter((activity) => activity.workspaceId !== workspaceId),
      ...rows.activities
    ],
    tasks: [
      ...state.tasks.filter((task) => task.workspaceId !== workspaceId),
      ...rows.tasks
    ],
    notes: [
      ...state.notes.filter((note) => note.workspaceId !== workspaceId),
      ...rows.notes
    ],
    callLogs: [
      ...state.callLogs.filter((call) => call.workspaceId !== workspaceId),
      ...rows.callLogs
    ]
  };
}

async function readNormalizedCrmEventRowsFromPrisma(workspaceId: string): Promise<CrmEventReadRows> {
  const { prisma } = await import("@/lib/prisma");
  const accountSelect = { select: { companyId: true } };
  const contactSelect = { select: { contactId: true } };
  const [opportunityRows, activityRows, taskRows, noteRows, callRows] = await Promise.all([
    prisma.opportunity.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        accountId: true,
        contactId: true,
        name: true,
        stage: true,
        amountCents: true,
        probability: true,
        expectedCloseDate: true,
        ownerUserId: true,
        source: true,
        createdAt: true,
        updatedAt: true,
        account: accountSelect,
        contact: contactSelect
      }
    }),
    prisma.activity.findMany({
      where: { workspaceId },
      orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        accountId: true,
        contactId: true,
        opportunityId: true,
        actorUserId: true,
        type: true,
        title: true,
        body: true,
        metadata: true,
        occurredAt: true,
        account: accountSelect,
        contact: contactSelect
      }
    }),
    prisma.task.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        accountId: true,
        contactId: true,
        title: true,
        status: true,
        priority: true,
        dueAt: true,
        ownerUserId: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        account: accountSelect,
        contact: contactSelect
      }
    }),
    prisma.note.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        accountId: true,
        contactId: true,
        body: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
        account: accountSelect,
        contact: contactSelect
      }
    }),
    prisma.callLog.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        accountId: true,
        contactId: true,
        phone: true,
        outcome: true,
        durationSeconds: true,
        notes: true,
        createdById: true,
        createdAt: true,
        account: accountSelect,
        contact: contactSelect
      }
    })
  ]);

  return {
    opportunities: opportunityRows.map((row) => opportunityFromPrisma(row)),
    activities: activityRows.map((row) => activityFromPrisma(row)),
    tasks: taskRows.map((row) => taskFromPrisma(row)),
    notes: noteRows.map((row) => noteFromPrisma(row)),
    callLogs: callRows.map((row) => callLogFromPrisma(row))
  };
}

function opportunityFromPrisma(row: PrismaOpportunityReadRow): Opportunity {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.account?.companyId ?? row.accountId,
    contactId: row.contact?.contactId ?? row.contactId ?? undefined,
    name: row.name,
    stage: opportunityStageValue(row.stage),
    amount: Math.round(row.amountCents) / 100,
    probability: row.probability,
    expectedCloseDate: optionalIsoString(row.expectedCloseDate),
    ownerUserId: row.ownerUserId ?? "system",
    source: row.source ?? "CRM",
    createdAt: isoString(row.createdAt),
    updatedAt: isoString(row.updatedAt)
  };
}

function activityFromPrisma(row: PrismaActivityReadRow): Activity {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.account?.companyId ?? row.accountId ?? undefined,
    contactId: row.contact?.contactId ?? row.contactId ?? undefined,
    opportunityId: row.opportunityId ?? undefined,
    type: activityTypeValue(row.type),
    title: row.title,
    body: row.body ?? undefined,
    actorUserId: row.actorUserId ?? "system",
    metadata: primitiveRecord(row.metadata),
    createdAt: isoString(row.occurredAt)
  };
}

function taskFromPrisma(row: PrismaTaskReadRow): CrmTask {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.account?.companyId ?? row.accountId ?? undefined,
    contactId: row.contact?.contactId ?? row.contactId ?? undefined,
    title: row.title,
    status: taskStatusValue(row.status),
    priority: taskPriorityValue(row.priority),
    dueAt: optionalIsoString(row.dueAt),
    ownerUserId: row.ownerUserId ?? "system",
    createdById: row.createdById ?? "system",
    createdAt: isoString(row.createdAt),
    updatedAt: isoString(row.updatedAt),
    completedAt: optionalIsoString(row.completedAt)
  };
}

function noteFromPrisma(row: PrismaNoteReadRow): Note {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.account?.companyId ?? row.accountId ?? undefined,
    contactId: row.contact?.contactId ?? row.contactId ?? undefined,
    body: row.body,
    createdById: row.createdById ?? "system",
    createdAt: isoString(row.createdAt),
    updatedAt: isoString(row.updatedAt)
  };
}

function callLogFromPrisma(row: PrismaCallLogReadRow): CallLog {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.account?.companyId ?? row.accountId ?? undefined,
    contactId: row.contact?.contactId ?? row.contactId ?? undefined,
    phone: row.phone,
    outcome: callOutcomeValue(row.outcome),
    durationSeconds: row.durationSeconds,
    notes: row.notes ?? "",
    createdById: row.createdById ?? "system",
    createdAt: isoString(row.createdAt)
  };
}

function hasCrmEventRows(rows: CrmEventReadRows) {
  return rows.opportunities.length > 0 ||
    rows.activities.length > 0 ||
    rows.tasks.length > 0 ||
    rows.notes.length > 0 ||
    rows.callLogs.length > 0;
}

function opportunityStageValue(value: string): OpportunityStage {
  const map: Record<string, OpportunityStage> = {
    PROSPECTING: "Prospecting",
    QUALIFIED: "Qualified",
    DISCOVERY: "Discovery",
    PROPOSAL: "Proposal",
    CLOSED_WON: "Closed won",
    CLOSED_LOST: "Closed lost",
    Prospecting: "Prospecting",
    Qualified: "Qualified",
    Discovery: "Discovery",
    Proposal: "Proposal",
    "Closed won": "Closed won",
    "Closed lost": "Closed lost"
  };

  return map[value] ?? "Prospecting";
}

function activityTypeValue(value: string): ActivityType {
  const map: Record<string, ActivityType> = {
    EMAIL: "Email",
    CALL: "Call",
    SMS: "SMS",
    NOTE: "Note",
    TASK: "Task",
    MEETING: "Meeting",
    STATUS_CHANGE: "Status change",
    VERIFICATION: "Verification",
    OPPORTUNITY: "Opportunity",
    Email: "Email",
    Call: "Call",
    Note: "Note",
    Task: "Task",
    Meeting: "Meeting",
    Verification: "Verification",
    Opportunity: "Opportunity"
  };

  return map[value] ?? "Note";
}

function taskStatusValue(value: string): TaskStatus {
  if (value === "Open" || value === "Completed" || value === "Overdue") {
    return value;
  }

  return "Open";
}

function taskPriorityValue(value: string): TaskPriority {
  const normalized = value.toLowerCase();
  if (normalized === "low") return "Low";
  if (normalized === "high") return "High";
  return "Normal";
}

function callOutcomeValue(value: string): CallLog["outcome"] {
  if (value === "Connected" || value === "Left voicemail" || value === "No answer" || value === "Bad number") {
    return value;
  }

  return "No answer";
}

function primitiveRecord(value: unknown): Record<string, string | number | boolean | undefined> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, item]) =>
      item === undefined || typeof item === "string" || typeof item === "number" || typeof item === "boolean"
    )
  );
}

function isoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function optionalIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return isoString(value);
}
