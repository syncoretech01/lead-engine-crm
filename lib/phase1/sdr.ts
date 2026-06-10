import { randomUUID } from "node:crypto";
import { addActivity, ownerUserIdForName, userNameForId } from "@/lib/phase1/crm";
import type {
  AppState,
  AssignmentMethod,
  CrmTask,
  FollowUpReminder,
  LeadStatus,
  OutreachChannel,
  ReassignmentRule,
  ReassignmentTrigger,
  ReminderStatus,
  SdrAssignment,
  SdrLeadStatus,
  SdrTeam,
  SlaStatus,
  User
} from "@/lib/phase1/types";

export const sdrLeadStatuses: SdrLeadStatus[] = [
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

export const assignmentMethods: AssignmentMethod[] = [
  "Round robin",
  "Weighted round robin",
  "Territory-based",
  "Industry-based",
  "Lead-score based",
  "Capacity-based",
  "Account ownership",
  "Client/team-based",
  "Timezone/language"
];

export const reassignmentTriggers: ReassignmentTrigger[] = [
  "SLA overdue",
  "Owner overloaded",
  "Inactive owner",
  "Territory mismatch"
];

export const outreachChannels: OutreachChannel[] = ["Email", "Call", "SMS", "LinkedIn", "Meeting"];

export function ensureSdrDefaults(state: AppState, workspaceId: string) {
  let changed = false;
  const now = new Date().toISOString();
  const actorUserId = state.users[0]?.id ?? "user-nora";

  if (state.sdrTeams.filter((team) => team.workspaceId === workspaceId).length === 0) {
    state.sdrTeams.push(...defaultSdrTeams(state, workspaceId, now));
    changed = true;
  }

  if (state.reassignmentRules.filter((rule) => rule.workspaceId === workspaceId).length === 0) {
    state.reassignmentRules.push(...defaultReassignmentRules(workspaceId, now));
    changed = true;
  }

  const assignmentResult = assignWorkspaceLeads(state, workspaceId, actorUserId, now);
  changed = assignmentResult.created > 0 || changed;

  const refreshed = refreshSlaStatuses(state, workspaceId, now);
  changed = refreshed.changed || changed;

  return { changed };
}

export function assignWorkspaceLeads(
  state: AppState,
  workspaceId: string,
  assignedById: string,
  assignedAt = new Date().toISOString()
) {
  let created = 0;
  const existingContactIds = new Set(
    state.sdrAssignments
      .filter((assignment) => assignment.workspaceId === workspaceId)
      .map((assignment) => assignment.contactId)
  );

  for (const contact of state.contacts.filter((item) => item.workspaceId === workspaceId)) {
    if (existingContactIds.has(contact.id)) {
      continue;
    }

    if (contact.isSuppressed || contact.priority === "S") {
      continue;
    }

    const company = state.companies.find((item) => item.id === contact.companyId);
    const routing = routeContact(state, workspaceId, contact.id);
    const firstTouchDueAt = firstTouchDueAtForPriority(contact.priority, assignedAt);
    const followUpDueAt = followUpDueAtForStatus(statusForContact(contact.status), assignedAt);
    const assignment: SdrAssignment = {
      id: `assign-${randomUUID()}`,
      workspaceId,
      companyId: contact.companyId,
      contactId: contact.id,
      assignedSdrId: routing.sdrId,
      assignedTeamId: routing.teamId,
      assignedById,
      assignmentMethod: routing.method,
      assignmentReason: routing.reason,
      assignedAt,
      firstTouchDueAt,
      followUpDueAt,
      status: statusForContact(contact.status),
      slaStatus: "On track",
      touchCount: statusForContact(contact.status) === "Assigned" ? 0 : 1,
      firstTouchedAt: statusForContact(contact.status) === "Assigned" ? undefined : offsetDate(assignedAt, -1, 13),
      lastTouchAt: statusForContact(contact.status) === "Assigned" ? undefined : offsetDate(assignedAt, -1, 13),
      createdAt: assignedAt,
      updatedAt: assignedAt
    };

    assignment.slaStatus = calculateSlaStatus(assignment, assignedAt);
    state.sdrAssignments.push(assignment);
    contact.owner = userNameForId(state, routing.sdrId);
    contact.status = leadStatusForAssignment(assignment.status);
    contact.updatedAt = assignedAt;

    const reminderDueAt = assignment.firstTouchedAt ? assignment.followUpDueAt : assignment.firstTouchDueAt;
    if (reminderDueAt) {
      state.followUpReminders.push({
        id: `reminder-${randomUUID()}`,
        workspaceId,
        assignmentId: assignment.id,
        companyId: assignment.companyId,
        contactId: assignment.contactId,
        ownerUserId: assignment.assignedSdrId,
        title: assignment.firstTouchedAt ? `Follow up with ${contact.name}` : `First touch ${contact.name}`,
        channel: recommendedChannel(contact.grade, contact.phone),
        dueAt: reminderDueAt,
        status: reminderStatusForDueAt(reminderDueAt, assignedAt),
        createdAt: assignedAt
      });
    }

    addActivity(state, {
      workspaceId,
      companyId: assignment.companyId,
      contactId: assignment.contactId,
      type: "Status change",
      title: `Assigned to ${userNameForId(state, routing.sdrId)}`,
      body: `${routing.method}: ${routing.reason}${company ? ` for ${company.name}` : ""}.`,
      actorUserId: assignedById,
      metadata: { assignmentId: assignment.id, method: assignment.assignmentMethod },
      createdAt: assignedAt
    });

    created += 1;
  }

  return { created };
}

export function refreshSlaStatuses(state: AppState, workspaceId: string, now = new Date().toISOString()) {
  let changed = false;

  for (const assignment of state.sdrAssignments.filter((item) => item.workspaceId === workspaceId)) {
    const nextStatus = calculateSlaStatus(assignment, now);
    if (assignment.slaStatus !== nextStatus) {
      assignment.slaStatus = nextStatus;
      assignment.updatedAt = now;
      changed = true;
    }
  }

  for (const reminder of state.followUpReminders.filter((item) => item.workspaceId === workspaceId)) {
    if (reminder.status === "Completed") {
      continue;
    }

    const nextStatus = reminderStatusForDueAt(reminder.snoozedUntil ?? reminder.dueAt, now);
    if (reminder.status !== nextStatus) {
      reminder.status = nextStatus;
      changed = true;
    }
  }

  return { changed };
}

export function sdrQueueSnapshot(state: AppState, workspaceId: string, ownerUserId?: string) {
  refreshSlaStatuses(state, workspaceId);
  const assignments = assignmentViews(state, workspaceId).filter(
    (assignment) => !ownerUserId || assignment.assignedSdrId === ownerUserId
  );
  const reminders = reminderViews(state, workspaceId).filter(
    (reminder) => !ownerUserId || reminder.ownerUserId === ownerUserId
  );
  const activeAssignments = assignments.filter((assignment) => activeAssignmentStatuses.has(assignment.status));

  return {
    metrics: {
      assigned: activeAssignments.length,
      p1: activeAssignments.filter((assignment) => assignment.priority === "P1").length,
      dueToday: reminders.filter((reminder) => isSameDay(reminder.dueAt, new Date().toISOString())).length,
      overdue: assignments.filter((assignment) => assignment.slaStatus === "Overdue").length + reminders.filter((reminder) => reminder.status === "Overdue").length
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
        count: reminders.filter((reminder) => isSameDay(reminder.dueAt, new Date().toISOString())).length
      },
      {
        name: "Overdue",
        purpose: "Missed SLA or overdue follow-ups",
        count: assignments.filter((assignment) => assignment.slaStatus === "Overdue").length
      },
      {
        name: "Recently Replied",
        purpose: "Leads with new replies",
        count: assignments.filter((assignment) => assignment.status === "Replied" || assignment.status === "Interested").length
      },
      {
        name: "Call-First Leads",
        purpose: "Valid phone, no strong email",
        count: assignments.filter((assignment) => assignment.phone && (assignment.grade === "C" || assignment.grade === "D")).length
      },
      {
        name: "Email-Ready Leads",
        purpose: "A-grade email leads",
        count: assignments.filter((assignment) => assignment.grade === "A").length
      },
      {
        name: "Meeting Follow-Up",
        purpose: "Prospects after meeting",
        count: assignments.filter((assignment) => assignment.status === "Meeting Booked").length
      },
      {
        name: "Nurture Leads",
        purpose: "Future follow-up opportunities",
        count: assignments.filter((assignment) => assignment.status === "Nurture").length
      }
    ],
    assignments,
    reminders
  };
}

export function managerDashboardSnapshot(state: AppState, workspaceId: string) {
  refreshSlaStatuses(state, workspaceId);
  const assignments = assignmentViews(state, workspaceId);
  const activeAssignments = assignments.filter((assignment) => activeAssignmentStatuses.has(assignment.status));
  const reminders = reminderViews(state, workspaceId);
  const workloads = sdrWorkloads(state, workspaceId);
  const recommendations = reassignmentRecommendations(state, workspaceId);
  const touched = activeAssignments.filter((assignment) => assignment.touchCount > 0).length;
  const adherenceBase = activeAssignments.length || 1;
  const adherence = Math.round(((activeAssignments.length - activeAssignments.filter((assignment) => assignment.slaStatus === "Overdue").length) / adherenceBase) * 100);

  return {
    metrics: {
      activeAssigned: activeAssignments.length,
      overdue: activeAssignments.filter((assignment) => assignment.slaStatus === "Overdue").length,
      untouchedP1: activeAssignments.filter((assignment) => assignment.priority === "P1" && assignment.touchCount === 0).length,
      slaAdherence: adherence,
      contactedRate: Math.round((touched / adherenceBase) * 100)
    },
    workloads,
    recommendations,
    assignments,
    reminders,
    rules: state.reassignmentRules.filter((rule) => rule.workspaceId === workspaceId)
  };
}

export function recordFirstTouch(
  state: AppState,
  input: {
    assignmentId: string;
    actorUserId: string;
    channel: OutreachChannel;
    outcome: SdrLeadStatus;
    notes: string;
    followUpDueAt?: string;
  }
) {
  const now = new Date().toISOString();
  const assignment = state.sdrAssignments.find((item) => item.id === input.assignmentId);

  if (!assignment) {
    throw new Error("Assignment not found.");
  }

  const contact = state.contacts.find((item) => item.id === assignment.contactId);
  const firstTouch = !assignment.firstTouchedAt;
  assignment.firstTouchedAt = assignment.firstTouchedAt ?? now;
  assignment.lastTouchAt = now;
  assignment.touchCount += 1;
  assignment.status = input.outcome;
  assignment.followUpDueAt = input.followUpDueAt ?? defaultFollowUpDueAt(now, input.outcome);
  assignment.slaStatus = calculateSlaStatus(assignment, now);
  assignment.updatedAt = now;

  if (contact) {
    contact.status = leadStatusForAssignment(input.outcome);
    contact.owner = userNameForId(state, assignment.assignedSdrId);
    contact.updatedAt = now;
  }

  for (const reminder of state.followUpReminders.filter(
    (item) => item.assignmentId === assignment.id && item.status !== "Completed"
  )) {
    reminder.status = "Completed";
    reminder.completedAt = now;
  }

  if (assignment.followUpDueAt && activeAssignmentStatuses.has(assignment.status)) {
    const reminder = createFollowUpReminder(state, assignment, {
      title: `${firstTouch ? "Follow up" : "Next step"} with ${contact?.name ?? "contact"}`,
      channel: nextChannel(input.channel, input.outcome),
      dueAt: assignment.followUpDueAt,
      createdAt: now
    });
    createFollowUpTask(state, reminder, input.actorUserId);
  }

  addActivity(state, {
    workspaceId: assignment.workspaceId,
    companyId: assignment.companyId,
    contactId: assignment.contactId,
    type: activityTypeForChannel(input.channel),
    title: `${input.channel} touch logged`,
    body: input.notes || `${input.outcome} recorded.`,
    actorUserId: input.actorUserId,
    metadata: { assignmentId: assignment.id, outcome: input.outcome, channel: input.channel }
  });

  return assignment;
}

export function completeReminder(state: AppState, reminderId: string, actorUserId: string) {
  const reminder = state.followUpReminders.find((item) => item.id === reminderId);

  if (!reminder) {
    throw new Error("Reminder not found.");
  }

  const now = new Date().toISOString();
  reminder.status = "Completed";
  reminder.completedAt = now;

  const task = state.tasks.find(
    (item) => item.contactId === reminder.contactId && item.dueAt === reminder.dueAt && item.status !== "Completed"
  );

  if (task) {
    task.status = "Completed";
    task.completedAt = now;
    task.updatedAt = now;
  }

  addActivity(state, {
    workspaceId: reminder.workspaceId,
    companyId: reminder.companyId,
    contactId: reminder.contactId,
    type: "Task",
    title: `Reminder completed: ${reminder.title}`,
    actorUserId
  });

  return reminder;
}

export function reassignSdrAssignment(
  state: AppState,
  input: {
    assignmentId: string;
    nextSdrId: string;
    actorUserId: string;
    reason: string;
    method?: AssignmentMethod;
  }
) {
  const assignment = state.sdrAssignments.find((item) => item.id === input.assignmentId);

  if (!assignment) {
    throw new Error("Assignment not found.");
  }

  const now = new Date().toISOString();
  const previousOwnerId = assignment.assignedSdrId;
  assignment.previousOwnerId = previousOwnerId;
  assignment.assignedSdrId = input.nextSdrId;
  assignment.assignedTeamId = teamForUser(state, assignment.workspaceId, input.nextSdrId)?.id;
  assignment.assignmentMethod = input.method ?? "Capacity-based";
  assignment.reassignmentReason = input.reason;
  assignment.assignedAt = now;
  assignment.updatedAt = now;
  assignment.slaStatus = calculateSlaStatus(assignment, now);

  const contact = state.contacts.find((item) => item.id === assignment.contactId);
  if (contact) {
    contact.owner = userNameForId(state, input.nextSdrId);
    contact.updatedAt = now;
  }

  for (const task of state.tasks.filter((item) => item.contactId === assignment.contactId && item.status !== "Completed")) {
    task.ownerUserId = input.nextSdrId;
    task.updatedAt = now;
  }

  for (const reminder of state.followUpReminders.filter(
    (item) => item.assignmentId === assignment.id && item.status !== "Completed"
  )) {
    reminder.ownerUserId = input.nextSdrId;
  }

  addActivity(state, {
    workspaceId: assignment.workspaceId,
    companyId: assignment.companyId,
    contactId: assignment.contactId,
    type: "Status change",
    title: `Reassigned to ${userNameForId(state, input.nextSdrId)}`,
    body: input.reason,
    actorUserId: input.actorUserId,
    metadata: { previousOwnerId, nextSdrId: input.nextSdrId, assignmentId: assignment.id }
  });

  return assignment;
}

export function applyReassignmentRecommendations(state: AppState, workspaceId: string, actorUserId: string) {
  const recommendations = reassignmentRecommendations(state, workspaceId);

  for (const recommendation of recommendations) {
    reassignSdrAssignment(state, {
      assignmentId: recommendation.assignmentId,
      nextSdrId: recommendation.recommendedSdrId,
      actorUserId,
      reason: recommendation.reason,
      method: recommendation.method
    });
  }

  return { applied: recommendations.length };
}

export function createReassignmentRule(input: {
  workspaceId: string;
  name: string;
  trigger: ReassignmentTrigger;
  assignmentMethod: AssignmentMethod;
  thresholdHours: number;
  targetTeamId?: string;
}) {
  const now = new Date().toISOString();

  return {
    id: `rule-sdr-${randomUUID()}`,
    workspaceId: input.workspaceId,
    name: input.name,
    trigger: input.trigger,
    assignmentMethod: input.assignmentMethod,
    thresholdHours: input.thresholdHours,
    targetTeamId: input.targetTeamId,
    active: true,
    createdAt: now,
    updatedAt: now
  } satisfies ReassignmentRule;
}

export function assignmentViews(state: AppState, workspaceId: string) {
  return state.sdrAssignments
    .filter((assignment) => assignment.workspaceId === workspaceId)
    .map((assignment) => {
      const contact = state.contacts.find((item) => item.id === assignment.contactId);
      const company = state.companies.find((item) => item.id === assignment.companyId);
      const reminder = state.followUpReminders
        .filter((item) => item.assignmentId === assignment.id && item.status !== "Completed")
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];

      return {
        ...assignment,
        contactName: contact?.name ?? "Unknown contact",
        title: contact?.title ?? "",
        email: contact?.email ?? "",
        phone: contact?.phone ?? "",
        grade: contact?.grade ?? "D",
        priority: contact?.priority ?? "P4",
        segment: contact?.segment ?? "General outbound",
        companyName: company?.name ?? "Unknown account",
        companyDomain: company?.domain ?? "",
        companyState: company?.state ?? "",
        companyIndustry: company?.industry ?? "",
        ownerName: userNameForId(state, assignment.assignedSdrId),
        teamName: state.sdrTeams.find((team) => team.id === assignment.assignedTeamId)?.name ?? "No team",
        dueAt: assignment.firstTouchedAt ? assignment.followUpDueAt : assignment.firstTouchDueAt,
        dueLabel: timerLabel(assignment.firstTouchedAt ? assignment.followUpDueAt : assignment.firstTouchDueAt),
        reminderTitle: reminder?.title,
        reminderStatus: reminder?.status
      };
    })
    .sort((a, b) => sortByUrgency(a.slaStatus, b.slaStatus) || Date.parse(a.dueAt ?? a.assignedAt) - Date.parse(b.dueAt ?? b.assignedAt));
}

export function reminderViews(state: AppState, workspaceId: string) {
  return state.followUpReminders
    .filter((reminder) => reminder.workspaceId === workspaceId)
    .map((reminder) => {
      const contact = state.contacts.find((item) => item.id === reminder.contactId);
      const company = state.companies.find((item) => item.id === reminder.companyId);

      return {
        ...reminder,
        contactName: contact?.name ?? "Unknown contact",
        companyName: company?.name ?? "Unknown account",
        ownerName: userNameForId(state, reminder.ownerUserId),
        dueLabel: timerLabel(reminder.dueAt)
      };
    })
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

export function sdrWorkloads(state: AppState, workspaceId: string) {
  const users = sdrUsers(state, workspaceId);
  const assignments = state.sdrAssignments.filter((assignment) => assignment.workspaceId === workspaceId);

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
      p1: active.filter((assignment) => {
        const contact = state.contacts.find((item) => item.id === assignment.contactId);
        return contact?.priority === "P1";
      }).length,
      overdue: overdue.length,
      touched: touched.length,
      meetings: active.filter((assignment) => assignment.status === "Meeting Booked").length,
      slaAdherence: active.length ? Math.round(((active.length - overdue.length) / active.length) * 100) : 100
    };
  });
}

export function reassignmentRecommendations(state: AppState, workspaceId: string) {
  const assignments = assignmentViews(state, workspaceId);
  const workloads = sdrWorkloads(state, workspaceId);
  const recommendations: Array<{
    assignmentId: string;
    contactName: string;
    companyName: string;
    currentOwner: string;
    recommendedSdrId: string;
    recommendedOwner: string;
    reason: string;
    method: AssignmentMethod;
    slaStatus: SlaStatus;
  }> = [];

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

export function sdrUsers(state: AppState, workspaceId: string): User[] {
  const memberSdrIds = state.workspaceMembers
    .filter((member) => member.workspaceId === workspaceId && (member.role === "SDR" || member.role === "Manager"))
    .map((member) => member.userId);
  const ownerIds = state.contacts
    .filter((contact) => contact.workspaceId === workspaceId && contact.owner !== "Blocked" && contact.owner !== "Unassigned")
    .map((contact) => ownerUserIdForName(state, contact.owner));
  const ids = new Set([...memberSdrIds, ...ownerIds]);

  return state.users.filter((user) => ids.has(user.id));
}

function defaultSdrTeams(state: AppState, workspaceId: string, now: string): SdrTeam[] {
  const ari = ownerUserIdForName(state, "Ari Patel");
  const mina = ownerUserIdForName(state, "Mina Brooks");
  const leo = ownerUserIdForName(state, "Leo Grant");
  const nora = ownerUserIdForName(state, "Nora West");

  return [
    {
      id: "team-auto-sdr",
      workspaceId,
      name: "Auto SDR pod",
      managerUserId: nora,
      memberUserIds: [ari],
      territories: ["TX"],
      industries: ["Automotive retail", "Auto finance"],
      capacityWeight: 1.1,
      active: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "team-ecommerce-sdr",
      workspaceId,
      name: "Ecommerce SDR pod",
      managerUserId: nora,
      memberUserIds: [mina],
      territories: ["WA", "CO"],
      industries: ["Ecommerce", "DTC", "Specialty retail"],
      capacityWeight: 1,
      active: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "team-services-sdr",
      workspaceId,
      name: "Professional services pod",
      managerUserId: nora,
      memberUserIds: [leo],
      territories: ["CA"],
      industries: ["Architecture", "Professional services"],
      capacityWeight: 0.9,
      active: true,
      createdAt: now,
      updatedAt: now
    }
  ];
}

function defaultReassignmentRules(workspaceId: string, now: string): ReassignmentRule[] {
  return [
    {
      id: "rule-sdr-overdue-p1",
      workspaceId,
      name: "Overdue P1 rescue",
      trigger: "SLA overdue",
      assignmentMethod: "Capacity-based",
      thresholdHours: 1,
      active: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "rule-sdr-capacity-rebalance",
      workspaceId,
      name: "Capacity rebalance",
      trigger: "Owner overloaded",
      assignmentMethod: "Capacity-based",
      thresholdHours: 24,
      active: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "rule-sdr-territory-mismatch",
      workspaceId,
      name: "Territory mismatch guard",
      trigger: "Territory mismatch",
      assignmentMethod: "Territory-based",
      thresholdHours: 4,
      active: true,
      createdAt: now,
      updatedAt: now
    }
  ];
}

function routeContact(state: AppState, workspaceId: string, contactId: string) {
  const contact = state.contacts.find((item) => item.id === contactId);
  const company = contact ? state.companies.find((item) => item.id === contact.companyId) : undefined;
  const existingOwnerId = contact?.owner && contact.owner !== "Unassigned" ? ownerUserIdForName(state, contact.owner) : undefined;
  const territoryTeam = state.sdrTeams.find(
    (team) => team.workspaceId === workspaceId && company?.state && team.territories.includes(company.state)
  );
  const industryTeam = state.sdrTeams.find(
    (team) => team.workspaceId === workspaceId && company?.industry && team.industries.some((industry) => company.industry.includes(industry))
  );

  if (existingOwnerId && contact?.owner !== "Blocked") {
    return {
      sdrId: existingOwnerId,
      teamId: teamForUser(state, workspaceId, existingOwnerId)?.id,
      method: "Account ownership" as AssignmentMethod,
      reason: "Existing CRM owner retained for continuity"
    };
  }

  if (territoryTeam?.memberUserIds[0]) {
    return {
      sdrId: territoryTeam.memberUserIds[0],
      teamId: territoryTeam.id,
      method: "Territory-based" as AssignmentMethod,
      reason: `${company?.state} territory mapped to ${territoryTeam.name}`
    };
  }

  if (industryTeam?.memberUserIds[0]) {
    return {
      sdrId: industryTeam.memberUserIds[0],
      teamId: industryTeam.id,
      method: "Industry-based" as AssignmentMethod,
      reason: `${company?.industry ?? "Industry"} mapped to ${industryTeam.name}`
    };
  }

  const leastLoaded = sdrWorkloads(state, workspaceId).sort((a, b) => a.active - b.active)[0];
  return {
    sdrId: leastLoaded?.userId ?? state.users[0]?.id ?? "user-nora",
    teamId: leastLoaded ? teamForUser(state, workspaceId, leastLoaded.userId)?.id : undefined,
    method: "Capacity-based" as AssignmentMethod,
    reason: "Assigned to lowest active workload"
  };
}

function teamForUser(state: AppState, workspaceId: string, userId: string) {
  return state.sdrTeams.find((team) => team.workspaceId === workspaceId && team.memberUserIds.includes(userId));
}

function statusForContact(status: LeadStatus): SdrLeadStatus {
  if (sdrLeadStatuses.includes(status as SdrLeadStatus)) {
    return status as SdrLeadStatus;
  }

  if (status === "Ready for SDR") return "Assigned";
  if (status === "Needs enrichment") return "New";
  if (status === "In review") return "Working";
  if (status === "Exported") return "Meeting Booked";
  if (status === "Suppressed") return "Suppressed";
  return "Assigned";
}

function leadStatusForAssignment(status: SdrLeadStatus): LeadStatus {
  return status as LeadStatus;
}

function firstTouchDueAtForPriority(priority: string, assignedAt: string) {
  if (priority === "P1") return offsetHours(assignedAt, 1);
  if (priority === "P2") return sameBusinessDayDueAt(assignedAt);
  if (priority === "P3") return offsetDate(assignedAt, 3, 17);
  return undefined;
}

function followUpDueAtForStatus(status: SdrLeadStatus, assignedAt: string) {
  if (status === "Working" || status === "Contacted" || status === "Opened") return offsetDate(assignedAt, 2, 10);
  if (status === "Replied" || status === "Interested") return offsetHours(assignedAt, 4);
  if (status === "Meeting Booked") return offsetDate(assignedAt, 1, 9);
  if (status === "Nurture") return offsetDate(assignedAt, 14, 9);
  return undefined;
}

function defaultFollowUpDueAt(now: string, outcome: SdrLeadStatus) {
  if (outcome === "Interested" || outcome === "Replied") return offsetHours(now, 4);
  if (outcome === "Meeting Booked") return offsetDate(now, 1, 9);
  if (outcome === "Nurture") return offsetDate(now, 14, 9);
  if (outcome === "Lost" || outcome === "Disqualified" || outcome === "Invalid" || outcome === "Unsubscribed") {
    return undefined;
  }
  return offsetDate(now, 2, 10);
}

function calculateSlaStatus(assignment: SdrAssignment, now: string): SlaStatus {
  if (assignment.status === "Suppressed" || assignment.status === "Unsubscribed") return "Paused";
  if (!activeAssignmentStatuses.has(assignment.status)) return "No SLA";
  const dueAt = assignment.firstTouchedAt ? assignment.followUpDueAt : assignment.firstTouchDueAt;
  if (!dueAt) return "No SLA";
  const diffMs = Date.parse(dueAt) - Date.parse(now);
  if (diffMs < 0) return "Overdue";
  if (diffMs <= 2 * 60 * 60 * 1000) return "Due soon";
  return "On track";
}

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

function reminderStatusForDueAt(dueAt: string, now: string): ReminderStatus {
  return Date.parse(dueAt) < Date.parse(now) ? "Overdue" : "Open";
}

function recommendedChannel(grade: string, phone: string): OutreachChannel {
  if (grade === "A" || grade === "B") return "Email";
  if (phone) return "Call";
  return "LinkedIn";
}

function nextChannel(channel: OutreachChannel, outcome: SdrLeadStatus): OutreachChannel {
  if (outcome === "Meeting Booked") return "Meeting";
  if (channel === "Email") return "Call";
  if (channel === "Call") return "Email";
  return channel;
}

function activityTypeForChannel(channel: OutreachChannel) {
  if (channel === "Email") return "Email";
  if (channel === "Call") return "Call";
  if (channel === "SMS") return "SMS";
  if (channel === "Meeting") return "Meeting";
  return "Task";
}

function createFollowUpReminder(
  state: AppState,
  assignment: SdrAssignment,
  input: {
    title: string;
    channel: OutreachChannel;
    dueAt: string;
    createdAt: string;
  }
) {
  const reminder: FollowUpReminder = {
    id: `reminder-${randomUUID()}`,
    workspaceId: assignment.workspaceId,
    assignmentId: assignment.id,
    companyId: assignment.companyId,
    contactId: assignment.contactId,
    ownerUserId: assignment.assignedSdrId,
    title: input.title,
    channel: input.channel,
    dueAt: input.dueAt,
    status: reminderStatusForDueAt(input.dueAt, input.createdAt),
    createdAt: input.createdAt
  };

  state.followUpReminders.unshift(reminder);
  return reminder;
}

function createFollowUpTask(state: AppState, reminder: FollowUpReminder, actorUserId: string) {
  const task: CrmTask = {
    id: `task-${randomUUID()}`,
    workspaceId: reminder.workspaceId,
    companyId: reminder.companyId,
    contactId: reminder.contactId,
    title: reminder.title,
    status: reminder.status === "Overdue" ? "Overdue" : "Open",
    priority: reminder.channel === "Meeting" || reminder.status === "Overdue" ? "High" : "Normal",
    dueAt: reminder.dueAt,
    ownerUserId: reminder.ownerUserId,
    createdById: actorUserId,
    createdAt: reminder.createdAt,
    updatedAt: reminder.createdAt
  };

  state.tasks.unshift(task);
  return task;
}

function sameBusinessDayDueAt(value: string) {
  const date = new Date(value);
  if (date.getUTCHours() >= 21) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  date.setUTCHours(21, 0, 0, 0);
  return date.toISOString();
}

function offsetHours(value: string, hours: number) {
  const date = new Date(value);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function offsetDate(value: string, days: number, hour: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

function isSameDay(left: string, right: string) {
  const a = new Date(left);
  const b = new Date(right);
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

function timerLabel(value?: string) {
  if (!value) return "No SLA";
  const diffMs = Date.parse(value) - Date.now();
  const absHours = Math.max(1, Math.round(Math.abs(diffMs) / (60 * 60 * 1000)));
  if (diffMs < 0) return `${absHours}h overdue`;
  if (absHours < 24) return `${absHours}h left`;
  return `${Math.round(absHours / 24)}d left`;
}

function sortByUrgency(left: SlaStatus, right: SlaStatus) {
  const order: Record<SlaStatus, number> = {
    Overdue: 0,
    "Due soon": 1,
    "On track": 2,
    "No SLA": 3,
    Paused: 4
  };

  return order[left] - order[right];
}
