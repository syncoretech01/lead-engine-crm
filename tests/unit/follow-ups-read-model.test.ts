import { describe, expect, it } from "vitest";

import {
  groupFollowUpsByContact,
  type FollowUpSourceRow
} from "@/lib/phase1/follow-ups-read-model";

function sourceRow(overrides: Partial<FollowUpSourceRow> & Pick<FollowUpSourceRow, "id">): FollowUpSourceRow {
  return {
    contactId: "contact-1",
    companyId: "company-1",
    ownerUserId: "user-sdr",
    ownerName: "Zack",
    title: "Follow up with Kimberly",
    channel: "Call",
    dueAt: "2026-08-25T15:00:00.000Z",
    status: "Open",
    createdAt: "2026-08-20T15:00:00.000Z",
    contactName: "Kimberly Reed",
    contactTitle: "Owner",
    email: "kim@example.com",
    phone: "+15551230000",
    grade: "B",
    priority: "P2",
    leadStatus: "Working",
    doNotContact: false,
    isSuppressed: false,
    companyName: "Reed Brokerage",
    ...overrides
  };
}

describe("follow-ups read model", () => {
  it("keeps only contacts with an SDR-scheduled follow-up", () => {
    const rows = groupFollowUpsByContact([
      sourceRow({ id: "reminder-1" }),
      // Assignment creates this one before any SDR work — not scheduled work.
      sourceRow({ id: "reminder-2", contactId: "contact-2", title: "First touch Michael" }),
      sourceRow({ id: "reminder-3", contactId: "contact-3", status: "Completed" }),
      sourceRow({ id: "reminder-4", contactId: "" })
    ]);

    expect(rows.map((row) => row.contactId)).toEqual(["contact-1"]);
  });

  it("collapses several follow-ups per contact onto the soonest one", () => {
    const rows = groupFollowUpsByContact([
      sourceRow({ id: "reminder-late", dueAt: "2026-08-27T15:00:00.000Z", title: "Send proposal" }),
      sourceRow({
        id: "reminder-soon",
        dueAt: "2026-08-22T15:00:00.000Z",
        title: "Call back",
        channel: "Email",
        status: "Overdue"
      })
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      contactId: "contact-1",
      openFollowUps: 2,
      overdueFollowUps: 1,
      nextFollowUpId: "reminder-soon",
      nextTitle: "Call back",
      nextChannel: "Email",
      nextStatus: "Overdue",
      nextDueAt: "2026-08-22T15:00:00.000Z"
    });
  });

  it("orders contacts by the soonest thing due, breaking ties on contact id", () => {
    const rows = groupFollowUpsByContact([
      sourceRow({ id: "reminder-b", contactId: "contact-b", dueAt: "2026-08-26T15:00:00.000Z" }),
      sourceRow({ id: "reminder-a", contactId: "contact-a", dueAt: "2026-08-24T15:00:00.000Z" }),
      sourceRow({ id: "reminder-c", contactId: "contact-c", dueAt: "2026-08-24T15:00:00.000Z" })
    ]);

    expect(rows.map((row) => row.contactId)).toEqual(["contact-a", "contact-c", "contact-b"]);
  });

  it("labels an overdue follow-up as overdue and a future one as remaining", () => {
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const [overdue] = groupFollowUpsByContact([sourceRow({ id: "reminder-past", dueAt: past })]);
    const [upcoming] = groupFollowUpsByContact([sourceRow({ id: "reminder-future", dueAt: future })]);

    expect(overdue.nextDueLabel).toMatch(/overdue$/);
    expect(upcoming.nextDueLabel).toMatch(/left$/);
  });
});
