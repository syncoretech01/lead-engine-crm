import type { AppState, SdrCallingSession, TrackedCall } from "@/lib/phase1/types";

export type SdrSessionWrapupSummary = {
  contactId: string;
  outcome: string;
  connected: boolean;
  followUp: boolean;
  suppressed: boolean;
  talkTimeSeconds: number;
};

export function ensureSdrCallingSession(
  state: AppState,
  input: { id: string; workspaceId: string; sdrUserId: string; startedAt: string; now?: string }
): SdrCallingSession {
  const existing = state.sdrCallingSessions.find(
    (item) => item.id === input.id && item.workspaceId === input.workspaceId
  );
  if (existing) {
    if (existing.sdrUserId !== input.sdrUserId) throw new Error("Calling session belongs to another SDR.");
    return existing;
  }

  const startedAt = validIso(input.startedAt, "Session start time is invalid.");
  const now = validIso(input.now ?? new Date().toISOString(), "Session timestamp is invalid.");
  const report: SdrCallingSession = {
    id: input.id,
    workspaceId: input.workspaceId,
    sdrUserId: input.sdrUserId,
    status: "Active",
    startedAt,
    activeDurationSeconds: 0,
    totalCalls: 0,
    connectedCalls: 0,
    voicemailCalls: 0,
    unansweredCalls: 0,
    suppressedContacts: 0,
    followUpContacts: 0,
    totalTalkTimeSeconds: 0,
    completedContactIds: [],
    createdAt: now,
    updatedAt: now
  };
  state.sdrCallingSessions.unshift(report);
  return report;
}

export function recordSdrCallingSessionWrapup(
  state: AppState,
  input: {
    id: string;
    workspaceId: string;
    sdrUserId: string;
    startedAt: string;
    summary: SdrSessionWrapupSummary;
    now?: string;
  }
): SdrCallingSession {
  const now = input.now ?? new Date().toISOString();
  const report = ensureSdrCallingSession(state, { ...input, now });
  if (report.status === "Completed" || report.completedContactIds.includes(input.summary.contactId)) return report;

  report.completedContactIds.push(input.summary.contactId);
  report.totalCalls += 1;
  report.connectedCalls += input.summary.connected ? 1 : 0;
  report.voicemailCalls += input.summary.outcome === "Voicemail" ? 1 : 0;
  report.unansweredCalls += unansweredOutcome(input.summary.outcome) ? 1 : 0;
  report.suppressedContacts += input.summary.suppressed ? 1 : 0;
  report.followUpContacts += input.summary.followUp ? 1 : 0;
  report.totalTalkTimeSeconds += nonNegativeInteger(input.summary.talkTimeSeconds);
  report.updatedAt = now;

  const trackedCall = latestSessionCall(state, report, input.summary.contactId, now);
  if (trackedCall) applyWrapupOutcomeToTrackedCall(trackedCall, input.summary);
  return report;
}

export function completeSdrCallingSession(
  state: AppState,
  input: {
    id: string;
    workspaceId: string;
    sdrUserId: string;
    startedAt: string;
    activeDurationSeconds: number;
    endedAt?: string;
  }
): SdrCallingSession {
  const endedAt = validIso(input.endedAt ?? new Date().toISOString(), "Session end time is invalid.");
  const report = ensureSdrCallingSession(state, { ...input, now: endedAt });
  if (report.status === "Completed") return report;

  const calls = callsDuringSession(state, report, endedAt);
  if (calls.length) {
    report.totalCalls = Math.max(report.totalCalls, calls.length);
    report.connectedCalls = Math.max(
      report.connectedCalls,
      calls.filter((call) => call.callStatus === "Connected").length
    );
    report.voicemailCalls = Math.max(
      report.voicemailCalls,
      calls.filter((call) => call.callStatus === "Voicemail").length
    );
    report.unansweredCalls = Math.max(
      report.unansweredCalls,
      calls.filter((call) => ["No answer", "Busy", "Failed"].includes(call.callStatus)).length
    );
    report.totalTalkTimeSeconds = Math.max(
      report.totalTalkTimeSeconds,
      calls.reduce((total, call) => total + nonNegativeInteger(call.durationSeconds), 0)
    );
  }

  const wallSeconds = Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(report.startedAt)) / 1000));
  report.activeDurationSeconds = Math.min(nonNegativeInteger(input.activeDurationSeconds), wallSeconds);
  report.endedAt = endedAt;
  report.status = "Completed";
  report.updatedAt = endedAt;
  return report;
}

function callsDuringSession(state: AppState, report: SdrCallingSession, endedAt: string): TrackedCall[] {
  // RingOut writes its placeholder immediately before the client observes the
  // connecting state and starts the UI session. A small grace window keeps that
  // first call in the report without pulling in an earlier completed call.
  const lowerBound = Date.parse(report.startedAt) - 30_000;
  const upperBound = Date.parse(endedAt) + 1_000;
  return state.trackedCalls.filter((call) => {
    const createdAt = Date.parse(call.createdAt);
    return (
      call.workspaceId === report.workspaceId &&
      call.sdrUserId === report.sdrUserId &&
      call.direction === "Outbound" &&
      Number.isFinite(createdAt) &&
      createdAt >= lowerBound &&
      createdAt <= upperBound
    );
  });
}

function latestSessionCall(
  state: AppState,
  report: SdrCallingSession,
  contactId: string,
  now: string
): TrackedCall | undefined {
  const lowerBound = Date.parse(report.startedAt) - 30_000;
  const upperBound = Date.parse(now) + 1_000;
  return state.trackedCalls
    .filter((call) => {
      const createdAt = Date.parse(call.createdAt);
      return (
        call.workspaceId === report.workspaceId &&
        call.sdrUserId === report.sdrUserId &&
        call.contactId === contactId &&
        call.direction === "Outbound" &&
        Number.isFinite(createdAt) &&
        createdAt >= lowerBound &&
        createdAt <= upperBound
      );
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

function applyWrapupOutcomeToTrackedCall(call: TrackedCall, summary: SdrSessionWrapupSummary) {
  if (summary.outcome === "Voicemail") {
    call.callStatus = "Voicemail";
    call.disposition = "Left voicemail";
  } else if (summary.outcome === "No answer") {
    call.callStatus = "No answer";
    call.disposition = "No answer";
  } else if (summary.outcome === "Busy") {
    call.callStatus = "Busy";
    call.disposition = "No answer";
  } else if (summary.outcome === "Wrong number") {
    call.callStatus = "Failed";
    call.disposition = "Bad number";
  } else if (summary.outcome === "Hang Up") {
    call.callStatus = summary.connected ? "Connected" : "No answer";
    call.disposition = "Hung up";
  } else if (summary.connected) {
    call.callStatus = "Connected";
    if (summary.outcome === "Meeting booked") call.disposition = "Meeting booked";
    else if (summary.outcome === "Not interested") call.disposition = "Not interested";
    else if (call.disposition === "No answer") call.disposition = "Interested";
  }
}

function unansweredOutcome(outcome: string): boolean {
  return outcome === "No answer" || outcome === "Busy" || outcome === "Wrong number";
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function validIso(value: string, message: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(message);
  return new Date(timestamp).toISOString();
}
