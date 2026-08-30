import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { DIRECTORY_FETCH_LIMIT } from "@/lib/phase1/directory-bounds";
import {
  mapSdrAssignmentRow,
  sdrAssignmentRowSelect,
  type SdrQueueAssignmentReadRow
} from "@/lib/phase1/sdr-queue-read-model";
import type { Session } from "@/lib/phase1/types";
import {
  buildSdrDailyCallPlan,
  isCurrentCallCycleAssignment,
  type SdrDailyCallPlan
} from "@/lib/phase1/sdr-call-cycle";

export type AssignedContactsReadModel = {
  rows: SdrQueueAssignmentReadRow[];
  dailyCallPlan?: Omit<SdrDailyCallPlan<SdrQueueAssignmentReadRow>, "assignments">;
  /**
   * The fetch hit its bound, so `rows` is a prefix of the book — a silently
   * short book is how an SDR's older assignments went missing before. Rendered
   * as a notice in the /sdr/focus queue rail; the flag itself is asserted in
   * tests/unit/assigned-contacts-truncation.test.ts. The RENDERING has no
   * automated coverage — reproducing it needs 5,000 seeded assignments.
   *
   * Computed BEFORE the daily-call-plan filter, so it reports whether the
   * database fetch was capped, not how many rows survived the filter.
   */
  truncated: boolean;
  /** SDR/Manager roster for the owner filter (empty for an SDR's own view). */
  roster: Array<{ id: string; name: string }>;
};

// The shared bound (see lib/phase1/directory-bounds.ts). Re-exported under the
// name callers already use.
export const ASSIGNED_CONTACTS_FETCH_LIMIT = DIRECTORY_FETCH_LIMIT;

// Prisma-only fast path for the "my assigned contacts" directory: the current
// SDR's assignments (or, for a Manager/Admin, all — optionally narrowed to one
// SDR via opts.sdrId), ordered newest-assigned first. Returns undefined on the
// file-store driver so the page falls back to assignedContactsSnapshot.
export async function readAssignedContactsModel(
  session: Session,
  workspaceId: string,
  opts?: { sdrId?: string; callPlan?: boolean }
): Promise<AssignedContactsReadModel | undefined> {
  if (resolveStorageDriver() !== "prisma") {
    return undefined;
  }

  const { prisma } = await import("@/lib/prisma");
  const isSdr = session.role === "SDR";
  // SDRs are always locked to their own id; any ?sdr= param is ignored for them.
  const ownerId = isSdr ? session.user.id : opts?.sdrId;

  const today = utcDayBounds();
  const [assignments, members, completedCallsToday] = await Promise.all([
    prisma.sdrAssignment.findMany({
      where: {
        workspaceId,
        ...(opts?.callPlan ? { callCycleCompletedAt: null } : {}),
        ...(ownerId ? { assignedSdrId: ownerId } : {})
      },
      select: sdrAssignmentRowSelect,
      orderBy: [{ assignedAt: "desc" }, { id: "asc" }],
      // Fetch the full assigned book so no SDR's older assignments fall past the cap
      // in the unfiltered manager view (a 692-broker import once buried an SDR's 136
      // earlier assignments below a take:500 — the "Sam's leads invisible" bug). The
      // cockpit view paginates client-side. True server-side pagination (P1.11) is the
      // eventual fix once a workspace exceeds this bound.
      //
      // One past the bound, so `truncated` below is a fact and not an inference
      // from a book that happens to be exactly the limit.
      take: ASSIGNED_CONTACTS_FETCH_LIMIT + 1
    }),
    isSdr
      ? Promise.resolve([])
      : prisma.workspaceMember.findMany({
          where: { workspaceId, role: { in: ["SDR", "MANAGER"] } },
          include: { user: true },
          orderBy: [{ role: "asc" }, { id: "asc" }]
        }),
    opts?.callPlan && ownerId
      ? prisma.trackedCall.count({
          where: {
            workspaceId,
            sdrUserId: ownerId,
            direction: "Outbound",
            createdAt: { gte: today.start, lt: today.end }
          }
        })
      : Promise.resolve(0)
  ]);

  // One clock for the whole read so every row agrees (and so .map does not hand
  // the mapper an array index as its "now").
  const nowIso = new Date().toISOString();
  const truncated = assignments.length > ASSIGNED_CONTACTS_FETCH_LIMIT;
  const allRows = (truncated ? assignments.slice(0, ASSIGNED_CONTACTS_FETCH_LIMIT) : assignments).map(
    (assignment) => mapSdrAssignmentRow(assignment, nowIso)
  );
  const callPlan = opts?.callPlan && ownerId
    ? buildSdrDailyCallPlan(allRows, ownerId, completedCallsToday)
    : undefined;
  const rows = callPlan?.assignments ?? (
    opts?.callPlan ? allRows.filter(isCurrentCallCycleAssignment) : allRows
  );

  return {
    rows,
    truncated,
    roster: members.map((member) => ({ id: member.user.id, name: member.user.name })),
    dailyCallPlan: callPlan
      ? {
          target: callPlan.target,
          completedToday: callPlan.completedToday,
          remainingToday: callPlan.remainingToday,
          pass: callPlan.pass,
          activeBatchSize: callPlan.activeBatchSize,
          batchRemaining: callPlan.batchRemaining
        }
      : undefined
  };
}

function utcDayBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
