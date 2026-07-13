import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import {
  mapSdrAssignmentRow,
  sdrAssignmentRowInclude,
  type SdrQueueAssignmentReadRow
} from "@/lib/phase1/sdr-queue-read-model";
import type { Session } from "@/lib/phase1/types";

export type AssignedContactsReadModel = {
  rows: SdrQueueAssignmentReadRow[];
  /** SDR/Manager roster for the owner filter (empty for an SDR's own view). */
  roster: Array<{ id: string; name: string }>;
};

// Prisma-only fast path for the "my assigned contacts" directory: the current
// SDR's assignments (or, for a Manager/Admin, all — optionally narrowed to one
// SDR via opts.sdrId), ordered newest-assigned first. Returns undefined on the
// file-store driver so the page falls back to assignedContactsSnapshot.
export async function readAssignedContactsModel(
  session: Session,
  workspaceId: string,
  opts?: { sdrId?: string }
): Promise<AssignedContactsReadModel | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const isSdr = session.role === "SDR";
  // SDRs are always locked to their own id; any ?sdr= param is ignored for them.
  const ownerId = isSdr ? session.user.id : opts?.sdrId;

  const [assignments, members] = await Promise.all([
    prisma.sdrAssignment.findMany({
      where: {
        workspaceId,
        ...(ownerId ? { assignedSdrId: ownerId } : {})
      },
      include: sdrAssignmentRowInclude,
      orderBy: [{ assignedAt: "desc" }, { id: "asc" }],
      // Fetch the full assigned book so no SDR's older assignments fall past the cap
      // in the unfiltered manager view (a 692-broker import once buried an SDR's 136
      // earlier assignments below a take:500 — the "Sam's leads invisible" bug). The
      // cockpit view paginates client-side. True server-side pagination (P1.11) is the
      // eventual fix once a workspace exceeds this bound.
      take: 2000
    }),
    isSdr
      ? Promise.resolve([])
      : prisma.workspaceMember.findMany({
          where: { workspaceId, role: { in: ["SDR", "MANAGER"] } },
          include: { user: true },
          orderBy: [{ role: "asc" }, { id: "asc" }]
        })
  ]);

  return {
    rows: assignments.map(mapSdrAssignmentRow),
    roster: members.map((member) => ({ id: member.user.id, name: member.user.name }))
  };
}
