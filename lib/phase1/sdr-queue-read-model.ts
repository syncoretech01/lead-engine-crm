import type { Prisma } from "@prisma/client";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { DIRECTORY_FETCH_LIMIT } from "@/lib/phase1/directory-bounds";
import { isUtcToday } from "@/lib/phase1/date-utils";
import { displayContactName } from "@/lib/phase1/lead-data-quality";
import { activityTypeValue } from "@/lib/phase1/fast-read-utils";
import { calculateSlaStatus, reminderStatusForDueAt } from "@/lib/phase1/sdr";
import {
  buildSdrDailyCallPlan,
  SDR_DAILY_CALL_TARGET,
  type SdrDailyCallPlan
} from "@/lib/phase1/sdr-call-cycle";
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
  firstCallCompletedAt?: string;
  secondCallCompletedAt?: string;
  callCycleCompletedAt?: string;
  createdAt: string;
  updatedAt: string;
  contactName: string;
  title: string;
  email: string;
  phone: string;
  doNotContact: boolean;
  isSuppressed: boolean;
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

// The shared bound (see lib/phase1/directory-bounds.ts), re-exported so the
// bound test can assert this model against it. Importing the constant without
// re-exporting it left this call site provably unguarded: reverting it to its
// old 2,000 kept the entire suite green.
export const SDR_QUEUE_FETCH_LIMIT = DIRECTORY_FETCH_LIMIT;

export type SdrQueueReadModel = {
  snapshot: {
    metrics: {
      assigned: number;
      p1: number;
      dueToday: number;
      overdue: number;
    };
    queueViews: Array<{ name: string; purpose: string; count: number }>;
    /**
     * The assignment fetch hit its bound, so every count above is derived from a
     * prefix of the book rather than the book. This is the surface where a
     * silent cap does the most damage — Assigned / P1 / Overdue are the numbers
     * a manager steers by, and a quietly under-counted Overdue reads as "we are
     * on top of it".
     */
    truncated: boolean;
    assignments: SdrQueueAssignmentReadRow[];
    reminders: SdrQueueReminderReadRow[];
    recentActivity: SdrQueueActivityReadRow[];
    dailyCallPlan: Omit<SdrDailyCallPlan<SdrQueueAssignmentReadRow>, "assignments">;
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

// Shared prisma selection for an SdrAssignment enriched with the contact (CRM +
// lead), account, owner, team, and its next open reminder. Exported so the
// assigned-contacts read model reuses the exact same join + row mapper.
//
// Every column below is read by mapSdrAssignmentRow; nothing else is fetched.
//
// This was `include: { account: true, contact: { include: { account: true,
// contact: true } }, assignedSdr: true, assignedTeam: true }`, which pulls every
// scalar on five tables — including the sourceLineage provenance JSON on the
// lead Contact, and full User/Team rows for two names. It is the heaviest graph
// in a /crm/contacts render and it is bounded by the directory limit, so the
// select discipline matters more here than on the contacts query itself: on that
// page its only consumer keeps two short strings per row.
//
// tsc is what holds this honest. Adding a field to the mapper without adding it
// here fails typecheck at the read site — the unit tests do NOT catch it,
// because the Prisma mocks return fully-populated rows regardless of the select.
export const sdrAssignmentRowSelect = {
  id: true,
  workspaceId: true,
  accountId: true,
  contactId: true,
  assignedSdrId: true,
  assignedTeamId: true,
  assignedById: true,
  assignmentMethod: true,
  assignmentReason: true,
  assignedAt: true,
  firstTouchDueAt: true,
  followUpDueAt: true,
  status: true,
  reassignmentReason: true,
  previousOwnerId: true,
  firstTouchedAt: true,
  lastTouchAt: true,
  touchCount: true,
  firstCallCompletedAt: true,
  secondCallCompletedAt: true,
  callCycleCompletedAt: true,
  createdAt: true,
  updatedAt: true,
  account: { select: { id: true, name: true, domain: true, industry: true, location: true } },
  contact: {
    select: {
      id: true,
      fullName: true,
      title: true,
      email: true,
      phone: true,
      account: { select: { id: true, name: true, domain: true, industry: true, location: true } },
      contact: {
        select: {
          fullName: true,
          title: true,
          email: true,
          phone: true,
          grade: true,
          priority: true,
          segment: true,
          notes: true,
          doNotContact: true,
          isSuppressed: true
        }
      }
    }
  },
  assignedSdr: { select: { name: true } },
  assignedTeam: { select: { name: true } },
  reminders: {
    where: { status: { not: "Completed" } },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: 1,
    select: { title: true, status: true }
  }
} satisfies Prisma.SdrAssignmentSelect;

type SdrAssignmentRowPayload = Prisma.SdrAssignmentGetPayload<{ select: typeof sdrAssignmentRowSelect }>;

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

// Flattens one prisma SdrAssignment (with sdrAssignmentRowSelect) into the
// merged read row consumed by the SDR queue and the assigned-contacts directory.
export function mapSdrAssignmentRow(
  assignment: SdrAssignmentRowPayload,
  now = new Date().toISOString()
): SdrQueueAssignmentReadRow {
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
    // Computed live, not read from the column: the stored value only advances on a
    // write, so an assignment that lapsed since the last write would still claim
    // "On track" here while its own dueLabel below says overdue.
    slaStatus: calculateSlaStatus(
      {
        status: sdrLeadStatusValue(assignment.status),
        firstTouchedAt: assignment.firstTouchedAt?.toISOString(),
        firstTouchDueAt: assignment.firstTouchDueAt?.toISOString(),
        followUpDueAt: assignment.followUpDueAt?.toISOString(),
        callCycleCompletedAt: assignment.callCycleCompletedAt?.toISOString()
      },
      now
    ),
    firstTouchedAt: assignment.firstTouchedAt?.toISOString(),
    lastTouchAt: assignment.lastTouchAt?.toISOString(),
    touchCount: assignment.touchCount,
    firstCallCompletedAt: assignment.firstCallCompletedAt?.toISOString(),
    secondCallCompletedAt: assignment.secondCallCompletedAt?.toISOString(),
    callCycleCompletedAt: assignment.callCycleCompletedAt?.toISOString(),
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
    contactName: displayContactName({
      name: leadContact?.fullName ?? crmContact?.fullName,
      email
    }),
    title: leadContact?.title ?? crmContact?.title ?? "",
    email,
    phone,
    doNotContact: leadContact?.doNotContact ?? false,
    isSuppressed: leadContact?.isSuppressed ?? false,
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
    dueLabel: timerLabel(dueAt?.toISOString(), Date.parse(now)),
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
    callCycleCompletedAt: null,
    ...(ownerUserId ? { assignedSdrId: ownerUserId } : {})
  };
  const reminderWhere = {
    workspaceId,
    status: { not: "Completed" },
    ...(ownerUserId ? { ownerUserId } : {})
  };
  const today = utcDayBounds();

  const [assignments, reminders, memberRows, completedCallsToday] = await Promise.all([
    prisma.sdrAssignment.findMany({
      where: assignmentWhere,
      select: sdrAssignmentRowSelect,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      // Same table, same bound as the assigned book and the contacts directory.
      // It was left at a separate 2,000 while those moved, which would have made
      // /sdr/queue under-count Assigned/P1/Overdue against a cockpit showing the
      // full book — the headline metrics here are derived from this very array.
      // One past the bound, so `truncated` is a fact rather than an inference
      // from a book that happens to land exactly on the limit.
      take: SDR_QUEUE_FETCH_LIMIT + 1
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
    }),
    ownerUserId
      ? prisma.trackedCall.count({
          where: {
            workspaceId,
            sdrUserId: ownerUserId,
            direction: "Outbound",
            createdAt: { gte: today.start, lt: today.end }
          }
        })
      : Promise.resolve(0)
  ]);

  // One clock for the whole read, so every row in a response agrees.
  const nowIso = new Date().toISOString();
  const truncated = assignments.length > SDR_QUEUE_FETCH_LIMIT;
  // Hoisted, not inlined into the .map below: the probe row must be dropped for
  // every consumer, and readRecentActivityRows further down derives its contact
  // and account scope from this same array. Slicing only on the way into the
  // mapper let the probe row widen that scope by one record, so the activity
  // panel could surface an item for a contact the queue does not list.
  const boundedAssignments = truncated ? assignments.slice(0, SDR_QUEUE_FETCH_LIMIT) : assignments;
  const allAssignmentRows = boundedAssignments.map((assignment) => mapSdrAssignmentRow(assignment, nowIso));
  const ownerPlan = ownerUserId
    ? buildSdrDailyCallPlan(allAssignmentRows, ownerUserId, completedCallsToday)
    : undefined;
  const assignmentRows = ownerPlan?.assignments ?? allAssignmentRows.filter(
    (assignment) => !assignment.callCycleCompletedAt && activeAssignmentStatuses.has(assignment.status)
  );
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
    // Live for the same reason; a completed reminder keeps its terminal status.
    status:
      reminder.status === "Completed"
        ? reminder.status
        : reminderStatusForDueAt((reminder.snoozedUntil ?? reminder.dueAt).toISOString(), nowIso),
    createdAt: reminder.createdAt.toISOString(),
    completedAt: reminder.completedAt?.toISOString(),
    snoozedUntil: reminder.snoozedUntil?.toISOString(),
    contactName: displayContactName({
      name: reminder.contact?.fullName,
      email: reminder.contact?.email
    }),
    companyName: reminder.account?.name ?? reminder.contact?.account?.name ?? "Unknown account",
    ownerName: reminder.owner?.name ?? "Unassigned",
    dueLabel: timerLabel(reminder.dueAt.toISOString(), Date.parse(nowIso))
  } satisfies SdrQueueReminderReadRow));
  const dueToday = reminderRows.filter((reminder) => isUtcToday(reminder.dueAt)).length;
  const overdue = assignmentRows.filter((assignment) => assignment.slaStatus === "Overdue").length +
    reminderRows.filter((reminder) => reminder.status === "Overdue").length;
  const recentActivity = await readRecentActivityRows({
    prisma,
    workspaceId,
    ownerUserId,
    assignments: boundedAssignments,
    reminders
  });

  return {
    snapshot: {
      metrics: {
        assigned: ownerPlan?.activeBatchSize ?? activeAssignments.length,
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
      // On the fetch, not the filtered rows: this reports whether the database
      // read was capped, not how many survived the active filter.
      truncated,
      assignments: assignmentRows,
      reminders: reminderRows,
      recentActivity,
      dailyCallPlan: ownerPlan
        ? {
            target: ownerPlan.target,
            completedToday: ownerPlan.completedToday,
            remainingToday: ownerPlan.remainingToday,
            pass: ownerPlan.pass,
            activeBatchSize: ownerPlan.activeBatchSize,
            batchRemaining: ownerPlan.batchRemaining
          }
        : {
            target: SDR_DAILY_CALL_TARGET,
            completedToday: 0,
            remainingToday: SDR_DAILY_CALL_TARGET,
            pass: null,
            activeBatchSize: activeAssignments.length,
            batchRemaining: activeAssignments.length
          }
    },
    bulkOwnerUsers: memberRows.map(({ user }) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      timezone: user.timezone ?? undefined,
      createdAt: user.createdAt.toISOString()
    }))
  };
}

function utcDayBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
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
    ...(ownerUserId ? { actorUserId: ownerUserId, OR: scopedFilters } : {})
  };
  const activityRows = await prisma.activity.findMany({
    where,
    include: sdrActivityRowInclude,
    orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
    take: 16
  });

  return activityRows.map(mapSdrActivityRow);
}

// Takes the caller's clock so a row's label and its computed slaStatus are read
// from the same instant rather than two Date.now() calls a few statements apart.
function timerLabel(value?: string, now = Date.now()) {
  if (!value) return "No SLA";
  const diffMs = Date.parse(value) - now;
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

