import { describe, expect, it } from "vitest";

import { createNormalizedPersistenceProjection } from "@/lib/phase1/persistence-projection";
import { createSeedState } from "@/lib/phase1/seed";
import type { AppState } from "@/lib/phase1/types";

/**
 * Removing a workspace member deletes the User row but leaves their id behind on
 * event rows in the blob. Every FK to User must be guarded — nullable columns go
 * undefined, required ones drop the row (the database cascade already deleted it).
 * Unguarded, a full-mode projection sync threw P2003 mid-transaction and failed
 * the whole write; in diff mode it failed silently instead.
 */
function stateWithDepartedUserRefs(): { state: AppState; departedId: string; liveId: string } {
  const state = createSeedState();
  const departedId = "user-departed-sdr";
  const now = new Date().toISOString();
  const workspaceId = state.workspaces[0].id;
  const contact = state.contacts[0];

  state.trackedCalls.unshift({
    id: "call-departed",
    workspaceId,
    contactId: contact.id,
    companyId: contact.companyId,
    sdrUserId: departedId,
    phoneNumber: "+1 555 000 0000",
    direction: "Outbound",
    callStatus: "Connected",
    disposition: "Interested",
    durationSeconds: 60,
    recordingConsent: "Granted",
    createdAt: now
  } as unknown as AppState["trackedCalls"][number]);

  state.auditLogs.unshift({
    id: "audit-departed",
    workspaceId,
    actorUserId: departedId,
    objectType: "tracked_call",
    objectId: "call-departed",
    action: "created",
    createdAt: now
  } as unknown as AppState["auditLogs"][number]);

  state.sdrCallingSessions.unshift({
    id: "session-departed",
    workspaceId,
    sdrUserId: departedId,
    status: "Completed",
    startedAt: now,
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
  } as unknown as AppState["sdrCallingSessions"][number]);

  state.sdrDailyReports.unshift({
    id: "report-departed",
    workspaceId,
    sdrUserId: departedId,
    reportDate: "2026-08-28",
    periodStart: now,
    periodEnd: now,
    timezone: "Asia/Karachi",
    createdAt: now,
    updatedAt: now
  } as unknown as AppState["sdrDailyReports"][number]);

  // Live-user twins of each row: without these the "untouched" assertions below
  // would pass vacuously against empty arrays (the seed ships none of these).
  const liveId = state.users[0].id;
  state.trackedCalls.unshift({
    ...state.trackedCalls[0],
    id: "call-live",
    sdrUserId: liveId
  } as unknown as AppState["trackedCalls"][number]);
  state.sdrCallingSessions.unshift({
    ...state.sdrCallingSessions[0],
    id: "session-live",
    sdrUserId: liveId
  } as unknown as AppState["sdrCallingSessions"][number]);
  state.sdrDailyReports.unshift({
    ...state.sdrDailyReports[0],
    id: "report-live",
    sdrUserId: liveId
  } as unknown as AppState["sdrDailyReports"][number]);

  // The other four User FKs the sweep guards, so reverting any one of them fails.
  state.leadJobs.unshift({
    ...state.leadJobs[0],
    id: "job-departed",
    createdById: departedId
  } as unknown as AppState["leadJobs"][number]);
  state.outreachCampaigns.unshift({
    ...state.outreachCampaigns[0],
    id: "campaign-departed",
    ownerUserId: departedId
  } as unknown as AppState["outreachCampaigns"][number]);
  state.campaignSequences.unshift({
    ...state.campaignSequences[0],
    id: "sequence-departed",
    createdById: departedId
  } as unknown as AppState["campaignSequences"][number]);
  state.dataSubjectRequests.unshift({
    ...state.dataSubjectRequests[0],
    id: "dsr-departed",
    handledById: departedId
  } as unknown as AppState["dataSubjectRequests"][number]);

  return { state, departedId, liveId };
}

describe("projection guards references to a removed user", () => {
  it("nulls the nullable FKs instead of pointing at a user that no longer exists", () => {
    const { state } = stateWithDepartedUserRefs();
    const projection = createNormalizedPersistenceProjection(state);

    // Each row must still BE in the projection with only its dangling FK cleared —
    // asserting on find(...)?.field alone would pass just as well if the row had
    // vanished, which is the opposite of what these guards should do.
    const cleared = [
      [projection.trackedCalls, "call-departed", "sdrUserId"],
      [projection.auditLogs, "audit-departed", "actorUserId"],
      [projection.leadJobs, "job-departed", "createdById"],
      [projection.outreachCampaigns, "campaign-departed", "ownerUserId"],
      [projection.campaignSequences, "sequence-departed", "createdById"],
      [projection.dataSubjectRequests, "dsr-departed", "handledById"]
    ] as const;

    for (const [rows, id, field] of cleared) {
      const row = (rows as ReadonlyArray<Record<string, unknown>>).find((item) => item.id === id);
      expect(row, id + " should still be projected").toBeDefined();
      expect(row?.[field], id + "." + field + " should be cleared").toBeUndefined();
    }
  });

  it("drops rows whose user FK is required and can no longer resolve", () => {
    const { state } = stateWithDepartedUserRefs();
    const projection = createNormalizedPersistenceProjection(state);

    expect(projection.sdrCallingSessions.some((row) => row.id === "session-departed")).toBe(false);
    expect(projection.sdrDailyReports.some((row) => row.id === "report-departed")).toBe(false);
  });

  it("leaves rows belonging to existing users untouched", () => {
    const { state, liveId } = stateWithDepartedUserRefs();
    const projection = createNormalizedPersistenceProjection(state);

    // The guard must be surgical: same tables, same shapes, only the dangling
    // references are affected.
    expect(projection.trackedCalls.find((row) => row.id === "call-live")?.sdrUserId).toBe(liveId);
    expect(projection.sdrCallingSessions.find((row) => row.id === "session-live")?.sdrUserId).toBe(liveId);
    expect(projection.sdrDailyReports.find((row) => row.id === "report-live")?.sdrUserId).toBe(liveId);
    expect(projection.sdrCallingSessions).toHaveLength(1);
    expect(projection.sdrDailyReports).toHaveLength(1);
  });
});
