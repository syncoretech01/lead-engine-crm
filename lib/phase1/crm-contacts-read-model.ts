import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { DIRECTORY_FETCH_LIMIT } from "@/lib/phase1/directory-bounds";
import { displayContactName } from "@/lib/phase1/lead-data-quality";
import type { LeadGrade, LeadStatus, Priority, Session } from "@/lib/phase1/types";

export type CrmContactListRow = {
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
  notes: string;
};

export type CrmContactsReadModel = {
  contacts: CrmContactListRow[];
  openTaskCount: number;
  /** Every contact in scope (assigned or unassigned), not capped by the directory
   *  list limit — powers the "Total Contacts" tile. */
  totalContacts: number;
  /**
   * The directory fetch hit its bound, so `contacts` is a prefix of the book and
   * the rest is unreachable in the table. Surfaced in the UI: the failure this
   * exists to prevent is not the cap, it is the cap being SILENT — the ordering
   * is newest-first, so what disappears is the established book an SDR is
   * actively working, with nothing on screen to say so.
   */
  truncated: boolean;
};

// The records directory currently paginates, sorts, and searches client-side.
// Keep this aligned with the assigned-contacts read model so a normal SDR book
// (including Sam's 791-contact import) is not silently truncated at 500 rows.
// True server-side pagination should replace this bounded fetch as books grow.
//
// NOTE: with the newest-first ordering below, this bound drops the OLDEST
// contacts rather than the lowest-scoring ones — the established book an SDR is
// actively working.
//
// The shared bound (see lib/phase1/directory-bounds.ts), re-exported under the
// name callers already use. It moved from 2,000 once the live workspace crossed
// it: 2,116 contacts meant the directory was already dropping the ~116 OLDEST
// with nothing on screen to say so.
export const CRM_CONTACT_DIRECTORY_LIMIT = DIRECTORY_FETCH_LIMIT;

export async function readFastCrmContactsModel(
  session: Session,
  workspaceId: string
): Promise<CrmContactsReadModel | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const scopedContactIds = await crmScopedContactIds(session, workspaceId);
  const contactWhere = {
    workspaceId,
    ...(scopedContactIds ? { id: { in: scopedContactIds } } : {})
  };
  const [contacts, taskRows, opportunityRows, activityRows, openTaskCount, totalContacts] = await Promise.all([
    prisma.contact.findMany({
      where: contactWhere,
      // Explicit select, not `include: { company: true }`: that pulled every
      // scalar on both models, including the sourceLineage provenance JSON on
      // each, which the mapper below never reads — roughly a fifth of the
      // fetched bytes, parsed into objects and then discarded. Matches how
      // crm-overview-read-model already queries the same two tables.
      select: {
        id: true,
        fullName: true,
        title: true,
        email: true,
        phone: true,
        companyId: true,
        grade: true,
        score: true,
        priority: true,
        status: true,
        segment: true,
        owner: true,
        verification: true,
        enrichmentCoverage: true,
        confidence: true,
        isSuppressed: true,
        notes: true,
        company: { select: { name: true, rootDomain: true } }
      },
      // Newest first. Score-first buried a freshly imported list at the bottom
      // whenever it graded below the existing book, which is exactly when an SDR
      // most needs to find it. Score is still a sortable column in the table.
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: CRM_CONTACT_DIRECTORY_LIMIT
    }),
    prisma.task.findMany({
      where: {
        workspaceId,
        status: { not: "Completed" },
        contactId: scopedContactIds ? { in: scopedContactIds } : undefined
      },
      select: { contactId: true }
    }),
    prisma.opportunity.findMany({
      where: {
        workspaceId,
        contactId: scopedContactIds ? { in: scopedContactIds } : undefined
      },
      select: { contactId: true }
    }),
    prisma.activity.findMany({
      where: {
        workspaceId,
        contactId: scopedContactIds ? { in: scopedContactIds } : undefined
      },
      select: { contactId: true, title: true, occurredAt: true },
      orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
      take: 1500
    }),
    prisma.task.count({
      where: {
        workspaceId,
        status: { not: "Completed" },
        contactId: scopedContactIds ? { in: scopedContactIds } : undefined
      }
    }),
    prisma.contact.count({ where: contactWhere })
  ]);
  const taskCounts = countByContact(taskRows.map((row) => row.contactId));
  const opportunityCounts = countByContact(opportunityRows.map((row) => row.contactId));
  const latestActivity = new Map<string, { title: string; occurredAt: string }>();

  for (const activity of activityRows) {
    if (!activity.contactId || latestActivity.has(activity.contactId)) {
      continue;
    }
    latestActivity.set(activity.contactId, {
      title: activity.title,
      occurredAt: activity.occurredAt.toISOString()
    });
  }

  return {
    contacts: contacts.map((contact) => {
      const latest = latestActivity.get(contact.id);
      return {
        id: contact.id,
        name: displayContactName({ name: contact.fullName, email: contact.email }),
        title: contact.title ?? "",
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        companyId: contact.companyId ?? "",
        companyName: contact.company?.name ?? "Unknown account",
        domain: contact.company?.rootDomain ?? "",
        grade: leadGradeValue(contact.grade),
        score: contact.score,
        priority: priorityValue(contact.priority),
        status: leadStatusValue(contact.status),
        segment: contact.segment ?? "Unsegmented",
        owner: contact.owner ?? "Unassigned",
        openTasks: taskCounts.get(contact.id) ?? 0,
        opportunities: opportunityCounts.get(contact.id) ?? 0,
        lastActivity: latest?.title ?? contact.verification ?? "No activity yet",
        lastActivityAt: latest?.occurredAt,
        verification: contact.verification ?? "No verification yet",
        enrichmentCoverage: contact.enrichmentCoverage ?? contact.confidence,
        isSuppressed: contact.isSuppressed,
        notes: contact.notes ?? ""
      };
    }),
    openTaskCount,
    totalContacts,
    // Compare against the fetch bound, not against totalContacts: an SDR-scoped
    // session sees a filtered subset, so "fewer rows than the workspace total" is
    // normal for them and is not truncation.
    truncated: contacts.length >= CRM_CONTACT_DIRECTORY_LIMIT
  };
}

export async function crmScopedContactIds(session: Session, workspaceId: string) {
  if (session.permissions.includes("view_all_records")) {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const [assignments, ownedContacts, opportunities] = await Promise.all([
    prisma.sdrAssignment.findMany({
      where: { workspaceId, assignedSdrId: session.user.id },
      select: { contactId: true }
    }),
    prisma.contact.findMany({
      where: { workspaceId, owner: session.user.name },
      select: { id: true }
    }),
    prisma.opportunity.findMany({
      where: { workspaceId, ownerUserId: session.user.id },
      select: { contactId: true }
    })
  ]);

  return [
    ...assignments.map((assignment) => assignment.contactId),
    ...ownedContacts.map((contact) => contact.id),
    ...opportunities.map((opportunity) => opportunity.contactId)
  ].filter((id): id is string => Boolean(id));
}

function countByContact(contactIds: Array<string | null>) {
  const counts = new Map<string, number>();
  for (const contactId of contactIds) {
    if (!contactId) continue;
    counts.set(contactId, (counts.get(contactId) ?? 0) + 1);
  }
  return counts;
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
