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
    origin: "sdr",
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
  it("keeps only follow-ups the SDR actually scheduled", () => {
    const rows = groupFollowUpsByContact([
      sourceRow({ id: "reminder-1" }),
      // Assignment's first-touch SLA reminder.
      sourceRow({ id: "reminder-2", contactId: "contact-2", title: "First touch Michael", origin: "system" }),
      sourceRow({ id: "reminder-3", contactId: "contact-3", status: "Completed" }),
      sourceRow({ id: "reminder-4", contactId: "" })
    ]);

    expect(rows.map((row) => row.contactId)).toEqual(["contact-1"]);
  });

  // The regression that mattered: a touch logged with the follow-up field left
  // blank still creates a reminder, and defaultFollowUpDueAt titles it exactly
  // like an SDR-scheduled one. Title text cannot separate them; origin can.
  it("excludes an auto-defaulted follow-up that is titled like a real one", () => {
    const rows = groupFollowUpsByContact([
      sourceRow({ id: "reminder-auto", contactId: "contact-auto", title: "Follow up with Kimberly Reed", origin: "system" }),
      sourceRow({ id: "reminder-auto-2", contactId: "contact-auto-2", title: "Next step with Michael", origin: "system" })
    ]);

    expect(rows).toEqual([]);
  });

  it("excludes legacy rows that predate the origin field rather than guessing", () => {
    const rows = groupFollowUpsByContact([
      sourceRow({ id: "reminder-legacy", contactId: "contact-legacy", origin: undefined }),
      sourceRow({ id: "reminder-new", contactId: "contact-new", origin: "sdr" })
    ]);

    expect(rows.map((row) => row.contactId)).toEqual(["contact-new"]);
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
