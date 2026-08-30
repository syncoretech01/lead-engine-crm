import { beforeEach, describe, expect, it, vi } from "vitest";

import { readFastSdrQueueModel, SDR_QUEUE_FETCH_LIMIT } from "@/lib/phase1/sdr-queue-read-model";
import type { Session } from "@/lib/phase1/types";

const prismaMocks = vi.hoisted(() => ({
  sdrAssignmentFindMany: vi.fn(),
  followUpReminderFindMany: vi.fn(),
  workspaceMemberFindMany: vi.fn(),
  trackedCallCount: vi.fn(),
  activityFindMany: vi.fn()
}));

vi.mock("@/lib/phase1/storage-driver", () => ({
  resolveStorageDriver: () => "prisma"
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sdrAssignment: { findMany: prismaMocks.sdrAssignmentFindMany },
    followUpReminder: { findMany: prismaMocks.followUpReminderFindMany },
    workspaceMember: { findMany: prismaMocks.workspaceMemberFindMany },
    trackedCall: { count: prismaMocks.trackedCallCount },
    activity: { findMany: prismaMocks.activityFindMany }
  }
}));

// A manager: the unfiltered read, which is the one that can reach the bound.
const session = {
  role: "MANAGER",
  user: { id: "manager-1", name: "Sam" },
  permissions: ["manage_sdr", "view_all_records"]
} as unknown as Session;

const sdrSession = {
  role: "SDR",
  user: { id: "sdr-1", name: "Zack" },
  permissions: ["manage_sdr"]
} as unknown as Session;

/**
 * Rows shaped for the real mapper (not stubbed here, unlike the assigned-contacts
 * test): the point is partly that the probe row is dropped before mapping.
 */
function assignments(count: number) {
  const date = new Date("2026-08-01T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => ({
    id: `assignment-${index}`,
    workspaceId: "ws-1",
    accountId: `account-${index}`,
    contactId: `contact-${index}`,
    assignedSdrId: "sdr-1",
    assignedTeamId: null,
    assignedById: null,
    assignmentMethod: "auto",
    assignmentReason: "round robin",
    assignedAt: date,
    firstTouchDueAt: null,
    followUpDueAt: null,
    status: "Assigned",
    reassignmentReason: null,
    previousOwnerId: null,
    firstTouchedAt: null,
    lastTouchAt: null,
    touchCount: 0,
    firstCallCompletedAt: null,
    secondCallCompletedAt: null,
    callCycleCompletedAt: null,
    createdAt: date,
    updatedAt: date,
    account: null,
    contact: null,
    assignedSdr: null,
    assignedTeam: null,
    reminders: []
  }));
}

/**
 * The queue is the surface where a silent cap does the most damage: Assigned,
 * P1 and Overdue are counted off this very slice, so an undercounted Overdue
 * reads to a manager as being on top of the queue.
 *
 * These exist because review proved nothing held any of it — removing the slice
 * entirely left all 775 other tests green while the queue rendered the probe row
 * and counted it into the metrics.
 */
describe("SDR queue truncation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.followUpReminderFindMany.mockResolvedValue([]);
    prismaMocks.workspaceMemberFindMany.mockResolvedValue([]);
    prismaMocks.trackedCallCount.mockResolvedValue(0);
    prismaMocks.activityFindMany.mockResolvedValue([]);
  });

  it("asks for one row past the bound", async () => {
    prismaMocks.sdrAssignmentFindMany.mockResolvedValue([]);

    await readFastSdrQueueModel(session, "ws-1");

    expect(prismaMocks.sdrAssignmentFindMany.mock.calls[0][0].take).toBe(SDR_QUEUE_FETCH_LIMIT + 1);
  });

  it("reports truncation and drops the probe row from the rendered queue", async () => {
    prismaMocks.sdrAssignmentFindMany.mockResolvedValue(assignments(SDR_QUEUE_FETCH_LIMIT + 1));

    const model = await readFastSdrQueueModel(session, "ws-1");

    expect(model?.snapshot.truncated).toBe(true);
    expect(model?.snapshot.assignments).toHaveLength(SDR_QUEUE_FETCH_LIMIT);
    // The metric is the number a manager acts on, so the probe row must not
    // reach it either.
    expect(model?.snapshot.metrics.assigned).toBe(SDR_QUEUE_FETCH_LIMIT);
  });

  it("does not cry truncation on a book that is exactly the bound", async () => {
    prismaMocks.sdrAssignmentFindMany.mockResolvedValue(assignments(SDR_QUEUE_FETCH_LIMIT));

    const model = await readFastSdrQueueModel(session, "ws-1");

    expect(model?.snapshot.truncated).toBe(false);
    expect(model?.snapshot.assignments).toHaveLength(SDR_QUEUE_FETCH_LIMIT);
  });

  it("keeps the probe row out of the recent-activity scope", async () => {
    prismaMocks.sdrAssignmentFindMany.mockResolvedValue(assignments(SDR_QUEUE_FETCH_LIMIT + 1));

    // An SDR session, because the contact/account scope is only applied to the
    // activity query when the read is narrowed to one owner.
    await readFastSdrQueueModel(sdrSession, "ws-1");

    // readRecentActivityRows derives its contact/account scope from the same
    // array. Slicing only on the way into the row mapper let the probe row widen
    // that scope by one record, so the activity panel could surface an item for
    // a contact the queue does not list.
    const activityWhere = prismaMocks.activityFindMany.mock.calls[0][0].where;
    const scoped = JSON.stringify(activityWhere);
    expect(scoped).not.toContain(`contact-${SDR_QUEUE_FETCH_LIMIT}`);
    expect(scoped).toContain(`contact-${SDR_QUEUE_FETCH_LIMIT - 1}`);
  });
});
