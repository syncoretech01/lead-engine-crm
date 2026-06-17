import { findExportRule, recordIdsForExport } from "@/lib/phase1/exporting";
import {
  isOpenOpportunityStage,
  latestActivityForCompany,
  latestActivityForContact,
  userNameForId
} from "@/lib/phase1/crm";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type {
  AppState,
  Company,
  ConsentStatus,
  Contact,
  ExportRecord,
  LawfulBasis,
  LeadGrade,
  LeadStatus,
  OpportunityStage,
  Priority,
  Session
} from "@/lib/phase1/types";
import { assignmentViews, sdrWorkloads } from "@/lib/phase1/sdr";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const sourceHealth = [
  {
    source: "Apollo",
    status: "Mock ready",
    trust: 85,
    credits: "12.4k",
    fields: ["company", "contact", "email", "title"]
  },
  {
    source: "Hunter",
    status: "Mock ready",
    trust: 80,
    credits: "7.8k",
    fields: ["email finder", "verification", "confidence"]
  },
  {
    source: "Google Places",
    status: "Mock ready",
    trust: 75,
    credits: "billing cap on",
    fields: ["local business", "phone", "rating", "place id"]
  },
  {
    source: "Apify",
    status: "Mock ready",
    trust: 72,
    credits: "run budget cap",
    fields: ["custom extraction", "niche source", "crawl output"]
  },
  {
    source: "CSV Upload",
    status: "Ready",
    trust: 55,
    credits: "unmetered",
    fields: ["manual import", "mapped fields", "source label"]
  }
];

export function dashboardSnapshot(state: AppState, workspaceId = state.workspaces[0].id) {
  const rawCount = state.rawLeads.filter((lead) => lead.workspaceId === workspaceId).length;
  const normalizedCount = state.normalizedRecords.filter((record) => record.workspaceId === workspaceId).length;
  const duplicateCount = state.normalizedRecords.filter(
    (record) => record.workspaceId === workspaceId && (record.duplicateCompanyId || record.duplicateContactId)
  ).length;
  const suppressedCount =
    state.suppressionRecords.filter((record) => record.workspaceId === workspaceId).length +
    state.contacts.filter((contact) => contact.workspaceId === workspaceId && contact.isSuppressed).length;
  const verifiedCount = state.contacts.filter(
    (contact) => contact.workspaceId === workspaceId && !contact.isSuppressed && isExportableGrade(contact.grade)
  ).length;
  const crmReadyCount = state.contacts.filter(
    (contact) => contact.workspaceId === workspaceId && contact.status === "Ready for SDR"
  ).length;
  const openPipeline = state.opportunities
    .filter((opportunity) => opportunity.workspaceId === workspaceId && isOpenOpportunityStage(opportunity.stage))
    .reduce((total, opportunity) => total + opportunity.amount, 0);
  const totalContacts = state.contacts.filter((contact) => contact.workspaceId === workspaceId && !contact.isSuppressed).length;
  const verifiedRate = totalContacts === 0 ? 0 : Math.round((verifiedCount / totalContacts) * 100);

  return {
    metrics: [
      {
        label: "Raw leads staged",
        value: rawCount,
        note: `${formatNumber(normalizedCount)} normalized`,
        tone: "info"
      },
      {
        label: "Verified email rate",
        value: verifiedRate,
        suffix: "%",
        note: `${state.verificationResults.filter((result) => result.workspaceId === workspaceId).length} verification checks`,
        tone: "success"
      },
      {
        label: "Suppression blocks",
        value: suppressedCount,
        note: "Bounces, DNC, customers",
        tone: "warning"
      },
      {
        label: "Open pipeline",
        value: openPipeline,
        currency: true,
        note: "Live opportunities",
        tone: "success"
      }
    ],
    pipelineStages: [
      { name: "Extracted", count: rawCount, percent: rawCount ? 100 : 0 },
      { name: "Normalized", count: normalizedCount, percent: percent(normalizedCount, rawCount) },
      { name: "Deduped", count: Math.max(normalizedCount - duplicateCount, 0), percent: percent(normalizedCount - duplicateCount, rawCount) },
      { name: "Verified", count: verifiedCount, percent: percent(verifiedCount, rawCount) },
      { name: "CRM-ready", count: crmReadyCount, percent: percent(crmReadyCount, rawCount) }
    ],
    crmReadyCount,
    activeJobs: state.leadJobs.filter((job) => job.workspaceId === workspaceId && job.status !== "Completed"),
    accounts: accountViews(state, workspaceId),
    sdrQueues: sdrQueues(state, workspaceId)
  };
}

export function accountViews(state: AppState, workspaceId = state.workspaces[0].id) {
  return accountViewsFromRows(state, workspaceId, state.companies, state.contacts);
}

export function accountViewsFromRows(
  state: AppState,
  workspaceId: string,
  companies: Company[],
  contacts: Contact[]
) {
  return companies.filter((company) => company.workspaceId === workspaceId).map((company) => {
    const companyContacts = contacts.filter((contact) => contact.workspaceId === workspaceId && contact.companyId === company.id);
    const primaryContact = [...companyContacts].sort((a, b) => b.score - a.score)[0];
    const opportunities = state.opportunities.filter((opportunity) => opportunity.companyId === company.id);
    const openOpportunities = opportunities.filter((opportunity) => isOpenOpportunityStage(opportunity.stage));
    const primaryOpportunity =
      [...openOpportunities].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ??
      [...opportunities].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    const openTasks = state.tasks.filter(
      (task) => task.companyId === company.id && (task.status === "Open" || task.status === "Overdue")
    );
    const latestActivity = latestActivityForCompany(state, company.id);
    const source = company.sourceLineage[0] ?? "Unknown source";
    const amount =
      openOpportunities.reduce((total, opportunity) => total + opportunity.amount, 0) ||
      primaryOpportunity?.amount ||
      company.score * 1000;

    return {
      id: company.id,
      name: company.name,
      domain: company.domain,
      industry: company.industry,
      location: [company.city, company.state].filter(Boolean).join(", "),
      employees: company.employeeBand ?? "Unknown",
      revenueBand: company.revenueBand ?? "Unknown",
      source,
      score: company.score,
      priority: company.priority,
      owner: primaryOpportunity ? userNameForId(state, primaryOpportunity.ownerUserId) : primaryContact?.owner ?? "Unassigned",
      stage: primaryOpportunity?.stage ?? stageForPriority(company.priority),
      amount,
      probability: primaryOpportunity?.probability ?? stageProbabilityFallback(primaryOpportunity?.stage ?? stageForPriority(company.priority)),
      opportunities: opportunities.length,
      contacts: companyContacts.length,
      openTasks: openTasks.length,
      lastActivity: latestActivity?.title ?? primaryContact?.verification ?? "Imported from staging",
      lastActivityAt: latestActivity?.createdAt,
      compliance: companyContacts.some((contact) => contact.isSuppressed)
        ? "Suppression present"
        : "Source label and export gate clear",
      description: `${company.name} was created from staging with ${companyContacts.length} linked contact record${
        companyContacts.length === 1 ? "" : "s"
      }.`
    };
  });
}

export function contactViews(state: AppState, workspaceId = state.workspaces[0].id) {
  return contactViewsFromRows(state, workspaceId, state.companies, state.contacts);
}

export function contactViewsFromRows(
  state: AppState,
  workspaceId: string,
  companies: Company[],
  contacts: Contact[]
) {
  return contacts.filter((contact) => contact.workspaceId === workspaceId).map((contact) => {
    const company = companies.find((item) => item.workspaceId === workspaceId && item.id === contact.companyId);
    const openTasks = state.tasks.filter(
      (task) => task.contactId === contact.id && (task.status === "Open" || task.status === "Overdue")
    );
    const opportunities = state.opportunities.filter((opportunity) => opportunity.contactId === contact.id);
    const latestActivity = latestActivityForContact(state, contact.id);

    return {
      id: contact.id,
      name: contact.name,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      companyId: contact.companyId,
      companyName: company?.name ?? "Unknown account",
      domain: company?.domain ?? "",
      grade: contact.grade,
      score: contact.score,
      priority: contact.priority,
      status: contact.status,
      segment: contact.segment,
      owner: contact.owner,
      openTasks: openTasks.length,
      opportunities: opportunities.length,
      lastActivity: latestActivity?.title ?? contact.verification,
      lastActivityAt: latestActivity?.createdAt,
      verification: contact.verification,
      enrichmentCoverage: contact.enrichmentCoverage ?? 0,
      isSuppressed: contact.isSuppressed
    };
  });
}

export async function accountViewsForWorkspace(state: AppState, workspaceId = state.workspaces[0].id) {
  const rows = await crmReadRowsForWorkspace(state, workspaceId);
  return accountViewsFromRows(state, workspaceId, rows.companies, rows.contacts);
}

export async function contactViewsForWorkspace(state: AppState, workspaceId = state.workspaces[0].id) {
  const rows = await crmReadRowsForWorkspace(state, workspaceId);
  return contactViewsFromRows(state, workspaceId, rows.companies, rows.contacts);
}

export async function accountDetailReadModelForWorkspace(
  state: AppState,
  workspaceId: string,
  companyId: string
) {
  const rows = await crmReadRowsForWorkspace(state, workspaceId);
  const account = accountViewsFromRows(state, workspaceId, rows.companies, rows.contacts).find((item) => item.id === companyId);
  const company = rows.companies.find((item) => item.workspaceId === workspaceId && item.id === companyId);
  const contacts = rows.contacts.filter((contact) => contact.workspaceId === workspaceId && contact.companyId === companyId);

  return { account, company, contacts };
}

export async function contactDetailReadModelForWorkspace(
  state: AppState,
  workspaceId: string,
  contactId: string
) {
  const rows = await crmReadRowsForWorkspace(state, workspaceId);
  const contact = rows.contacts.find((item) => item.workspaceId === workspaceId && item.id === contactId);
  const company = contact
    ? rows.companies.find((item) => item.workspaceId === workspaceId && item.id === contact.companyId)
    : undefined;

  return { contact, company };
}

type CrmReadRows = {
  companies: Company[];
  contacts: Contact[];
};

type PrismaCompanyReadRow = {
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
  createdAt: Date | string;
  updatedAt: Date | string;
};

type PrismaContactReadRow = {
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
  enrichedAt: Date | string | null;
  lawfulBasis: string | null;
  consentStatus: string | null;
  consentSource: string | null;
  consentCapturedAt: Date | string | null;
  doNotContact: boolean;
  isSuppressed: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

async function crmReadRowsForWorkspace(state: AppState, workspaceId: string): Promise<CrmReadRows> {
  const snapshotRows = snapshotCrmReadRows(state, workspaceId);

  if (resolveStorageDriver() !== "prisma") {
    return snapshotRows;
  }

  try {
    const rows = await readNormalizedCrmRowsFromPrisma(workspaceId);
    const hasSnapshotRows = snapshotRows.companies.length > 0 || snapshotRows.contacts.length > 0;

    if (hasSnapshotRows && rows.companies.length === 0 && rows.contacts.length === 0) {
      return snapshotRows;
    }

    return rows;
  } catch (error) {
    console.warn("Falling back to snapshot CRM rows after normalized Prisma read failed.", error);
    return snapshotRows;
  }
}

function snapshotCrmReadRows(state: AppState, workspaceId: string): CrmReadRows {
  return {
    companies: state.companies.filter((company) => company.workspaceId === workspaceId),
    contacts: state.contacts.filter((contact) => contact.workspaceId === workspaceId)
  };
}

async function readNormalizedCrmRowsFromPrisma(workspaceId: string): Promise<CrmReadRows> {
  const { prisma } = await import("@/lib/prisma");
  const [companyRows, contactRows] = await Promise.all([
    prisma.company.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        name: true,
        normalizedName: true,
        rootDomain: true,
        website: true,
        phone: true,
        industry: true,
        employeeBand: true,
        revenueBand: true,
        city: true,
        state: true,
        country: true,
        sourceLineage: true,
        confidence: true,
        score: true,
        priority: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.contact.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        workspaceId: true,
        companyId: true,
        fullName: true,
        title: true,
        seniority: true,
        department: true,
        email: true,
        phone: true,
        sourceLineage: true,
        confidence: true,
        grade: true,
        score: true,
        priority: true,
        status: true,
        segment: true,
        owner: true,
        verification: true,
        enrichmentCoverage: true,
        fitReason: true,
        enrichedAt: true,
        lawfulBasis: true,
        consentStatus: true,
        consentSource: true,
        consentCapturedAt: true,
        doNotContact: true,
        isSuppressed: true,
        createdAt: true,
        updatedAt: true
      }
    })
  ]);

  return {
    companies: companyRows.map((row) => companyFromPrismaReadRow(row)),
    contacts: contactRows.map((row) => contactFromPrismaReadRow(row))
  };
}

function companyFromPrismaReadRow(row: PrismaCompanyReadRow): Company {
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
    createdAt: isoString(row.createdAt),
    updatedAt: isoString(row.updatedAt)
  };
}

function contactFromPrismaReadRow(row: PrismaContactReadRow): Contact {
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
    enrichedAt: optionalIsoString(row.enrichedAt),
    lawfulBasis: lawfulBasisValue(row.lawfulBasis),
    consentStatus: consentStatusValue(row.consentStatus),
    consentSource: row.consentSource ?? "Unknown",
    consentCapturedAt: optionalIsoString(row.consentCapturedAt),
    doNotContact: row.doNotContact,
    isSuppressed: row.isSuppressed,
    createdAt: isoString(row.createdAt),
    updatedAt: isoString(row.updatedAt)
  };
}

export function opportunityViews(state: AppState, workspaceId = state.workspaces[0].id) {
  return state.opportunities.filter((opportunity) => opportunity.workspaceId === workspaceId).map((opportunity) => {
    const company = state.companies.find((item) => item.id === opportunity.companyId);
    const contact = state.contacts.find((item) => item.id === opportunity.contactId);
    const openTasks = state.tasks.filter(
      (task) =>
        (task.companyId === opportunity.companyId || task.contactId === opportunity.contactId) &&
        (task.status === "Open" || task.status === "Overdue")
    );
    const latestActivity = state.activities
      .filter((activity) => activity.opportunityId === opportunity.id || activity.companyId === opportunity.companyId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];

    return {
      ...opportunity,
      companyName: company?.name ?? "Unknown account",
      companyDomain: company?.domain ?? "",
      contactName: contact?.name ?? "No primary contact",
      contactEmail: contact?.email ?? "",
      owner: userNameForId(state, opportunity.ownerUserId),
      openTasks: openTasks.length,
      lastActivity: latestActivity?.title ?? "Opportunity created",
      lastActivityAt: latestActivity?.createdAt
    };
  });
}

/**
 * The set of contact and company ids a session "owns" for CRM scoping. An SDR
 * owns a record when it is assigned to them (SdrAssignment), when they are the
 * named owner of the lead-gen contact, or when they own an opportunity tied to
 * it. Callers apply this only when restrictsToOwnedRecords(session) is true.
 */
export function ownedCrmRecordScope(state: AppState, session: Session) {
  const workspaceId = session.workspace.id;
  const userId = session.user.id;
  const userName = session.user.name;
  const contactIds = new Set<string>();
  const companyIds = new Set<string>();

  for (const assignment of state.sdrAssignments) {
    if (assignment.workspaceId === workspaceId && assignment.assignedSdrId === userId) {
      if (assignment.contactId) {
        contactIds.add(assignment.contactId);
      }
      if (assignment.companyId) {
        companyIds.add(assignment.companyId);
      }
    }
  }

  for (const contact of state.contacts) {
    if (contact.workspaceId === workspaceId && contact.owner === userName) {
      contactIds.add(contact.id);
      if (contact.companyId) {
        companyIds.add(contact.companyId);
      }
    }
  }

  for (const opportunity of state.opportunities) {
    if (opportunity.workspaceId === workspaceId && opportunity.ownerUserId === userId) {
      if (opportunity.contactId) {
        contactIds.add(opportunity.contactId);
      }
      if (opportunity.companyId) {
        companyIds.add(opportunity.companyId);
      }
    }
  }

  return { contactIds, companyIds };
}

export function exportTemplates(state: AppState, workspaceId: string) {
  const templates: Array<{
    id: ExportRecord["type"];
    name: string;
    description: string;
    columns: string[];
    eligible: number;
  }> = [
    {
      id: "verified_email_leads",
      name: "Verified email leads",
      description: "Contacts with A/B grades, suppression clear, and direct outbound readiness.",
      columns: ["company", "contact", "title", "email", "grade", "score", "segment", "owner"],
      eligible: recordIdsForExport(
        state,
        workspaceId,
        "verified_email_leads",
        findExportRule(state, workspaceId, "verified_email_leads")
      ).length
    },
    {
      id: "contacts",
      name: "Contacts CSV",
      description: "All non-suppressed CRM contacts with verification grade and assignment context.",
      columns: ["company", "contact", "title", "email", "phone", "status", "owner"],
      eligible: recordIdsForExport(state, workspaceId, "contacts", findExportRule(state, workspaceId, "contacts")).length
    },
    {
      id: "phone_leads",
      name: "Phone-ready leads",
      description: "Validated phone leads with priority, owner, segment, and source lineage for call-heavy handoff.",
      columns: ["company", "contact", "title", "phone", "phone_status", "priority", "score", "segment", "owner"],
      eligible: recordIdsForExport(
        state,
        workspaceId,
        "phone_leads",
        findExportRule(state, workspaceId, "phone_leads")
      ).length
    },
    {
      id: "companies",
      name: "Companies CSV",
      description: "Golden company records with source lineage, score, and priority.",
      columns: ["company", "domain", "website", "industry", "city", "state", "score", "priority"],
      eligible: recordIdsForExport(state, workspaceId, "companies").length
    },
    {
      id: "sdr_assignments",
      name: "SDR assignment queue",
      description: "Owner, priority, due date, channel, and next task for SDR handoff.",
      columns: ["owner", "priority", "company", "contact", "channel", "due_date", "next_task"],
      eligible: recordIdsForExport(
        state,
        workspaceId,
        "sdr_assignments",
        findExportRule(state, workspaceId, "sdr_assignments")
      ).length
    }
  ];

  return templates;
}

export function sdrQueues(state: AppState, workspaceId = state.workspaces[0].id) {
  if (state.sdrAssignments.length > 0) {
    const assignments = assignmentViews(state, workspaceId);
    return sdrWorkloads(state, workspaceId).map((workload) => {
      const owned = assignments.filter((assignment) => assignment.assignedSdrId === workload.userId);
      const dueToday = owned.filter((assignment) => assignment.dueAt && isToday(assignment.dueAt)).length;
      const focus = owned.find((assignment) => assignment.priority === "P1")?.segment ?? owned[0]?.segment ?? "General outbound";

      return {
        owner: workload.name,
        assigned: workload.active,
        dueToday,
        overdue: workload.overdue,
        bookedMeetings: workload.meetings,
        focus: `${focus}${workload.p1 ? `, ${workload.p1} P1` : ""}`
      };
    });
  }

  const owners = Array.from(new Set(state.contacts.map((contact) => contact.owner))).filter(
    (owner) => owner && owner !== "Blocked" && owner !== "Unassigned"
  );

  return owners.map((owner) => {
    const owned = state.contacts.filter((contact) => contact.owner === owner && !contact.isSuppressed);
    return {
      owner,
      assigned: owned.length,
      dueToday: owned.filter((contact) => contact.status === "Ready for SDR").length,
      overdue: owned.filter((contact) => contact.status === "In review").length,
      bookedMeetings: owned.filter((contact) => contact.status === "Exported").length,
      focus: focusForOwnedContacts(owned)
    };
  });
}

export function contactRowsForStaging(state: AppState, workspaceId = state.workspaces[0].id) {
  return state.normalizedRecords.filter((record) => record.workspaceId === workspaceId).map((record) => ({
    id: record.id,
    contactName: record.contactName,
    title: record.title,
    company: record.companyName,
    domain: record.domain,
    email: record.email,
    phone: record.phone,
    city: record.city,
    state: record.state,
    source: record.source,
    emailGrade: record.grade,
    score: record.score,
    priority: record.priority,
    status: record.status,
    segment: record.segment,
    owner: record.owner,
    verification: record.verification,
    signals: [record.source, record.priority, record.status],
    lastSeen: new Date(record.normalizedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    })
  }));
}

function isExportableGrade(grade: LeadGrade) {
  return grade === "A" || grade === "B";
}

function percent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function stageForPriority(priority: Priority) {
  if (priority === "P1") return "Qualified";
  if (priority === "P2") return "Prospecting";
  if (priority === "P3") return "Prospecting";
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

function focusForOwnedContacts(contacts: { segment: string; priority: Priority }[]) {
  const p1 = contacts.filter((contact) => contact.priority === "P1").length;
  const segment = contacts[0]?.segment ?? "General outbound";
  return `${segment}${p1 ? `, ${p1} P1` : ""}`;
}

function isToday(value: string) {
  const input = new Date(value);
  const now = new Date();
  return input.getFullYear() === now.getFullYear() && input.getMonth() === now.getMonth() && input.getDate() === now.getDate();
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
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

function leadGradeValue(value: string | null): LeadGrade {
  if (value === "A" || value === "B" || value === "C" || value === "D" || value === "S") {
    return value;
  }

  return "D";
}

function priorityValue(value: string | null): Priority {
  if (value === "P1" || value === "P2" || value === "P3" || value === "P4" || value === "S") {
    return value;
  }

  return "P4";
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

function lawfulBasisValue(value: string | null): LawfulBasis {
  if (
    value === "Legitimate interest" ||
    value === "Consent" ||
    value === "Contract" ||
    value === "Legal obligation" ||
    value === "Do not contact"
  ) {
    return value;
  }

  return "Legitimate interest";
}

function consentStatusValue(value: string | null): ConsentStatus {
  if (value === "Not required" || value === "Granted" || value === "Revoked" || value === "Unknown") {
    return value;
  }

  return "Unknown";
}
