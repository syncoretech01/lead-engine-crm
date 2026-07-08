import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { displayContactName } from "@/lib/phase1/lead-data-quality";
import type { Session } from "@/lib/phase1/types";

// Flat, already-serializable call row read straight from Prisma — avoids loading
// the whole AppState blob (readState) just to render the call log. Mirrors the
// fast read-model pattern used by the other CRM list pages.
export type CallReadRow = {
  id: string;
  contactId: string;
  contactName: string;
  phoneNumber: string;
  durationSeconds: number;
  callStatus: string;
  disposition: string;
  sdrUserId: string;
  sdrName: string;
  recordingId?: string;
  recordingConsent: string;
  createdAt: string;
};

export type CallsReadModel = {
  calls: CallReadRow[];
  roster: Array<{ id: string; name: string }>;
  connected: number;
  recordings: number;
};

const MAX_CALLS = 200;

export async function readFastCallsModel(
  session: Session,
  workspaceId: string,
  options: { sdrId?: string } = {}
): Promise<CallsReadModel | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const isSdr = session.role === "SDR";
  // SDRs only ever see their own calls; managers/admins can filter by one SDR.
  const sdrFilter = isSdr ? session.user.id : options.sdrId || undefined;

  const calls = await prisma.trackedCall.findMany({
    where: { workspaceId, ...(sdrFilter ? { sdrUserId: sdrFilter } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: MAX_CALLS,
    select: {
      id: true,
      contactId: true,
      phoneNumber: true,
      durationSeconds: true,
      callStatus: true,
      disposition: true,
      sdrUserId: true,
      recordingId: true,
      recordingConsent: true,
      createdAt: true
    }
  });

  const contactIds = [...new Set(calls.map((call) => call.contactId).filter((id): id is string => Boolean(id)))];
  const userIds = [...new Set(calls.map((call) => call.sdrUserId).filter((id): id is string => Boolean(id)))];

  const [contacts, users, roster] = await Promise.all([
    contactIds.length
      ? prisma.contact.findMany({ where: { workspaceId, id: { in: contactIds } }, select: { id: true, fullName: true, email: true } })
      : Promise.resolve([]),
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    isSdr
      ? Promise.resolve([])
      : prisma.workspaceMember.findMany({ where: { workspaceId, role: "SDR" }, select: { user: { select: { id: true, name: true } } } })
  ]);

  const contactName = new Map(contacts.map((c) => [c.id, displayContactName({ name: c.fullName, email: c.email ?? "" })]));
  const userName = new Map(users.map((u) => [u.id, u.name]));

  let connected = 0;
  let recordings = 0;
  const rows: CallReadRow[] = calls.map((call) => {
    if (call.callStatus === "Connected") connected += 1;
    if (call.recordingId) recordings += 1;
    return {
      id: call.id,
      contactId: call.contactId ?? "",
      contactName: call.contactId ? contactName.get(call.contactId) ?? "Unknown contact" : "Unknown contact",
      phoneNumber: call.phoneNumber || "",
      durationSeconds: call.durationSeconds ?? 0,
      callStatus: call.callStatus,
      disposition: call.disposition,
      sdrUserId: call.sdrUserId ?? "",
      sdrName: call.sdrUserId ? userName.get(call.sdrUserId) ?? "—" : "—",
      recordingId: call.recordingId ?? undefined,
      recordingConsent: call.recordingConsent,
      createdAt: call.createdAt.toISOString()
    };
  });

  return {
    calls: rows,
    roster: roster.map((entry) => ({ id: entry.user.id, name: entry.user.name })),
    connected,
    recordings
  };
}
