import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type {
  AppState,
  AssignmentMethod,
  ReassignmentRule,
  Session,
  SdrAssignment,
  SdrLeadStatus,
  SdrTeam,
  SlaStatus,
  User
} from "@/lib/phase1/types";
import {
  assignmentMethodValue,
  createFastState,
  optionalIso,
  priorityValue,
  reminderStatusValue,
  sdrLeadStatusValue,
  slaStatusValue,
  uniqueUsers,
  userFromPrisma,
  workspaceMemberFromPrisma
} from "@/lib/phase1/fast-read-utils";

export type FastManagerAssignmentView = SdrAssignment & {
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
};

export type FastSdrWorkload = {
  userId: string;
  name: string;
  assigned: number;
  active: number;
  p1: number;
  overdue: number;
  touched: number;
  meetings: number;
  slaAdherence: number;
};

export type FastReassignmentRecommendation = {
  assignmentId: string;
  contactName: string;
  companyName: string;
  currentOwner: string;
  recommendedSdrId: string;
  recommendedOwner: string;
  reason: string;
  method: AssignmentMethod;
  slaStatus: SlaStatus;
};

export type FastSdrManagerModel = {
  state: AppState;
  snapshot: {
    metrics: {
      activeAssigned: number;
      overdue: number;
      untouchedP1: number;
      slaAdherence: number;
      contactedRate: number;
    };
    workloads: FastSdrWorkload[];
    recommendations: FastReassignmentRecommendation[];
    assignments: FastManagerAssignmentView[];
    reminders: unknown[];
    rules: ReassignmentRule[];
  };
  users: User[];
  teams: SdrTeam[];
};

const activeAssignmentStatuses = new Set<SdrLeadStatus>([
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

export async function readFastSdrManagerModel(
  session: Session,
  workspaceId: string
): Promise<FastSdrManagerModel | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const [assignments, reminders, teams, rules, memberRows] = await Promise.all([
    prisma.sdrAssignment.findMany({
      where: { workspaceId },
      include: {
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
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 1000
    }),
    prisma.followUpReminder.findMany({
      where: { workspaceId },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: 1000
    }),
    prisma.sdrTeam.findMany({
      where: { workspaceId },
      orderBy: [{ active: "desc" }, { name: "asc" }]
    }),
    prisma.reassignmentRule.findMany({
      where: { workspaceId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
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

  const users = uniqueUsers(memberRows.map(({ user }) => userFromPrisma(user)));
  const managerAssignments = assignments.map((assignment) => {
    const crmContact = assignment.contact;
    const leadContact = crmContact?.contact;
    const account = assignment.account ?? crmContact?.account;
    const dueAt = assignment.firstTouchedAt ? assignment.followUpDueAt : assignment.firstTouchDueAt;
    const activeReminder = assignment.reminders[0];

    return {
      id: assignment.id,
      workspaceId: assignment.workspaceId,
      companyId: assignment.accountId ?? account?.id ?? "",
      contactId: assignment.contactId ?? crmContact?.id ?? "",
      assignedSdrId: assignment.assignedSdrId ?? "",
      assignedTeamId: assignment.assignedTeamId ?? undefined,
      assignedById: assignment.assignedById ?? "",
      assignmentMethod: assignmentMethodValue(assignment.assignmentMethod),
      assignmentReason: assignment.assignmentReason,
      assignedAt: assignment.assignedAt.toISOString(),
      firstTouchDueAt: optionalIso(assignment.firstTouchDueAt),
      followUpDueAt: optionalIso(assignment.followUpDueAt),
      status: sdrLeadStatusValue(assignment.status),
      reassignmentReason: assignment.reassignmentReason ?? undefined,
      previousOwnerId: assignment.previousOwnerId ?? undefined,
      slaStatus: slaStatusValue(assignment.slaStatus),
      firstTouchedAt: optionalIso(assignment.firstTouchedAt),
      lastTouchAt: optionalIso(assignment.lastTouchAt),
      touchCount: assignment.touchCount,
      createdAt: assignment.createdAt.toISOString(),
      updatedAt: assignment.updatedAt.toISOString(),
      contactName: leadContact?.fullName ?? crmContact?.fullName ?? "Unknown contact",
      title: leadContact?.title ?? crmContact?.title ?? "",
      email: leadContact?.email ?? crmContact?.email ?? "",
      phone: leadContact?.phone ?? crmContact?.phone ?? "",
      grade: leadContact?.grade ?? "D",
      priority: priorityValue(leadContact?.priority),
      segment: leadContact?.segment ?? "General outbound",
      companyName: account?.name ?? "Unknown account",
      companyDomain: account?.domain ?? "",
      companyState: account?.location?.split(",")[1]?.trim() ?? "",
      companyIndustry: account?.industry ?? "",
      ownerName: assignment.assignedSdr?.name ?? "Unassigned",
      teamName: assignment.assignedTeam?.name ?? "No team",
      dueAt: optionalIso(dueAt),
      dueLabel: timerLabel(optionalIso(dueAt)),
      reminderTitle: activeReminder?.title,
      reminderStatus: activeReminder?.status
    } satisfies FastManagerAssignmentView;
  });
  const mappedTeams = teams.map((team) => ({
    id: team.id,
    workspaceId: team.workspaceId,
    name: team.name,
    managerUserId: team.managerUserId ?? "",
    memberUserIds: team.memberUserIds,
    territories: team.territories,
    industries: team.industries,
    capacityWeight: team.capacityWeight,
    active: team.active,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString()
  } satisfies SdrTeam));
  const activeAssignments = managerAssignments.filter((assignment) => activeAssignmentStatuses.has(assignment.status));
  const workloads = sdrWorkloads(users, managerAssignments);
  const recommendations = reassignmentRecommendations(managerAssignments, workloads);
  const touched = activeAssignments.filter((assignment) => assignment.touchCount > 0).length;
  const adherenceBase = activeAssignments.length || 1;
  const adherence = Math.round(
    ((activeAssignments.length - activeAssignments.filter((assignment) => assignment.slaStatus === "Overdue").length) /
      adherenceBase) *
      100
  );
  const mappedRules = rules.map((rule) => ({
    id: rule.id,
    workspaceId: rule.workspaceId,
    name: rule.name,
    trigger: rule.trigger === "Owner overloaded" || rule.trigger === "Inactive owner" || rule.trigger === "Territory mismatch"
      ? rule.trigger
      : "SLA overdue",
    assignmentMethod: assignmentMethodValue(rule.assignmentMethod),
    thresholdHours: rule.thresholdHours,
    targetTeamId: rule.targetTeamId ?? undefined,
    active: rule.active,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString()
  } satisfies ReassignmentRule));
  const state = createFastState(session, {
    users,
    workspaceMembers: memberRows.map(workspaceMemberFromPrisma),
    sdrTeams: mappedTeams,
    reassignmentRules: mappedRules,
    sdrAssignments: managerAssignments,
    followUpReminders: reminders.map((reminder) => ({
      id: reminder.id,
      workspaceId: reminder.workspaceId,
      assignmentId: reminder.assignmentId,
      companyId: reminder.accountId ?? "",
      contactId: reminder.contactId ?? "",
      ownerUserId: reminder.ownerUserId ?? "",
      title: reminder.title,
      channel: reminder.channel === "Call" || reminder.channel === "SMS" || reminder.channel === "LinkedIn" || reminder.channel === "Meeting"
        ? reminder.channel
        : "Email",
      dueAt: reminder.dueAt.toISOString(),
      status: reminderStatusValue(reminder.status),
      createdAt: reminder.createdAt.toISOString(),
      completedAt: optionalIso(reminder.completedAt),
      snoozedUntil: optionalIso(reminder.snoozedUntil)
    }))
  });

  return {
    state,
    snapshot: {
      metrics: {
        activeAssigned: activeAssignments.length,
        overdue: activeAssignments.filter((assignment) => assignment.slaStatus === "Overdue").length,
        untouchedP1: activeAssignments.filter((assignment) => assignment.priority === "P1" && assignment.touchCount === 0).length,
        slaAdherence: adherence,
        contactedRate: Math.round((touched / adherenceBase) * 100)
      },
      workloads,
      recommendations,
      assignments: managerAssignments,
      reminders: [],
      rules: mappedRules
    },
    users,
    teams: mappedTeams
  };
}

function sdrWorkloads(users: User[], assignments: FastManagerAssignmentView[]): FastSdrWorkload[] {
  return users.map((user) => {
    const owned = assignments.filter((assignment) => assignment.assignedSdrId === user.id);
    const active = owned.filter((assignment) => activeAssignmentStatuses.has(assignment.status));
    const overdue = active.filter((assignment) => assignment.slaStatus === "Overdue");
    const touched = active.filter((assignment) => assignment.touchCount > 0);

    return {
      userId: user.id,
      name: user.name,
      assigned: owned.length,
      active: active.length,
      p1: active.filter((assignment) => assignment.priority === "P1").length,
      overdue: overdue.length,
      touched: touched.length,
      meetings: active.filter((assignment) => assignment.status === "Meeting Booked").length,
      slaAdherence: active.length ? Math.round(((active.length - overdue.length) / active.length) * 100) : 100
    };
  });
}

function reassignmentRecommendations(
  assignments: FastManagerAssignmentView[],
  workloads: FastSdrWorkload[]
): FastReassignmentRecommendation[] {
  const recommendations: FastReassignmentRecommendation[] = [];

  for (const assignment of assignments) {
    if (assignment.slaStatus !== "Overdue" && assignment.priority !== "P1") {
      continue;
    }

    const currentWorkload = workloads.find((workload) => workload.userId === assignment.assignedSdrId);
    if (assignment.slaStatus !== "Overdue" && (!currentWorkload || currentWorkload.active < 4)) {
      continue;
    }

    const nextOwner = workloads
      .filter((workload) => workload.userId !== assignment.assignedSdrId)
      .sort((a, b) => a.active - b.active || a.overdue - b.overdue)[0];

    if (!nextOwner) {
      continue;
    }

    recommendations.push({
      assignmentId: assignment.id,
      contactName: assignment.contactName,
      companyName: assignment.companyName,
      currentOwner: assignment.ownerName,
      recommendedSdrId: nextOwner.userId,
      recommendedOwner: nextOwner.name,
      reason:
        assignment.slaStatus === "Overdue"
          ? "SLA overdue; move to the available SDR with the lightest active load."
          : "P1 load imbalance; rebalance to protect first-touch SLA.",
      method: "Capacity-based",
      slaStatus: assignment.slaStatus
    });
  }

  return recommendations.slice(0, 12);
}

function timerLabel(value?: string) {
  if (!value) return "No SLA";
  const diffMs = Date.parse(value) - Date.now();
  const absHours = Math.max(1, Math.round(Math.abs(diffMs) / (60 * 60 * 1000)));
  if (diffMs < 0) return `${absHours}h overdue`;
  if (absHours < 24) return `${absHours}h left`;
  return `${Math.round(absHours / 24)}d left`;
}
