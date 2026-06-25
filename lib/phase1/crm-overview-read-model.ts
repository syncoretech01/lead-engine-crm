import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type {
  CustomField,
  CustomFieldValue,
  LeadGrade,
  LeadStatus,
  OpportunityStage,
  Priority,
  Session,
  User
} from "@/lib/phase1/types";

export type FastCrmAccountView = {
  id: string;
  name: string;
  domain: string;
  industry: string;
  location: string;
  employees: string;
  revenueBand: string;
  source: string;
  score: number;
  priority: Priority;
  owner: string;
  stage: OpportunityStage;
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

export type FastCrmContactSummary = {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  companyId: string;
  companyName: string;
  domain: string;
  grade: LeadGrade;
  score: number;
  priority: Priority;
  status: LeadStatus;
  segment: string;
  owner: string;
  openTasks: number;
  opportunities: number;
  lastActivity: string;
  lastActivityAt?: string;
  verification: string;
  enrichmentCoverage: number;
  isSuppressed: boolean;
};

export type FastCrmOpportunityView = {
  id: string;
  workspaceId: string;
  companyId: string;
  contactId?: string;
  name: string;
  stage: OpportunityStage;
  amount: number;
  probability: number;
  expectedCloseDate?: string;
  ownerUserId: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  companyName: string;
  companyDomain: string;
  contactName: string;
  contactEmail: string;
  owner: string;
  openTasks: number;
  lastActivity: string;
  lastActivityAt?: string;
};

export type FastCrmCampaignSummary = {
  id: string;
  name: string;
  status: string;
};

export type FastCrmOption = {
  id: string;
  name: string;
};

export type FastCrmOverviewModel = {
  accounts: FastCrmAccountView[];
  contacts: FastCrmContactSummary[];
  opportunities: FastCrmOpportunityView[];
  activeCampaigns: FastCrmCampaignSummary[];
  opportunityFields: CustomField[];
  customFieldValues: CustomFieldValue[];
  accountOptions: FastCrmOption[];
  contactOptions: FastCrmOption[];
  users: User[];
  openTaskCount: number;
  dueToday: number;
  overdue: number;
};

type Scope = {
  contactIds?: Set<string>;
  companyIds?: Set<string>;
};

type PrismaOpportunityOverviewRow = {
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
};

export async function readFastCrmOverviewModel(
  session: Session,
  workspaceId: string
): Promise<FastCrmOverviewModel | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const scope = await crmScope(session, workspaceId);
  const contactIdList = scope.contactIds ? [...scope.contactIds] : undefined;
  const companyIdList = scope.companyIds ? [...scope.companyIds] : undefined;
  const scoped = Boolean(scope.contactIds || scope.companyIds);

  const companyWhere = {
    workspaceId,
    ...(companyIdList ? { id: { in: companyIdList } } : {})
  };
  const contactWhere = {
    workspaceId,
    ...(contactIdList ? { id: { in: contactIdList } } : {})
  };
  const contextualOpportunityWhere = scoped
    ? {
        workspaceId,
        OR: [
          { ownerUserId: session.user.id },
          ...(companyIdList?.length ? [{ accountId: { in: companyIdList } }] : []),
          ...(contactIdList?.length ? [{ contactId: { in: contactIdList } }] : [])
        ]
      }
    : { workspaceId };
  const visibleOpportunityWhere = scoped
    ? { workspaceId, ownerUserId: session.user.id }
    : { workspaceId };
  const scopedTaskOr = [
    ...(companyIdList?.length ? [{ accountId: { in: companyIdList } }] : []),
    ...(contactIdList?.length ? [{ contactId: { in: contactIdList } }] : [])
  ];
  const taskWhere = scoped
    ? scopedTaskOr.length
      ? { workspaceId, OR: scopedTaskOr }
      : { workspaceId, id: { in: [] } }
    : { workspaceId };
  const activityWhere = taskWhere;

  const [
    companies,
    contacts,
    contextualOpportunities,
    visibleOpportunities,
    tasks,
    activities,
    memberRows,
    activeCampaigns,
    opportunityFields,
    customFieldValues
  ] = await Promise.all([
    prisma.company.findMany({
      where: companyWhere,
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      take: 500,
      select: {
        id: true,
        name: true,
        rootDomain: true,
        industry: true,
        employeeBand: true,
        revenueBand: true,
        city: true,
        state: true,
        country: true,
        sourceLineage: true,
        score: true,
        priority: true
      }
    }),
    prisma.contact.findMany({
      where: contactWhere,
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      take: 500,
      select: {
        id: true,
        companyId: true,
        fullName: true,
        title: true,
        email: true,
        phone: true,
        grade: true,
        score: true,
        priority: true,
        status: true,
        segment: true,
        owner: true,
        verification: true,
        enrichmentCoverage: true,
        confidence: true,
        isSuppressed: true
      }
    }),
    prisma.opportunity.findMany({
      where: contextualOpportunityWhere,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 1000,
      select: opportunitySelect()
    }),
    prisma.opportunity.findMany({
      where: visibleOpportunityWhere,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 1000,
      select: opportunitySelect()
    }),
    prisma.task.findMany({
      where: taskWhere,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 2000,
      select: { accountId: true, contactId: true, status: true, dueAt: true }
    }),
    prisma.activity.findMany({
      where: activityWhere,
      orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
      take: 2000,
      select: { accountId: true, contactId: true, opportunityId: true, title: true, occurredAt: true }
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: [{ role: "asc" }, { id: "asc" }]
    }),
    prisma.outreachCampaign.findMany({
      where: { workspaceId, status: "Active" },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 20,
      select: { id: true, name: true, status: true }
    }),
    prisma.customField.findMany({
      where: { workspaceId, objectType: "opportunity" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        objectType: true,
        name: true,
        fieldType: true,
        options: true,
        createdAt: true
      }
    }),
    prisma.customFieldValue.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 1500,
      select: {
        id: true,
        workspaceId: true,
        customFieldId: true,
        objectId: true,
        value: true,
        updatedAt: true
      }
    })
  ]);

  const users = memberRows.map(({ user }) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString()
  }));
  const userNames = new Map(users.map((user) => [user.id, user.name]));
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const contactsByCompany = groupBy(contacts, (contact) => contact.companyId ?? "");
  const contextualOppsByCompany = groupBy(contextualOpportunities, (opportunity) => opportunity.accountId);
  const visibleOpportunityIds = new Set(visibleOpportunities.map((opportunity) => opportunity.id));
  const visibleOpportunityViews = visibleOpportunities.map((opportunity) =>
    opportunityView(opportunity, companyById, contactById, userNames, tasks, activities)
  );
  const openTasks = tasks.filter((task) => isOpenTaskStatus(task.status));
  const latestActivityByCompany = latestActivityMap(activities, "accountId");
  const latestActivityByContact = latestActivityMap(activities, "contactId");

  const accounts = companies.map((company) => {
    const companyContacts = contactsByCompany.get(company.id) ?? [];
    const primaryContact = [...companyContacts].sort((a, b) => b.score - a.score)[0];
    const companyOpportunities = contextualOppsByCompany.get(company.id) ?? [];
    const openOpportunities = companyOpportunities.filter((opportunity) => !isClosedStage(opportunityStageValue(opportunity.stage)));
    const primaryOpportunity =
      [...openOpportunities].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ??
      [...companyOpportunities].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    const companyOpenTasks = openTasks.filter((task) => task.accountId === company.id);
    const latestActivity = latestActivityByCompany.get(company.id);
    const source = firstString(company.sourceLineage) ?? "Unknown source";
    const stage = primaryOpportunity ? opportunityStageValue(primaryOpportunity.stage) : stageForPriority(priorityValue(company.priority));
    const amount =
      openOpportunities.reduce((total, opportunity) => total + centsToAmount(opportunity.amountCents), 0) ||
      (primaryOpportunity ? centsToAmount(primaryOpportunity.amountCents) : 0) ||
      company.score * 1000;

    return {
      id: company.id,
      name: company.name,
      domain: company.rootDomain ?? "",
      industry: company.industry ?? "",
      location: [company.city, company.state].filter(Boolean).join(", "),
      employees: company.employeeBand ?? "Unknown",
      revenueBand: company.revenueBand ?? "Unknown",
      source,
      score: company.score,
      priority: priorityValue(company.priority),
      owner: primaryOpportunity
        ? userNames.get(primaryOpportunity.ownerUserId ?? "") ?? "Syncore user"
        : primaryContact?.owner ?? "Unassigned",
      stage,
      amount,
      probability: primaryOpportunity?.probability ?? stageProbabilityFallback(stage),
      opportunities: companyOpportunities.filter((opportunity) => visibleOpportunityIds.has(opportunity.id) || !scoped).length,
      contacts: companyContacts.length,
      openTasks: companyOpenTasks.length,
      lastActivity: latestActivity?.title ?? primaryContact?.verification ?? "Imported from staging",
      lastActivityAt: latestActivity?.occurredAt,
      compliance: companyContacts.some((contact) => contact.isSuppressed)
        ? "Suppression present"
        : "Source label and export gate clear",
      description: `${company.name} was created from staging with ${companyContacts.length} linked contact record${
        companyContacts.length === 1 ? "" : "s"
      }.`
    } satisfies FastCrmAccountView;
  });

  const opportunityCountByContact = countBy(visibleOpportunities.map((opportunity) => opportunity.contactId).filter(Boolean));
  const openTaskCountByContact = countBy(openTasks.map((task) => task.contactId).filter(Boolean));
  const contactSummaries = contacts.map((contact) => {
    const company = contact.companyId ? companyById.get(contact.companyId) : undefined;
    const latest = latestActivityByContact.get(contact.id);

    return {
      id: contact.id,
      name: contact.fullName,
      title: contact.title ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      companyId: contact.companyId ?? "",
      companyName: company?.name ?? "Unknown account",
      domain: company?.rootDomain ?? "",
      grade: leadGradeValue(contact.grade),
      score: contact.score,
      priority: priorityValue(contact.priority),
      status: leadStatusValue(contact.status),
      segment: contact.segment ?? "Unsegmented",
      owner: contact.owner ?? "Unassigned",
      openTasks: openTaskCountByContact.get(contact.id) ?? 0,
      opportunities: opportunityCountByContact.get(contact.id) ?? 0,
      lastActivity: latest?.title ?? contact.verification ?? "No activity yet",
      lastActivityAt: latest?.occurredAt,
      verification: contact.verification ?? "No verification yet",
      enrichmentCoverage: contact.enrichmentCoverage ?? contact.confidence,
      isSuppressed: contact.isSuppressed
    } satisfies FastCrmContactSummary;
  });

  return {
    accounts,
    contacts: contactSummaries,
    opportunities: visibleOpportunityViews,
    activeCampaigns,
    opportunityFields: opportunityFields.map((field) => ({
      ...field,
      objectType: customFieldObjectTypeValue(field.objectType),
      fieldType: customFieldTypeValue(field.fieldType),
      createdAt: field.createdAt.toISOString()
    })),
    customFieldValues: customFieldValues.map((value) => ({
      ...value,
      updatedAt: value.updatedAt.toISOString()
    })),
    accountOptions: accounts.map((account) => ({ id: account.id, name: account.name })),
    contactOptions: contactSummaries.map((contact) => ({ id: contact.id, name: contact.name })),
    users,
    openTaskCount: openTasks.length,
    dueToday: openTasks.filter((task) => task.dueAt && isToday(task.dueAt.toISOString())).length,
    overdue: openTasks.filter((task) => task.status === "Overdue").length
  };
}

async function crmScope(session: Session, workspaceId: string): Promise<Scope> {
  if (session.permissions.includes("view_all_records")) {
    return {};
  }

  const { prisma } = await import("@/lib/prisma");
  const [assignments, ownedContacts, opportunities] = await Promise.all([
    prisma.sdrAssignment.findMany({
      where: { workspaceId, assignedSdrId: session.user.id },
      select: { accountId: true, contactId: true }
    }),
    prisma.contact.findMany({
      where: { workspaceId, owner: session.user.name },
      select: { id: true, companyId: true }
    }),
    prisma.opportunity.findMany({
      where: { workspaceId, ownerUserId: session.user.id },
      select: { accountId: true, contactId: true }
    })
  ]);

  const contactIds = new Set<string>();
  const companyIds = new Set<string>();

  for (const assignment of assignments) {
    if (assignment.contactId) contactIds.add(assignment.contactId);
    if (assignment.accountId) companyIds.add(assignment.accountId);
  }

  for (const contact of ownedContacts) {
    contactIds.add(contact.id);
    if (contact.companyId) companyIds.add(contact.companyId);
  }

  for (const opportunity of opportunities) {
    if (opportunity.contactId) contactIds.add(opportunity.contactId);
    if (opportunity.accountId) companyIds.add(opportunity.accountId);
  }

  return { contactIds, companyIds };
}

function opportunitySelect() {
  return {
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
    updatedAt: true
  } as const;
}

function opportunityView(
  opportunity: PrismaOpportunityOverviewRow,
  companyById: Map<string, { id: string; name: string; rootDomain: string | null }>,
  contactById: Map<string, { id: string; fullName: string; email: string | null }>,
  userNames: Map<string, string>,
  tasks: Array<{ accountId: string | null; contactId: string | null; status: string }>,
  activities: Array<{ accountId: string | null; opportunityId: string | null; title: string; occurredAt: Date }>
): FastCrmOpportunityView {
  const company = companyById.get(opportunity.accountId);
  const contact = opportunity.contactId ? contactById.get(opportunity.contactId) : undefined;
  const openTasks = tasks.filter(
    (task) =>
      (task.accountId === opportunity.accountId || task.contactId === opportunity.contactId) &&
      isOpenTaskStatus(task.status)
  );
  const latestActivity = activities.find(
    (activity) => activity.opportunityId === opportunity.id || activity.accountId === opportunity.accountId
  );

  return {
    id: opportunity.id,
    workspaceId: opportunity.workspaceId,
    companyId: opportunity.accountId,
    contactId: opportunity.contactId ?? undefined,
    name: opportunity.name,
    stage: opportunityStageValue(opportunity.stage),
    amount: centsToAmount(opportunity.amountCents),
    probability: opportunity.probability,
    expectedCloseDate: opportunity.expectedCloseDate?.toISOString(),
    ownerUserId: opportunity.ownerUserId ?? "system",
    source: opportunity.source ?? "CRM",
    createdAt: opportunity.createdAt.toISOString(),
    updatedAt: opportunity.updatedAt.toISOString(),
    companyName: company?.name ?? "Unknown account",
    companyDomain: company?.rootDomain ?? "",
    contactName: contact?.fullName ?? "No primary contact",
    contactEmail: contact?.email ?? "",
    owner: userNames.get(opportunity.ownerUserId ?? "") ?? "Syncore user",
    openTasks: openTasks.length,
    lastActivity: latestActivity?.title ?? "Opportunity created",
    lastActivityAt: latestActivity?.occurredAt.toISOString()
  };
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    if (!groupKey) continue;
    const existing = groups.get(groupKey) ?? [];
    existing.push(item);
    groups.set(groupKey, existing);
  }
  return groups;
}

function countBy(values: Array<string | null | undefined>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function latestActivityMap<T extends "accountId" | "contactId">(
  activities: Array<{ [key in T]: string | null } & { title: string; occurredAt: Date }>,
  key: T
) {
  const latest = new Map<string, { title: string; occurredAt: string }>();
  for (const activity of activities) {
    const id = activity[key];
    if (!id || latest.has(id)) continue;
    latest.set(id, { title: activity.title, occurredAt: activity.occurredAt.toISOString() });
  }
  return latest;
}

function firstString(value: unknown) {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string") : undefined;
}

function centsToAmount(value: number) {
  return Math.round(value) / 100;
}

function isOpenTaskStatus(value: string) {
  return value === "Open" || value === "Overdue" || value.toLowerCase() === "open" || value.toLowerCase() === "overdue";
}

function isClosedStage(stage: OpportunityStage) {
  return stage === "Closed won" || stage === "Closed lost";
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

function stageForPriority(priority: Priority) {
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

function leadGradeValue(value: string | null): LeadGrade {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "S" ? value : "D";
}

function priorityValue(value: string | null): Priority {
  return value === "P1" || value === "P2" || value === "P3" || value === "P4" || value === "S" ? value : "P4";
}

function leadStatusValue(value: string | null): LeadStatus {
  const statuses: LeadStatus[] = [
    "New",
    "Assigned",
    "Working",
    "Contacted",
    "Opened",
    "Replied",
    "Interested",
    "Meeting Booked",
    "Qualified",
    "Proposal Sent",
    "Won",
    "Lost",
    "Nurture",
    "Disqualified",
    "Invalid",
    "Unsubscribed",
    "Ready for SDR",
    "Needs enrichment",
    "Suppressed",
    "In review",
    "Exported"
  ];

  return value && statuses.includes(value as LeadStatus) ? value as LeadStatus : "New";
}

function customFieldObjectTypeValue(value: string): CustomField["objectType"] {
  if (value === "company" || value === "contact" || value === "opportunity") {
    return value;
  }
  return "opportunity";
}

function customFieldTypeValue(value: string): CustomField["fieldType"] {
  if (value === "text" || value === "number" || value === "date" || value === "select") {
    return value;
  }
  return "text";
}

function isToday(value: string) {
  const input = new Date(value);
  const now = new Date();
  return input.getFullYear() === now.getFullYear() && input.getMonth() === now.getMonth() && input.getDate() === now.getDate();
}
