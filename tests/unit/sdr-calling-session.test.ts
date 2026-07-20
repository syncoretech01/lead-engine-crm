import { describe, expect, it } from "vitest";

import {
  completeSdrCallingSession,
  ensureSdrCallingSession,
  recordSdrCallingSessionWrapup
} from "@/lib/phase1/sdr-calling-session";
import { createSeedState } from "@/lib/phase1/seed";
import type { TrackedCall } from "@/lib/phase1/types";

describe("SDR calling session reports", () => {
  it("records wrap-up outcomes once and reconciles final call totals and talk time", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const sdrUserId = state.workspaceMembers.find((member) => member.role === "SDR")!.userId;
    const [first, second] = state.contacts.filter((contact) => contact.workspaceId === workspaceId);
    const startedAt = "2026-07-20T13:00:00.000Z";

    ensureSdrCallingSession(state, { id: "session-test-1", workspaceId, sdrUserId, startedAt, now: startedAt });
    state.trackedCalls.unshift(
      trackedCall({ id: "call-1", workspaceId, sdrUserId, contactId: first.id, companyId: first.companyId, createdAt: "2026-07-20T13:01:00.000Z", callStatus: "Connected", durationSeconds: 125 }),
      trackedCall({ id: "call-2", workspaceId, sdrUserId, contactId: second.id, companyId: second.companyId, createdAt: "2026-07-20T13:04:00.000Z", callStatus: "No answer", durationSeconds: 0 })
    );

    recordSdrCallingSessionWrapup(state, {
      id: "session-test-1",
      workspaceId,
      sdrUserId,
      startedAt,
      now: "2026-07-20T13:03:30.000Z",
      summary: { contactId: first.id, outcome: "Do not contact", connected: true, followUp: true, suppressed: true, talkTimeSeconds: 125 }
    });
    // A repeated save for the same contact is idempotent.
    recordSdrCallingSessionWrapup(state, {
      id: "session-test-1",
      workspaceId,
      sdrUserId,
      startedAt,
      now: "2026-07-20T13:03:31.000Z",
      summary: { contactId: first.id, outcome: "Do not contact", connected: true, followUp: true, suppressed: true, talkTimeSeconds: 125 }
    });
    recordSdrCallingSessionWrapup(state, {
      id: "session-test-1",
      workspaceId,
      sdrUserId,
      startedAt,
      now: "2026-07-20T13:05:00.000Z",
      summary: { contactId: second.id, outcome: "Voicemail", connected: false, followUp: false, suppressed: false, talkTimeSeconds: 0 }
    });

    const report = completeSdrCallingSession(state, {
      id: "session-test-1",
      workspaceId,
      sdrUserId,
      startedAt,
      endedAt: "2026-07-20T13:10:00.000Z",
      activeDurationSeconds: 540
    });

    expect(report).toMatchObject({
      status: "Completed",
      totalCalls: 2,
      connectedCalls: 1,
      voicemailCalls: 1,
      unansweredCalls: 0,
      suppressedContacts: 1,
      followUpContacts: 1,
      totalTalkTimeSeconds: 125,
      activeDurationSeconds: 540
    });
    expect(report.completedContactIds).toHaveLength(2);
    expect(state.trackedCalls.find((call) => call.id === "call-2")?.callStatus).toBe("Voicemail");
  });

  it("keeps an already completed report stable when End is retried", () => {
    const state = createSeedState();
    const workspaceId = state.workspaces[0].id;
    const sdrUserId = state.workspaceMembers.find((member) => member.role === "SDR")!.userId;
    const report = completeSdrCallingSession(state, {
      id: "session-test-2",
      workspaceId,
      sdrUserId,
      startedAt: "2026-07-20T14:00:00.000Z",
      endedAt: "2026-07-20T14:15:00.000Z",
      activeDurationSeconds: 900
    });
    const retry = completeSdrCallingSession(state, {
      id: "session-test-2",
      workspaceId,
      sdrUserId,
      startedAt: "2026-07-20T14:00:00.000Z",
      endedAt: "2026-07-20T15:00:00.000Z",
      activeDurationSeconds: 3600
    });

    expect(retry).toBe(report);
    expect(retry.endedAt).toBe("2026-07-20T14:15:00.000Z");
    expect(state.sdrCallingSessions).toHaveLength(1);
  });
});

function trackedCall(input: {
  id: string;
  workspaceId: string;
  sdrUserId: string;
  contactId: string;
  companyId: string;
  createdAt: string;
  callStatus: TrackedCall["callStatus"];
  durationSeconds: number;
}): TrackedCall {
  return {
    ...input,
    phoneNumber: "+15555550100",
    direction: "Outbound",
    disposition: "No answer",
    recordingConsent: "Not recorded"
  };
}
