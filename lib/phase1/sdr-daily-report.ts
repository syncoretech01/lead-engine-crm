import { SDR_DAILY_CALL_TARGET } from "@/lib/phase1/sdr-call-cycle";
import type { AppState, SdrDailyReport, SdrDailyReportMetrics } from "@/lib/phase1/types";

export const PAKISTAN_REPORT_TIMEZONE = "Asia/Karachi" as const;
export const PAKISTAN_REPORT_CUTOFF_HOUR = 4 as const;
const PAKISTAN_OFFSET_MS = 5 * 60 * 60 * 1000;

export type SdrDailyReportWindow = {
  reportDate: string;
  periodStart: string;
  periodEnd: string;
};

export function duePakistanReportWindows(now = new Date().toISOString(), lookbackDays = 7): SdrDailyReportWindow[] {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("Daily report timestamp is invalid.");
  const shifted = new Date(nowMs + PAKISTAN_OFFSET_MS);
  let latestBoundaryMs =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), PAKISTAN_REPORT_CUTOFF_HOUR) -
    PAKISTAN_OFFSET_MS;
  if (latestBoundaryMs > nowMs) latestBoundaryMs -= 24 * 60 * 60 * 1000;

  return Array.from({ length: Math.max(1, Math.floor(lookbackDays)) }, (_, index) => {
    const periodEndMs = latestBoundaryMs - index * 24 * 60 * 60 * 1000;
    const periodStartMs = periodEndMs - 24 * 60 * 60 * 1000;
    return {
      reportDate: new Date(periodStartMs + PAKISTAN_OFFSET_MS).toISOString().slice(0, 10),
      periodStart: new Date(periodStartMs).toISOString(),
      periodEnd: new Date(periodEndMs).toISOString()
    };
  });
}

export function countMissingSdrDailyReports(
  state: AppState,
  options: { now?: string; workspaceId?: string; lookbackDays?: number } = {}
): number {
  const windows = duePakistanReportWindows(options.now, options.lookbackDays);
  const existing = new Set(state.sdrDailyReports.map((report) => report.id));
  let missing = 0;
  for (const member of reportableSdrMembers(state, options.workspaceId)) {
    for (const window of windows) {
      if (!existing.has(reportId(member.workspaceId, member.userId, window.reportDate))) missing += 1;
    }
  }
  return missing;
}

export function generateDueSdrDailyReports(
  state: AppState,
  options: { now?: string; workspaceId?: string; lookbackDays?: number } = {}
): { created: number; reportDates: string[] } {
  const now = options.now ?? new Date().toISOString();
  const windows = duePakistanReportWindows(now, options.lookbackDays);
  const existing = new Set(state.sdrDailyReports.map((report) => report.id));
  const created: SdrDailyReport[] = [];

  for (const member of reportableSdrMembers(state, options.workspaceId)) {
    for (const window of windows) {
      const id = reportId(member.workspaceId, member.userId, window.reportDate);
      if (existing.has(id)) continue;
      created.push({
        id,
        workspaceId: member.workspaceId,
        sdrUserId: member.userId,
        reportDate: window.reportDate,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        timezone: PAKISTAN_REPORT_TIMEZONE,
        cutoffHour: PAKISTAN_REPORT_CUTOFF_HOUR,
        metrics: metricsForSdr(state, member.workspaceId, member.userId, window),
        generatedAt: now
      });
      existing.add(id);
    }
  }

  state.sdrDailyReports.unshift(...created);
  return { created: created.length, reportDates: [...new Set(created.map((report) => report.reportDate))] };
}

export function sdrDailyReportMetrics(value: unknown): SdrDailyReportMetrics {
  const raw = value && typeof value === "object" ? value as Partial<SdrDailyReportMetrics> : {};
  return {
    dailyCallTarget: metric(raw.dailyCallTarget, SDR_DAILY_CALL_TARGET),
    callsTotal: metric(raw.callsTotal),
    callsConnected: metric(raw.callsConnected),
    callsVoicemail: metric(raw.callsVoicemail),
    callsUnanswered: metric(raw.callsUnanswered),
    callsFailed: metric(raw.callsFailed),
    uniqueContactsCalled: metric(raw.uniqueContactsCalled),
    totalTalkTimeSeconds: metric(raw.totalTalkTimeSeconds),
    emailsSent: metric(raw.emailsSent),
    emailReplies: metric(raw.emailReplies),
    smsSent: metric(raw.smsSent),
    smsReplies: metric(raw.smsReplies),
    opportunitiesCreated: metric(raw.opportunitiesCreated),
    opportunityValue: metric(raw.opportunityValue),
    followUpsCreated: metric(raw.followUpsCreated),
    followUpsCompleted: metric(raw.followUpsCompleted),
    meetingsBooked: metric(raw.meetingsBooked),
    contactsSuppressed: metric(raw.contactsSuppressed),
    tasksCreated: metric(raw.tasksCreated),
    tasksCompleted: metric(raw.tasksCompleted),
    notesAdded: metric(raw.notesAdded),
    leadsTouched: metric(raw.leadsTouched),
    assignmentsReceived: metric(raw.assignmentsReceived),
    firstPassCompleted: metric(raw.firstPassCompleted),
    secondPassCompleted: metric(raw.secondPassCompleted),
    callingSessions: metric(raw.callingSessions),
    activeCallingSeconds: metric(raw.activeCallingSeconds)
  };
}

function metricsForSdr(
  state: AppState,
  workspaceId: string,
  sdrUserId: string,
  window: SdrDailyReportWindow
): SdrDailyReportMetrics {
  const inWindow = (value?: string) => {
    if (!value) return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp >= Date.parse(window.periodStart) && timestamp < Date.parse(window.periodEnd);
  };
  const calls = state.trackedCalls.filter(
    (call) => call.workspaceId === workspaceId && call.sdrUserId === sdrUserId && call.direction === "Outbound" && inWindow(call.createdAt)
  );
  const activities = state.activities.filter(
    (activity) => activity.workspaceId === workspaceId && activity.actorUserId === sdrUserId && inWindow(activity.createdAt)
  );
  const opportunities = state.opportunities.filter(
    (opportunity) => opportunity.workspaceId === workspaceId && opportunity.ownerUserId === sdrUserId && inWindow(opportunity.createdAt)
  );
  const reminders = state.followUpReminders.filter(
    (reminder) => reminder.workspaceId === workspaceId && reminder.ownerUserId === sdrUserId
  );
  const tasks = state.tasks.filter((task) => task.workspaceId === workspaceId && task.ownerUserId === sdrUserId);
  const assignments = state.sdrAssignments.filter(
    (assignment) => assignment.workspaceId === workspaceId && assignment.assignedSdrId === sdrUserId
  );
  const sessions = state.sdrCallingSessions.filter(
    (session) => session.workspaceId === workspaceId && session.sdrUserId === sdrUserId && session.status === "Completed" && inWindow(session.endedAt)
  );
  const callTouches = activities.filter((activity) => activity.type === "Call" && activity.metadata?.assignmentId);
  const touchedContactIds = new Set(activities.map((activity) => activity.contactId).filter(Boolean));
  const suppressedContactIds = new Set(
    activities
      .filter((activity) => {
        const outcome = String(activity.metadata?.outcome ?? "");
        return outcome === "Suppressed" || outcome === "Unsubscribed" || activity.title.toLowerCase() === "sms opt-out";
      })
      .map((activity) => activity.contactId)
      .filter(Boolean)
  );

  return {
    dailyCallTarget: SDR_DAILY_CALL_TARGET,
    callsTotal: calls.length,
    callsConnected: calls.filter((call) => call.callStatus === "Connected").length,
    callsVoicemail: calls.filter((call) => call.callStatus === "Voicemail" || call.disposition === "Left voicemail").length,
    callsUnanswered: calls.filter((call) => call.callStatus === "No answer" || call.callStatus === "Busy").length,
    callsFailed: calls.filter((call) => call.callStatus === "Failed").length,
    uniqueContactsCalled: new Set(calls.map((call) => call.contactId).filter(Boolean)).size,
    totalTalkTimeSeconds: calls.reduce((total, call) => total + metric(call.durationSeconds), 0),
    emailsSent: activities.filter((activity) => activity.type === "Email" && activity.title.toLowerCase() === "email sent").length,
    emailReplies: activities.filter((activity) => activity.type === "Email" && activity.title.toLowerCase() === "email replied").length,
    smsSent: activities.filter((activity) => activity.type === "SMS" && activity.title.toLowerCase() === "sms sent").length,
    smsReplies: activities.filter((activity) => activity.type === "SMS" && activity.title.toLowerCase() === "sms replied").length,
    opportunitiesCreated: opportunities.length,
    opportunityValue: opportunities.reduce((total, opportunity) => total + metric(opportunity.amount), 0),
    followUpsCreated: reminders.filter((reminder) => inWindow(reminder.createdAt)).length,
    followUpsCompleted: reminders.filter((reminder) => inWindow(reminder.completedAt)).length,
    meetingsBooked: callTouches.filter((activity) => activity.metadata?.outcome === "Meeting Booked").length,
    contactsSuppressed: suppressedContactIds.size,
    tasksCreated: tasks.filter((task) => inWindow(task.createdAt)).length,
    tasksCompleted: tasks.filter((task) => inWindow(task.completedAt)).length,
    notesAdded: activities.filter((activity) => activity.type === "Note").length,
    leadsTouched: touchedContactIds.size,
    assignmentsReceived: assignments.filter((assignment) => inWindow(assignment.assignedAt)).length,
    firstPassCompleted: assignments.filter((assignment) => inWindow(assignment.firstCallCompletedAt)).length,
    secondPassCompleted: assignments.filter((assignment) => inWindow(assignment.secondCallCompletedAt)).length,
    callingSessions: sessions.length,
    activeCallingSeconds: sessions.reduce((total, session) => total + metric(session.activeDurationSeconds), 0)
  };
}

function reportableSdrMembers(state: AppState, workspaceId?: string) {
  return state.workspaceMembers.filter(
    (member) => member.role === "SDR" && (!workspaceId || member.workspaceId === workspaceId)
  );
}

function reportId(workspaceId: string, sdrUserId: string, reportDate: string): string {
  return `sdr-daily-${workspaceId}-${sdrUserId}-${reportDate}`;
}

function metric(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
}
