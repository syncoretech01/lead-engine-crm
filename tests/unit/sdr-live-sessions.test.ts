import { describe, expect, it } from "vitest";

import {
  LIVE_SESSION_IDLE_AFTER_MS,
  LIVE_SESSION_STALE_AFTER_MS,
  classifyLiveSdrSession,
  countLiveSdrSessions,
  liveSdrSessionsFromState,
  scopeLiveSdrSessions,
  type LiveSdrSessionRow
} from "@/lib/phase1/sdr-live-sessions-read-model";
import type { AppState, Session, SdrCallingSession } from "@/lib/phase1/types";

const NOW = Date.parse("2026-08-24T10:00:00.000Z");

function row(overrides: Partial<LiveSdrSessionRow> = {}): LiveSdrSessionRow {
  return {
    id: "session-1",
    sdrUserId: "user-sdr",
    sdrName: "Zack",
    startedAt: new Date(NOW - 30 * 60_000).toISOString(),
    lastActivityAt: new Date(NOW - 60_000).toISOString(),
    totalCalls: 4,
    connectedCalls: 1,
    voicemailCalls: 2,
    unansweredCalls: 1,
    followUpContacts: 1,
    totalTalkTimeSeconds: 240,
    ...overrides
  };
}

describe("Live SDR calling sessions", () => {
  it("reads a recent wrap-up as on the phones", () => {
    expect(classifyLiveSdrSession(row(), NOW)).toBe("live");
  });

  it("reads a quiet stretch as idle, not gone", () => {
    const quiet = row({ lastActivityAt: new Date(NOW - LIVE_SESSION_IDLE_AFTER_MS - 1000).toISOString() });
    expect(classifyLiveSdrSession(quiet, NOW)).toBe("idle");
  });

  // The abandoned-tab case: the row stays Active forever because only the SDR's
  // "End session" click completes it, so a manager must not read it as live.
  it("reads a session silent for over 90 minutes as never ended", () => {
    const abandoned = row({ lastActivityAt: new Date(NOW - LIVE_SESSION_STALE_AFTER_MS - 1000).toISOString() });
    expect(classifyLiveSdrSession(abandoned, NOW)).toBe("stale");
  });

  it("keeps stale sessions out of the headline count", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", lastActivityAt: new Date(NOW - 20 * 60_000).toISOString() }),
      row({ id: "c", lastActivityAt: new Date(NOW - 5 * 60 * 60_000).toISOString() })
    ];
    expect(countLiveSdrSessions(rows, NOW)).toBe(2);
  });

  it("counts a brand-new session with no wrap-up yet as live", () => {
    const fresh = row({
      startedAt: new Date(NOW - 20_000).toISOString(),
      lastActivityAt: new Date(NOW - 20_000).toISOString(),
      totalCalls: 0
    });
    expect(classifyLiveSdrSession(fresh, NOW)).toBe("live");
  });

  it("falls back to the blob for active sessions, newest activity first", () => {
    const state = {
      users: [
        { id: "user-a", name: "Zack" },
        { id: "user-b", name: "Zainab" }
      ],
      sdrCallingSessions: [
        session({ id: "older", sdrUserId: "user-a", updatedAt: new Date(NOW - 40 * 60_000).toISOString() }),
        session({ id: "newer", sdrUserId: "user-b", updatedAt: new Date(NOW - 60_000).toISOString() }),
        session({ id: "done", sdrUserId: "user-a", status: "Completed" }),
        session({ id: "other-workspace", sdrUserId: "user-a", workspaceId: "workspace-other" })
      ]
    } as unknown as AppState;

    const model = liveSdrSessionsFromState(state, "workspace-acme");
    expect(model.rows.map((item) => item.id)).toEqual(["newer", "older"]);
    expect(model.rows[0].sdrName).toBe("Zainab");
  });

  it("shows an SDR only their own session", () => {
    const model = {
      rows: [row({ id: "mine", sdrUserId: "user-a" }), row({ id: "theirs", sdrUserId: "user-b" })],
      generatedAt: new Date(NOW).toISOString()
    };
    const sdr = { role: "SDR", user: { id: "user-a" } } as unknown as Session;
    const manager = { role: "Manager", user: { id: "user-m" } } as unknown as Session;

    expect(scopeLiveSdrSessions(model, sdr).rows.map((item) => item.id)).toEqual(["mine"]);
    expect(scopeLiveSdrSessions(model, manager).rows).toHaveLength(2);
  });
});

function session(overrides: Partial<SdrCallingSession> & { id: string; sdrUserId: string }): SdrCallingSession {
  return {
    workspaceId: "workspace-acme",
    status: "Active",
    startedAt: new Date(NOW - 60 * 60_000).toISOString(),
    activeDurationSeconds: 0,
    totalCalls: 0,
    connectedCalls: 0,
    voicemailCalls: 0,
    unansweredCalls: 0,
    suppressedContacts: 0,
    followUpContacts: 0,
    totalTalkTimeSeconds: 0,
    completedContactIds: [],
    createdAt: new Date(NOW - 60 * 60_000).toISOString(),
    updatedAt: new Date(NOW - 60 * 60_000).toISOString(),
    ...overrides
  } as SdrCallingSession;
}
