import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import type { AppState, SdrCallingSession, Session } from "@/lib/phase1/types";

export type SdrSessionHistoryRow = Omit<SdrCallingSession, "completedContactIds"> & {
  sdrName: string;
};

export type SdrSessionHistoryModel = {
  rows: SdrSessionHistoryRow[];
  roster: Array<{ id: string; name: string }>;
};

const MAX_SESSIONS = 100;

export async function readFastSdrSessionHistory(
  session: Session,
  workspaceId: string,
  options: { sdrId?: string } = {}
): Promise<SdrSessionHistoryModel | undefined> {
  if (resolveStorageDriver() !== "prisma") return undefined;

  const { prisma } = await import("@/lib/prisma");
  const sdrFilter = session.role === "SDR" ? session.user.id : options.sdrId || undefined;
  const [sessions, members] = await Promise.all([
    prisma.sdrCallingSession.findMany({
      where: { workspaceId, status: "Completed", ...(sdrFilter ? { sdrUserId: sdrFilter } : {}) },
      orderBy: [{ endedAt: "desc" }, { id: "asc" }],
      take: MAX_SESSIONS,
      include: { sdr: { select: { name: true } } }
    }),
    session.role === "SDR"
      ? Promise.resolve([])
      : prisma.workspaceMember.findMany({
          where: { workspaceId, role: "SDR" },
          select: { user: { select: { id: true, name: true } } },
          orderBy: { user: { name: "asc" } }
        })
  ]);

  return {
    rows: sessions.map((item) => ({
      id: item.id,
      workspaceId: item.workspaceId,
      sdrUserId: item.sdrUserId,
      sdrName: item.sdr.name,
      status: item.status === "Completed" ? "Completed" : "Active",
      startedAt: item.startedAt.toISOString(),
      endedAt: item.endedAt?.toISOString(),
      activeDurationSeconds: item.activeDurationSeconds,
      totalCalls: item.totalCalls,
      connectedCalls: item.connectedCalls,
      voicemailCalls: item.voicemailCalls,
      unansweredCalls: item.unansweredCalls,
      suppressedContacts: item.suppressedContacts,
      followUpContacts: item.followUpContacts,
      totalTalkTimeSeconds: item.totalTalkTimeSeconds,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    })),
    roster: members.map((item) => ({ id: item.user.id, name: item.user.name }))
  };
}

export function sdrSessionHistoryFromState(
  state: AppState,
  session: Session,
  workspaceId: string,
  options: { sdrId?: string } = {}
): SdrSessionHistoryModel {
  const sdrFilter = session.role === "SDR" ? session.user.id : options.sdrId || undefined;
  const userNames = new Map(state.users.map((user) => [user.id, user.name]));
  const rows = state.sdrCallingSessions
    .filter(
      (item) =>
        item.workspaceId === workspaceId &&
        item.status === "Completed" &&
        (!sdrFilter || item.sdrUserId === sdrFilter)
    )
    .sort((a, b) => Date.parse(b.endedAt ?? b.updatedAt) - Date.parse(a.endedAt ?? a.updatedAt))
    .slice(0, MAX_SESSIONS)
    .map(({ completedContactIds: _completedContactIds, ...item }) => ({
      ...item,
      sdrName: userNames.get(item.sdrUserId) ?? "Unknown SDR"
    }));

  const roster = session.role === "SDR"
    ? []
    : state.workspaceMembers
        .filter((member) => member.workspaceId === workspaceId && member.role === "SDR")
        .map((member) => ({ id: member.userId, name: userNames.get(member.userId) ?? "Unknown SDR" }))
        .sort((a, b) => a.name.localeCompare(b.name));
  return { rows, roster };
}
