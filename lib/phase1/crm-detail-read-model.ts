import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { defaultWaterfallTemplates } from "@/lib/phase1/waterfall-templates";
import type {
  Activity,
  AppState,
  CallLog,
  Company,
  Contact,
  CrmTask,
  CustomField,
  CustomFieldValue,
  Note,
  Opportunity,
  OpportunityStage,
  Session
} from "@/lib/phase1/types";
import {
  activityTypeValue,
  consentStatusValue,
  createFastState,
  customFieldObjectTypeValue,
  customFieldTypeValue,
  lawfulBasisValue,
  leadGradeValue,
  leadStatusValue,
  opportunityStageValue,
  optionalIso,
  priorityValue,
  recordFromJson,
  stringArray,
  taskPriorityValue,
  taskStatusValue,
  uniqueUsers,
  userFromPrisma,
  workspaceMemberFromPrisma
} from "@/lib/phase1/fast-read-utils";

export type FastAccountDetailView = {
  id: string;
  name: string;
  domain: string;
  industry: string;
  location: string;
  employees: string;
  revenueBand: string;
  source: string;
  score: number;
  priority: Company["priority"];
  owner: string;
  stage: Opportunity["stage"];
  amount: number;
  probability: number;
  opportunities: number;
  contacts: number;
  openTasks: number;
  lastActivity: string;
  lastActivityAt?: string;
  compliance: string;
  description: string;
};

export type FastContactDetailModel = {
  state: AppState;
  readModel: {
    contact?: Contact;
    company?: Company;
  };
  visible: boolean;
};

export type FastAccountDetailModel = {
  state: AppState;
  readModel: {
    account?: FastAccountDetailView;
    company?: Company;
    contacts: Contact[];
  };
  visible: boolean;
};

export async function readFastContactDetailModel(
  session: Session,
  workspaceId: string,
  contactId: string
): Promise<FastContactDetailModel | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    include: { company: true }
  });

  if (!contact) {
    return {
      state: createFastState(session),
      readModel: {},
      visible: true
    };
  }

  const visible = await canSeeCrmRecord(session, workspaceId, {
    contactId: contact.id,
    companyId: contact.companyId ?? undefined
  });

  if (!visible) {
    return {
      state: createFastState(session),
      readModel: {},
      visible: false
    };
  }

  const companyId = contact.companyId ?? "";
  const [
    opportunities,
    tasks,
    notes,
    callLogs,
    activities,
    customFields,
    customFieldValues,
    memberRows
  ] = await Promise.all([
    prisma.opportunity.findMany({
      where: {
        workspaceId,
        OR: [{ contactId: contact.id }, ...(companyId ? [{ accountId: companyId }] : [])]
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
    }),
    prisma.task.findMany({
      where: { workspaceId, contactId: contact.id },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
    }),
    prisma.note.findMany({
      where: { workspaceId, contactId: contact.id },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }]
    }),
    prisma.callLog.findMany({
      where: { workspaceId, contactId: contact.id },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }]
    }),
    prisma.activity.findMany({
      where: { workspaceId, contactId: contact.id },
      orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
      take: 50
    }),
    prisma.customField.findMany({
      where: { workspaceId, objectType: "contact" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    }),
    prisma.customFieldValue.findMany({
      where: { workspaceId, objectId: contact.id },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: [{ role: "asc" }, { id: "asc" }]
    })
  ]);

  const users = uniqueUsers(memberRows.map(({ user }) => userFromPrisma(user)));
  const mappedContact = contactFromPrisma(contact);
  const mappedCompany = contact.company ? companyFromPrisma(contact.company) : undefined;
  const state = createFastState(session, {
    users,
    workspaceMembers: memberRows.map(workspaceMemberFromPrisma),
    companies: mappedCompany ? [mappedCompany] : [],
    contacts: [mappedContact],
    opportunities: opportunities.map(opportunityFromPrisma),
    tasks: tasks.map(taskFromPrisma),
    notes: notes.map(noteFromPrisma),
    callLogs: callLogs.map(callLogFromPrisma),
    activities: activities.map(activityFromPrisma),
    customFields: customFields.map(customFieldFromPrisma),
    customFieldValues: customFieldValues.map(customFieldValueFromPrisma),
    waterfallTemplates: defaultWaterfallTemplates(workspaceId)
  });

  return {
    state,
    readModel: {
      contact: mappedContact,
      company: mappedCompany
    },
    visible: true
  };
}

export async function readFastAccountDetailModel(
  session: Session,
  workspaceId: string,
  companyId: string
): Promise<FastAccountDetailModel | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const company = await prisma.company.findFirst({
    where: { id: companyId, workspaceId }
  });

  if (!company) {
    return {
      state: createFastState(session),
      readModel: { contacts: [] },
      visible: true
    };
  }

  const visible = await canSeeCrmRecord(session, workspaceId, { companyId: company.id });
  if (!visible) {
    return {
      state: createFastState(session),
      readModel: { contacts: [] },
      visible: false
    };
  }

  const [
    contacts,
    opportunities,
    tasks,
    notes,
    callLogs,
    activities,
    customFields,
    customFieldValues,
    memberRows
  ] = await Promise.all([
    prisma.contact.findMany({
      where: { workspaceId, companyId: company.id },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }, { id: "asc" }]
    }),
    prisma.opportunity.findMany({
      where: { workspaceId, accountId: company.id },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
    }),
    prisma.task.findMany({
      where: { workspaceId, accountId: company.id },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
    }),
    prisma.note.findMany({
      where: { workspaceId, accountId: company.id },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }]
    }),
    prisma.callLog.findMany({
      where: { workspaceId, accountId: company.id },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }]
    }),
    prisma.activity.findMany({
      where: { workspaceId, accountId: company.id },
      orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
      take: 50
    }),
    prisma.customField.findMany({
      where: { workspaceId, objectType: "company" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    }),
    prisma.customFieldValue.findMany({
      where: { workspaceId, objectId: company.id },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: [{ role: "asc" }, { id: "asc" }]
    })
  ]);

  const users = uniqueUsers(memberRows.map(({ user }) => userFromPrisma(user)));
  const userNames = new Map(users.map((user) => [user.id, user.name]));
  const mappedCompany = companyFromPrisma(company);
  const mappedContacts = contacts.map(contactFromPrisma);
  const mappedOpportunities = opportunities.map(opportunityFromPrisma);
  const mappedTasks = tasks.map(taskFromPrisma);
  const mappedActivities = activities.map(activityFromPrisma);
  const account = accountDetailView({
    company: mappedCompany,
    contacts: mappedContacts,
    opportunities: mappedOpportunities,
    tasks: mappedTasks,
    activities: mappedActivities,
    userNames
  });
  const state = createFastState(session, {
    users,
    workspaceMembers: memberRows.map(workspaceMemberFromPrisma),
    companies: [mappedCompany],
    contacts: mappedContacts,
    opportunities: mappedOpportunities,
    tasks: mappedTasks,
    notes: notes.map(noteFromPrisma),
    callLogs: callLogs.map(callLogFromPrisma),
    activities: mappedActivities,
    customFields: customFields.map(customFieldFromPrisma),
    customFieldValues: customFieldValues.map(customFieldValueFromPrisma)
  });

  return {
    state,
    readModel: {
      account,
      company: mappedCompany,
      contacts: mappedContacts
    },
    visible: true
  };
}

async function canSeeCrmRecord(
  session: Session,
  workspaceId: string,
  input: { contactId?: string; companyId?: string }
) {
  if (session.permissions.includes("view_all_records")) {
    return true;
  }

  const { prisma } = await import("@/lib/prisma");
  const [assignment, ownedContact, ownedOpportunity] = await Promise.all([
    prisma.sdrAssignment.findFirst({
      where: {
        workspaceId,
        assignedSdrId: session.user.id,
        OR: [
          ...(input.contactId ? [{ contactId: input.contactId }] : []),
          ...(input.companyId ? [{ accountId: input.companyId }] : [])
        ]
      },
      select: { id: true }
    }),
    input.contactId
      ? prisma.contact.findFirst({
          where: { workspaceId, id: input.contactId, owner: session.user.name },
          select: { id: true }
        })
      : prisma.contact.findFirst({
          where: { workspaceId, companyId: input.companyId, owner: session.user.name },
          select: { id: true }
        }),
    prisma.opportunity.findFirst({
      where: {
        workspaceId,
        ownerUserId: session.user.id,
        OR: [
          ...(input.contactId ? [{ contactId: input.contactId }] : []),
          ...(input.companyId ? [{ accountId: input.companyId }] : [])
        ]
      },
      select: { id: true }
    })
  ]);

  return Boolean(assignment || ownedContact || ownedOpportunity);
}

function companyFromPrisma(row: {
  id: string;
  workspaceId: string;
  name: string;
  normalizedName: string;
  rootDomain: string | null;
  website: string | null;
  phone: string | null;
  industry: string | null;
  employeeBand: string | null;
  revenueBand: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  sourceLineage: unknown;
  confidence: number;
  score: number;
  priority: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Company {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    normalizedName: row.normalizedName,
    domain: row.rootDomain ?? "",
    website: row.website ?? "",
    phone: row.phone ?? "",
    industry: row.industry ?? "",
    employeeBand: row.employeeBand ?? undefined,
    revenueBand: row.revenueBand ?? undefined,
    technologies: [],
    signals: [],
    enrichmentCoverage: row.confidence,
    city: row.city ?? "",
    state: row.state ?? "",
    country: row.country ?? "",
    sourceLineage: stringArray(row.sourceLineage),
    score: row.score,
    priority: priorityValue(row.priority),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function contactFromPrisma(row: {
  id: string;
  workspaceId: string;
  companyId: string | null;
  fullName: string;
  title: string | null;
  seniority: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  sourceLineage: unknown;
  confidence: number;
  grade: string | null;
  score: number;
  priority: string | null;
  status: string | null;
  segment: string | null;
  owner: string | null;
  verification: string | null;
  enrichmentCoverage: number | null;
  fitReason: string | null;
  enrichedAt: Date | null;
  lawfulBasis: string | null;
  consentStatus: string | null;
  consentSource: string | null;
  consentCapturedAt: Date | null;
  doNotContact: boolean;
  isSuppressed: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Contact {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.companyId ?? "",
    name: row.fullName,
    title: row.title ?? "",
    seniority: row.seniority ?? undefined,
    department: row.department ?? undefined,
    email: row.email ?? "",
    phone: row.phone ?? "",
    grade: leadGradeValue(row.grade),
    score: row.score,
    priority: priorityValue(row.priority),
    status: leadStatusValue(row.status),
    segment: row.segment ?? "Unsegmented",
    owner: row.owner ?? "Unassigned",
    sourceLineage: stringArray(row.sourceLineage),
    verification: row.verification ?? "No verification yet",
    enrichmentCoverage: row.enrichmentCoverage ?? row.confidence,
    fitReason: row.fitReason ?? undefined,
    enrichedAt: optionalIso(row.enrichedAt),
    lawfulBasis: lawfulBasisValue(row.lawfulBasis),
    consentStatus: consentStatusValue(row.consentStatus),
    consentSource: row.consentSource ?? "Unknown",
    consentCapturedAt: optionalIso(row.consentCapturedAt),
    doNotContact: row.doNotContact,
    isSuppressed: row.isSuppressed,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function opportunityFromPrisma(row: {
  id: string;
  workspaceId: string;
  accountId: string;
  contactId: string | null;
  name: string;
  stage: string;
  amountCents: number;
  probability: number;
  expectedCloseDate: Date | null;
  ownerUserId: string | null;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Opportunity {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.accountId,
    contactId: row.contactId ?? undefined,
    name: row.name,
    stage: opportunityStageValue(row.stage),
    amount: Math.round(row.amountCents) / 100,
    probability: row.probability,
    expectedCloseDate: optionalIso(row.expectedCloseDate),
    ownerUserId: row.ownerUserId ?? "",
    source: row.source ?? "CRM",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function taskFromPrisma(row: {
  id: string;
  workspaceId: string;
  accountId: string | null;
  contactId: string | null;
  title: string;
  status: string;
  priority: string;
  dueAt: Date | null;
  ownerUserId: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}): CrmTask {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.accountId ?? undefined,
    contactId: row.contactId ?? undefined,
    title: row.title,
    status: taskStatusValue(row.status),
    priority: taskPriorityValue(row.priority),
    dueAt: optionalIso(row.dueAt),
    ownerUserId: row.ownerUserId ?? "",
    createdById: row.createdById ?? "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: optionalIso(row.completedAt)
  };
}

function noteFromPrisma(row: {
  id: string;
  workspaceId: string;
  accountId: string | null;
  contactId: string | null;
  body: string;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Note {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.accountId ?? undefined,
    contactId: row.contactId ?? undefined,
    body: row.body,
    createdById: row.createdById ?? "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function callLogFromPrisma(row: {
  id: string;
  workspaceId: string;
  accountId: string | null;
  contactId: string | null;
  phone: string;
  outcome: string;
  durationSeconds: number;
  notes: string | null;
  createdById: string | null;
  createdAt: Date;
}): CallLog {
  const outcome = row.outcome === "Connected" || row.outcome === "Left voicemail" || row.outcome === "Bad number"
    ? row.outcome
    : "No answer";
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.accountId ?? undefined,
    contactId: row.contactId ?? undefined,
    phone: row.phone,
    outcome,
    durationSeconds: row.durationSeconds,
    notes: row.notes ?? "",
    createdById: row.createdById ?? "",
    createdAt: row.createdAt.toISOString()
  };
}

function activityFromPrisma(row: {
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
  occurredAt: Date;
}): Activity {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    companyId: row.accountId ?? undefined,
    contactId: row.contactId ?? undefined,
    opportunityId: row.opportunityId ?? undefined,
    type: activityTypeValue(row.type),
    title: row.title,
    body: row.body ?? undefined,
    actorUserId: row.actorUserId ?? "",
    metadata: recordFromJson(row.metadata),
    createdAt: row.occurredAt.toISOString()
  };
}

function customFieldFromPrisma(row: {
  id: string;
  workspaceId: string;
  objectType: string;
  name: string;
  fieldType: string;
  options: string[];
  createdAt: Date;
}): CustomField {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    objectType: customFieldObjectTypeValue(row.objectType),
    name: row.name,
    fieldType: customFieldTypeValue(row.fieldType),
    options: row.options.length ? row.options : undefined,
    createdAt: row.createdAt.toISOString()
  };
}

function customFieldValueFromPrisma(row: {
  id: string;
  workspaceId: string;
  customFieldId: string;
  objectId: string;
  value: string;
  updatedAt: Date;
}): CustomFieldValue {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    customFieldId: row.customFieldId,
    objectId: row.objectId,
    value: row.value,
    updatedAt: row.updatedAt.toISOString()
  };
}

function accountDetailView(input: {
  company: Company;
  contacts: Contact[];
  opportunities: Opportunity[];
  tasks: CrmTask[];
  activities: Activity[];
  userNames: Map<string, string>;
}): FastAccountDetailView {
  const openOpportunities = input.opportunities.filter((opportunity) => !isClosedStage(opportunity.stage));
  const primaryOpportunity =
    [...openOpportunities].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ??
    [...input.opportunities].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const openTasks = input.tasks.filter((task) => task.status !== "Completed");
  const latestActivity = input.activities[0];
  const source = input.company.sourceLineage[0] ?? "Unknown source";
  const stage = primaryOpportunity?.stage ?? stageForPriority(input.company.priority);
  const amount =
    openOpportunities.reduce((total, opportunity) => total + opportunity.amount, 0) ||
    primaryOpportunity?.amount ||
    input.company.score * 1000;

  return {
    id: input.company.id,
    name: input.company.name,
    domain: input.company.domain,
    industry: input.company.industry,
    location: [input.company.city, input.company.state].filter(Boolean).join(", "),
    employees: input.company.employeeBand ?? "Unknown",
    revenueBand: input.company.revenueBand ?? "Unknown",
    source,
    score: input.company.score,
    priority: input.company.priority,
    owner: primaryOpportunity
      ? input.userNames.get(primaryOpportunity.ownerUserId) ?? "Syncore user"
      : input.contacts[0]?.owner ?? "Unassigned",
    stage,
    amount,
    probability: primaryOpportunity?.probability ?? stageProbabilityFallback(stage),
    opportunities: input.opportunities.length,
    contacts: input.contacts.length,
    openTasks: openTasks.length,
    lastActivity: latestActivity?.title ?? input.contacts[0]?.verification ?? "Imported from staging",
    lastActivityAt: latestActivity?.createdAt,
    compliance: input.contacts.some((contact) => contact.isSuppressed)
      ? "Suppression present"
      : "Source label and export gate clear",
    description: `${input.company.name} was created from staging with ${input.contacts.length} linked contact record${
      input.contacts.length === 1 ? "" : "s"
    }.`
  };
}

function isClosedStage(stage: OpportunityStage) {
  return stage === "Closed won" || stage === "Closed lost";
}

function stageForPriority(priority: Company["priority"]): OpportunityStage {
  if (priority === "P1") return "Qualified";
  if (priority === "S") return "Closed lost";
  return "Prospecting";
}

function stageProbabilityFallback(stage: OpportunityStage) {
  if (stage === "Closed won") return 100;
  if (stage === "Proposal") return 75;
  if (stage === "Discovery") return 55;
  if (stage === "Qualified") return 35;
  if (stage === "Closed lost") return 0;
  return 15;
}
