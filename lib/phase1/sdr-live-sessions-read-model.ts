import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type { AppState, Session } from "@/lib/phase1/types";

/**
 * "Live now" for the manager dashboard.
 *
 * The SDR calling session is a client-side concept (localStorage) mirrored to
 * `SdrCallingSession`: the row is created `Active` the moment Focus opens a
 * session, and only flips to `Completed` when the SDR clicks "End session". A
 * closed laptop therefore leaves an `Active` row behind forever, so "Active" on
 * its own is not the same thing as "live" — freshness has to be classified from
 * the row's last activity, which is what `classifyLiveSdrSession` does.
 */
export type LiveSdrSessionRow = {
  id: string;
  sdrUserId: string;
  sdrName: string;
  startedAt: string;
  /** Last server-recorded activity: the most recent wrap-up, else the start. */
  lastActivityAt: string;
  totalCalls: number;
  connectedCalls: number;
  voicemailCalls: number;
  unansweredCalls: number;
  followUpContacts: number;
  totalTalkTimeSeconds: number;
};

export type LiveSdrSessionsModel = {
  rows: LiveSdrSessionRow[];
  /** Server clock when the rows were read, so relative labels have an anchor. */
  generatedAt: string;
};

export type LiveSdrSessionState = "live" | "idle" | "stale";

/** No wrap-up for this long and the session is quiet rather than working. */
export const LIVE_SESSION_IDLE_AFTER_MS = 15 * 60 * 1000;
/** Quiet for this long and it is almost certainly a session nobody ended. */
export const LIVE_SESSION_STALE_AFTER_MS = 90 * 60 * 1000;

/**
 * How much to trust an `Active` row, given how long it has been silent.
 *
 * `idle` is a real state, not a bug: a rep on a twenty-minute discovery call
 * logs nothing until they wrap up. `stale` is the abandoned-tab case and is
 * deliberately kept out of the live count.
 */
export function classifyLiveSdrSession(row: LiveSdrSessionRow, nowMs: number): LiveSdrSessionState {
  const lastActivity = Date.parse(row.lastActivityAt);
  const since = nowMs - (Number.isFinite(lastActivity) ? lastActivity : nowMs);
  if (since >= LIVE_SESSION_STALE_AFTER_MS) return "stale";
  if (since >= LIVE_SESSION_IDLE_AFTER_MS) return "idle";
  return "live";
}

/** Sessions a manager should read as genuinely on the phones right now. */
export function countLiveSdrSessions(rows: LiveSdrSessionRow[], nowMs: number): number {
  return rows.filter((row) => classifyLiveSdrSession(row, nowMs) !== "stale").length;
}

function lastActivityAt(startedAt: string, updatedAt: string): string {
  const started = Date.parse(startedAt);
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(updated)) return startedAt;
  if (!Number.isFinite(started)) return updatedAt;
  return updated > started ? updatedAt : startedAt;
}

function sortRows(rows: LiveSdrSessionRow[]): LiveSdrSessionRow[] {
  return rows.sort(
    (a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) || a.sdrName.localeCompare(b.sdrName)
  );
}

export async function readFastLiveSdrSessions(
  workspaceId: string
): Promise<LiveSdrSessionsModel | undefined> {
  if (resolveStorageDriver() !== "prisma") return undefined;

  const { prisma } = await import("@/lib/prisma");
  // Indexed by [workspaceId, status, startedAt] — cheap enough to poll.
  const sessions = await prisma.sdrCallingSession.findMany({
    where: { workspaceId, status: "Active" },
    orderBy: [{ startedAt: "desc" }],
    include: { sdr: { select: { name: true } } }
  });

  return {
    rows: sortRows(
      sessions.map((item) => ({
        id: item.id,
        sdrUserId: item.sdrUserId,
        sdrName: item.sdr.name,
        startedAt: item.startedAt.toISOString(),
        lastActivityAt: lastActivityAt(item.startedAt.toISOString(), item.updatedAt.toISOString()),
        totalCalls: item.totalCalls,
        connectedCalls: item.connectedCalls,
        voicemailCalls: item.voicemailCalls,
        unansweredCalls: item.unansweredCalls,
        followUpContacts: item.followUpContacts,
        totalTalkTimeSeconds: item.totalTalkTimeSeconds
      }))
    ),
    generatedAt: new Date().toISOString()
  };
}

export function liveSdrSessionsFromState(state: AppState, workspaceId: string): LiveSdrSessionsModel {
  const userNames = new Map(state.users.map((user) => [user.id, user.name]));
  return {
    rows: sortRows(
      state.sdrCallingSessions
        .filter((item) => item.workspaceId === workspaceId && item.status === "Active")
        .map((item) => ({
          id: item.id,
          sdrUserId: item.sdrUserId,
          sdrName: userNames.get(item.sdrUserId) ?? "Unknown SDR",
          startedAt: item.startedAt,
          lastActivityAt: lastActivityAt(item.startedAt, item.updatedAt),
          totalCalls: item.totalCalls,
          connectedCalls: item.connectedCalls,
          voicemailCalls: item.voicemailCalls,
          unansweredCalls: item.unansweredCalls,
          followUpContacts: item.followUpContacts,
          totalTalkTimeSeconds: item.totalTalkTimeSeconds
        }))
    ),
    generatedAt: new Date().toISOString()
  };
}

/** Managers see the whole team; an SDR only ever sees their own session. */
export function scopeLiveSdrSessions(model: LiveSdrSessionsModel, session: Session): LiveSdrSessionsModel {
  if (session.role !== "SDR") return model;
  return { ...model, rows: model.rows.filter((row) => row.sdrUserId === session.user.id) };
}
