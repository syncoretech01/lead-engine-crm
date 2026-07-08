import type { Prisma } from "@prisma/client";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { isUtcToday } from "@/lib/phase1/date-utils";
import { displayContactName } from "@/lib/phase1/lead-data-quality";
import { activityTypeValue } from "@/lib/phase1/fast-read-utils";
import type { ActivityType, Session, SdrLeadStatus, SlaStatus, User } from "@/lib/phase1/types";

export type SdrQueueAssignmentReadRow = {
  id: string;
  workspaceId: string;
  companyId: string;
  contactId: string;
  assignedSdrId: string;
  assignedTeamId?: string;
  assignedById?: string;
  assignmentMethod: string;
  assignmentReason: string;
  assignedAt: string;
  firstTouchDueAt?: string;
  followUpDueAt?: string;
  status: SdrLeadStatus;
  reassignmentReason?: string;
  previousOwnerId?: string;
  slaStatus: SlaStatus;
  firstTouchedAt?: string;
  lastTouchAt?: string;
  touchCount: number;
  createdAt: string;
  updatedAt: string;
  contactName: string;
  title: string;
  email: string;
  phone: string;
  grade: string;
  priority: string;
  segment: string;
  companyName: string;
  companyDomain: string;
  companyState: string;
  companyIndustry: string;
  ownerName: string;
  teamName: string;
  dueAt?: string;
  dueLabel: string;
  reminderTitle?: string;
  reminderStatus?: string;
  emailEligible: boolean;
  notes: string;
};

export type SdrQueueReminderReadRow = {
  id: string;
  workspaceId: string;
  assignmentId: string;
  companyId: string;
  contactId: string;
  ownerUserId: string;
  title: string;
  channel: string;
  dueAt: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  snoozedUntil?: string;
  contactName: string;
  companyName: string;
  ownerName: string;
  dueLabel: string;
};

export type SdrQueueActivityReadRow = {
  id: string;
  workspaceId: string;
  companyId?: string;
  contactId?: string;
  type: ActivityType;
  title: string;
  body?: string;
  actorName: string;
  contactName: string;
  companyName: string;
  occurredAt: string;
};

export type SdrQueueReadModel = {
  snapshot: {
    metrics: {
      assigned: number;
      p1: number;
      dueToday: number;
      overdue: number;
    };
    queueViews: Array<{ name: string; purpose: string; count: number }>;
    assignments: SdrQueueAssignmentReadRow[];
    reminders: SdrQueueReminderReadRow[];
    recentActivity: SdrQueueActivityReadRow[];
  };
  bulkOwnerUsers: User[];
};

const activeAssignmentStatuses = new Set([
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
  "Nurture"
]);

// Shared prisma include for an SdrAssignment enriched with the contact (CRM +
// lead), account, owner, team, and its next open reminder. Exported so the
// assigned-contacts read model reuses the exact same join + row mapper.
export const sdrAssignmentRowInclude = {
  account: true,
  contact: {
    include: {
      account: true,
      contact: true
    }
  },
  assignedSdr: true,
  assignedTeam: true,
  reminders: {
    where: { status: { not: "Completed" } },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: 1
  }
} satisfies Prisma.SdrAssignmentInclude;

type SdrAssignmentRowPayload = Prisma.SdrAssignmentGetPayload<{ include: typeof sdrAssignmentRowInclude }>;

const sdrActivityRowInclude = {
  account: {
    include: {
      company: true
    }
  },
  contact: {
    include: {
      account: {
        include: {
          company: true
        }
      },
      contact: true
    }
  },
  actor: true
} satisfies Prisma.ActivityInclude;

type SdrActivityRowPayload = Prisma.ActivityGetPayload<{ include: typeof sdrActivityRowInclude }>;

// Flattens one prisma SdrAssignment (with sdrAssignmentRowInclude) into the
// merged read row consumed by the SDR queue and the assigned-contacts directory.
export function mapSdrAssignmentRow(assignment: SdrAssignmentRowPayload): SdrQueueAssignmentReadRow {
  const crmContact = assignment.contact;
  const leadContact = crmContact?.contact;
  const account = assignment.account ?? crmContact?.account;
  const activeReminder = assignment.reminders[0];
  const dueAt = assignment.firstTouchedAt ? assignment.followUpDueAt : assignment.firstTouchDueAt;
  const grade = leadContact?.grade ?? "D";
  const priority = leadContact?.priority ?? "P4";
  const email = leadContact?.email ?? crmContact?.email ?? "";
  const phone = leadContact?.phone ?? crmContact?.phone ?? "";

  return {
    id: assignment.id,
    workspaceId: assignment.workspaceId,
    companyId: assignment.accountId ?? account?.id ?? "",
    contactId: assignment.contactId ?? crmContact?.id ?? "",
    assignedSdrId: assignment.assignedSdrId ?? "",
    assignedTeamId: assignment.assignedTeamId ?? undefined,
    assignedById: assignment.assignedById ?? undefined,
    assignmentMethod: assignment.assignmentMethod,
    assignmentReason: assignment.assignmentReason,
    assignedAt: assignment.assignedAt.toISOString(),
    firstTouchDueAt: assignment.firstTouchDueAt?.toISOString(),
    followUpDueAt: assignment.followUpDueAt?.toISOString(),
    status: sdrLeadStatusValue(assignment.status),
    reassignmentReason: assignment.reassignmentReason ?? undefined,
    previousOwnerId: assignment.previousOwnerId ?? undefined,
    slaStatus: slaStatusValue(assignment.slaStatus),
    firstTouchedAt: assignment.firstTouchedAt?.toISOString(),
    lastTouchAt: assignment.lastTouchAt?.toISOString(),
    touchCount: assignment.touchCount,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
    contactName: displayContactName({
      name: leadContact?.fullName ?? crmContact?.fullName,
      email
    }),
    title: leadContact?.title ?? crmContact?.title ?? "",
    email,
    phone,
    grade,
    priority,
    segment: leadContact?.segment ?? "General outbound",
    companyName: account?.name ?? "Unknown account",
    companyDomain: account?.domain ?? "",
    companyState: account?.location?.split(",")[1]?.trim() ?? "",
    companyIndustry: account?.industry ?? "",
    ownerName: assignment.assignedSdr?.name ?? "Unassigned",
    teamName: assignment.assignedTeam?.name ?? "No team",
    dueAt: dueAt?.toISOString(),
    dueLabel: timerLabel(dueAt?.toISOString()),
    reminderTitle: activeReminder?.title,
    reminderStatus: activeReminder?.status,
    emailEligible: Boolean(
      leadContact &&
        email &&
        !leadContact.isSuppressed &&
        !leadContact.doNotContact &&
        grade !== "S" &&
        grade !== "D" &&
        priority !== "S"
    ),
    notes: leadContact?.notes ?? ""
  } satisfies SdrQueueAssignmentReadRow;
}

function mapSdrActivityRow(activity: SdrActivityRowPayload): SdrQueueActivityReadRow {
  const crmContact = activity.contact;
  const leadContact = crmContact?.contact;
  const account = activity.account ?? crmContact?.account;
  const company = activity.account?.company ?? crmContact?.account?.company;
  const contactName = displayContactName({
    name: leadContact?.fullName ?? crmContact?.fullName,
    email: leadContact?.email ?? crmContact?.email
  });

  return {
    id: activity.id,
    workspaceId: activity.workspaceId,
    companyId: company?.id ?? leadContact?.companyId ?? account?.companyId ?? activity.accountId ?? undefined,
    contactId: leadContact?.id ?? activity.contactId ?? undefined,
    type: activityTypeValue(activity.type),
    title: activity.title,
    body: activity.body ?? undefined,
    actorName: activity.actor?.name ?? "Syncore user",
    contactName,
    companyName: company?.name ?? account?.name ?? "Unknown account",
    occurredAt: activity.occurredAt.toISOString()
  } satisfies SdrQueueActivityReadRow;
}

export async function readFastSdrQueueModel(
  session: Session,
  workspaceId: string
): Promise<SdrQueueReadModel | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const ownerUserId = session.role === "SDR" ? session.user.id : undefined;
  const assignmentWhere = {
    workspaceId,
    ...(ownerUserId ? { assignedSdrId: ownerUserId } : {})
  };
  const reminderWhere = {
    workspaceId,
    status: { not: "Completed" },
    ...(ownerUserId ? { ownerUserId } : {})
  };

  const [assignments, reminders, memberRows] = await Promise.all([
    prisma.sdrAssignment.findMany({
      where: assignmentWhere,
      include: sdrAssignmentRowInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 500
    }),
    prisma.followUpReminder.findMany({
      where: reminderWhere,
      include: {
        account: true,
        contact: {
          include: {
            account: true
          }
        },
        owner: true
      },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: 100
    }),
    prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        role: { in: ["SDR", "MANAGER"] }
      },
      include: { user: true },
      orderBy: [{ role: "asc" }, { id: "asc" }]
    })
  ]);

  const assignmentRows = assignments.map(mapSdrAssignmentRow);
  const activeAssignments = assignmentRows.filter((assignment) => activeAssignmentStatuses.has(assignment.status));
  const reminderRows = reminders.map((reminder) => ({
    id: reminder.id,
    workspaceId: reminder.workspaceId,
    assignmentId: reminder.assignmentId,
    companyId: reminder.accountId ?? reminder.account?.id ?? "",
    contactId: reminder.contactId ?? reminder.contact?.id ?? "",
    ownerUserId: reminder.ownerUserId ?? "",
    title: reminder.title,
    channel: reminder.channel,
    dueAt: reminder.dueAt.toISOString(),
    status: reminder.status,
    createdAt: reminder.createdAt.toISOString(),
    completedAt: reminder.completedAt?.toISOString(),
    snoozedUntil: reminder.snoozedUntil?.toISOString(),
    contactName: displayContactName({
      name: reminder.contact?.fullName,
      email: reminder.contact?.email
    }),
    companyName: reminder.account?.name ?? reminder.contact?.account?.name ?? "Unknown account",
    ownerName: reminder.owner?.name ?? "Unassigned",
    dueLabel: timerLabel(reminder.dueAt.toISOString())
  } satisfies SdrQueueReminderReadRow));
  const dueToday = reminderRows.filter((reminder) => isUtcToday(reminder.dueAt)).length;
  const overdue = assignmentRows.filter((assignment) => assignment.slaStatus === "Overdue").length +
    reminderRows.filter((reminder) => reminder.status === "Overdue").length;
  const recentActivity = await readRecentActivityRows({
    prisma,
    workspaceId,
    ownerUserId,
    assignments,
    reminders
  });

  return {
    snapshot: {
      metrics: {
        assigned: activeAssignments.length,
        p1: activeAssignments.filter((assignment) => assignment.priority === "P1").length,
        dueToday,
        overdue
      },
      queueViews: [
        {
          name: "My P1 Leads",
          purpose: "Highest priority leads requiring action",
          count: activeAssignments.filter((assignment) => assignment.priority === "P1").length
        },
        {
          name: "Due Today",
          purpose: "Tasks and follow-ups due today",
          count: dueToday
        },
        {
          name: "Overdue",
          purpose: "Missed SLA or overdue follow-ups",
          count: assignmentRows.filter((assignment) => assignment.slaStatus === "Overdue").length
        },
        {
          name: "Recently Replied",
          purpose: "Leads with new replies",
          count: activeAssignments.filter((assignment) => assignment.status === "Replied" || assignment.status === "Interested").length
        },
        {
          name: "Call-First Leads",
          purpose: "Valid phone, no strong email",
          count: activeAssignments.filter((assignment) => assignment.phone && (assignment.grade === "C" || assignment.grade === "D")).length
        },
        {
          name: "Email-Ready Leads",
          purpose: "A-grade email leads",
          count: activeAssignments.filter((assignment) => assignment.grade === "A").length
        },
        {
          name: "Meeting Follow-Up",
          purpose: "Prospects after meeting",
          count: activeAssignments.filter((assignment) => assignment.status === "Meeting Booked").length
        },
        {
          name: "Nurture Leads",
          purpose: "Future follow-up opportunities",
          count: activeAssignments.filter((assignment) => assignment.status === "Nurture").length
        }
      ],
      assignments: assignmentRows,
      reminders: reminderRows,
      recentActivity
    },
    bulkOwnerUsers: memberRows.map(({ user }) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString()
    }))
  };
}

async function readRecentActivityRows({
  prisma,
  workspaceId,
  ownerUserId,
  assignments,
  reminders
}: {
  prisma: Prisma.TransactionClient;
  workspaceId: string;
  ownerUserId?: string;
  assignments: SdrAssignmentRowPayload[];
  reminders: Array<{ accountId: string | null; contactId: string | null }>;
}) {
  const scopedContactIds = new Set<string>();
  const scopedAccountIds = new Set<string>();

  for (const assignment of assignments) {
    if (assignment.contactId) scopedContactIds.add(assignment.contactId);
    if (assignment.accountId) scopedAccountIds.add(assignment.accountId);
  }

  for (const reminder of reminders) {
    if (reminder.contactId) scopedContactIds.add(reminder.contactId);
    if (reminder.accountId) scopedAccountIds.add(reminder.accountId);
  }

  if (ownerUserId && scopedContactIds.size === 0 && scopedAccountIds.size === 0) {
    return [];
  }

  const scopedFilters: Prisma.ActivityWhereInput[] = [
    ...(scopedContactIds.size ? [{ contactId: { in: Array.from(scopedContactIds) } }] : []),
    ...(scopedAccountIds.size ? [{ accountId: { in: Array.from(scopedAccountIds) } }] : [])
  ];
  const where: Prisma.ActivityWhereInput = {
    workspaceId,
    ...(ownerUserId ? { OR: scopedFilters } : {})
  };
  const activityRows = await prisma.activity.findMany({
    where,
    include: sdrActivityRowInclude,
    orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
    take: 16
  });

  return activityRows.map(mapSdrActivityRow);
}

function timerLabel(value?: string) {
  if (!value) return "No SLA";
  const diffMs = Date.parse(value) - Date.now();
  const absHours = Math.max(1, Math.round(Math.abs(diffMs) / (60 * 60 * 1000)));
  if (diffMs < 0) return `${absHours}h overdue`;
  if (absHours < 24) return `${absHours}h left`;
  return `${Math.round(absHours / 24)}d left`;
}


function sdrLeadStatusValue(value: string): SdrLeadStatus {
  const statuses: SdrLeadStatus[] = [
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
    "Suppressed"
  ];

  return statuses.includes(value as SdrLeadStatus) ? value as SdrLeadStatus : "Assigned";
}

function slaStatusValue(value: string): SlaStatus {
  const statuses: SlaStatus[] = ["On track", "Due soon", "Overdue", "No SLA", "Paused"];
  return statuses.includes(value as SlaStatus) ? value as SlaStatus : "No SLA";
}
