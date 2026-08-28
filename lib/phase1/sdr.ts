import { randomUUID } from "node:crypto";
import { addActivity, ownerUserIdForName, userNameForId } from "@/lib/phase1/crm";
import { isUtcToday } from "@/lib/phase1/date-utils";
import { displayContactName } from "@/lib/phase1/lead-data-quality";
import {
  buildSdrDailyCallPlan,
  SDR_DAILY_CALL_TARGET
} from "@/lib/phase1/sdr-call-cycle";
import type { FollowUpSourceRow } from "@/lib/phase1/follow-ups-read-model";
import { assertWorkspaceMember, requireWorkspaceScopedRecord } from "@/lib/phase1/tenant-isolation";
import type {
  AppState,
  AssignmentMethod,
  CrmTask,
  FollowUpOrigin,
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
  assignedAt = new Date().toISOString(),
  options?: {
    eligibleContactIds?: Set<string>;
    orderedContactIds?: string[];
    perSdrLimit?: number;
    callOnly?: boolean;
  }
) {
  let created = 0;
  const perSdrLimit = options?.perSdrLimit ?? SDR_DAILY_CALL_TARGET;
  const callOnly = options?.callOnly ?? true;
  const activeBySdr = new Map<string, number>();
  for (const assignment of state.sdrAssignments.filter((item) => item.workspaceId === workspaceId)) {
    if (!isCallableCycleAssignment(state, assignment)) continue;
    activeBySdr.set(assignment.assignedSdrId, (activeBySdr.get(assignment.assignedSdrId) ?? 0) + 1);
  }
  const ownersWithOpenBatch = new Set(
    Array.from(activeBySdr.entries()).filter(([, count]) => count > 0).map(([ownerId]) => ownerId)
  );
  const ownersFillingNewBatch = new Set<string>();
  const existingContactIds = new Set(
    state.sdrAssignments
      .filter((assignment) => assignment.workspaceId === workspaceId)
      .map((assignment) => assignment.contactId)
  );
  const orderedIds = options?.orderedContactIds ? [...new Set(options.orderedContactIds)] : undefined;
  const contacts = orderedIds
    ? orderedIds
        .map((id) => state.contacts.find((item) => item.id === id && item.workspaceId === workspaceId))
        .filter((contact): contact is NonNullable<typeof contact> => Boolean(contact))
    : state.contacts.filter((item) => item.workspaceId === workspaceId);

  for (const contact of contacts) {
    if (existingContactIds.has(contact.id)) {
      continue;
    }

    if (contact.isSuppressed || contact.priority === "S") {
      continue;
    }

    if (callOnly && !contact.phone.trim()) {
      continue;
    }

    if (options?.eligibleContactIds && !options.eligibleContactIds.has(contact.id)) {
      continue;
    }

    const company = state.companies.find((item) => item.id === contact.companyId && item.workspaceId === workspaceId);
    const routing = routeContact(state, workspaceId, contact.id);
    if (ownersWithOpenBatch.has(routing.sdrId) && !ownersFillingNewBatch.has(routing.sdrId)) {
      continue;
    }
    if ((activeBySdr.get(routing.sdrId) ?? 0) >= perSdrLimit) {
      continue;
    }
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
    ownersFillingNewBatch.add(routing.sdrId);
    activeBySdr.set(routing.sdrId, (activeBySdr.get(routing.sdrId) ?? 0) + 1);
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
        // Routing invented this date, not an SDR.
        origin: "system",
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
  const allAssignments = assignmentViews(state, workspaceId).filter(
    (assignment) => !ownerUserId || assignment.assignedSdrId === ownerUserId
  );
  const completedCallsToday = ownerUserId
    ? state.trackedCalls.filter(
        (call) =>
          call.workspaceId === workspaceId &&
          call.sdrUserId === ownerUserId &&
          call.direction === "Outbound" &&
          isUtcToday(call.createdAt)
      ).length
    : 0;
  const ownerPlan = ownerUserId
    ? buildSdrDailyCallPlan(allAssignments, ownerUserId, completedCallsToday)
    : undefined;
  const assignments = ownerPlan?.assignments ?? allAssignments.filter(
    (assignment) => !assignment.callCycleCompletedAt && activeAssignmentStatuses.has(assignment.status)
  );
  const reminders = reminderViews(state, workspaceId).filter(
    (reminder) => !ownerUserId || reminder.ownerUserId === ownerUserId
  );
  const activeAssignments = assignments.filter((assignment) => activeAssignmentStatuses.has(assignment.status));

  return {
    metrics: {
      assigned: ownerPlan?.activeBatchSize ?? activeAssignments.length,
      p1: activeAssignments.filter((assignment) => assignment.priority === "P1").length,
      dueToday: reminders.filter((reminder) => isUtcToday(reminder.dueAt)).length,
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
        count: reminders.filter((reminder) => isUtcToday(reminder.dueAt)).length
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
    reminders,
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
    workspaceId?: string;
    assignmentId: string;
    actorUserId: string;
    channel: OutreachChannel;
    outcome: SdrLeadStatus;
    notes: string;
    followUpDueAt?: string;
  }
) {
  const now = new Date().toISOString();
  const assignment = requireWorkspaceScopedRecord(
    state.sdrAssignments.find((item) => item.id === input.assignmentId),
    input.workspaceId ?? state.sdrAssignments.find((item) => item.id === input.assignmentId)?.workspaceId ?? "",
    "SDR assignment"
  );
  if (input.workspaceId) {
    assertWorkspaceMember(state, input.workspaceId, input.actorUserId);
  }

  const contact = state.contacts.find(
    (item) => item.id === assignment.contactId && item.workspaceId === assignment.workspaceId
  );
  const firstTouch = !assignment.firstTouchedAt;
  // Captured BEFORE the default is merged in below: a follow-up only counts as
  // SDR-scheduled when the touch form / call wrap-up actually supplied a date.
  // Leaving the field blank still creates a reminder, but that one is the
  // platform's own idea and must not read as committed SDR work.
  const sdrScheduledFollowUp = Boolean(input.followUpDueAt);
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
    (item) =>
      item.workspaceId === assignment.workspaceId &&
      item.assignmentId === assignment.id &&
      item.status !== "Completed"
  )) {
    reminder.status = "Completed";
    reminder.completedAt = now;
  }

  if (assignment.followUpDueAt && activeAssignmentStatuses.has(assignment.status)) {
    const reminder = createFollowUpReminder(state, assignment, {
      title: `${firstTouch ? "Follow up" : "Next step"} with ${contact?.name ?? "contact"}`,
      channel: nextChannel(input.channel, input.outcome),
      dueAt: assignment.followUpDueAt,
      origin: sdrScheduledFollowUp ? "sdr" : "system",
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

export type SdrCallCycleResult = {
  recordedPass: 1 | 2 | null;
  batchCompleted: boolean;
  nextBatchAssigned: number;
};

/** Records one completed call wrap-up against the two-pass SDR lifecycle. */
export function recordSdrCallCycleAttempt(
  state: AppState,
  input: {
    workspaceId: string;
    assignmentId: string;
    actorUserId: string;
    now?: string;
  }
): SdrCallCycleResult {
  const now = input.now ?? new Date().toISOString();
  const assignment = requireWorkspaceScopedRecord(
    state.sdrAssignments.find((item) => item.id === input.assignmentId),
    input.workspaceId,
    "SDR assignment"
  );
  assertWorkspaceMember(state, input.workspaceId, input.actorUserId);

  if (assignment.callCycleCompletedAt) {
    return { recordedPass: null, batchCompleted: false, nextBatchAssigned: 0 };
  }

  const wasCompleted = Boolean(assignment.callCycleCompletedAt);
  let recordedPass: 1 | 2 | null = null;
  if (!assignment.firstCallCompletedAt) {
    assignment.firstCallCompletedAt = now;
    recordedPass = 1;
  } else {
    const ownerStillHasFirstPassCalls = state.sdrAssignments.some(
      (candidate) =>
        candidate.workspaceId === assignment.workspaceId &&
        candidate.assignedSdrId === assignment.assignedSdrId &&
        candidate.id !== assignment.id &&
        isCallableCycleAssignment(state, candidate) &&
        !candidate.firstCallCompletedAt
    );
    if (!ownerStillHasFirstPassCalls && !assignment.secondCallCompletedAt) {
      assignment.secondCallCompletedAt = now;
      assignment.callCycleCompletedAt = now;
      recordedPass = 2;
    }
  }

  if (!isCallableCycleAssignment(state, assignment)) {
    assignment.callCycleCompletedAt = assignment.callCycleCompletedAt ?? now;
  }
  if (assignment.callCycleCompletedAt) {
    completeAssignmentReminders(state, assignment, now);
    if (!wasCompleted) {
      addActivity(state, {
        workspaceId: assignment.workspaceId,
        companyId: assignment.companyId,
        contactId: assignment.contactId,
        type: "Status change",
        title: recordedPass === 2 ? "Two-pass calling cycle completed" : "Removed from active calling",
        body: recordedPass === 2
          ? "Both required call passes were completed. The contact remains in CRM history."
          : "The contact is no longer eligible for the active calling cycle.",
        actorUserId: input.actorUserId,
        metadata: { assignmentId: assignment.id, recordedPass: recordedPass ?? undefined }
      });
    }
  }
  assignment.updatedAt = now;

  const ownerHasRemainingCalls = state.sdrAssignments.some(
    (candidate) =>
      candidate.workspaceId === assignment.workspaceId &&
      candidate.assignedSdrId === assignment.assignedSdrId &&
      isCallableCycleAssignment(state, candidate)
  );
  if (ownerHasRemainingCalls) {
    return { recordedPass, batchCompleted: false, nextBatchAssigned: 0 };
  }

  // Close non-callable rows in the same batch (no phone, invalid, suppressed,
  // or otherwise terminal) so they remain history without looking actively assigned.
  for (const candidate of state.sdrAssignments.filter(
    (item) =>
      item.workspaceId === assignment.workspaceId &&
      item.assignedSdrId === assignment.assignedSdrId &&
      !item.callCycleCompletedAt
  )) {
    candidate.callCycleCompletedAt = now;
    candidate.updatedAt = now;
    completeAssignmentReminders(state, candidate, now);
  }

  assignWorkspaceLeads(
    state,
    assignment.workspaceId,
    input.actorUserId,
    now,
    { perSdrLimit: SDR_DAILY_CALL_TARGET, callOnly: true }
  );
  const nextBatchAssigned = state.sdrAssignments.filter(
    (candidate) =>
      candidate.workspaceId === assignment.workspaceId &&
      candidate.assignedSdrId === assignment.assignedSdrId &&
      candidate.createdAt === now
  ).length;

  return {
    recordedPass,
    batchCompleted: true,
    nextBatchAssigned
  };
}

export function completeReminder(state: AppState, reminderId: string, actorUserId: string, workspaceId?: string) {
  const reminder = requireWorkspaceScopedRecord(
    state.followUpReminders.find((item) => item.id === reminderId),
    workspaceId ?? state.followUpReminders.find((item) => item.id === reminderId)?.workspaceId ?? "",
    "Follow-up reminder"
  );
  if (workspaceId) {
    assertWorkspaceMember(state, workspaceId, actorUserId);
  }

  const now = new Date().toISOString();
  reminder.status = "Completed";
  reminder.completedAt = now;

  const task = state.tasks.find(
    (item) =>
      item.workspaceId === reminder.workspaceId &&
      item.contactId === reminder.contactId &&
      item.dueAt === reminder.dueAt &&
      item.status !== "Completed"
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

/**
 * Manager/owner action: assign one contact to a specific SDR. Creates a fresh
 * SdrAssignment (with a first-touch reminder + activity, like the auto router)
 * when the contact has no assignment, or reassigns an existing one to the target
 * SDR. No-op when the contact is already assigned to that SDR.
 */
export function assignContactToSdr(
  state: AppState,
  input: {
    workspaceId: string;
    contactId: string;
    sdrId: string;
    actorUserId: string;
    reason: string;
    method?: AssignmentMethod;
  }
): { created: boolean; reassigned: boolean } {
  assertWorkspaceMember(state, input.workspaceId, input.actorUserId);
  assertWorkspaceMember(state, input.workspaceId, input.sdrId);
  const contact = requireWorkspaceScopedRecord(
    state.contacts.find((item) => item.id === input.contactId),
    input.workspaceId,
    "Contact"
  );
  const method = input.method ?? "Account ownership";

  const existing = state.sdrAssignments.find(
    (item) => item.workspaceId === input.workspaceId && item.contactId === input.contactId
  );
  if (existing) {
    if (existing.assignedSdrId === input.sdrId) {
      return { created: false, reassigned: false };
    }
    reassignSdrAssignment(state, {
      workspaceId: input.workspaceId,
      assignmentId: existing.id,
      nextSdrId: input.sdrId,
      actorUserId: input.actorUserId,
      reason: input.reason,
      method
    });
    return { created: false, reassigned: true };
  }

  const accountAssignment = accountAssignmentForContact(state, input.workspaceId, contact);
  const targetSdrId = accountAssignment?.assignedSdrId ?? input.sdrId;
  if (targetSdrId !== input.sdrId) {
    assertWorkspaceMember(state, input.workspaceId, targetSdrId);
  }
  const targetReason =
    targetSdrId !== input.sdrId
      ? "Existing account SDR retained so all contacts stay with one owner"
      : input.reason;
  const targetMethod = targetSdrId !== input.sdrId ? "Account ownership" : method;
  const assignedAt = new Date().toISOString();
  const status = statusForContact(contact.status);
  const assignment: SdrAssignment = {
    id: `assign-${randomUUID()}`,
    workspaceId: input.workspaceId,
    companyId: contact.companyId,
    contactId: contact.id,
    assignedSdrId: targetSdrId,
    assignedById: input.actorUserId,
    assignmentMethod: targetMethod,
    assignmentReason: targetReason,
    assignedAt,
    firstTouchDueAt: firstTouchDueAtForPriority(contact.priority, assignedAt),
    followUpDueAt: followUpDueAtForStatus(status, assignedAt),
    status,
    slaStatus: "On track",
    touchCount: 0,
    createdAt: assignedAt,
    updatedAt: assignedAt
  };
  assignment.slaStatus = calculateSlaStatus(assignment, assignedAt);
  state.sdrAssignments.push(assignment);
  contact.owner = userNameForId(state, targetSdrId);
  contact.status = leadStatusForAssignment(assignment.status);
  contact.updatedAt = assignedAt;

  if (assignment.firstTouchDueAt) {
    state.followUpReminders.push({
      id: `reminder-${randomUUID()}`,
      workspaceId: input.workspaceId,
      assignmentId: assignment.id,
      companyId: assignment.companyId,
      contactId: assignment.contactId,
      ownerUserId: assignment.assignedSdrId,
      title: `First touch ${contact.name}`,
      channel: recommendedChannel(contact.grade, contact.phone),
      dueAt: assignment.firstTouchDueAt,
      status: reminderStatusForDueAt(assignment.firstTouchDueAt, assignedAt),
      // The assignment SLA clock, not a follow-up the SDR scheduled.
      origin: "system",
      createdAt: assignedAt
    });
  }

  const company = state.companies.find(
    (item) => item.id === contact.companyId && item.workspaceId === input.workspaceId
  );
  addActivity(state, {
    workspaceId: input.workspaceId,
    companyId: assignment.companyId,
    contactId: assignment.contactId,
    type: "Status change",
    title: `Assigned to ${userNameForId(state, targetSdrId)}`,
    body: `${targetMethod}: ${targetReason}${company ? ` for ${company.name}` : ""}.`,
    actorUserId: input.actorUserId,
    metadata: { assignmentId: assignment.id, method: assignment.assignmentMethod },
    createdAt: assignedAt
  });

  return { created: true, reassigned: false };
}

/**
 * Test-data cleanup: reset one contact's SDR engagement to a freshly-assigned
 * state, KEEPING the assignment + owner. Zeroes the touch history, restarts the
 * first-touch/SLA clock as of `now`, resets the contact + assignment status to
 * "Assigned", and drops a fresh first-touch reminder — exactly what a brand-new
 * assignment looks like. Callers delete the contact's activity/call/note/task/
 * opportunity/event/reminder records BEFORE calling this. No-op if unassigned.
 */
export function resetSdrAssignmentToFresh(
  state: AppState,
  workspaceId: string,
  contactId: string,
  now: string
): boolean {
  const assignment = state.sdrAssignments.find(
    (item) => item.workspaceId === workspaceId && item.contactId === contactId
  );
  if (!assignment) return false;
  const contact = state.contacts.find((item) => item.id === contactId && item.workspaceId === workspaceId);
  if (!contact) return false;

  const status: SdrLeadStatus = "Assigned";
  assignment.assignedAt = now;
  assignment.status = status;
  assignment.touchCount = 0;
  assignment.firstCallCompletedAt = undefined;
  assignment.secondCallCompletedAt = undefined;
  assignment.callCycleCompletedAt = undefined;
  assignment.firstTouchedAt = undefined;
  assignment.lastTouchAt = undefined;
  assignment.reassignmentReason = undefined;
  assignment.previousOwnerId = undefined;
  assignment.firstTouchDueAt = firstTouchDueAtForPriority(contact.priority, now);
  assignment.followUpDueAt = followUpDueAtForStatus(status, now);
  assignment.slaStatus = calculateSlaStatus(assignment, now);
  assignment.updatedAt = now;

  contact.status = leadStatusForAssignment(status);
  contact.updatedAt = now;

  if (assignment.firstTouchDueAt) {
    state.followUpReminders.push({
      id: `reminder-${randomUUID()}`,
      workspaceId,
      assignmentId: assignment.id,
      companyId: assignment.companyId,
      contactId: assignment.contactId,
      ownerUserId: assignment.assignedSdrId,
      title: `First touch ${contact.name}`,
      channel: recommendedChannel(contact.grade, contact.phone),
      dueAt: assignment.firstTouchDueAt,
      status: reminderStatusForDueAt(assignment.firstTouchDueAt, now),
      // The assignment SLA clock, not a follow-up the SDR scheduled.
      origin: "system",
      createdAt: now
    });
  }
  return true;
}

export function reassignSdrAssignment(
  state: AppState,
  input: {
    workspaceId?: string;
    assignmentId: string;
    nextSdrId: string;
    actorUserId: string;
    reason: string;
    method?: AssignmentMethod;
  }
) {
  const assignment = requireWorkspaceScopedRecord(
    state.sdrAssignments.find((item) => item.id === input.assignmentId),
    input.workspaceId ?? state.sdrAssignments.find((item) => item.id === input.assignmentId)?.workspaceId ?? "",
    "SDR assignment"
  );
  if (input.workspaceId) {
    assertWorkspaceMember(state, input.workspaceId, input.actorUserId);
    assertWorkspaceMember(state, input.workspaceId, input.nextSdrId);
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

  const contact = state.contacts.find(
    (item) => item.id === assignment.contactId && item.workspaceId === assignment.workspaceId
  );
  if (contact) {
    contact.owner = userNameForId(state, input.nextSdrId);
    contact.updatedAt = now;
  }

  for (const task of state.tasks.filter(
    (item) =>
      item.workspaceId === assignment.workspaceId &&
      item.contactId === assignment.contactId &&
      item.status !== "Completed"
  )) {
    task.ownerUserId = input.nextSdrId;
    task.updatedAt = now;
  }

  for (const reminder of state.followUpReminders.filter(
    (item) =>
      item.workspaceId === assignment.workspaceId &&
      item.assignmentId === assignment.id &&
      item.status !== "Completed"
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
      workspaceId,
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
      const contact = state.contacts.find(
        (item) => item.id === assignment.contactId && item.workspaceId === workspaceId
      );
      const company = state.companies.find(
        (item) => item.id === assignment.companyId && item.workspaceId === workspaceId
      );
      const reminder = state.followUpReminders
        .filter(
          (item) =>
            item.workspaceId === workspaceId &&
            item.assignmentId === assignment.id &&
            item.status !== "Completed"
        )
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];

      return {
        ...assignment,
        contactName: displayContactName(contact),
        title: contact?.title ?? "",
        email: contact?.email ?? "",
        phone: contact?.phone ?? "",
        doNotContact: contact?.doNotContact ?? false,
        isSuppressed: contact?.isSuppressed ?? false,
        grade: contact?.grade ?? "D",
        priority: contact?.priority ?? "P4",
        segment: contact?.segment ?? "General outbound",
        companyName: company?.name ?? "Unknown account",
        companyDomain: company?.domain ?? "",
        companyState: company?.state ?? "",
        companyIndustry: company?.industry ?? "",
        ownerName: userNameForId(state, assignment.assignedSdrId),
        notes: contact?.notes ?? "",
        teamName: state.sdrTeams.find((team) => team.id === assignment.assignedTeamId)?.name ?? "No team",
        dueAt: assignment.firstTouchedAt ? assignment.followUpDueAt : assignment.firstTouchDueAt,
        dueLabel: timerLabel(assignment.firstTouchedAt ? assignment.followUpDueAt : assignment.firstTouchDueAt),
        reminderTitle: reminder?.title,
        reminderStatus: reminder?.status
      };
    })
    .sort((a, b) => sortByUrgency(a.slaStatus, b.slaStatus) || Date.parse(a.dueAt ?? a.assignedAt) - Date.parse(b.dueAt ?? b.assignedAt));
}

// File-store backing for the "my assigned contacts" directory: the same enriched
// assignment views, filtered to one SDR (when given) and re-sorted newest-assigned
// first (overriding assignmentViews' SLA-urgency order).
export function assignedContactsSnapshot(state: AppState, workspaceId: string, ownerUserId?: string) {
  refreshSlaStatuses(state, workspaceId);
  return assignmentViews(state, workspaceId)
    .filter((assignment) => !ownerUserId || assignment.assignedSdrId === ownerUserId)
    .sort((a, b) => Date.parse(b.assignedAt) - Date.parse(a.assignedAt));
}

export function reminderViews(state: AppState, workspaceId: string) {
  return state.followUpReminders
    .filter((reminder) => reminder.workspaceId === workspaceId)
    .map((reminder) => {
      const contact = state.contacts.find(
        (item) => item.id === reminder.contactId && item.workspaceId === workspaceId
      );
      const company = state.companies.find(
        (item) => item.id === reminder.companyId && item.workspaceId === workspaceId
      );

      return {
        ...reminder,
        contactName: displayContactName(contact),
        companyName: company?.name ?? "Unknown account",
        ownerName: userNameForId(state, reminder.ownerUserId),
        dueLabel: timerLabel(reminder.dueAt)
      };
    })
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

/**
 * File-store backing for the Follow-ups directory: every open follow-up in the
 * workspace (optionally one owner's), flattened into the same source rows the
 * prisma fast path builds so both drivers share `groupFollowUpsByContact`.
 */
export function followUpSourceRowsSnapshot(
  state: AppState,
  workspaceId: string,
  ownerUserId?: string
): FollowUpSourceRow[] {
  refreshSlaStatuses(state, workspaceId);
  return state.followUpReminders
    .filter(
      (reminder) =>
        reminder.workspaceId === workspaceId &&
        reminder.status !== "Completed" &&
        Boolean(reminder.contactId) &&
        (!ownerUserId || reminder.ownerUserId === ownerUserId)
    )
    .map((reminder) => {
      const contact = state.contacts.find(
        (item) => item.id === reminder.contactId && item.workspaceId === workspaceId
      );
      const company = state.companies.find(
        (item) => item.id === reminder.companyId && item.workspaceId === workspaceId
      );

      return {
        id: reminder.id,
        contactId: reminder.contactId,
        companyId: reminder.companyId,
        ownerUserId: reminder.ownerUserId,
        ownerName: userNameForId(state, reminder.ownerUserId),
        title: reminder.title,
        channel: reminder.channel,
        dueAt: reminder.dueAt,
        status: reminder.status,
        origin: reminder.origin,
        createdAt: reminder.createdAt,
        contactName: displayContactName(contact),
        contactTitle: contact?.title ?? "",
        email: contact?.email ?? "",
        phone: contact?.phone ?? "",
        grade: contact?.grade ?? "D",
        priority: contact?.priority ?? "P4",
        leadStatus: contact?.status ?? "New",
        doNotContact: contact?.doNotContact ?? false,
        isSuppressed: contact?.isSuppressed ?? false,
        companyName: company?.name ?? "Unknown account"
      } satisfies FollowUpSourceRow;
    });
}

export function sdrWorkloads(state: AppState, workspaceId: string) {
  const users = sdrUsers(state, workspaceId);
  const assignments = state.sdrAssignments.filter((assignment) => assignment.workspaceId === workspaceId);

  return users.map((user) => {
    const owned = assignments.filter((assignment) => assignment.assignedSdrId === user.id);
    const current = owned.filter((assignment) => !assignment.callCycleCompletedAt);
    const active = current.filter((assignment) => activeAssignmentStatuses.has(assignment.status));
    const overdue = active.filter((assignment) => assignment.slaStatus === "Overdue");
    const touched = active.filter((assignment) => assignment.touchCount > 0);

    return {
      userId: user.id,
      name: user.name,
      assigned: current.length,
      active: active.length,
      p1: active.filter((assignment) => {
        const contact = state.contacts.find(
          (item) => item.id === assignment.contactId && item.workspaceId === workspaceId
        );
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
    if (assignment.callCycleCompletedAt) {
      continue;
    }
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
  const contact = state.contacts.find((item) => item.id === contactId && item.workspaceId === workspaceId);
  const company = contact
    ? state.companies.find((item) => item.id === contact.companyId && item.workspaceId === workspaceId)
    : undefined;
  const accountAssignment = contact ? accountAssignmentForContact(state, workspaceId, contact) : undefined;
  const existingOwnerId = contact?.owner && contact.owner !== "Unassigned" ? ownerUserIdForName(state, contact.owner) : undefined;
  const territoryTeam = state.sdrTeams.find(
    (team) => team.workspaceId === workspaceId && company?.state && team.territories.includes(company.state)
  );
  const industryTeam = state.sdrTeams.find(
    (team) => team.workspaceId === workspaceId && company?.industry && team.industries.some((industry) => company.industry.includes(industry))
  );

  if (accountAssignment?.assignedSdrId) {
    return {
      sdrId: accountAssignment.assignedSdrId,
      teamId: teamForUser(state, workspaceId, accountAssignment.assignedSdrId)?.id,
      method: "Account ownership" as AssignmentMethod,
      reason: "Existing account SDR retained so all contacts stay with one owner"
    };
  }

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

function accountAssignmentForContact(
  state: AppState,
  workspaceId: string,
  contact: Pick<AppState["contacts"][number], "id" | "companyId">
) {
  return state.sdrAssignments.find(
    (assignment) =>
      assignment.workspaceId === workspaceId &&
      assignment.companyId === contact.companyId &&
      assignment.contactId !== contact.id &&
      Boolean(assignment.assignedSdrId)
  );
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

/**
 * SLA state from the assignment row plus the clock — pure, so read models compute
 * it live instead of trusting the stored column. The column is only refreshed by
 * writes (refreshSlaStatuses), so on a read-only day a lapsed due date would keep
 * reporting "On track" while the same row's timer label said "overdue".
 */
export function calculateSlaStatus(assignment: SdrAssignment, now: string): SlaStatus {
  if (assignment.callCycleCompletedAt) return "No SLA";
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

function isCallableCycleAssignment(state: AppState, assignment: SdrAssignment) {
  if (assignment.callCycleCompletedAt || !activeAssignmentStatuses.has(assignment.status)) return false;
  const contact = state.contacts.find(
    (item) => item.workspaceId === assignment.workspaceId && item.id === assignment.contactId
  );
  return Boolean(
    contact?.phone.trim() &&
      !contact.isSuppressed &&
      !contact.doNotContact &&
      contact.priority !== "S"
  );
}

function completeAssignmentReminders(state: AppState, assignment: SdrAssignment, now: string) {
  for (const reminder of state.followUpReminders.filter(
    (item) => item.assignmentId === assignment.id && item.workspaceId === assignment.workspaceId && item.status !== "Completed"
  )) {
    reminder.status = "Completed";
    reminder.completedAt = now;
  }
}

/** Same read-time rule for reminders: past due is Overdue regardless of the column. */
export function reminderStatusForDueAt(dueAt: string, now: string): ReminderStatus {
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
    origin: FollowUpOrigin;
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
    origin: input.origin,
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
