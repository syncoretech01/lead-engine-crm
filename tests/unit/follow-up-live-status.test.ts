import { beforeEach, describe, expect, it, vi } from "vitest";

import { readFastFollowUpsModel } from "@/lib/phase1/follow-ups-read-model";
import type { Session } from "@/lib/phase1/types";

const prismaMocks = vi.hoisted(() => ({
  followUpReminderFindMany: vi.fn(),
  workspaceMemberFindMany: vi.fn()
}));

vi.mock("@/lib/phase1/storage-driver", () => ({
  resolveStorageDriver: () => "prisma"
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    followUpReminder: { findMany: prismaMocks.followUpReminderFindMany },
    workspaceMember: { findMany: prismaMocks.workspaceMemberFindMany }
  }
}));

const workspaceId = "workspace-syncore";

const session = {
  role: "MANAGER",
  user: { id: "user-sam", name: "Sam Carter" },
  permissions: ["manage_sdr"]
} as unknown as Session;

const HOURS = 60 * 60 * 1000;
const past = () => new Date(Date.now() - 14 * HOURS).toISOString();
const future = () => new Date(Date.now() + 48 * HOURS).toISOString();

function prismaReminder(overrides: Record<string, unknown> = {}) {
  return {
    id: "reminder-1",
    contactId: "contact-1",
    accountId: "company-1",
    ownerUserId: "user-sam",
    owner: { name: "Sam Carter" },
    title: "Call back",
    channel: "Call",
    dueAt: new Date(past()),
    status: "Open",
    origin: "sdr",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    snoozedUntil: null,
    account: { id: "company-1", name: "Acme Co" },
    contact: { id: "contact-1", fullName: "Lead One", email: "lead@example.com", account: null, contact: null },
    ...overrides
  };
}


/**
 * The Overdue signal on /crm/follow-ups came off the stored column while the due
 * LABEL beside it was computed live, so the same row contradicted itself — a
 * blue "info" badge reading "14h overdue", under an Overdue tile reading 0.
 *
 * The fix is in the SOURCE builder, which is why these tests drive the read
 * model end to end rather than groupFollowUpsByContact: the existing suite
 * hand-builds source rows with an explicit status, so it passes whether or not
 * the mapper is correct.
 */
describe("follow-up status is computed live on the prisma fast path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.workspaceMemberFindMany.mockResolvedValue([]);
  });

  /**
   * There are deliberately no blob-driver tests here.
   *
   * followUpSourceRowsSnapshot calls refreshSlaStatuses first, which already
   * rewrites reminder.status live and snooze-aware — so that path was never
   * broken, and any test written against it passes whether the mapper derives
   * the status or copies the column. Three such tests were written and deleted
   * for exactly that reason: they asserted nothing.
   *
   * The defect lived only on the prisma fast path, which queries the database
   * directly and refreshes nothing.
   */

  describe("prisma fast path", () => {
    it("reports a lapsed follow-up as overdue even though the column says Open", async () => {
      prismaMocks.followUpReminderFindMany.mockResolvedValue([prismaReminder()]);

      const model = await readFastFollowUpsModel(session, workspaceId);

      expect(model?.rows[0].nextStatus).toBe("Overdue");
      // The count the headline Overdue tile is derived from.
      expect(model?.rows[0].overdueFollowUps).toBe(1);
    });

    it("does not call a snoozed follow-up overdue", async () => {
      prismaMocks.followUpReminderFindMany.mockResolvedValue([
        prismaReminder({ snoozedUntil: new Date(future()) })
      ]);

      const model = await readFastFollowUpsModel(session, workspaceId);

      expect(model?.rows[0].nextStatus).toBe("Open");
      expect(model?.rows[0].overdueFollowUps).toBe(0);
    });

    it("counts every lapsed follow-up on a contact, not just the soonest", async () => {
      // The accumulate branch is a separate assignment from the seed branch;
      // fixing only one leaves the busiest contacts under-counted.
      prismaMocks.followUpReminderFindMany.mockResolvedValue([
        prismaReminder({ id: "reminder-1", dueAt: new Date(past()) }),
        prismaReminder({ id: "reminder-2", dueAt: new Date(new Date(past()).getTime() - HOURS) })
      ]);

      const model = await readFastFollowUpsModel(session, workspaceId);

      expect(model?.rows[0].openFollowUps).toBe(2);
      expect(model?.rows[0].overdueFollowUps).toBe(2);
    });
  });

  it("agrees with the live due label rendered beside it", async () => {
    // The reported symptom, asserted as one row: the badge tone (nextStatus) and
    // the label (nextDueLabel) are rendered side by side and must not contradict
    // each other. The label was always live; the status now is too.
    prismaMocks.followUpReminderFindMany.mockResolvedValue([prismaReminder()]);

    const model = await readFastFollowUpsModel(session, workspaceId);
    const row = model!.rows[0];

    expect(row.nextDueLabel).toMatch(/overdue$/);
    expect(row.nextStatus).toBe("Overdue");
  });
});
